'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const http = require('node:http')
const path = require('node:path')

const DEFAULT_PORT = 8787
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000
const MAX_BODY_BYTES = 11 * 1024 * 1024
const emailPattern = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function loadEnv(file) {
  return fs.readFile(file, 'utf8').then((contents) => {
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
      if (!match || Object.prototype.hasOwnProperty.call(process.env, match[1])) continue
      let value = match[2]
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      } else {
        value = value.replace(/\s+#.*$/, '')
      }
      process.env[match[1]] = value
    }
  }).catch((error) => {
    if (error.code !== 'ENOENT') throw error
  })
}

function json(res, status, value, headers = {}) {
  res.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
    ...headers
  })
  res.end(JSON.stringify(value))
}

function html(res, value) {
  res.writeHead(200, {
    'cache-control': 'no-store',
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': "default-src 'none'; connect-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'self'",
    'x-content-type-options': 'nosniff'
  })
  res.end(value)
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return fallback
    throw error
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  try {
    await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600 })
    await fs.chmod(temporary, 0o600)
    await fs.rename(temporary, file)
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined)
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Payload trop volumineux'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('error', reject)
    req.on('end', () => {
      try {
        const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON invalide')
        resolve(value)
      } catch (error) {
        reject(error)
      }
    })
  })
}

function passwordHash(password, salt) {
  return crypto.scryptSync(password, salt, 32)
}

function passwordsMatch(password, user) {
  const actual = passwordHash(password, Buffer.from(user.salt, 'base64'))
  const expected = Buffer.from(user.passwordHash, 'base64')
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}

function makeSession(sessions, userId) {
  const token = crypto.randomBytes(32).toString('base64url')
  sessions.set(token, { userId, expiresAt: Date.now() + SESSION_TTL })
  return token
}

