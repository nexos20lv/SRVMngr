import { app, BrowserWindow, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import { MetricsService } from './metrics-service'
import { Remote } from './remote'
import { SecurityManager } from './security'
import { SitesManager } from './sites'
import { SshManager } from './ssh-manager'
import { ToolsManager } from './tools'

const ssh = new SshManager()
const remote = new Remote(ssh)
const sites = new SitesManager(ssh, remote)
const tools = new ToolsManager(ssh)
const security = new SecurityManager(ssh, remote)
const metrics = new MetricsService(ssh, () => mainWindow?.webContents ?? null)

let mainWindow: BrowserWindow | null = null
let splashWindow: BrowserWindow | null = null
let updateFinished = false

function createSplashWindow(): void {
  splashWindow = new BrowserWindow({
    width: 420,
    height: 260,
    frame: false,
    resizable: false,
    center: true,
    show: false,
    backgroundColor: '#0a0d13',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  const splashHtml = `
    <!doctype html>
    <html lang="fr">
      <head>
        <meta charset="UTF-8">
        <style>
          :root { color-scheme: dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
          body { margin: 0; height: 100vh; display: grid; place-items: center; background: #0a0d13; color: #f5f3ff; }
          main { width: 300px; text-align: center; }
          .mark { width: 52px; height: 52px; margin: 0 auto 18px; border-radius: 15px; display: grid; place-items: center; background: linear-gradient(135deg, #8b5cf6, #5b21b6); box-shadow: 0 12px 30px #7c3aed55; font-size: 25px; }
          h1 { margin: 0; font-size: 20px; letter-spacing: .02em; }
          p { min-height: 20px; margin: 12px 0 18px; color: #9ca3af; font-size: 12px; }
          .track { height: 4px; overflow: hidden; border-radius: 99px; background: #202636; }
          .bar { width: 35%; height: 100%; border-radius: inherit; background: #a78bfa; animation: move 1.2s ease-in-out infinite; }
          @keyframes move { 0% { transform: translateX(-120%); } 50% { transform: translateX(180%); } 100% { transform: translateX(300%); } }
        </style>
      </head>
      <body><main><div class="mark">▦</div><h1>SRV Mngr</h1><p id="message">Préparation de l'application…</p><div class="track"><div class="bar"></div></div></main></body>
    </html>`
  void splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml)}`)
  splashWindow.once('ready-to-show', () => splashWindow?.show())
  splashWindow.on('closed', () => {
    splashWindow = null
  })
}

function updateSplash(message: string): void {
  if (!splashWindow || splashWindow.isDestroyed()) return
  const escaped = JSON.stringify(message)
  void splashWindow.webContents.executeJavaScript(
    `document.getElementById('message').textContent = ${escaped}`,
    true
  ).catch((error: unknown) => {
    console.error('Mise à jour du splash impossible:', error)
  })
}

function finishStartup(): void {
  if (updateFinished) return
  updateFinished = true
  splashWindow?.close()
  splashWindow = null
  mainWindow?.show()
}

function createWindow(): void {
  const isMac = process.platform === 'darwin'
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    backgroundColor: '#0a0d13',
    title: 'SRV Mngr',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    ...(isMac ? { trafficLightPosition: { x: 14, y: 18 } } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (updateFinished || !app.isPackaged) mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && url.startsWith(devUrl)) return
    if (url.startsWith('file://')) return
    event.preventDefault()
    void shell.openExternal(url)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void mainWindow.loadURL(devUrl)
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

function startAutoUpdater(): void {
  if (!app.isPackaged) {
    finishStartup()
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  const send = (status: { state: string; version?: string; percent?: number; error?: string }): void => {
    mainWindow?.webContents.send('updater:status', status)
  }
  autoUpdater.on('checking-for-update', () => {
    updateSplash('Recherche de mises à jour…')
    send({ state: 'checking' })
  })
  autoUpdater.on('update-available', (info) => {
    updateSplash(`Mise à jour ${info.version} disponible…`)
    send({ state: 'available', version: info.version })
  })
  autoUpdater.on('update-not-available', () => {
    updateSplash('Application à jour')
    send({ state: 'current' })
    setTimeout(finishStartup, 450)
  })
  autoUpdater.on('download-progress', (progress) => {
    updateSplash(`Téléchargement de la mise à jour : ${Math.round(progress.percent)} %`)
    send({ state: 'downloading', percent: progress.percent })
  })
  autoUpdater.on('error', (error) => {
    console.error('Mise à jour automatique impossible:', error)
    updateSplash('Mise à jour indisponible, démarrage de l’application…')
    send({ state: 'error', error: error.message })
    setTimeout(finishStartup, 900)
  })
  autoUpdater.on('update-downloaded', () => {
    console.info('Mise à jour téléchargée ; elle sera installée à la fermeture.')
    updateSplash('Mise à jour prête, installation…')
    send({ state: 'downloaded' })
    setTimeout(() => autoUpdater.quitAndInstall(false, true), 350)
  })

  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch((error: unknown) => {
      console.error('Vérification des mises à jour impossible:', error)
    })
  }, 10_000)
}

app.setName('SRV Mngr')
if (process.platform === 'win32') app.setAppUserModelId('in.nxslab.srvmngr')

app.whenReady().then(async () => {
  ssh.onStatus((status) => {
    mainWindow?.webContents.send('ssh:status', status)
  })

  await registerIpc({ ssh, remote, metrics, sites, tools, security, getWindow: () => mainWindow })

  createSplashWindow()
  createWindow()
  startAutoUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  metrics.stopAll()
  ssh.disconnectAll()
})
