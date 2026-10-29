import { randomBytes } from 'node:crypto'
import type {
  ComposeProject,
  ContainerInfo,
  ExecResult,
  FileEntry,
  ImageInfo,
  ProcessRow,
  ServiceInfo,
  SiteInfo,
  SysInfo
} from '@shared/types'
import {
  COMPOSE_LS_COMMAND,
  DOCKER_IMAGES_COMMAND,
  DOCKER_PS_COMMAND,
  DOCKER_STATS_COMMAND,
  PROCESSES_COMMAND,
  SERVICES_COMMAND,
  SYSINFO_COMMAND,
  UNIT_FILES_COMMAND,
  listFileCommand,
  parseCompose,
  parseContainers,
  parseFileList,
  parseImages,
  parseProcesses,
  parseServices,
  parseSysInfo
} from './parsers'
import { shQuote } from './shell'
import type { SshManager } from './ssh-manager'

export interface DockerOverview {
  available: boolean
  error?: string
  containers: ContainerInfo[]
  images: ImageInfo[]
  compose: ComposeProject[]
}

export interface FileReadResult {
  path: string
  content: string
  size: number
  binary: boolean
  truncated: boolean
}

const MAX_READ = 2 * 1024 * 1024
const MAX_TRANSFER = 96 * 1024 * 1024

/** Opérations métier au-dessus du pool SSH. */
export class Remote {
  constructor(private ssh: SshManager) {}

  sysInfo(id: string): Promise<Partial<SysInfo>> {
    return this.ssh.exec(id, SYSINFO_COMMAND, { timeoutMs: 25_000 }).then((r) => parseSysInfo(r.stdout))
  }

  async services(id: string): Promise<ServiceInfo[]> {
    const [units, files] = await Promise.all([
      this.ssh.exec(id, SERVICES_COMMAND, { timeoutMs: 25_000 }),
      this.ssh.exec(id, UNIT_FILES_COMMAND, { timeoutMs: 25_000 })
    ])
    return parseServices(units.stdout, files.stdout)
  }

  async serviceAction(id: string, unit: string, action: string): Promise<ExecResult> {
    const safeUnit = unit.replace(/[^a-zA-Z0-9@._:-]/g, '')
    const map: Record<string, string> = {
      start: `systemctl start ${safeUnit}`,
      stop: `systemctl stop ${safeUnit}`,
      restart: `systemctl restart ${safeUnit}`,
      reload: `systemctl reload ${safeUnit}`,
      enable: `systemctl enable ${safeUnit}`,
      disable: `systemctl disable ${safeUnit}`
    }
    const command = map[action]
    if (!command) throw new Error(`Action non supportée: ${action}`)
    return this.ssh.exec(id, command, { sudo: true, timeoutMs: 90_000 })
  }

  journal(id: string, unit: string | null, lines = 300): Promise<string> {
    const scope = unit ? `-u ${unit.replace(/[^a-zA-Z0-9@._:-]/g, '')}` : ''
    return this.ssh
      .exec(id, `journalctl ${scope} -n ${Math.min(2000, Math.max(20, lines))} --no-pager -o short-iso 2>&1`, {
        sudo: true,
        timeoutMs: 30_000
      })
      .then((r) => r.stdout || r.stderr)
  }

  async docker(id: string): Promise<DockerOverview> {
    const ps = await this.ssh.exec(id, DOCKER_PS_COMMAND, { sudo: true, timeoutMs: 30_000 })
    if (/permission denied|command not found|Cannot connect to the Docker daemon/i.test(ps.stdout + ps.stderr)) {
      return { available: false, error: (ps.stderr || ps.stdout).trim(), containers: [], images: [], compose: [] }
    }
    const [stats, images, compose] = await Promise.all([
      this.ssh.exec(id, DOCKER_STATS_COMMAND, { sudo: true, timeoutMs: 45_000 }).catch(() => null),
      this.ssh.exec(id, DOCKER_IMAGES_COMMAND, { sudo: true, timeoutMs: 25_000 }).catch(() => null),
      this.ssh.exec(id, COMPOSE_LS_COMMAND, { sudo: true, timeoutMs: 25_000 }).catch(() => null)
    ])
    return {
      available: true,
      containers: parseContainers(ps.stdout, stats?.stdout ?? ''),
      images: images ? parseImages(images.stdout) : [],
      compose: compose ? parseCompose(compose.stdout) : []
    }
  }

  async dockerAction(id: string, container: string, action: 'start' | 'stop' | 'restart' | 'rm'): Promise<ExecResult> {
    const safe = container.replace(/[^a-zA-Z0-9_.-]/g, '')
    return this.ssh.exec(id, `docker ${action} ${safe}`, { sudo: true, timeoutMs: 120_000 })
  }

  dockerLogs(id: string, container: string, lines = 300): Promise<string> {
    const safe = container.replace(/[^a-zA-Z0-9_.-]/g, '')
    return this.ssh
      .exec(id, `docker logs --tail ${Math.min(2000, lines)} ${safe} 2>&1`, { sudo: true, timeoutMs: 30_000 })
      .then((r) => r.stdout || r.stderr)
  }

  nginxTest(id: string): Promise<ExecResult> {
    return this.ssh.exec(id, 'nginx -t 2>&1', { sudo: true, timeoutMs: 25_000 })
  }