async function createServer() {
  await loadEnv(path.join(__dirname, '.env'))

  const port = Number(process.env.SYNC_PORT || process.env.SERVER_PORT || DEFAULT_PORT)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SYNC_PORT invalide')
  const dataDir = path.resolve(process.env.SYNC_DATA || path.join(__dirname, 'data'))
  const usersFile = path.join(dataDir, 'users.json')
  const allowRegistration = process.env.SYNC_ALLOW_REGISTRATION !== 'false'
  const sessions = new Map()

  async function currentUser(req) {
    const header = req.headers.authorization || ''
    if (!header.startsWith('Bearer ')) return null
    const token = header.slice(7).trim()
    const session = sessions.get(token)
    if (!session) return null
    if (session.expiresAt <= Date.now()) {
      sessions.delete(token)
      return null
    }
    const users = await readJson(usersFile, [])
    return users.find((user) => user.id === session.userId) || null
  }

  async function authenticate(req, res) {
    const user = await currentUser(req)
    if (!user) {
      json(res, 401, { error: 'Authentification requise' })
      return null
    }
    return user
  }

  async function auth(req, res, register) {
    const input = await readBody(req)
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
    const password = typeof input.password === 'string' ? input.password : ''
    if (!emailPattern.test(email)) return json(res, 400, { error: 'Email invalide' })
    if (password.length < 10) return json(res, 400, { error: 'Le mot de passe doit contenir au moins 10 caractères' })

    const users = await readJson(usersFile, [])
    let user = users.find((item) => item.email === email)
    if (register) {
      if (!allowRegistration) return json(res, 403, { error: 'Les inscriptions sont désactivées' })
      if (user) return json(res, 409, { error: 'Ce compte existe déjà' })
      const salt = crypto.randomBytes(16)
      user = {
        id: crypto.randomBytes(16).toString('hex'),
        email,
        salt: salt.toString('base64'),
        passwordHash: passwordHash(password, salt).toString('base64')
      }
      users.push(user)
      await writeJson(usersFile, users)
    } else if (!user || !passwordsMatch(password, user)) {
      return json(res, 401, { error: 'Identifiants incorrects' })
    }
    return json(res, 200, { token: makeSession(sessions, user.id), email: user.email })
  }

  async function vault(req, res, user) {
    const file = path.join(dataDir, `vault-${user.id}.json`)
    if (req.method === 'GET') {
      try {
        const value = await fs.readFile(file, 'utf8')
        return json(res, 200, JSON.parse(value))
      } catch (error) {
        if (error.code === 'ENOENT') return json(res, 404, { error: 'Aucun coffre' })
        throw error
      }
    }
    const input = await readBody(req)
    if (typeof input.blob !== 'string' || input.blob.length === 0 || input.blob.length > 10 * 1024 * 1024) {
      return json(res, 400, { error: 'Coffre invalide' })
    }
    await writeJson(file, { blob: input.blob })
    res.writeHead(204, { 'cache-control': 'no-store' }).end()
  }

  const server = http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
      const route = requestUrl.pathname

      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': 'authorization, content-type',
          'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
          'access-control-max-age': '600'
        })
        return res.end()
      }
      if (req.method === 'GET' && route === '/') return html(res, WEB_PAGE)
      if (req.method === 'GET' && route === '/health') return json(res, 200, { ok: true })
      if (req.method === 'POST' && route === '/v1/auth/register') return auth(req, res, true)
      if (req.method === 'POST' && route === '/v1/auth/login') return auth(req, res, false)
      if (req.method === 'GET' && route === '/v1/auth/me') {
        const user = await authenticate(req, res)
        return user ? json(res, 200, { email: user.email }) : undefined
      }
      if (req.method === 'PUT' && route === '/v1/auth/password') {
        const user = await authenticate(req, res)
        if (!user) return undefined
        const input = await readBody(req)
        const password = typeof input.password === 'string' ? input.password : ''
        const newPassword = typeof input.newPassword === 'string' ? input.newPassword : ''
        if (!passwordsMatch(password, user)) return json(res, 401, { error: 'Mot de passe incorrect' })
        if (newPassword.length < 10) return json(res, 400, { error: 'Le nouveau mot de passe doit contenir au moins 10 caractères' })
        const users = await readJson(usersFile, [])
        const index = users.findIndex((item) => item.id === user.id)
        const salt = crypto.randomBytes(16)
        users[index] = { ...users[index], salt: salt.toString('base64'), passwordHash: passwordHash(newPassword, salt).toString('base64') }
        await writeJson(usersFile, users)
        return json(res, 200, { ok: true })
      }
      if ((req.method === 'GET' || req.method === 'PUT') && route === '/v1/vault') {
        const user = await authenticate(req, res)
        return user ? vault(req, res, user) : undefined
      }
      return json(res, 404, { error: 'Route introuvable' })
    } catch (error) {
      console.error('[sync-server]', error)
      return json(res, error.message === 'Payload trop volumineux' ? 413 : 400, { error: error.message || 'Erreur serveur' })
    }
  })

  server.on('error', (error) => console.error('[sync-server] network error:', error))
  server.listen(port, '0.0.0.0', () => {
    console.log(`SRV Mngr Sync Server listening on port ${port}`)
    console.log(`Listening on port ${port}`)
    console.log(`Local: http://0.0.0.0:${port}`)
  })
}

