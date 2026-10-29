import { BrowserWindow, dialog, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { HostConfig, HostPublic } from '@shared/types'
import { MetricsService } from './metrics-service'
import { Remote } from './remote'
import { SecurityManager } from './security'
import { SitesManager } from './sites'
import { loadHosts, saveHosts, toPublic } from './store'
import type { SshManager } from './ssh-manager'
import { ToolsManager } from './tools'

const MAX_UPLOAD = 96 * 1024 * 1024

type Ok<T> = { ok: true; data: T }
type Err = { ok: false; error: string }

function ok<T>(data: T): Ok<T> {
  return { ok: true, data }
}

/** Enveloppe un handler pour renvoyer une erreur propre au renderer. */
function handle<T>(channel: string, fn: (...args: never[]) => Promise<T> | T): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]): Promise<Ok<T> | Err> => {
    try {
      return ok(await fn(...(args as never[])))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[ipc] ${channel}:`, message)
      return { ok: false, error: message }
    }
  })
}

interface Deps {
  ssh: SshManager
  remote: Remote
  metrics: MetricsService
  sites: SitesManager
  tools: ToolsManager
  security: SecurityManager
  getWindow: () => BrowserWindow | null
}

export async function registerIpc({
  ssh,
  remote,
  metrics,
  sites,
  tools,
  security,
  getWindow
}: Deps): Promise<void> {
  let hosts: HostConfig[] = await loadHosts()
  hosts.forEach((host) => ssh.register(host))

  /* ------------------------------------------------------------- hôtes */

  handle('hosts:list', () => hosts.map(toPublic))

  handle('hosts:save', async (input: Partial<HostConfig> & { id?: string }) => {
    const existing = input.id ? hosts.find((h) => h.id === input.id) : undefined
    const merged: HostConfig = {
      id: existing?.id ?? (input as { id?: string }).id ?? randomUUID(),
      name: (input.name ?? existing?.name ?? input.host ?? '').trim(),
      host: (input.host ?? existing?.host ?? '').trim(),
      port: Number(input.port ?? existing?.port ?? 22),
      username: (input.username ?? existing?.username ?? 'root').trim(),
      password: input.password === undefined ? existing?.password : input.password || undefined,
      privateKey: input.privateKey === undefined ? existing?.privateKey : input.privateKey || undefined,
      passphrase: input.passphrase === undefined ? existing?.passphrase : input.passphrase || undefined,
      sudoPassword: input.sudoPassword === undefined ? existing?.sudoPassword : input.sudoPassword || undefined,
      group: input.group ?? existing?.group,
      color: input.color ?? existing?.color,
      notes: input.notes ?? existing?.notes
    }
    if (!merged.host || !merged.username) throw new Error('Hôte et utilisateur sont obligatoires')

    const index = hosts.findIndex((h) => h.id === merged.id)
    if (index >= 0) hosts[index] = merged
    else hosts.push(merged)

    await saveHosts(hosts)
    ssh.disconnect(merged.id)
    ssh.register(merged)
    metrics.stop(merged.id)
    const pub: HostPublic = toPublic(merged)
    return pub
  })

  handle('hosts:remove', async (id: string) => {
    hosts = hosts.filter((h) => h.id !== id)
    await saveHosts(hosts)
    ssh.unregister(id)
    metrics.stop(id)
    return true
  })

  /* --------------------------------------------------------------- ssh */

  handle('ssh:connect', async (id: string) => {
    await ssh.connect(id, true)
    return ssh.statusOf(id)
  })

  handle('ssh:disconnect', (id: string) => {
    ssh.disconnect(id)
    return true
  })

  handle('ssh:test', (input: Partial<HostConfig>) => {
    const candidate: HostConfig = {
      id: 'test',
      name: input.name || input.host || 'test',
      host: (input.host ?? '').trim(),
      port: Number(input.port) || 22,
      username: (input.username ?? 'root').trim(),
      password: input.password || undefined,
      privateKey: input.privateKey || undefined,
      passphrase: input.passphrase || undefined
    }
    if (!candidate.host) throw new Error('Hôte manquant')
    return ssh.test(candidate)
  })

  handle('ssh:status', (id: string) => ssh.statusOf(id))
  handle('ssh:statuses', () => hosts.map((h) => ssh.statusOf(h.id)))

  handle('ssh:exec', (id: string, command: string, sudo = false) => ssh.exec(id, command, { sudo, timeoutMs: 120_000 }))

  handle('ssh:execMany', (ids: string[], command: string) => ssh.execMany(ids, command, { timeoutMs: 120_000 }))

  /* ----------------------------------------------------------- système */

  handle('sys:info', (id: string) => remote.sysInfo(id))

  handle('metrics:start', (id: string) => {
    metrics.start(id)
    return true
  })

  handle('metrics:stop', (id: string) => {
    metrics.stop(id)
    return true
  })

  /* ----------------------------------------------------------- services */

  handle('services:list', (id: string) => remote.services(id))
  handle('services:action', (id: string, unit: string, action: string) => remote.serviceAction(id, unit, action))
  handle('services:journal', (id: string, unit: string | null, lines = 300) => remote.journal(id, unit, lines))

  /* ------------------------------------------------------------ docker */

  handle('docker:overview', (id: string) => remote.docker(id))
  handle('docker:action', (id: string, container: string, action: 'start' | 'stop' | 'restart' | 'rm') =>
    remote.dockerAction(id, container, action)
  )
  handle('docker:logs', (id: string, container: string, lines = 300) => remote.dockerLogs(id, container, lines))

  /* ------------------------------------------------------------- nginx */

  handle('sites:list', (id: string) => sites.list(id))
  handle('sites:read', (id: string, name: string) => sites.read(id, name))
  handle('sites:save', (id: string, name: string, content: string) => sites.save(id, name, content))
  handle('sites:create', (id: string, input: Parameters<SitesManager['create']>[1]) => sites.create(id, input))
  handle('sites:toggle', (id: string, name: string, enable: boolean) => sites.toggle(id, name, enable))
  handle('sites:remove', (id: string, name: string) => sites.remove(id, name))
  handle('sites:restore', (id: string, name: string, backup: string) => sites.restore(id, name, backup))
  handle('sites:cert', (id: string, domains: string[], email: string) => sites.obtainCertificate(id, domains, email))
  handle('sites:test', (id: string) => remote.nginxTest(id))
  handle('sites:reload', (id: string) => remote.nginxReload(id))

  /* -------------------------------------------------------- boîte à outils */

  handle('tools:databases', (id: string) => tools.databases(id))
  handle('tools:tables', (id: string, db: string) => tools.tables(id, db))
  handle('tools:query', (id: string, db: string, sql: string) => tools.query(id, db, sql))
  handle('tools:dump', (id: string, db: string) => tools.dump(id, db))
  handle('tools:certs', (id: string) => tools.certificates(id))
  handle('tools:renew-cert', (id: string, name?: string) => tools.renewCertificate(id, name))
  handle('tools:fail2ban', (id: string) => tools.fail2ban(id))
  handle('tools:fail2ban-action', (id: string, jail: string, ip: string, action: 'ban' | 'unban') =>
    tools.fail2banAction(id, jail, ip, action)
  )
  handle('tools:cron', (id: string) => tools.cron(id))
  handle('tools:cron-save', (id: string, content: string) => tools.saveCron(id, content))
  handle('tools:ports', (id: string) => tools.ports(id))
  handle('tools:maintenance', (id: string) => tools.maintenance(id))
  handle('tools:maintenance-action', (id: string, action: string) => tools.maintenanceAction(id, action))

  /* ---------------------------------------------------------- sécurité */

  handle('sec:audit', (id: string) => security.audit(id))
  handle('sec:ssh', (id: string) => security.sshConfig(id))
  handle('sec:ssh-apply', (id: string, options: Parameters<SecurityManager['applySshHardening']>[1]) =>
    security.applySshHardening(id, options)
  )
  handle('sec:ssh-revert', (id: string) => security.revertSshHardening(id))
  handle('sec:ssh-key', (id: string, user: string, key: string) => security.addKey(id, user, key))
  handle('sec:firewall', (id: string) => security.firewall(id))
  handle(
    'sec:firewall-action',
    (id: string, action: Parameters<SecurityManager['firewallAction']>[1], options: Parameters<SecurityManager['firewallAction']>[2]) =>
      security.firewallAction(id, action, options)
  )
  handle('sec:accounts', (id: string) => security.accounts(id))
  handle('sec:access', (id: string) => security.access(id))
  handle('sec:updates', (id: string) => security.updates(id))
  handle('sec:apply-updates', (id: string) => security.applySecurityUpdates(id))

  /* -------------------------------------------------------- processus */

  handle('proc:list', (id: string) => remote.processes(id))
  handle('proc:kill', (id: string, pid: number, signal = 'TERM') => remote.killProcess(id, pid, signal))

  handle('host:reboot', (id: string) => remote.reboot(id))
  handle('host:shutdown', (id: string) => remote.shutdown(id))

  /* ---------------------------------------------------------- fichiers */

  handle('files:home', async (id: string) => {
    const res = await ssh.exec(id, 'echo $HOME', { timeoutMs: 10_000 })
    return res.stdout.trim() || '/root'
  })

  handle('files:list', (id: string, dir: string, root: boolean) => remote.listFiles(id, dir, root))
  handle('files:read', (id: string, path: string, root: boolean) => remote.readFile(id, path, root))
  handle('files:write', (id: string, path: string, content: string, root: boolean) =>
    remote.writeFile(id, path, content, root)
  )
  handle('files:mkdir', (id: string, path: string, root: boolean) => remote.mkdir(id, path, root))
  handle('files:remove', (id: string, path: string, root: boolean) => remote.remove(id, path, root))
  handle('files:rename', (id: string, from: string, to: string, root: boolean) => remote.rename(id, from, to, root))
  handle('files:tail', (id: string, path: string, lines: number, root: boolean) => remote.tailFile(id, path, lines, root))

  handle('files:upload', async (id: string, dir: string, root: boolean) => {
    const win = getWindow()
    if (!win) throw new Error('Fenêtre indisponible')
    const picked = await dialog.showOpenDialog(win, { properties: ['openFile'], title: 'Fichier à envoyer' })
    if (picked.canceled || !picked.filePaths[0]) return null
    const localPath = picked.filePaths[0]
    const stat = await readFile(localPath)
    if (stat.length > MAX_UPLOAD) throw new Error('Fichier trop volumineux (max 96 Mo)')
    const remotePath = `${dir.replace(/\/+$/, '')}/${basename(localPath)}`
    await remote.writeBase64(id, remotePath, stat.toString('base64'), root)
    return { path: remotePath, size: stat.length }
  })

  handle('files:download', async (id: string, path: string, root: boolean) => {
    const win = getWindow()
    if (!win) throw new Error('Fenêtre indisponible')
    const picked = await dialog.showSaveDialog(win, { defaultPath: basename(path), title: 'Enregistrer le fichier' })
    if (picked.canceled || !picked.filePath) return null
    const { base64, size } = await remote.download(id, path, root)
    await writeFile(picked.filePath, Buffer.from(base64, 'base64'))
    return { path: picked.filePath, size }
  })

  /* --------------------------------------------------------- terminal */

  handle('term:open', (id: string, cols: number, rows: number) => {
    const win = getWindow()
    return ssh.openShell(id, cols, rows, {
      onData: (termId, data) => win?.webContents.send('term:data', termId, data),
      onClose: (termId) => win?.webContents.send('term:close', termId)
    })
  })

  handle('term:write', (termId: string, data: string) => {
    ssh.writeShell(termId, data)
    return true
  })

  handle('term:resize', (termId: string, cols: number, rows: number) => {
    ssh.resizeShell(termId, cols, rows)
    return true
  })

  handle('term:close', (termId: string) => {
    ssh.closeShell(termId)
    return true
  })
}
