import type {
  ComposeProject,
  ContainerInfo,
  FileEntry,
  ImageInfo,
  ProcessRow,
  ServiceInfo,
  SysInfo
} from '@shared/types'

export function toNumber(value: string | undefined): number {
  const n = Number.parseFloat(String(value ?? '').replace('%', '').trim())
  return Number.isFinite(n) ? n : 0
}

/* ------------------------------------------------------------------ systemd */

export const SERVICES_COMMAND =
  'LC_ALL=C systemctl list-units --type=service --all --no-pager --no-legend --plain 2>/dev/null'

export const UNIT_FILES_COMMAND =
  'LC_ALL=C systemctl list-unit-files --type=service --no-pager --no-legend 2>/dev/null'

/** Fusionne `list-units` et `list-unit-files` pour connaître aussi l'état `enabled`. */
export function parseServices(unitsOut: string, filesOut: string): ServiceInfo[] {
  const enabled = new Map<string, string>()
  for (const line of filesOut.split('\n')) {
    const parts = line.trim().split(/\s+/)
    if (parts.length >= 2 && parts[0].endsWith('.service')) enabled.set(parts[0], parts[1])
  }
  const services: ServiceInfo[] = []
  for (const line of unitsOut.split('\n')) {
    const clean = line.replace(/^[●*\s]+/, '').trim()
    if (!clean) continue
    const parts = clean.split(/\s+/)
    if (parts.length < 4 || !parts[0].endsWith('.service')) continue
    const [unit, load, active, sub, ...rest] = parts
    if (load === 'not-found') continue
    services.push({
      unit,
      load,
      active,
      sub,
      description: rest.join(' '),
      enabled: enabled.get(unit) ?? 'unknown'
    })
  }
  const rank = (s: ServiceInfo): number => (s.active === 'active' ? 0 : s.active === 'failed' ? 1 : 2)
  return services.sort((a, b) => rank(a) - rank(b) || a.unit.localeCompare(b.unit))
}

/* ------------------------------------------------------------------- docker */

export const DOCKER_PS_COMMAND = "docker ps -a --no-trunc --format '{{json .}}' 2>&1"
export const DOCKER_STATS_COMMAND = "docker stats --no-stream --format '{{json .}}' 2>&1"
export const DOCKER_IMAGES_COMMAND = "docker images --format '{{json .}}' 2>&1"
export const COMPOSE_LS_COMMAND = "docker compose ls -a --format json 2>&1"

function jsonLines<T>(output: string): T[] {
  const rows: T[] = []
  for (const line of output.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) continue
    try {
      rows.push(JSON.parse(trimmed) as T)
    } catch {
      /* ligne non JSON (avertissement docker, etc.) */
    }
  }
  return rows
}

interface RawContainer {
  ID?: string
  Names?: string
  Image?: string
  State?: string
  Status?: string
  Ports?: string
  Labels?: string
}

export function parseContainers(psOut: string, statsOut = ''): ContainerInfo[] {
  const stats = new Map<string, RawContainer & { CPUPerc?: string; MemUsage?: string; MemPerc?: string; PIDs?: string; NetIO?: string }>()
  for (const row of jsonLines<Record<string, string>>(statsOut)) {
    if (row.Name) stats.set(row.Name.replace(/^\//, ''), row as never)
  }
  return jsonLines<RawContainer>(psOut)
    .map((c) => {
      const name = (c.Names ?? '').replace(/^\//, '')
      const st = stats.get(name)
      return {
        id: c.ID ?? '',
        name,
        image: c.Image ?? '',
        state: (c.State ?? '').toLowerCase(),
        status: c.Status ?? '',
        ports: c.Ports ?? '',
        labels: c.Labels ?? '',
        cpu: st ? toNumber(st.CPUPerc) : undefined,
        mem: st?.MemUsage,
        memPct: st ? toNumber(st.MemPerc) : undefined,
        pids: st?.PIDs,
        netIO: st?.NetIO
      }
    })
    .filter((c) => c.name)
}

export function parseImages(out: string): ImageInfo[] {
  return jsonLines<Record<string, string>>(out).map((i) => ({
    id: i.ID ?? '',
    repo: i.Repository ?? '',
    tag: i.Tag ?? '',
    size: i.Size ?? '',
    created: i.CreatedSince ?? ''
  }))
}

export function parseCompose(out: string): ComposeProject[] {
  const trimmed = out.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('[')) {
    try {
      return (JSON.parse(trimmed) as Array<Record<string, string>>).map((p) => ({
        name: p.Name ?? '?',
        status: p.Status ?? '',
        configFiles: p.ConfigFiles ?? ''
      }))
    } catch {
      return []
    }
  }
  return trimmed
    .split('\n')
    .slice(1)
    .map((line) => line.trim().split(/\s{2,}/))
    .filter((cols) => cols.length >= 2)
    .map((cols) => ({ name: cols[0], status: cols[1], configFiles: cols[2] ?? '' }))
}

/* --------------------------------------------------------------- processus */

export const PROCESSES_COMMAND =
  'LC_ALL=C ps -eo pid=,user=,%cpu=,%mem=,rss=,etime=,stat=,comm= --sort=-%cpu 2>/dev/null | head -80'

export function parseProcesses(out: string): ProcessRow[] {
  const rows: ProcessRow[] = []
  for (const line of out.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.+)$/)
    if (!m) continue
    rows.push({
      pid: Number(m[1]),
      user: m[2],
      cpu: toNumber(m[3]),
      mem: toNumber(m[4]),
      rss: Number(m[5]) * 1024,
      etime: m[6],
      stat: m[7],
      comm: m[8].trim()
    })
  }
  return rows
}