const WEB_PAGE = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SRV Mngr Sync</title>
<style>
:root{color-scheme:dark;font:15px system-ui,sans-serif;color:#f5f3ff;background:#080b13}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 10% 0,#35265d,transparent 34%),radial-gradient(circle at 90% 20%,#123146,transparent 30%),#080b13}main{width:min(1040px,calc(100% - 32px));margin:auto;padding:28px 0 56px}header{display:flex;justify-content:space-between;align-items:center;margin-bottom:80px}.brand{display:flex;gap:11px;align-items:center;font-weight:800}.logo{display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:linear-gradient(135deg,#a78bfa,#6366f1);font-size:20px}.brand small{display:block;color:#8691ad;font-size:9px;letter-spacing:1px;text-transform:uppercase}.status{border:1px solid #ffffff1a;border-radius:999px;padding:8px 12px;color:#aab5ce;font-size:11px}.status i{display:inline-block;width:6px;height:6px;border-radius:50%;background:#34d399;margin-right:6px}.hero{display:grid;grid-template-columns:1.1fr .9fr;gap:70px;align-items:center}.eyebrow{display:inline-block;color:#d4caff;background:#241a45;border:1px solid #6048a0;border-radius:99px;padding:7px 11px;font-size:11px;margin-bottom:18px}h1{font-size:clamp(38px,6vw,68px);line-height:.98;letter-spacing:-3px;margin:0 0 20px}h1 span{color:#a78bfa}p{color:#aeb8d4;line-height:1.65;margin:0 0 22px}.checks{display:flex;gap:16px;flex-wrap:wrap;color:#aeb8d4;font-size:11px}.checks b{color:#fff}.card{padding:25px;border:1px solid #35405c;border-radius:20px;background:#151b2af2;box-shadow:0 26px 80px #0008}.card h2{margin:0 0 6px;font-size:20px}.sub{color:#8490ab;font-size:12px;margin-bottom:20px}.tabs{display:flex;gap:4px;padding:4px;background:#0b101a;border-radius:10px}.tabs button,.secondary{flex:1;padding:10px;border:0;border-radius:8px;background:transparent;color:#9da8c1;cursor:pointer}.tabs .active{color:#fff;background:#33245f}label{display:block;color:#b9c3d9;font-size:11px;margin:14px 0 7px}input{width:100%;padding:12px;border:1px solid #303a54;border-radius:10px;background:#0b101a;color:#fff;outline:0}input:focus{border-color:#9b7cf8;box-shadow:0 0 0 3px #8b5cf633}.primary{width:100%;margin-top:18px;padding:12px;border:0;border-radius:10px;color:#fff;font-weight:700;background:linear-gradient(135deg,#9876ff,#6366f1);cursor:pointer}.primary:disabled{opacity:.6}.message{min-height:20px;margin-top:12px;color:#fca5a5;font-size:12px}.muted{color:#8995b2;font-size:11px;line-height:1.5;margin-top:16px}.account{display:none}.account.show{display:block}.auth.hide{display:none}.account-top{display:flex;justify-content:space-between;gap:12px;align-items:center}.account-top button{border:1px solid #303a54;border-radius:9px;padding:9px 11px;color:#d5dcf2;background:#121827;cursor:pointer}.email{color:#a78bfa;font-size:13px;margin:0 0 22px}.features{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:28px}.feature{padding:15px;border:1px solid #29334b;border-radius:14px;background:#111725b8}.feature b{display:block;margin-bottom:6px;font-size:12px}.feature span{color:#8995b2;font-size:11px;line-height:1.4}footer{text-align:center;color:#697692;font-size:11px;margin-top:50px}@media(max-width:760px){header{margin-bottom:48px}.hero{grid-template-columns:1fr;gap:30px;text-align:center}.checks{justify-content:center}.features{grid-template-columns:1fr;text-align:left}}@media(max-width:460px){.status{font-size:0}.status i{margin:0}}
</style></head><body><main>
<header><div class="brand"><div class="logo">☁</div><div>SRV Mngr Sync<small>Cloud sécurisé</small></div></div><div class="status"><i></i>Service opérationnel</div></header>
<section class="hero"><div><div class="eyebrow">● Synchronisation sécurisée</div><h1>Tes VPS.<br><span>Partout avec toi.</span></h1><p>Un espace simple pour retrouver tes serveurs sur tous tes ordinateurs. Le coffre est chiffré avant de quitter ton appareil.</p><div class="checks"><span>✓ <b>AES-256-GCM</b></span><span>✓ <b>Mot de passe maître local</b></span></div><div class="features"><div class="feature"><b>Chiffré</b><span>AES-256-GCM côté client</span></div><div class="feature"><b>Privé</b><span>Le serveur ne lit jamais ton coffre</span></div><div class="feature"><b>Simple</b><span>Connexion automatique</span></div></div></div>
<div class="card auth" id="auth"><h2>Bienvenue sur Sync</h2><div class="sub">Connecte-toi pour gérer ton compte.</div><div class="tabs"><button class="active" data-mode="login">Se connecter</button><button data-mode="register">S'inscrire</button></div><form id="form"><label>Email</label><input id="email" type="email" required autocomplete="email" placeholder="toi@exemple.com"><label>Mot de passe</label><input id="password" type="password" required minlength="10" placeholder="10 caractères minimum"><button class="primary" id="submit">Se connecter</button><div class="message" id="message"></div></form><div class="muted">Le mot de passe maître reste dans l'application SRV Mngr.</div></div>
<div class="card account" id="account"><div class="account-top"><h2>Mon compte</h2><button id="logout">Déconnexion</button></div><div class="email" id="accountEmail"></div><p>Ton coffre reste chiffré et illisible depuis ce site.</p><form id="change"><label>Mot de passe actuel</label><input id="old" type="password" required><label>Nouveau mot de passe</label><input id="next" type="password" minlength="10" required><button class="primary">Modifier le mot de passe</button><div class="message" id="changeMessage"></div></form></div>
</section><footer>SRV Mngr Sync · Le serveur ne stocke que des coffres chiffrés</footer></main>
<script>
const key='srvmngr-sync-token',auth=document.getElementById('auth'),account=document.getElementById('account'),form=document.getElementById('form'),message=document.getElementById('message');let mode='login';
async function request(url,options={}){const headers={'content-type':'application/json',...(options.headers||{})};const token=localStorage.getItem(key);if(token)headers.authorization='Bearer '+token;let response;try{response=await fetch(url,{...options,headers,credentials:'same-origin'})}catch(error){throw Error('Serveur inaccessible. Vérifie Cloudflare Tunnel et réessaie.')}const body=await response.json().catch(()=>({}));if(!response.ok)throw Error(body.error||('Erreur serveur ('+response.status+')'));return body}
function show(email){auth.classList.add('hide');account.classList.add('show');document.getElementById('accountEmail').textContent=email}
document.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>{mode=button.dataset.mode;document.querySelectorAll('[data-mode]').forEach(item=>item.classList.toggle('active',item===button));document.getElementById('submit').textContent=mode==='login'?'Se connecter':'Créer mon compte';message.textContent=''}) 
form.onsubmit=async event=>{event.preventDefault();message.textContent='';const submit=document.getElementById('submit');submit.disabled=true;try{const body=await request('/v1/auth/'+mode,{method:'POST',body:JSON.stringify({email:document.getElementById('email').value,password:document.getElementById('password').value})});localStorage.setItem(key,body.token);show(body.email)}catch(error){message.textContent=error instanceof Error?error.message:'Erreur réseau'}finally{submit.disabled=false}}
document.getElementById('logout').onclick=()=>{localStorage.removeItem(key);account.classList.remove('show');auth.classList.remove('hide')}
document.getElementById('change').onsubmit=async event=>{event.preventDefault();const target=document.getElementById('changeMessage');try{await request('/v1/auth/password',{method:'PUT',body:JSON.stringify({password:document.getElementById('old').value,newPassword:document.getElementById('next').value})});target.style.color='#86efac';target.textContent='Mot de passe modifié.';event.target.reset()}catch(error){target.textContent=error.message}}
if(localStorage.getItem(key))request('/v1/auth/me').then(body=>show(body.email)).catch(()=>localStorage.removeItem(key))
</script></body></html>`

createServer().catch((error) => {
  console.error('[sync-server] startup failed:', error)
  process.exitCode = 1
})
