/**
 * Smoke test de la couche SSH contre les vrais serveurs du fichier hosts.seed.json.
 * Usage : npm run smoke
 */
import { readFileSync } from 'node:fs'
import { SshManager } from '../src/main/ssh-manager'
import { Remote } from '../src/main/remote'
import { METRICS_COMMAND, parseMetrics } from '../src/main/metrics'
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
const ssh = new SshManager()
const remote = new Remote(ssh)

const hosts: HostConfig[] = seed.map((entry, index) => ({ ...entry, id: `smoke-${index}` }))
hosts.forEach((host) => ssh.register(host))

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
const line = (label: string, value: unknown): void => console.log(`  ${label.padEnd(16)} ${String(value)}`)

let failures = 0
const check = (label: string, ok: boolean, detail?: unknown): void => {
  if (!ok) failures += 1
  console.log(`${ok ? '✓' : '✗'} ${label}${detail !== undefined ? ` — ${String(detail).slice(0, 160)}` : ''}`)
}

for (const host of hosts) {
  console.log(`\n=== ${host.name} (${host.host}) ===`)
  try {
    const started = Date.now()
    await ssh.connect(host.id)
    check('connexion SSH', true, `${Date.now() - started} ms`)

    const first = parseMetrics((await ssh.exec(host.id, METRICS_COMMAND)).stdout, undefined)
    await wait(1200)
    const second = parseMetrics((await ssh.exec(host.id, METRICS_COMMAND)).stdout, first.raw)
    const m = second.snapshot
    check('métriques', m.cores > 0 && m.mem.total > 0, `${m.cores} cœurs, RAM ${(m.mem.total / 1024 ** 3).toFixed(1)} Go`)
    line('CPU', `${m.cpu.toFixed(1)} %`)
    line('RAM utilisée', `${(m.mem.used / 1024 ** 3).toFixed(2)} Go`)
    line('Charge', m.load.join(' / '))
    line('Disques', m.disks.map((d) => `${d.mount} ${d.pct}%`).join(', '))
    line('Réseau rx', `${(m.net.rxRate / 1024).toFixed(1)} Ko/s`)
    line('Uptime', `${Math.round(m.uptime / 3600)} h`)
    line('Top process', m.procs[0] ? `${m.procs[0].comm} ${m.procs[0].cpu}%` : '—')

    const info = await remote.sysInfo(host.id)
    check('infos système', !!info.hostname, `${info.os} · ${info.kernel} · ${info.arch}`)
    check('détection outils', true, `docker=${info.hasDocker} nginx=${info.hasNginx} wings=${info.hasWings} sudo=${!info.isRoot}`)

    const services = await remote.services(host.id)
    const failed = services.filter((s) => s.active === 'failed')
    check('services systemd', services.length > 5, `${services.length} unités, ${services.filter((s) => s.active === 'active').length} actives, ${failed.length} en échec`)

    const docker = await remote.docker(host.id)
    check('docker', docker.available, docker.available ? `${docker.containers.length} conteneurs, ${docker.images.length} images, ${docker.compose.length} compose` : docker.error)
    if (docker.containers[0]) line('conteneur', `${docker.containers[0].name.slice(0, 12)} ${docker.containers[0].state} cpu=${docker.containers[0].cpu ?? '?'}%`)

    const sites = await remote.sites(host.id)
    check('sites nginx', sites.length > 0, sites.map((s) => s.domains[0]).join(', '))
    if (sites[0]) line('site', `${sites[0].domains.join(',')} → ${sites[0].proxies[0] ?? sites[0].roots[0] ?? '?'}`)

    const files = await remote.listFiles(host.id, '/etc/nginx/sites-enabled', true)
    check('fichiers (sudo)', files.length > 0, files.map((f) => f.name).join(', '))

    const journal = await remote.journal(host.id, null, 5)
    check('journalctl', journal.trim().length > 0, `${journal.split('\n').length} lignes`)

    const nginx = await remote.nginxTest(host.id)
    check('nginx -t', nginx.code === 0, `${nginx.stdout}${nginx.stderr}`.trim().replace(/\s+/g, ' '))
  } catch (err) {
    check(`${host.name} : exception`, false, err instanceof Error ? err.message : err)
  } finally {
    ssh.disconnect(host.id)
  }
}

console.log(`\n${failures === 0 ? '✅ Tous les contrôles sont passés' : `❌ ${failures} contrôle(s) en échec`}`)
process.exit(failures === 0 ? 0 : 1)
