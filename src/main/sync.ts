import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import type { HostConfig } from '@shared/types'

export interface SyncConfig {
  url: string
  token: string
}

export class SyncVaultMissingError extends Error {
  constructor() {
    super('Aucun coffre sur le serveur')
    this.name = 'SyncVaultMissingError'
  }
}

export class SyncUnauthorizedError extends Error {
  constructor() {
    super('Session de synchronisation expirée')
    this.name = 'SyncUnauthorizedError'
  }
}

interface Vault {
  version: 1
  updatedAt: number
  hosts: HostConfig[]
}

const deriveKey = (password: string, salt: Buffer): Buffer => scryptSync(password, salt, 32)

export function encryptVault(hosts: HostConfig[], password: string): string {
  if (password.length < 10) throw new Error('Le mot de passe maître doit contenir au moins 10 caractères')
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(password, salt), iv)
  const payload: Vault = { version: 1, updatedAt: Date.now(), hosts }
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return JSON.stringify({ version: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: tag.toString('base64'), data: data.toString('base64') })
}

export function decryptVault(blob: string, password: string): HostConfig[] {
  try {
    const stored = JSON.parse(blob) as { version: 1; salt: string; iv: string; tag: string; data: string }
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(password, Buffer.from(stored.salt, 'base64')), Buffer.from(stored.iv, 'base64'))
    decipher.setAuthTag(Buffer.from(stored.tag, 'base64'))
    const json = Buffer.concat([decipher.update(Buffer.from(stored.data, 'base64')), decipher.final()]).toString('utf8')
    const vault = JSON.parse(json) as Vault
    if (vault.version !== 1 || !Array.isArray(vault.hosts)) throw new Error('Coffre invalide')
    return vault.hosts
  } catch {
    throw new Error('Mot de passe maître incorrect ou coffre invalide')
  }
}

export async function pushVault(config: SyncConfig, blob: string): Promise<void> {
  const response = await fetch(`${config.url.replace(/\/+$/, '')}/v1/vault`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ blob })
  })
  if (!response.ok) {
    if (response.status === 401) throw new SyncUnauthorizedError()
    if (response.status === 502) throw new Error('Serveur de synchronisation inaccessible (502) : vérifie que sync-server et Cloudflare Tunnel sont démarrés')
    throw new Error(`Synchronisation impossible (${response.status})`)
  }
}

export async function pullVault(config: SyncConfig): Promise<string> {
  const response = await fetch(`${config.url.replace(/\/+$/, '')}/v1/vault`, {
    headers: { authorization: `Bearer ${config.token}` }
  })
  if (!response.ok) {
    if (response.status === 401) throw new SyncUnauthorizedError()
    if (response.status === 404) throw new SyncVaultMissingError()
    if (response.status === 502) throw new Error('Serveur de synchronisation inaccessible (502) : vérifie que sync-server et Cloudflare Tunnel sont démarrés')
    throw new Error(`Synchronisation impossible (${response.status})`)
  }
  const body = (await response.json()) as { blob?: string }
  if (!body.blob) throw new Error('Réponse de synchronisation invalide')
  return body.blob
}

export async function registerSyncUser(url: string, email: string, password: string): Promise<string> {
  return authenticateSyncUser(url, '/v1/auth/register', email, password)
}

export async function loginSyncUser(url: string, email: string, password: string): Promise<string> {
  return authenticateSyncUser(url, '/v1/auth/login', email, password)
}

export async function changeSyncPassword(url: string, token: string, password: string, newPassword: string): Promise<void> {
  const response = await fetch(`${url.replace(/\/+$/, '')}/v1/auth/password`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ password, newPassword })
  })
  const body = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) throw new Error(body.error || `Modification impossible (${response.status})`)
}

async function authenticateSyncUser(url: string, path: string, email: string, password: string): Promise<string> {
  const response = await fetch(`${url.replace(/\/+$/, '')}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password })
  })
  const body = (await response.json().catch(() => ({}))) as { token?: string; error?: string }
  if (!response.ok || !body.token) throw new Error(body.error || `Authentification impossible (${response.status})`)
  return body.token
}