/* -------------------------------------------------------------------- infos */

export const SYSINFO_COMMAND = [
  'export LC_ALL=C',
  `echo '@@host'; hostname`,
  `echo '@@os'; (grep PRETTY_NAME /etc/os-release 2>/dev/null | cut -d= -f2- | tr -d '"')`,
  `echo '@@kernel'; uname -r`,
  `echo '@@arch'; uname -m`,
  `echo '@@uptime'; cut -d' ' -f1 /proc/uptime`,
  `echo '@@ip'; hostname -I 2>/dev/null`,
  `echo '@@tz'; (timedatectl show -p Timezone --value 2>/dev/null || cat /etc/timezone 2>/dev/null)`,
  `echo '@@cpu'; (grep -m1 'model name' /proc/cpuinfo | cut -d: -f2- || grep -m1 'Model' /proc/cpuinfo | cut -d: -f2-)`,
  `echo '@@cores'; nproc`,
  `echo '@@mem'; grep -m1 MemTotal /proc/meminfo | tr -s ' '`,
  `echo '@@user'; whoami`,
  `echo '@@uid'; id -u`,
  `echo '@@virt'; (systemd-detect-virt 2>/dev/null || echo unknown)`,
  `echo '@@docker'; command -v docker >/dev/null && echo yes || echo no`,
  `echo '@@nginx'; command -v nginx >/dev/null && echo yes || echo no`,
  `echo '@@wings'; command -v wings >/dev/null && echo yes || echo no`,
  `echo '@@ptuuid'; (grep -m1 '^uuid:' /etc/pterodactyl/config.yml 2>/dev/null | cut -d: -f2- | tr -d ' ' || true)`
].join('\n')

export function parseSysInfo(out: string): Partial<SysInfo> {
  const map = new Map<string, string>()
  let key = ''
  for (const line of out.split('\n')) {
    const m = line.match(/^@@(\w+)$/)
    if (m) {
      key = m[1]
      map.set(key, '')
      continue
    }
    if (key) map.set(key, (map.get(key) ?? '') + (map.get(key) ? '\n' : '') + line)
  }
  const get = (k: string): string => (map.get(k) ?? '').trim()
  const ips = get('ip').split(/\s+/).filter(Boolean)
  const memKb = Number((get('mem').match(/(\d+)/) ?? [])[1] ?? 0)
  return {
    hostname: get('host'),
    os: get('os'),
    kernel: get('kernel'),
    arch: get('arch'),
    uptime: toNumber(get('uptime')),
    ip: ips[0] ?? '',
    timezone: get('tz') || 'UTC',
    cpuModel: get('cpu').replace(/\s+/g, ' ').trim(),
    cores: Number(get('cores')) || 1,
    memTotal: memKb * 1024,
    user: get('user'),
    isRoot: get('uid') === '0',
    hasDocker: get('docker') === 'yes',
    hasNginx: get('nginx') === 'yes',
    hasWings: get('wings') === 'yes',
    pterodactylNode: get('ptuuid') || undefined,
    virtualization: get('virt') || undefined
  }
}

/* ---------------------------------------------------------------- fichiers */

export const listFileCommand = (path: string): string => {
  const quoted = `'${path.replace(/'/g, `'\\''`)}'`
  return `find ${quoted} -mindepth 1 -maxdepth 1 -printf '%y|%s|%T@|%m|%u|%f\\n' 2>&1`
}

export function parseFileList(out: string, dir: string): FileEntry[] {
  const entries: FileEntry[] = []
  for (const line of out.split('\n')) {
    const parts = line.trim().split('|')
    if (parts.length < 6) continue
    const [type, size, mtime, mode, owner] = parts
    const name = parts.slice(5).join('|')
    if (!name || name === '.' || name === '..') continue
    entries.push({
      name,
      path: dir.replace(/\/$/, '') + '/' + name,
      type: type === 'd' ? 'dir' : type === 'f' ? 'file' : type === 'l' ? 'link' : 'other',
      size: Number(size) || 0,
      mtime: Math.round(Number(mtime) * 1000) || 0,
      mode,
      owner
    })
  }
  return entries.sort((a, b) => {
    if (a.type === 'dir' && b.type !== 'dir') return -1
    if (b.type === 'dir' && a.type !== 'dir') return 1
    return a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' })
  })
}
