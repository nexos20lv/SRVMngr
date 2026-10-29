import type {
  CertInfo,
  CronJob,
  DatabaseInfo,
  DbQueryResult,
  DbTableInfo,
  Fail2banJail,
  MaintenanceInfo,
  PortInfo
} from '@shared/types'
import { randomBytes } from 'node:crypto'
import { shQuote } from './shell'
import type { SshManager } from './ssh-manager'

const safeDb = (name: string): string => {
  if (!/^[A-Za-z0-9_$-]{1,64}$/.test(name)) throw new Error('Nom de base invalide')
  return name
}

function splitBlocks(output: string, prefix: string): Map<string, string> {
  const map = new Map<string, string>()
  const pattern = new RegExp(`^${prefix}([A-Z]+)$`)
  let key = ''
  for (const line of output.split('\n')) {
    const match = line.match(pattern)
    if (match) {
      key = match[1]
      map.set(key, '')
      continue
    }
    if (key) map.set(key, (map.get(key) ?? '') + line + '\n')
  }
  return map
}

export class ToolsManager {
  constructor(private ssh: SshManager) {}

  private async dbClient(id: string): Promise<string> {
    const res = await this.ssh.exec(id, 'command -v mariadb || command -v mysql || echo none', { timeoutMs: 10_000 })
    const client = res.stdout.trim().split('\n')[0] || 'none'
    if (client === 'none') throw new Error('MariaDB/MySQL n’est pas installé sur cet hôte')
    return client
  }

  /* ------------------------------------------------------------ bases de données */

  async databases(id: string): Promise<DatabaseInfo[]> {
    const client = await this.dbClient(id)
    const sql =
      "SELECT s.schema_name, COALESCE(t.tables,0), COALESCE(ROUND(t.mb,1),0) FROM information_schema.schemata s " +
      'LEFT JOIN (SELECT table_schema, COUNT(*) tables, SUM(data_length+index_length)/1048576 mb FROM information_schema.tables GROUP BY table_schema) t ' +
      "ON t.table_schema = s.schema_name WHERE s.schema_name NOT IN ('information_schema','performance_schema','mysql','sys') ORDER BY 3 DESC, 1"
    const res = await this.ssh.exec(id, `${client} -N -B -e ${shQuote(sql)}`, { sudo: true, timeoutMs: 30_000 })
    if (res.code !== 0) throw new Error(res.stderr.trim() || 'Lecture des bases impossible')
    return res.stdout
      .split('\n')
      .map((line) => line.split('\t'))
      .filter((cols) => cols.length >= 3 && cols[0])
      .map((cols) => ({ name: cols[0], tables: Number(cols[1]) || 0, sizeMb: Number(cols[2]) || 0 }))
  }

  async tables(id: string, db: string): Promise<DbTableInfo[]> {
    const client = await this.dbClient(id)
    const sql =
      'SELECT table_name, COALESCE(table_rows,0), ROUND((COALESCE(data_length,0)+COALESCE(index_length,0))/1048576,2) ' +
      `FROM information_schema.tables WHERE table_schema = ${shQuote(safeDb(db))} ORDER BY 1`
    const res = await this.ssh.exec(id, `${client} -N -B -e ${shQuote(sql)}`, { sudo: true, timeoutMs: 30_000 })
    if (res.code !== 0) throw new Error(res.stderr.trim() || 'Lecture des tables impossible')
    return res.stdout
      .split('\n')
      .map((line) => line.split('\t'))
      .filter((cols) => cols.length >= 3 && cols[0])
      .map((cols) => ({ name: cols[0], rows: Number(cols[1]) || 0, sizeMb: Number(cols[2]) || 0 }))
  }

  async query(id: string, db: string, sql: string): Promise<DbQueryResult> {
    const client = await this.dbClient(id)
    const target = db ? safeDb(db) : undefined
    const tmp = `/tmp/srvmngr-q-${randomBytes(5).toString('hex')}.sql`
    await this.ssh.exec(id, `cat > ${shQuote(tmp)}`, { stdin: sql, timeoutMs: 20_000 })
    const started = Date.now()
    const res = await this.ssh.exec(id, `set -e; trap 'rm -f ${shQuote(tmp)}' EXIT; ${client} --batch ${target ?? ''} < ${shQuote(tmp)}`, {
      sudo: true,
      timeoutMs: 120_000
    })
    const ms = Date.now() - started
    if (res.code !== 0) throw new Error(res.stderr.trim() || 'Requête refusée')

    const lines = res.stdout.replace(/\n$/, '').split('\n').filter((line) => line.length > 0)
    if (!lines.length) return { headers: [], rows: [], ms, message: 'Requête exécutée (aucun résultat retourné)' }
    const headers = lines[0].split('\t')
    const rows = lines.slice(1).map((line) => line.split('\t'))
    return { headers, rows, ms, message: `${rows.length} ligne(s) en ${ms} ms` }
  }

