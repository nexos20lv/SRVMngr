import type { SiteActionResult, SiteInfo, SiteInput } from '@shared/types'
import type { Remote } from './remote'
import { shQuote } from './shell'
import type { SshManager } from './ssh-manager'

const AVAILABLE = '/etc/nginx/sites-available'
const ENABLED = '/etc/nginx/sites-enabled'
const BACKUP_DIR = '/root/srvmngr-backups'

// Les marqueurs sont prefixés d'un saut de ligne : un fichier sans newline final
// ne doit pas coller le marqueur suivant à sa dernière ligne.
export const SITES_COMMAND = [
  `for d in available enabled; do`,
  `  printf '\\n@@DIR:%s\\n' "$d"`,
  `  for f in /etc/nginx/sites-$d/*; do`,
  `    [ -e "$f" ] || continue`,
  `    printf '\\n@@FILE:%s\\n' "$f"`,
  `    cat "$f" 2>/dev/null`,
  `  done`,
  `done`
].join('\n')

interface ParsedConfig {
  domains: string[]
  listens: string[]
  roots: string[]
  proxies: string[]
  php: string[]
  ssl: boolean
}

function parseConfig(body: string): ParsedConfig {
  const clean = body.replace(/#.*$/gm, '')
  const directives = (re: RegExp): string[] => {
    const found: string[] = []
    for (const m of clean.matchAll(re)) {
      const value = m[1].trim().replace(/\s+/g, ' ')
      if (value) found.push(value)
    }
    return [...new Set(found)]
  }
  const domains = directives(/server_name\s+([^;]+);/g)
    .flatMap((value) => value.split(/\s+/))
    .filter((domain) => domain && domain !== '_')

  return {
    domains: [...new Set(domains)],
    listens: [...new Set(directives(/listen\s+([^;]+);/g).map((value) => value.replace(/^\[::\]:/, '')))],
    roots: directives(/^\s*root\s+([^;]+);/gm),
    proxies: directives(/proxy_pass\s+([^;]+);/g),
    php: directives(/fastcgi_pass\s+([^;]+);/g),
    ssl: /ssl_certificate\s/.test(clean)
  }
}

/** Analyse la sortie de SITES_COMMAND (sites-available + sites-enabled). */
export function parseSiteConfigs(output: string): SiteInfo[] {
  interface Bucket {
    available?: { path: string; body: string }
    enabled?: { path: string; body: string }
  }
  const buckets = new Map<string, Bucket>()
  let scope: 'available' | 'enabled' = 'available'
  let current: { path: string; body: string } | null = null

  const flush = (): void => {
    if (!current) return
    const name = current.path.split('/').pop() ?? current.path
    const bucket = buckets.get(name) ?? {}
    bucket[scope] = current
    buckets.set(name, bucket)
    current = null
  }

  for (const line of output.split('\n')) {
    const dirMatch = line.match(/^@@DIR:(\w+)$/)
    if (dirMatch) {
      flush()
      scope = dirMatch[1] === 'enabled' ? 'enabled' : 'available'
      continue
    }
    const fileMatch = line.match(/^@@FILE:(.+)$/)
    if (fileMatch) {
      flush()
      current = { path: fileMatch[1].trim(), body: '' }
      continue
    }
    if (current) current.body += line + '\n'
  }
  flush()

  const sites: SiteInfo[] = []
  for (const [name, bucket] of buckets) {
    const reference = bucket.enabled ?? bucket.available
    if (!reference) continue
    const parsed = parseConfig(reference.body)
    sites.push({
      name,
      file: bucket.enabled?.path ?? bucket.available?.path ?? '',
      availablePath: bucket.available?.path,
      enabled: !!bucket.enabled,
      managed: !!bucket.available,
      domains: parsed.domains,
      listens: parsed.listens,
      roots: parsed.roots,
      proxies: parsed.proxies,
      php: parsed.php,
      ssl: parsed.ssl,
      aliases: parsed.domains.filter((d) => d.startsWith('www.')),
      size: reference.body.length
    })
  }

  return sites.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name))
}

const PHP_FALLBACK = '/run/php/php8.4-fpm.sock'

function buildConfig(input: SiteInput, phpSocket: string): string {
  const domains = input.domains.join(' ')
  const port = input.port && input.port > 0 ? input.port : 80
  const listen = port === 80 ? 'listen 80;\n    listen [::]:80;' : `listen ${port};\n    listen [::]:${port};`
  const head = `server {\n    ${listen}\n    server_name ${domains};\n`

  if (input.type === 'proxy') {
    const target = input.proxyTarget || 'http://127.0.0.1:3000'
    return `${head}
    client_max_body_size 64M;

    location / {
        proxy_pass ${target};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }
}
`
  }

  const root = input.root || `/var/www/${input.name}`
  if (input.type === 'php') {
    return `${head}    root ${root};
    index index.php index.html;

    client_max_body_size 64M;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \\.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:${phpSocket};
    }

    location ~ /\\.ht {
        deny all;
    }
}
`
  }

  return `${head}    root ${root};
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
}
`
}

