import { app, safeStorage } from 'electron'
import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AuditEntry, HostConfig, HostPublic, MetricsSnapshot } from '@shared/types'

interface StoredFile {
  version: number
  encrypted: boolean
  data: string
}

export interface SyncSession {
  url: string
  email: string
  accountPassword: string
  token: string
  masterPassword: string
}

function hostsFile(): string {
  return join(app.getPath('userData'), 'hosts.json')
}

function localFile(name: string): string {
  return join(app.getPath('userData'), name)
}

function readJson<T>(name: string, fallback: T): T {
  try {
    const file = localFile(name)
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : fallback
  } catch (err) {
    console.error(`[store] lecture ${name} impossible:`, err)
    return fallback
  }
}

function writeJson(name: string, value: unknown): void {
  const file = localFile(name)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(value), { mode: 0o600 })
  chmodSync(file, 0o600)
}

export async function loadSyncSession(): Promise<SyncSession | null> {
  const stored = readJson<StoredFile | null>('sync-session.json', null)
  if (!stored) return null
  try {
    const json = stored.encrypted
      ? (await safeStorage.isAsyncEncryptionAvailable()
        ? (await safeStorage.decryptStringAsync(Buffer.from(stored.data, 'base64'))).result
        : safeStorage.decryptString(Buffer.from(stored.data, 'base64')))
      : stored.data
    return JSON.parse(json) as SyncSession
  } catch (err) {
    console.error('[store] lecture sync-session.json impossible:', err)
    return null
  }
}

export async function saveSyncSession(session: SyncSession): Promise<void> {
  const json = JSON.stringify(session)
  let payload: StoredFile
  if (await safeStorage.isAsyncEncryptionAvailable()) {
    payload = { version: 1, encrypted: true, data: (await safeStorage.encryptStringAsync(json)).toString('base64') }
  } else {
    console.warn('[store] chiffrement OS indisponible : session sync stockée en clair')
    payload = { version: 1, encrypted: false, data: json }
  }
  writeJson('sync-session.json', payload)
}

export function clearSyncSession(): void {
  writeJson('sync-session.json', null)
}

export function loadMetricHistory(hostId: string): MetricsSnapshot[] {
  return readJson<Record<string, MetricsSnapshot[]>>('metrics-history.json', {})[hostId] ?? []
}

export function saveMetricHistory(hostId: string, snapshots: MetricsSnapshot[]): void {
  const all = readJson<Record<string, MetricsSnapshot[]>>('metrics-history.json', {})
  all[hostId] = snapshots.slice(-480)
  writeJson('metrics-history.json', all)
}

export function loadAudit(): AuditEntry[] {
  return readJson<AuditEntry[]>('audit.json', [])
}

export function appendAudit(entry: AuditEntry): void {
  writeJson('audit.json', [...loadAudit(), entry].slice(-1000))
}

export function toPublic(host: HostConfig): HostPublic {
  return {
    id: host.id,
    name: host.name,
    host: host.host,
    port: host.port,
    username: host.username,
    group: host.group,
    color: host.color,
    notes: host.notes,
    hasPassword: !!host.password,
    hasKey: !!host.privateKey,
    hasSudo: !!host.sudoPassword,
    hostFingerprint: host.hostFingerprint
  }
}

function normalize(raw: Partial<HostConfig>): HostConfig | null {
  if (!raw.host || !raw.username) return null
  return {
    id: raw.id || randomUUID(),
    name: raw.name?.trim() || raw.host,
    host: raw.host.trim(),
    port: Number(raw.port) || 22,
    username: raw.username.trim(),
    password: raw.password || undefined,
    privateKey: raw.privateKey || undefined,
    passphrase: raw.passphrase || undefined,
    sudoPassword: raw.sudoPassword || undefined,
    hostFingerprint: raw.hostFingerprint?.trim() || undefined,
    group: raw.group || undefined,
    color: raw.color || undefined,
    notes: raw.notes || undefined
  }
}

function seedCandidates(): string[] {
  return [
    join(app.getAppPath(), 'hosts.seed.json'),
    join(process.resourcesPath ?? '', 'hosts.seed.json'),
    join(app.getAppPath(), '..', 'hosts.seed.json')
  ]
}

/** Lit la config chiffrée par le trousseau système, ou importe le seed au premier lancement. */
export async function loadHosts(): Promise<HostConfig[]> {
  const file = hostsFile()
  if (existsSync(file)) {
    try {
      const stored = JSON.parse(readFileSync(file, 'utf8')) as StoredFile
      let json: string
      if (stored.encrypted) {
        if (await safeStorage.isAsyncEncryptionAvailable()) {
          const decrypted = await safeStorage.decryptStringAsync(Buffer.from(stored.data, 'base64'))
          json = decrypted.result
        } else {
          // Repli pour les fichiers écrits par les anciennes versions (API synchrone).
          json = safeStorage.decryptString(Buffer.from(stored.data, 'base64'))
        }
      } else {
        json = stored.data
      }
      const parsed = JSON.parse(json) as Partial<HostConfig>[]
      return parsed.map(normalize).filter((h): h is HostConfig => !!h)
    } catch (err) {
      console.error('[store] lecture hosts.json impossible:', err)
    }
  }

  // Import du seed réservé au développement : un binaire distribué ne doit jamais
  // avaler un fichier d'identifiants posé à côté de lui.
  if (!app.isPackaged) {
    for (const candidate of seedCandidates()) {
      if (!candidate || !existsSync(candidate)) continue
      try {
        const parsed = JSON.parse(readFileSync(candidate, 'utf8')) as Partial<HostConfig>[]
        const hosts = parsed.map(normalize).filter((h): h is HostConfig => !!h)
        if (hosts.length) {
          await saveHosts(hosts)
          return hosts
        }
      } catch (err) {
        console.error('[store] seed invalide:', candidate, err)
      }
    }
  }
  return []
}

export async function saveHosts(hosts: HostConfig[]): Promise<void> {
  const file = hostsFile()
  mkdirSync(dirname(file), { recursive: true })
  const json = JSON.stringify(hosts, null, 2)
  let payload: StoredFile
  if (await safeStorage.isAsyncEncryptionAvailable()) {
    payload = {
      version: 1,
      encrypted: true,
      data: (await safeStorage.encryptStringAsync(json)).toString('base64')
    }
  } else {
    console.warn('[store] chiffrement OS indisponible : secrets stockés en clair')
    payload = { version: 1, encrypted: false, data: json }
  }
  writeFileSync(file, JSON.stringify(payload), { mode: 0o600 })
  chmodSync(file, 0o600)
}
