/** Vérifie les outils (sites, db, certs, fail2ban, cron, ports, maintenance) sur les vrais serveurs. */
import { readFileSync } from 'node:fs'
import { SshManager } from '../src/main/ssh-manager'
import { Remote } from '../src/main/remote'
import { SitesManager } from '../src/main/sites'
import { ToolsManager } from '../src/main/tools'
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
const hosts: HostConfig[] = seed.map((entry, index) => ({ ...entry, id: `tools-${index}` }))
const ssh = new SshManager()
const remote = new Remote(ssh)
const sites = new SitesManager(ssh, remote)
const tools = new ToolsManager(ssh)
hosts.forEach((host) => ssh.register(host))

let failures = 0
const check = (label: string, ok: boolean, detail?: unknown): void => {
  if (!ok) failures += 1
  console.log(`${ok ? '✓' : '✗'} ${label}${detail !== undefined ? ` — ${String(detail).slice(0, 220)}` : ''}`)
}

for (const host of hosts) {
  console.log(`\n=== ${host.name} (${host.host}) ===`)
  try {
    await ssh.connect(host.id)

    const list = await sites.list(host.id)
    check('sites: liste', list.length > 0, list.map((s) => `${s.name}${s.enabled ? '' : '(off)'}:${s.domains[0] ?? '?'}`).join(', '))
    check('sites: available/symlink', list.every((s) => s.managed), `${list.filter((s) => s.managed).length}/${list.length} gérés`)

    const first = list[0]
    if (first) {
      const read = await sites.read(host.id, first.name)
      check('sites: lecture config', read.content.length > 20, `${read.path} (${read.content.length} o)`)
    }

    const dbs = await tools.databases(host.id)
    check('db: liste', true, dbs.map((d) => `${d.name}(${d.tables}t,${d.sizeMb}Mo)`).join(', ') || 'aucune base')
    if (dbs[0]) {
      const tables = await tools.tables(host.id, dbs[0].name)
      check('db: tables', true, `${tables.length} tables dans ${dbs[0].name}`)
      const result = await tools.query(host.id, dbs[0].name, 'SELECT VERSION() AS version, NOW() AS now;')
      check('db: requête', result.headers.length === 2 && result.rows.length === 1, result.rows[0]?.join(' | '))
    }

    const certs = await tools.certificates(host.id)
    check('certs', true, certs.map((c) => `${c.name} (${c.daysLeft}j)`).join(', ') || 'aucun certificat')

    const f2b = await tools.fail2ban(host.id)
    check('fail2ban', f2b.active, f2b.jails.map((j) => `${j.name}:${j.banned}`).join(', '))

    const cron = await tools.cron(host.id)
    check('cron', true, `crontab=${cron.available} · ${cron.jobs.length} tâche(s)`)

    const ports = await tools.ports(host.id)
    check('ports', ports.length > 0, `${ports.length} sockets, ${ports.filter((p) => p.scope === 'public').length} publics`)

    const maintenance = await tools.maintenance(host.id)
    check('maintenance', maintenance.diskUsage.length > 0, `upgrades=${maintenance.upgrades} journal=${maintenance.journalSize} docker=${maintenance.dockerReclaimable}`)
  } catch (err) {
    check(`${host.name}: exception`, false, err instanceof Error ? err.message : err)
  }
}

/* ------------------------------------------------- cycle de vie d'un site (Lyc) */
const target = hosts[1]
console.log(`\n=== Cycle de vie site sur ${target.name} ===`)
try {
  await ssh.connect(target.id)
  const name = 'srvmngr-smoke'
  const created = await sites.create(target.id, {
    name,
    domains: ['srvmngr-smoke.local'],
    type: 'static',
    root: '/tmp/srvmngr-smoke',
    port: 18081,
    createIndex: true
  })
  check('création site', created.ok, created.test)

  const afterCreate = await sites.list(target.id)
  const entry = afterCreate.find((s) => s.name === name)
  check('site listé et actif', !!entry?.enabled, entry ? `${entry.domains.join(',')} → ${entry.roots[0]}` : 'absent')

  if (entry) {
    const saved = await sites.save(target.id, name, `${entry.domains.length ? '' : ''}${await sites.read(target.id, name).then((r) => r.content)}\n# smoke ${Date.now()}\n`)
    check('enregistrement config', saved.ok, saved.ok ? 'nginx rechargé' : saved.test)
    const off = await sites.toggle(target.id, name, false)
    check('désactivation', off.ok, off.test)
    const on = await sites.toggle(target.id, name, true)
    check('réactivation', on.ok, on.test)
  }

  const removed = await sites.remove(target.id, name)
  check('suppression', removed.ok, removed.test)
  const afterRemove = await sites.list(target.id)
  check('site absent après suppression', !afterRemove.some((s) => s.name === name))

  await ssh.exec(target.id, 'rm -rf /tmp/srvmngr-smoke', { sudo: true })
  const probe = await ssh.exec(target.id, 'ls /etc/nginx/sites-enabled/ | grep srvmngr || echo clean')
  check('nettoyage', probe.stdout.includes('clean'), probe.stdout.trim())
} catch (err) {
  check('cycle de vie site', false, err instanceof Error ? err.message : err)
}

ssh.disconnectAll()
console.log(`\n${failures === 0 ? '✅ Tous les contrôles sont passés' : `❌ ${failures} contrôle(s) en échec`}`)
process.exit(failures === 0 ? 0 : 1)