export class SitesManager {
  constructor(
    private ssh: SshManager,
    private remote: Remote
  ) {}

  async list(id: string): Promise<SiteInfo[]> {
    const res = await this.ssh.exec(id, SITES_COMMAND, { sudo: true, timeoutMs: 30_000 })
    return parseSiteConfigs(res.stdout)
  }

  async read(id: string, name: string): Promise<{ path: string; content: string }> {
    const path = await this.resolvePath(id, name)
    const file = await this.remote.readFile(id, path, true)
    return { path, content: file.content }
  }

  private async resolvePath(id: string, name: string): Promise<string> {
    const safe = name.replace(/[^a-zA-Z0-9._ -]/g, '')
    const res = await this.ssh.exec(id, `test -e ${shQuote(`${AVAILABLE}/${safe}`)} && echo available || echo enabled`, {
      sudo: true,
      timeoutMs: 15_000
    })
    return res.stdout.includes('available') ? `${AVAILABLE}/${safe}` : `${ENABLED}/${safe}`
  }

  private async testAndReload(id: string): Promise<{ ok: boolean; test: string }> {
    const test = await this.remote.nginxTest(id)
    const output = `${test.stdout}${test.stderr}`.trim()
    if (test.code !== 0) return { ok: false, test: output }
    const reload = await this.remote.nginxReload(id)
    if (reload.code !== 0) {
      return { ok: false, test: `${output}\nRechargement : ${reload.stderr || reload.stdout}`.trim() }
    }
    return { ok: true, test: output || 'Configuration valide' }
  }

  async save(id: string, name: string, content: string): Promise<SiteActionResult> {
    const path = await this.resolvePath(id, name)
    const backup = `${path}.bak-${Date.now()}`
    await this.ssh.exec(id, `cp -p ${shQuote(path)} ${shQuote(backup)}`, { sudo: true, timeoutMs: 20_000 })
    await this.remote.writeFile(id, path, content, true)
    const result = await this.testAndReload(id)
    return { ok: result.ok, test: result.test, backup }
  }

  async restore(id: string, name: string, backup: string): Promise<SiteActionResult> {
    const path = await this.resolvePath(id, name)
    if (!backup.startsWith('/etc/nginx/')) throw new Error('Sauvegarde invalide')
    await this.ssh.exec(id, `cp -p ${shQuote(backup)} ${shQuote(path)}`, { sudo: true, timeoutMs: 20_000 })
    const result = await this.testAndReload(id)
    return { ok: result.ok, test: result.test }
  }

