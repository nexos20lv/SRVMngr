/** Étape 2 : installation dans /opt + génération de mailcow.conf. */
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
  console.log(`\n===== ${title} (exit ${code}) =====\n${out.trim().slice(0, 6000)}`)
  return out
}

conn.on('ready', async () => {
  await step('DEPENDANCES', `${SUDO} 'DEBIAN_FRONTEND=noninteractive apt-get install -y -qq jq 2>&1 | tail -3; jq --version'`)

  await step('DEPLACEMENT /OPT', `${SUDO} 'if [ -d /opt/mailcow-dockerized/.git ]; then echo "deja present"; else rm -rf /opt/mailcow-dockerized; git clone -q https://github.com/mailcow/mailcow-dockerized.git /opt/mailcow-dockerized && chown -R sproot:sproot /opt/mailcow-dockerized; fi; ls -ld /opt/mailcow-dockerized; git -C /opt/mailcow-dockerized log -1 --format=%h'`)

  await step('GENERATE_CONFIG', `${SUDO} 'cd /opt/mailcow-dockerized && printf "1\\n" | env MAILCOW_HOSTNAME=webmail.nxslab.netlib.re MAILCOW_TZ=Europe/Paris SKIP_CLAMD=n ./generate_config.sh 2>&1 | tail -25'`)

  await step('CONF GENERE', `${SUDO} 'cd /opt/mailcow-dockerized && grep -vE "^#|^$" mailcow.conf'`)

  conn.end()
}).on('error', (e) => { console.error('SSH ERROR', e.message); process.exit(1) })
  .connect({ host: host.host, port: host.port, username: host.username, password: host.password, readyTimeout: 20_000 })
