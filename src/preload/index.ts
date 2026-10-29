import { contextBridge, ipcRenderer } from 'electron'
import type { SrvApi } from '@shared/api'

type Envelope<T> = { ok: true; data: T } | { ok: false; error: string }

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as Envelope<T>
  if (!res.ok) throw new Error(res.error || 'Erreur inconnue')
  return res.data
}

function subscribe(...channels: [string, (...args: never[]) => void][]): () => void {
  const cleanups = channels.map(([channel, callback]) => {
    const listener = (_event: Electron.IpcRendererEvent, ...args: unknown[]): void =>
      (callback as (...a: unknown[]) => void)(...args)
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  })
  return () => cleanups.forEach((fn) => fn())
}

const api: SrvApi = {
  platform: process.platform,
  version: process.versions.electron,
  hosts: {
    list: () => invoke('hosts:list'),
    save: (host) => invoke('hosts:save', host),
    importKnownHosts: () => invoke('hosts:import-known-hosts'),
    remove: (id) => invoke('hosts:remove', id)
  },
  sync: {
    session: () => invoke('sync:session'),
    register: (url, email, password) => invoke('sync:register', url, email, password),
    login: (url, email, password) => invoke('sync:login', url, email, password),
    changePassword: (password, newPassword) => invoke('sync:change-password', password, newPassword),
    logout: () => invoke('sync:logout'),
    auto: () => invoke('sync:auto'),
    push: (url, token, password) => invoke('sync:push', url, token, password),
    pull: (url, token, password) => invoke('sync:pull', url, token, password)
  },
  ssh: {
    connect: (id) => invoke('ssh:connect', id),
    disconnect: (id) => invoke('ssh:disconnect', id),
    statuses: () => invoke('ssh:statuses'),
    test: (host) => invoke('ssh:test', host),
    exec: (id, command, sudo = false) => invoke('ssh:exec', id, command, sudo),
    execMany: (ids, command) => invoke('ssh:execMany', ids, command)
  },
  metrics: {
    start: (id) => invoke('metrics:start', id),
    refresh: (id) => invoke('metrics:refresh', id),
    history: (id) => invoke('metrics:history', id),
    stop: (id) => invoke('metrics:stop', id),
    onUpdate: (cb) => subscribe(['metrics:update', cb as never]),
    onError: (cb) => subscribe(['metrics:error', cb as never])
  },
  sysInfo: (id) => invoke('sys:info', id),
  services: {
    list: (id) => invoke('services:list', id),
    action: (id, unit, action) => invoke('services:action', id, unit, action),
    actionMany: (ids, unit, action) => invoke('services:action-many', ids, unit, action),
    updateMany: (ids) => invoke('system:update-many', ids),
    journal: (id, unit, lines = 300) => invoke('services:journal', id, unit, lines)
  },
  docker: {
    overview: (id) => invoke('docker:overview', id),
    action: (id, container, action) => invoke('docker:action', id, container, action),
    logs: (id, container, lines = 300) => invoke('docker:logs', id, container, lines)
  },
  sites: {
    list: (id) => invoke('sites:list', id),
    read: (id, name) => invoke('sites:read', id, name),
    save: (id, name, content) => invoke('sites:save', id, name, content),
    create: (id, input) => invoke('sites:create', id, input),
    toggle: (id, name, enable) => invoke('sites:toggle', id, name, enable),
    remove: (id, name) => invoke('sites:remove', id, name),
    restore: (id, name, backup) => invoke('sites:restore', id, name, backup),
    cert: (id, domains, email) => invoke('sites:cert', id, domains, email),
    test: (id) => invoke('sites:test', id),
    reload: (id) => invoke('sites:reload', id)
  },
  tools: {
    databases: (id) => invoke('tools:databases', id),
    tables: (id, db) => invoke('tools:tables', id, db),
    query: (id, db, sql) => invoke('tools:query', id, db, sql),
    dump: (id, db) => invoke('tools:dump', id, db),
    certs: (id) => invoke('tools:certs', id),
    renewCert: (id, name) => invoke('tools:renew-cert', id, name),
    fail2ban: (id) => invoke('tools:fail2ban', id),
    fail2banAction: (id, jail, ip, action) => invoke('tools:fail2ban-action', id, jail, ip, action),
    cron: (id) => invoke('tools:cron', id),
    cronSave: (id, content) => invoke('tools:cron-save', id, content),
    ports: (id) => invoke('tools:ports', id),
    maintenance: (id) => invoke('tools:maintenance', id),
    maintenanceAction: (id, action) => invoke('tools:maintenance-action', id, action)
  },
  security: {
    audit: (id) => invoke('sec:audit', id),
    ssh: (id) => invoke('sec:ssh', id),
    sshApply: (id, options) => invoke('sec:ssh-apply', id, options),
    sshRevert: (id) => invoke('sec:ssh-revert', id),
    sshAddKey: (id, user, key) => invoke('sec:ssh-key', id, user, key),
    firewall: (id) => invoke('sec:firewall', id),
    firewallAction: (id, action, options) => invoke('sec:firewall-action', id, action, options),
    accounts: (id) => invoke('sec:accounts', id),
    access: (id) => invoke('sec:access', id),
    updates: (id) => invoke('sec:updates', id),
    applyUpdates: (id) => invoke('sec:apply-updates', id)
  },
  proc: {
    list: (id) => invoke('proc:list', id),
    kill: (id, pid, signal = 'TERM') => invoke('proc:kill', id, pid, signal)
  },
  host: {
    reboot: (id) => invoke('host:reboot', id),
    shutdown: (id) => invoke('host:shutdown', id)
  },
  files: {
    home: (id) => invoke('files:home', id),
    list: (id, dir, root) => invoke('files:list', id, dir, root),
    read: (id, path, root) => invoke('files:read', id, path, root),
    write: (id, path, content, root) => invoke('files:write', id, path, content, root),
    mkdir: (id, path, root) => invoke('files:mkdir', id, path, root),
    remove: (id, path, root) => invoke('files:remove', id, path, root),
    rename: (id, from, to, root) => invoke('files:rename', id, from, to, root),
    tail: (id, path, lines, root) => invoke('files:tail', id, path, lines, root),
    upload: (id, dir, root) => invoke('files:upload', id, dir, root),
    download: (id, path, root) => invoke('files:download', id, path, root)
  },
  term: {
    open: (id, cols, rows) => invoke('term:open', id, cols, rows),
    write: (termId, data) => invoke('term:write', termId, data),
    resize: (termId, cols, rows) => invoke('term:resize', termId, cols, rows),
    close: (termId) => invoke('term:close', termId),
    onData: (cb) => subscribe(['term:data', cb as never]),
    onClose: (cb) => subscribe(['term:close', cb as never])
  },
  onStatus: (cb) => subscribe(['ssh:status', cb as never]),
  audit: {
    list: () => invoke('audit:list')
  },
  updater: {
    onStatus: (cb) => subscribe(['updater:status', cb as never])
  }
}

contextBridge.exposeInMainWorld('srv', api)
