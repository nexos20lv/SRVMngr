/** Vérifie les blocages Mailcow : port 25 sortant (Oracle), certbot, vhosts nginx, docker en root. */
import { readFileSync } from 'node:fs'
import { Client } from 'ssh2'

interface Seed { name: string; host: string; port: number; username: string; password?: string }
const seed = JSON.parse(readFileSync(new URL('../hosts.seed.json', import.meta.url), 'utf8')) as Seed[]
const host = seed.find((h) => h.name.includes('Perso'))!
const conn = new Client()

function run(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err)
      let out = ''
      stream.on('data', (d: Buffer) => (out += d.toString()))
      stream.stderr.on('data', (d: Buffer) => (out += d.toString()))
      stream.on('close', () => resolve(out))
    })
  })
}

const sections: [string, string][] = [
  ['PORT 25 SORTANT', 'timeout 10 bash -c "echo > /dev/tcp/gmail-smtp-in.l.google.com/25" && echo "25 SORTANT OK" || echo "25 SORTANT BLOQUE"'],
  ['AUTRES PORTS SORTANTS', 'for p in 587 465; do timeout 6 bash -c "echo > /dev/tcp/smtp.gmail.com/$p" && echo "$p OK" || echo "$p bloque"; done'],
  ['CERTBOT', 'which certbot; certbot --version 2>&1; ls /etc/letsencrypt/live 2>/dev/null; ls /etc/letsencrypt/renewal 2>/dev/null | head'],
  ['NGINX TEST', 'printf "0905\\n" | sudo -S -p "" nginx -T 2>/dev/null | grep -E "server_name|ssl_certificate " | head -30'],
  ['VHOST WEBMAIL EXISTANT', 'ls /etc/nginx/sites-enabled/ /etc/nginx/sites-available/ 2>/dev/null | head -30; ls /etc/nginx/conf.d 2>/dev/null | head'],
  ['DOCKER ROOT', 'printf "0905\\n" | sudo -S -p "" docker ps --format "{{.Names}} {{.Ports}}" 2>/dev/null | head -20'],
  ['DAEMON.JSON', 'cat /etc/docker/daemon.json 2>/dev/null || echo "absent"'],
  ['IPV6', 'sysctl -n net.ipv6.conf.all.disable_ipv6; ip -6 route show default 2>/dev/null | head -2'],
  ['TOOLS', 'which git curl wget openssl jq 2>&1; getent passwd sproot | cut -d: -f1,7'],
  ['UFW', 'printf "0905\\n" | sudo -S -p "" ufw status 2>/dev/null | head -12'],
]

conn
  .on('ready', async () => {
    for (const [title, cmd] of sections) {
      const out = await run(cmd)
      console.log(`\n===== ${title} =====\n${out.trim()}`)
    }
    conn.end()
  })
  .on('error', (e) => { console.error('SSH ERROR', e.message); process.exit(1) })
  .connect({ host: host.host, port: host.port, username: host.username, password: host.password, readyTimeout: 20_000 })
