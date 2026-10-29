import { app, BrowserWindow, shell } from 'electron'
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

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    backgroundColor: '#0a0d13',
    title: 'SRV Mngr',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 18 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

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

app.setName('SRV Mngr')

app.whenReady().then(async () => {
  ssh.onStatus((status) => {
    mainWindow?.webContents.send('ssh:status', status)
  })

  await registerIpc({ ssh, remote, metrics, sites, tools, security, getWindow: () => mainWindow })

  createWindow()

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