  nginxReload(id: string): Promise<ExecResult> {
    return this.ssh.exec(id, 'systemctl reload nginx', { sudo: true, timeoutMs: 30_000 })
  }

  async processes(id: string): Promise<ProcessRow[]> {
    const res = await this.ssh.exec(id, PROCESSES_COMMAND, { timeoutMs: 20_000 })
    return parseProcesses(res.stdout)
  }

  killProcess(id: string, pid: number, signal = 'TERM'): Promise<ExecResult> {
    if (!Number.isInteger(pid) || pid <= 1) throw new Error('PID invalide')
    return this.ssh.exec(id, `kill -${signal} ${pid}`, { sudo: true, timeoutMs: 15_000 })
  }

  reboot(id: string): Promise<ExecResult> {
    return this.ssh.exec(id, 'systemctl reboot', { sudo: true, timeoutMs: 15_000 }).catch((err) => ({
      stdout: '',
      stderr: String(err?.message ?? err),
      code: 0,
      durationMs: 0
    }))
  }

  shutdown(id: string): Promise<ExecResult> {
    return this.ssh.exec(id, 'systemctl poweroff', { sudo: true, timeoutMs: 15_000 }).catch(() => ({
      stdout: '',
      stderr: '',
      code: 0,
      durationMs: 0
    }))
  }

  /* ----------------------------------------------------------- fichiers */

  async listFiles(id: string, dir: string, root: boolean): Promise<FileEntry[]> {
    const res = await this.ssh.exec(id, listFileCommand(dir), { sudo: root, timeoutMs: 25_000 })
    const text = res.stdout + res.stderr
    if (/Permission denied/i.test(text) && !root) throw new Error(`Accès refusé : ${dir} (essaie le mode root)`)
    if (/No such file or directory/i.test(text)) throw new Error(`Dossier introuvable : ${dir}`)
    return parseFileList(res.stdout, dir)
  }

  async readFile(id: string, path: string, root: boolean): Promise<FileReadResult> {
    const res = await this.ssh.exec(id, `head -c ${MAX_READ} ${shQuote(path)} | base64 -w0`, {
      sudo: root,
      timeoutMs: 40_000
    })
    const b64 = res.stdout.trim()
    if (!b64 && (res.stderr || res.code !== 0)) throw new Error(res.stderr.trim() || 'Fichier vide ou inaccessible')
    const buf = Buffer.from(b64, 'base64')
    const binary = buf.includes(0)
    return {
      path,
      content: binary ? '' : buf.toString('utf8'),
      size: buf.length,
      binary,
      truncated: buf.length >= MAX_READ
    }
  }

  async writeFile(id: string, path: string, content: string, root: boolean): Promise<void> {
    const payload = Buffer.from(content, 'utf8').toString('base64')
    await this.writeBase64(id, path, payload, root)
  }

  async writeBase64(id: string, path: string, base64: string, root: boolean): Promise<void> {
    const tmp = `/tmp/srvmngr-${randomBytes(6).toString('hex')}`
    await this.ssh.exec(id, `base64 -d > ${shQuote(tmp)}`, { stdin: base64, timeoutMs: 120_000 })
    const res = await this.ssh.exec(id, `cat ${shQuote(tmp)} > ${shQuote(path)} && rm -f ${shQuote(tmp)}`, {
      sudo: root,
      timeoutMs: 120_000
    })
    if (res.code !== 0) throw new Error(res.stderr.trim() || `Écriture impossible : ${path}`)
  }

  async mkdir(id: string, path: string, root: boolean): Promise<void> {
    const res = await this.ssh.exec(id, `mkdir -p ${shQuote(path)}`, { sudo: root, timeoutMs: 20_000 })
    if (res.code !== 0) throw new Error(res.stderr.trim() || 'mkdir a échoué')
  }

  async remove(id: string, path: string, root: boolean): Promise<void> {
    const res = await this.ssh.exec(id, `rm -rf -- ${shQuote(path)}`, { sudo: root, timeoutMs: 30_000 })
    if (res.code !== 0) throw new Error(res.stderr.trim() || 'Suppression impossible')
  }

  async rename(id: string, from: string, to: string, root: boolean): Promise<void> {
    const res = await this.ssh.exec(id, `mv -- ${shQuote(from)} ${shQuote(to)}`, { sudo: root, timeoutMs: 30_000 })
    if (res.code !== 0) throw new Error(res.stderr.trim() || 'Renommage impossible')
  }

  async download(id: string, path: string, root: boolean): Promise<{ base64: string; size: number }> {
    const res = await this.ssh.exec(
      id,
      `set -o pipefail; head -c ${MAX_TRANSFER} ${shQuote(path)} | base64 -w0`,
      { sudo: root, timeoutMs: 180_000 }
    )
    if (res.code !== 0 && !res.stdout.trim()) throw new Error(res.stderr.trim() || 'Téléchargement impossible')
    const b64 = res.stdout.trim()
    return { base64: b64, size: Buffer.from(b64, 'base64').length }
  }

  async tailFile(id: string, path: string, lines: number, root: boolean): Promise<string> {
    const res = await this.ssh.exec(id, `tail -n ${Math.min(5000, lines)} ${shQuote(path)} 2>&1`, {
      sudo: root,
      timeoutMs: 25_000
    })
    return res.stdout || res.stderr
  }
}
