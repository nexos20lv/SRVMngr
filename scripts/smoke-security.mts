/** Vérifie la couche sécurité (audit, ssh, pare-feu, comptes, accès, mises à jour) sur les vrais serveurs. */
import { readFileSync } from 'node:fs'
import { SshManager } from '../src/main/ssh-manager'
import { Remote } from '../src/main/remote'
import { SecurityManager } from '../src/main/security'
import type { HostConfig } from '../src/shared/types'

interface Seed {
  name: string
  host: string
  port: number
  username: string
  password?: string
  sudoPassword?: string
}

const seed = JSON.parse(readFileSync(new URL('../hosts.seed.json', import.meta.url), 'utf8')) as Seed[]
const hosts: HostConfig[] = seed.map((entry, index) => ({ ...entry, id: `sec-${index}` }))
const ssh = new SshManager()
const remote = new Remote(ssh)
const security = new SecurityManager(ssh, remote)
hosts.forEach((host) => ssh.register(host))

let failures = 0
const check = (label: string, ok: boolean, detail?: unknown): void => {
  if (!ok) failures += 1
  console.log(`${ok ? '✓' : '✗'} ${label}${detail !== undefined ? ` — ${String(detail).slice(0, 260)}` : ''}`)
}

for (const host of hosts) {
  console.log(`\n=== ${host.name} (${host.host}) ===`)
  try {
    const audit = await security.audit(host.id)
    check(`audit score ${audit.score}/100 (${audit.checks.length} contrôles)`, audit.checks.length >= 10)
    for (const c of audit.checks) console.log(`   [${c.status}] ${c.label} — ${c.detail}`)

    const sshInfo = await security.sshConfig(host.id)
    check(
      `ssh: port ${sshInfo.port}, root=${sshInfo.permitRootLogin}, mdp=${sshInfo.passwordAuthentication}, include=${sshInfo.includeDropIn}`,
      Boolean(sshInfo.port) && sshInfo.passwordAuthentication !== 'unknown',
      sshInfo.keys.map((k) => `${k.user}:${k.count}`).join(' ')
    )

    const fw = await security.firewall(host.id)
    check(`pare-feu ${fw.backend} actif=${fw.active} règles=${fw.rules.length}`, Boolean(fw.backend), fw.hint)

    const accounts = await security.accounts(host.id)
    check(`comptes ${accounts.length}`, accounts.length > 0, accounts.map((a) => `${a.user}${a.sudo ? '*' : ''}/${a.passwordState}/${a.keyCount}`).join(' '))

    const access = await security.access(host.id)
    check(
      `accès: ${access.sessions.length} sessions, ${access.lastLogins.length} dernières, ${access.failedCount} échecs/24h, ${access.established.length} connexions`,
      access.lastLogins.length > 0,
      access.lastLogins[0] ? `${access.lastLogins[0].user} ${access.lastLogins[0].from}` : ''
    )

    const upd = await security.updates(host.id)
    check(`maj: ${upd.pending} en attente dont ${upd.securityPending} sécurité, auto=${upd.autoUpdates}`, upd.pending >= 0)
  } catch (err) {
    check(`${host.name} exception`, false, err instanceof Error ? err.message : err)
  }
}

await ssh.dispose?.()
console.log(`\n${failures === 0 ? 'TOUT OK' : `${failures} échec(s)`}`)
process.exit(failures === 0 ? 0 : 1)
