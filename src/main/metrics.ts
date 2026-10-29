import type { DiskInfo, MetricsSnapshot, ProcInfo } from '@shared/types'

/**
 * Une seule commande par échantillon : limité à de la lecture de /proc et à df/ps.
 * Volontairement sans sudo (docker/systemctl en ont besoin, pas les métriques).
 */
export const METRICS_COMMAND = [
  'export LC_ALL=C',
  `echo '@@host'; hostname`,
  `echo '@@stat'; head -1 /proc/stat`,
  `echo '@@load'; cut -d' ' -f1-3 /proc/loadavg`,
  `echo '@@mem'; grep -E '^(MemTotal|MemAvailable|SwapTotal|SwapFree|MemFree|Buffers|Cached):' /proc/meminfo`,
  `echo '@@uptime'; cut -d' ' -f1 /proc/uptime`,
  `echo '@@net'; cat /proc/net/dev`,
  `echo '@@disk'; df -P -k -x tmpfs -x devtmpfs -x overlay -x efivarfs -x squashfs -x fuse.lxcfs 2>/dev/null`,
  `echo '@@proc'; ps -eo pid=,%cpu=,%mem=,rss=,comm= --sort=-%cpu 2>/dev/null | head -7`,
  `echo '@@cores'; nproc`,
  `echo '@@users'; who 2>/dev/null | wc -l`,
  `echo '@@temp'; for z in /sys/class/thermal/thermal_zone*/temp; do [ -r "$z" ] && cat "$z"; done 2>/dev/null | head -1`
].join('\n')

interface RawSample {
  time: number
  cpuTotal: number
  cpuIdle: number
  rx: number
  tx: number
}

export interface ParsedRaw {
  snapshot: MetricsSnapshot
  raw: RawSample
}

function sections(stdout: string): Map<string, string[]> {
  const map = new Map<string, string[]>()
  let current = ''
  for (const line of stdout.split('\n')) {
    const m = line.match(/^@@(\w+)$/)
    if (m) {
      current = m[1]
      map.set(current, [])
      continue
    }
    if (current) map.get(current)?.push(line)
  }
  return map
}

function num(value: string | undefined): number {
  const n = Number.parseFloat(String(value ?? '').trim())
  return Number.isFinite(n) ? n : 0
}

export function parseMetrics(stdout: string, previous: RawSample | undefined, now = Date.now()): ParsedRaw {
  const s = sections(stdout)

  const hostname = (s.get('host') ?? []).map((l) => l.trim()).find(Boolean)

  // --- CPU (delta de /proc/stat) ---
  const statLine = (s.get('stat') ?? [])[0] ?? ''
  const statParts = statLine.trim().split(/\s+/).slice(1).map(Number)
  const cpuTotal = statParts.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0)
  const cpuIdle = (statParts[3] ?? 0) + (statParts[4] ?? 0)
  let cpu = 0
  if (previous && cpuTotal > previous.cpuTotal) {
    const dTotal = cpuTotal - previous.cpuTotal
    const dIdle = cpuIdle - previous.cpuIdle
    cpu = Math.min(100, Math.max(0, ((dTotal - dIdle) / dTotal) * 100))
  }

  const load = (s.get('load') ?? [''])[0]
    .trim()
    .split(/\s+/)
    .map((v) => num(v))
  const loadTuple: [number, number, number] = [load[0] ?? 0, load[1] ?? 0, load[2] ?? 0]

  // --- Mémoire ---
  const memMap = new Map<string, number>()
  for (const line of s.get('mem') ?? []) {
    const m = line.match(/^(\w+):\s+(\d+)/)
    if (m) memMap.set(m[1], Number(m[2]) * 1024)
  }
  const memTotal = memMap.get('MemTotal') ?? 0
  const memAvailable = memMap.get('MemAvailable') ?? 0
  const swapTotal = memMap.get('SwapTotal') ?? 0
  const swapFree = memMap.get('SwapFree') ?? 0

  // --- Disques ---
  const disks: DiskInfo[] = []
  const skipped = new Set(['Filesystem', 'devtmpfs'])
  for (const line of s.get('disk') ?? []) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 6 || skipped.has(parts[0])) continue
    const size = Number(parts[1]) * 1024
    const used = Number(parts[2]) * 1024
    const avail = Number(parts[3]) * 1024
    if (!size) continue
    disks.push({
      fs: parts[0],
      mount: parts.slice(5).join(' '),
      size,
      used,
      avail,
      pct: Number.parseFloat(parts[4].replace('%', '')) || 0
    })
  }

  // --- Réseau (agrégat hors loopback) ---
  let rx = 0
  let tx = 0
  for (const line of s.get('net') ?? []) {
    const m = line.match(/^\s*([^\s:]+):\s*(.*)$/)
    if (!m || m[1] === 'lo') continue
    const cols = m[2].trim().split(/\s+/)
    rx += num(cols[0])
    tx += num(cols[8])
  }
  const elapsed = previous ? Math.max(0.2, (now - previous.time) / 1000) : 0
  const rxRate = previous && rx >= previous.rx ? Math.max(0, (rx - previous.rx) / elapsed) : 0
  const txRate = previous && tx >= previous.tx ? Math.max(0, (tx - previous.tx) / elapsed) : 0

  // --- Processus ---
  const procs: ProcInfo[] = []
  for (const line of s.get('proc') ?? []) {
    const m = line.trim().match(/^(\d+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)\s+(.+)$/)
    if (!m) continue
    procs.push({
      pid: Number(m[1]),
      cpu: num(m[2]),
      mem: num(m[3]),
      rss: Number(m[4]) * 1024,
      comm: m[5].trim()
    })
  }

  const tempRaw = num((s.get('temp') ?? [])[0])
  const temp = tempRaw > 1000 ? tempRaw / 1000 : tempRaw > 0 ? tempRaw : undefined

  const snapshot: MetricsSnapshot = {
    time: now,
    cpu,
    cores: num((s.get('cores') ?? [])[0]) || 1,
    load: loadTuple,
    mem: {
      total: memTotal,
      used: Math.max(0, memTotal - memAvailable),
      available: memAvailable,
      swapTotal,
      swapUsed: Math.max(0, swapTotal - swapFree)
    },
    disks,
    net: { rx, tx, rxRate, txRate },
    uptime: num((s.get('uptime') ?? [])[0]),
    procs,
    users: num((s.get('users') ?? [])[0]),
    hostname,
    temp
  }

  return { snapshot, raw: { time: now, cpuTotal, cpuIdle, rx, tx } }
}