  async dump(id: string, db: string): Promise<{ path: string; size: string }> {
    const name = safeDb(db)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const path = `/root/srvmngr-dumps/${name}-${stamp}.sql.gz`
    const cmd = `mkdir -p /root/srvmngr-dumps && mysqldump --single-transaction --quick --routines ${name} | gzip -6 > ${shQuote(path)} && ls -lh ${shQuote(path)} | awk '{print $5}'`
    const res = await this.ssh.exec(id, cmd, { sudo: true, timeoutMs: 300_000 })
    if (res.code !== 0) throw new Error(res.stderr.trim() || 'Export impossible')
    return { path, size: res.stdout.trim().split('\n').pop() ?? '' }
  }

  /* --------------------------------------------------------------- certificats */

  async certificates(id: string): Promise<CertInfo[]> {
    const res = await this.ssh.exec(id, 'certbot certificates 2>&1', { sudo: true, timeoutMs: 60_000 })
    const text = res.stdout + res.stderr
    if (/No certificates found/i.test(text)) return []
    if (/command not found|certbot: not found/i.test(text)) throw new Error('certbot n’est pas installé')
    const certs: CertInfo[] = []
    for (const block of text.split(/Certificate Name:/).slice(1)) {
      const lines = block.split('\n')
      const name = lines[0].trim()
      const domains = (block.match(/Domains:\s*(.+)/) ?? [])[1]?.trim().split(/\s+/) ?? []
      const expiry = (block.match(/Expiry Date:\s*([^(]+)/) ?? [])[1]?.trim() ?? ''
      const days = Number((block.match(/VALID:\s*(\d+)\s*day/) ?? [])[1] ?? 0)
      const path = (block.match(/Certificate Path:\s*(.+)/) ?? [])[1]?.trim() ?? ''
      if (name) certs.push({ name, domains, expiry, daysLeft: days, path })
    }
    return certs
  }

  async renewCertificate(id: string, name?: string): Promise<{ ok: boolean; output: string }> {
    const scope = name ? `--cert-name ${shQuote(name.replace(/[^A-Za-z0-9.*_-]/g, ''))}` : ''
    const res = await this.ssh.exec(id, `certbot renew ${scope} --non-interactive 2>&1`, {
      sudo: true,
      timeoutMs: 300_000
    })
    return { ok: res.code === 0, output: `${res.stdout}${res.stderr}`.trim() }
  }

  /* ----------------------------------------------------------------- fail2ban */

  async fail2ban(id: string): Promise<{ active: boolean; jails: Fail2banJail[] }> {
    const active = await this.ssh.exec(id, 'systemctl is-active fail2ban 2>/dev/null || true', { timeoutMs: 10_000 })
    if (active.stdout.trim() !== 'active') return { active: false, jails: [] }

    const list = await this.ssh.exec(id, 'fail2ban-client status 2>&1', { sudo: true, timeoutMs: 20_000 })
    const jailsLine = (list.stdout.match(/Jail list:\s*(.+)/) ?? [])[1] ?? ''
    const names = jailsLine
      .split(',')
      .map((j) => j.trim())
      .filter(Boolean)

    const jails: Fail2banJail[] = []
    for (const name of names) {
      const res = await this.ssh.exec(id, `fail2ban-client status ${shQuote(name.replace(/[^A-Za-z0-9_-]/g, ''))} 2>&1`, {
        sudo: true,
        timeoutMs: 20_000
      })
      const banned = Number((res.stdout.match(/Currently banned:\s*(\d+)/) ?? [])[1] ?? 0)
      const total = Number((res.stdout.match(/Total banned:\s*(\d+)/) ?? [])[1] ?? 0)
      const ips = ((res.stdout.match(/Banned IP list:\s*(.*)/) ?? [])[1] ?? '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
      jails.push({ name, banned, total, ips })
    }
    return { active: true, jails }
  }

  async fail2banAction(id: string, jail: string, ip: string, action: 'ban' | 'unban'): Promise<string> {
    const safeJail = jail.replace(/[^A-Za-z0-9_-]/g, '')
    const safeIp = ip.replace(/[^0-9a-fA-F:.]/g, '')
    if (!safeJail || !safeIp) throw new Error('Jail ou IP invalide')
    const res = await this.ssh.exec(id, `fail2ban-client set ${safeJail} ${action}ip ${safeIp} 2>&1`, {
      sudo: true,
      timeoutMs: 25_000
    })
    return `${res.stdout}${res.stderr}`.trim() || 'OK'
  }

  /* --------------------------------------------------------------------- cron */

  async cron(id: string): Promise<{ available: boolean; jobs: CronJob[]; rootRaw: string }> {
    const cmd = [
      `printf '\\n@@HAS\\n'; command -v crontab >/dev/null && echo yes || echo no`,
      `printf '\\n@@ROOT\\n'; crontab -l 2>/dev/null | grep -vE '^\\s*(#|$)'`,
      `printf '\\n@@CROND\\n'; for f in /etc/cron.d/*; do [ -f "$f" ] && { printf '\\n@@FILE:%s\\n' "$f"; grep -vE '^\\s*(#|$)' "$f"; }; done`
    ].join('\n')
    const res = await this.ssh.exec(id, cmd, { sudo: true, timeoutMs: 25_000 })
    const available = /@@HAS\nyes/.test(res.stdout)
    const rootBlock = res.stdout.split('@@ROOT\n')[1]?.split('@@CROND')[0] ?? ''
    const rootRaw = rootBlock
      .split('\n')
      .filter((line) => line.trim() && !line.startsWith('@@'))
      .join('\n')

    const jobs: CronJob[] = []
    let section = ''
    let file = ''
    for (const line of res.stdout.split('\n')) {
      if (line === '@@HAS' || line === '@@ROOT' || line === '@@CROND') {
        section = line.slice(2)
        continue
      }
      const fileMatch = line.match(/^@@FILE:(.+)$/)
      if (fileMatch) {
        file = fileMatch[1]
        continue
      }
      const trimmed = line.trim()
      if (!trimmed || trimmed === 'yes' || trimmed === 'no') continue
      if (/^[A-Z_]+=/.test(trimmed)) continue
      if (section === 'HAS') continue

      let schedule = ''
      let command = ''
      if (trimmed.startsWith('@')) {
        const space = trimmed.indexOf(' ')
        schedule = space === -1 ? trimmed : trimmed.slice(0, space)
        command = space === -1 ? '' : trimmed.slice(space + 1).trim()
      } else {
        const parts = trimmed.split(/\s+/)
        if (parts.length < 6) continue
        schedule = parts.slice(0, 5).join(' ')
        command = parts.slice(5).join(' ')
      }
      jobs.push({
        id: `${section}-${file || 'root'}-${jobs.length}`,
        schedule,
        command,
        source: section === 'CROND' ? file : 'crontab root',
        raw: trimmed
      })
    }
    return { available, jobs, rootRaw }
  }

  /** Remplace la crontab root par le contenu fourni. */
  async saveCron(id: string, content: string): Promise<void> {
    const tmp = `/tmp/srvmngr-cron-${randomBytes(5).toString('hex')}`
    await this.ssh.exec(id, `cat > ${shQuote(tmp)}`, { stdin: content, timeoutMs: 20_000 })
    const res = await this.ssh.exec(id, `crontab ${shQuote(tmp)} && rm -f ${shQuote(tmp)}`, {
      sudo: true,
      timeoutMs: 30_000
    })
    if (res.code !== 0) throw new Error(res.stderr.trim() || 'Écriture de la crontab refusée')
  }

  /* ------------------------------------------------------------------- ports */

  async ports(id: string): Promise<PortInfo[]> {
    const res = await this.ssh.exec(id, 'ss -tulpnH 2>/dev/null', { sudo: true, timeoutMs: 25_000 })
    const ports: PortInfo[] = []
    const seen = new Set<string>()
    for (const line of res.stdout.split('\n')) {
      const cols = line.trim().split(/\s+/)
      if (cols.length < 5) continue
      const proto = cols[0]
      const local = cols[4]
      const process = (line.match(/users:\(\("([^"]+)"/) ?? [])[1] ?? '—'
      const colon = local.lastIndexOf(':')
      if (colon === -1) continue
      const port = Number(local.slice(colon + 1))
      if (!Number.isFinite(port)) continue
      const address = local.slice(0, colon) || '*'
      const scope: PortInfo['scope'] =
        /^(127\.|::1$|localhost$)/.test(address) ? 'local' : /^(0\.0\.0\.0|\*|\[::\]|::)$/.test(address) ? 'public' : 'interface'
      const key = `${proto}-${port}-${process}-${scope}`
      if (seen.has(key)) continue
      seen.add(key)
      ports.push({ proto, address, port, process, scope })
    }
    return ports.sort((a, b) => a.port - b.port || a.proto.localeCompare(b.proto))
  }

  /* ------------------------------------------------------------- maintenance */

  async maintenance(id: string): Promise<MaintenanceInfo> {
    const cmd = [
      `printf '\\n@@DISK\\n'; du -x --max-depth=1 / 2>/dev/null | sort -rn | head -12`,
      `printf '\\n@@UPGRADES\\n'; apt list --upgradable 2>/dev/null | tail -n +2 | wc -l`,
      `printf '\\n@@REBOOT\\n'; [ -f /var/run/reboot-required ] && echo yes || echo no`,
      `printf '\\n@@JOURNAL\\n'; journalctl --disk-usage 2>/dev/null | tr -d '\\n'`,
      `printf '\\n@@DOCKER\\n'; docker system df --format '{{.Type}} {{.Reclaimable}}' 2>/dev/null | tr '\\n' '|'`,
      `printf '\\n@@APT\\n'; du -sh /var/cache/apt/archives 2>/dev/null | cut -f1`
    ].join('\n')
    const res = await this.ssh.exec(id, cmd, { sudo: true, timeoutMs: 90_000 })
    const blocks = splitBlocks(res.stdout, '@@')

    const diskUsage = (blocks.get('DISK') ?? '')
      .split('\n')
      .map((line) => line.trim().split(/\s+/))
      .filter((cols) => cols.length >= 2 && Number(cols[0]) > 0)
      .map((cols) => ({ bytes: Number(cols[0]) * 1024, path: cols.slice(1).join(' ') }))

    const journalRaw = (blocks.get('JOURNAL') ?? '').trim()
    const journalSize = ((journalRaw.match(/take up ([0-9.]+\s*[KMGT]?i?B?)/i) ?? [])[1] ?? journalRaw.slice(0, 60)) || '—'

    return {
      diskUsage,
      upgrades: Number((blocks.get('UPGRADES') ?? '0').trim()) || 0,
      rebootRequired: (blocks.get('REBOOT') ?? '').includes('yes'),
      journalSize,
      dockerReclaimable:
        (blocks.get('DOCKER') ?? '')
          .split('|')
          .map((part) => part.trim())
          .filter(Boolean)
          .join(' · ') || '—',
      aptCacheSize: (blocks.get('APT') ?? '').trim() || '—'
    }
  }

  async maintenanceAction(id: string, action: string): Promise<string> {
    const commands: Record<string, { cmd: string; timeout: number }> = {
      'apt-upgrade': {
        cmd: 'apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get -y -o Dpkg::Options::=--force-confdef upgrade',
        timeout: 600_000
      },
      'apt-autoremove': { cmd: 'DEBIAN_FRONTEND=noninteractive apt-get -y autoremove --purge', timeout: 300_000 },
      'apt-clean': { cmd: 'apt-get clean', timeout: 60_000 },
      'journal-vacuum': { cmd: 'journalctl --vacuum-size=200M', timeout: 90_000 },
      'docker-prune': { cmd: 'docker system prune -f', timeout: 180_000 }
    }
    const entry = commands[action]
    if (!entry) throw new Error(`Action inconnue : ${action}`)
    const res = await this.ssh.exec(id, entry.cmd, { sudo: true, timeoutMs: entry.timeout })
    const output = `${res.stdout}${res.stderr}`.trim()
    if (res.code !== 0) throw new Error(output || `Échec de ${action}`)
    return output || 'Terminé'
  }
}
