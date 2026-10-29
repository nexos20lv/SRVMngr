/** Étape 1 : clone de mailcow + génération de la config (aucun démarrage). */
import { readFileSync } from 'node:fs'
import { Client } from 'ssh2'

interface Seed { name: string; host: string; port: number; username: string; password?: string }
const seed = JSON.parse(readFileSync(new URL('../hosts.seed.json', import.meta.url), 'utf8')) as Seed[]
const host = seed.find((h) => h.name.includes('Perso'))!
const conn = new Client()

function run(cmd: string): Promise<{ out: string; code: number }> {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err)
      let out = ''
      stream.on('data', (d: Buffer) => (out += d.toString()))
      stream.stderr.on('data', (d: Buffer) => (out += d.toString()))
      stream.on('close', (code: number) => resolve({ out, code: code ?? 0 }))
    })
  })
}

const SUDO = `printf '0905\\n' | sudo -S -p '' bash -lc `

async function step(title: string, cmd: string): Promise<string> {
  const { out, code } = await run(cmd)
  console.log(`\n===== ${title} (exit ${code}) =====\n${out.trim().slice(0, 4000)}`)
  return out
}

conn.on('ready', async () => {
  await step('EXISTANT ?', `${SUDO} 'ls -la /opt/mailcow-dockerized 2>&1 | head -5'`)

  await step('CLONE', `${SUDO} 'cd /opt && rm -rf /tmp/mc-probe && git clone -q https://github.com/mailcow/mailcow-dockerized.git --depth 1 /tmp/mc-probe 2>&1 | tail -5; ls /tmp/mc-probe | head -20; git -C /tmp/mc-probe log -1 --format=%h\\ %ci'`)

  await step('GENERATE_CONFIG HEAD', `${SUDO} 'sed -n 1,80p /tmp/mc-probe/generate_config.sh'`)

  await step('COMPOSE IPV6', `${SUDO} 'grep -n "enable_ipv6\\|ipv6_address\\|subnet" /tmp/mc-probe/docker-compose.yml | head -40'`)

  await step('ENV/MAILCOW.CONF', `${SUDO} 'ls -l /tmp/mc-probe/mailcow.conf /tmp/mc-probe/.env 2>&1; grep -n "HTTP_PORT\\|HTTPS_PORT\\|_BIND\\|SKIP_IPV6\\|MAILCOW_HOSTNAME" /tmp/mc-probe/generate_config.sh | head -20'`)

  conn.end()
}).on('error', (e) => { console.error('SSH ERROR', e.message); process.exit(1) })
  .connect({ host: host.host, port: host.port, username: host.username, password: host.password, readyTimeout: 20_000 })