  async create(id: string, input: SiteInput): Promise<SiteActionResult> {
    const name = input.name.trim()
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,60}$/.test(name)) throw new Error('Nom invalide (lettres, chiffres, . _ - uniquement)')
    if (!input.domains.length) throw new Error('Au moins un domaine est requis')

    const available = `${AVAILABLE}/${name}`
    const enabled = `${ENABLED}/${name}`
    const exists = await this.ssh.exec(id, `test -e ${shQuote(available)} && echo yes || echo no`, {
      sudo: true,
      timeoutMs: 15_000
    })
    if (exists.stdout.includes('yes')) throw new Error(`Le site « ${name} » existe déjà`)

    let phpSocket = PHP_FALLBACK
    if (input.type === 'php') {
      const socket = await this.ssh.exec(id, 'ls /run/php/php*-fpm.sock 2>/dev/null | head -1', { timeoutMs: 15_000 })
      if (socket.stdout.trim()) phpSocket = socket.stdout.trim().split('\n')[0]
    }

    const root = (input.root || `/var/www/${name}`).replace(/\/+$/, '')
    const config = buildConfig(input, phpSocket)

    // 1. racine web + page d'accueil
    if (input.type !== 'proxy') {
      await this.ssh.exec(id, `mkdir -p ${shQuote(root)}`, { sudo: true, timeoutMs: 20_000 })
      if (input.createIndex) {
        const file = input.type === 'php' ? `${root}/index.php` : `${root}/index.html`
        const body =
          input.type === 'php'
            ? `<?php\n// Page d'accueil générée par SRV Mngr\nheader('Content-Type: text/html; charset=utf-8');\necho '<!doctype html><meta charset="utf-8"><title>' . htmlspecialchars(${JSON.stringify(`${input.domains[0]}`)}) . '</title><h1>Ça marche !</h1><p>Site PHP prêt sur ' . htmlspecialchars($_SERVER['HTTP_HOST'] ?? '') . '.</p>';\n`
            : `<!doctype html>\n<html lang="fr">\n  <head>\n    <meta charset="utf-8" />\n    <meta name="viewport" content="width=device-width, initial-scale=1" />\n    <title>${input.domains[0]}</title>\n    <style>body{font-family:system-ui,sans-serif;background:#0d1119;color:#e9eefb;display:grid;place-items:center;height:100vh;margin:0}h1{margin:0 0 8px}p{color:#8b98ad}</style>\n  </head>\n  <body>\n    <main>\n      <h1>${input.domains[0]}</h1>\n      <p>Site créé depuis SRV Mngr — dépose tes fichiers dans ${root}.</p>\n    </main>\n  </body>\n</html>\n`
        await this.remote.writeFile(id, file, body, true)
      }
    }

    // 2. config + activation
    await this.remote.writeFile(id, available, config, true)
    const link = await this.ssh.exec(id, `ln -sfn ${shQuote(available)} ${shQuote(enabled)}`, { sudo: true, timeoutMs: 15_000 })
    if (link.code !== 0) throw new Error(link.stderr.trim() || 'Activation impossible')

    const result = await this.testAndReload(id)
    if (!result.ok) {
      await this.ssh.exec(id, `rm -f ${shQuote(enabled)} ${shQuote(available)}`, { sudo: true, timeoutMs: 15_000 })
      return { ok: false, test: result.test, message: 'Configuration refusée par nginx : le site a été supprimé.' }
    }
    return { ok: true, test: result.test }
  }

  async toggle(id: string, name: string, enable: boolean): Promise<SiteActionResult> {
    const safe = name.replace(/[^a-zA-Z0-9._ -]/g, '')
    const available = `${AVAILABLE}/${safe}`
    const enabled = `${ENABLED}/${safe}`
    if (enable) {
      const check = await this.ssh.exec(id, `test -e ${shQuote(available)} && echo yes || echo no`, {
        sudo: true,
        timeoutMs: 15_000
      })
      if (!check.stdout.includes('yes')) throw new Error(`Aucun fichier dans sites-available pour « ${safe} »`)
      await this.ssh.exec(id, `ln -sfn ${shQuote(available)} ${shQuote(enabled)}`, { sudo: true, timeoutMs: 15_000 })
    } else {
      await this.ssh.exec(id, `rm -f ${shQuote(enabled)}`, { sudo: true, timeoutMs: 15_000 })
    }
    const result = await this.testAndReload(id)
    return { ok: result.ok, test: result.test }
  }

  async remove(id: string, name: string): Promise<SiteActionResult> {
    const safe = name.replace(/[^a-zA-Z0-9._ -]/g, '')
    const available = `${AVAILABLE}/${safe}`
    const enabled = `${ENABLED}/${safe}`
    const backup = `${BACKUP_DIR}/nginx-${safe}-${new Date().toISOString().replace(/[:.]/g, '-')}`
    await this.ssh.exec(id, `mkdir -p ${BACKUP_DIR} && cp -p ${shQuote(available)} ${shQuote(backup)} 2>/dev/null; true`, {
      sudo: true,
      timeoutMs: 20_000
    })
    await this.ssh.exec(id, `rm -f ${shQuote(enabled)} ${shQuote(available)} && nginx -t >/dev/null 2>&1`, {
      sudo: true,
      timeoutMs: 30_000
    })
    const result = await this.testAndReload(id)
    return { ok: result.ok, test: result.test, backup }
  }

  async certbotAvailable(id: string): Promise<boolean> {
    const res = await this.ssh.exec(id, 'command -v certbot >/dev/null && echo yes || echo no', { timeoutMs: 10_000 })
    return res.stdout.includes('yes')
  }

  async obtainCertificate(id: string, domains: string[], email: string): Promise<{ ok: boolean; output: string }> {
    if (!domains.length) throw new Error('Aucun domaine')
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Adresse e-mail invalide')
    const args = domains.map((domain) => `-d ${shQuote(domain)}`).join(' ')
    const res = await this.ssh.exec(
      id,
      `certbot --nginx ${args} --non-interactive --agree-tos --redirect -m ${shQuote(email)} 2>&1`,
      { sudo: true, timeoutMs: 300_000 }
    )
    return { ok: res.code === 0, output: `${res.stdout}${res.stderr}`.trim() }
  }
}
