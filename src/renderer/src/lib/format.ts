export function fmtBytes(bytes: number, digits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 o'
  const units = ['o', 'Ko', 'Mo', 'Go', 'To', 'Po']
  const exp = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / Math.pow(1024, exp)
  return `${value.toFixed(value >= 100 || exp === 0 ? 0 : digits)} ${units[exp]}`
}

export function fmtRate(bytesPerSecond: number): string {
  return `${fmtBytes(bytesPerSecond)}/s`
}

export function fmtPct(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return '—'
  return `${value.toFixed(digits)}%`
}

export function fmtUptime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d} j ${h} h`
  if (h > 0) return `${h} h ${m} min`
  return `${m} min`
}

export function fmtDate(ts: number): string {
  if (!ts) return '—'
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(ts))
}

export function fmtRelative(ms: number): string {
  const diff = Date.now() - ms
  if (!ms) return '—'
  if (diff < 60_000) return "à l'instant"
  if (diff < 3_600_000) return `il y a ${Math.floor(diff / 60_000)} min`
  if (diff < 86_400_000) return `il y a ${Math.floor(diff / 3_600_000)} h`
  return `il y a ${Math.floor(diff / 86_400_000)} j`
}

export function alertTone(value: number): 'ok' | 'warn' | 'err' {
  if (value >= 90) return 'err'
  if (value >= 75) return 'warn'
  return 'ok'
}

export function shortImage(image: string): string {
  const [repo, tag] = image.split(':')
  const name = repo.split('/').pop() ?? repo
  return tag && tag !== 'latest' ? `${name}:${tag}` : name
}
