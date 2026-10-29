import { Client, type ClientChannel, type ConnectConfig } from 'ssh2'
import { createHash } from 'node:crypto'
import type { ExecResult, HostConfig, HostStatus, SshStatus } from '@shared/types'
import { stripSudoNoise, withSudo } from './shell'

const MAX_OUTPUT = 8 * 1024 * 1024

export interface ExecOptions {
  sudo?: boolean
  stdin?: string
  timeoutMs?: number
}

interface Connection {
  client: Client
  status: SshStatus
  error?: string
  latencyMs?: number
  since?: number
}

type StatusListener = (status: HostStatus) => void

/**
 * Pool de connexions SSH réutilisables, une par hôte.
 * Toutes les opérations (exec, shell, fichiers) partagent le même client.
 */
export class SshManager {
  private hosts = new Map<string, HostConfig>()
  private connections = new Map<string, Connection>()
  private pending = new Map<string, Promise<Connection>>()
  private listeners = new Set<StatusListener>()
  private shells = new Map<string, ClientChannel>()
  private fingerprintListener: ((host: HostConfig, fingerprint: string) => void) | undefined

  register(host: HostConfig): void {
    this.hosts.set(host.id, host)
  }

  unregister(id: string): void {
    this.disconnect(id)
    this.hosts.delete(id)
  }

  getHost(id: string): HostConfig {
    const host = this.hosts.get(id)
    if (!host) throw new Error(`Hôte inconnu: ${id}`)
    return host
  }

  onStatus(listener: StatusListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onFingerprint(listener: (host: HostConfig, fingerprint: string) => void): () => void {
    this.fingerprintListener = listener
    return () => {
      if (this.fingerprintListener === listener) this.fingerprintListener = undefined
    }
  }

  statusOf(id: string): HostStatus {
    const conn = this.connections.get(id)
    return {
      id,
      status: conn?.status ?? 'offline',
      error: conn?.error,
      latencyMs: conn?.latencyMs,
      since: conn?.since
    }
  }

  private emit(id: string): void {
    const status = this.statusOf(id)
    for (const listener of this.listeners) {
      try {
        listener(status)
      } catch {
        /* listener cassé : on ignore */
      }
    }
  }

  private setStatus(id: string, status: SshStatus, extra: Partial<Connection> = {}): void {
    const conn = this.connections.get(id)
    if (conn) {
      conn.status = status
      if (extra.error !== undefined) conn.error = extra.error
      if (extra.latencyMs !== undefined) conn.latencyMs = extra.latencyMs
      if (extra.since !== undefined) conn.since = extra.since
    }
    this.emit(id)
  }

  private buildConfig(host: HostConfig, observed?: { fingerprint?: string }): ConnectConfig {
    return {
      host: host.host,
      port: host.port || 22,
      username: host.username,
      password: host.password || undefined,
      privateKey: host.privateKey || undefined,
      passphrase: host.passphrase || undefined,
      readyTimeout: 20_000,
      keepaliveInterval: 20_000,
      keepaliveCountMax: 4,
      algorithms: undefined,
      hostVerifier: (key: string | Buffer) => {
        const normalized = typeof key === 'string' && key.startsWith('SHA256:')
          ? key
          : `SHA256:${createHash('sha256').update(typeof key === 'string' ? Buffer.from(key, 'hex') : key).digest('base64').replace(/=+$/, '')}`
        if (observed) observed.fingerprint = normalized
        return !host.hostFingerprint || host.hostFingerprint === normalized
      }
    }
  }

  async connect(id: string, force = false): Promise<void> {
    await this.ensure(id, force)
  }

  /** Teste une configuration sans l'enregistrer (bouton « Tester »). */
  test(host: HostConfig): Promise<{ ok: boolean; latencyMs?: number; error?: string; fingerprint?: string }> {
    return new Promise((resolve) => {
      const client = new Client()
      const started = Date.now()
      let settled = false
      const observed: { fingerprint?: string } = {}
      const finish = (result: { ok: boolean; latencyMs?: number; error?: string }): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try {
          client.end()
        } catch {
          /* ignore */
        }
        resolve({ ...result, fingerprint: observed.fingerprint })
      }
      const timer = setTimeout(() => finish({ ok: false, error: 'Délai dépassé (20 s)' }), 20_000)
      client
        .on('ready', () => finish({ ok: true, latencyMs: Date.now() - started }))
        .on('error', (err) => finish({ ok: false, error: err.message }))
        .connect(this.buildConfig(host, observed))
    })
  }

  private ensure(id: string, force = false): Promise<Connection> {
    if (force) {
      this.disconnect(id)
    }
    const existing = this.connections.get(id)
    if (existing && existing.status === 'online') return Promise.resolve(existing)
    const inFlight = this.pending.get(id)
    if (inFlight) return inFlight

    const host = this.getHost(id)
    const conn: Connection = { client: new Client(), status: 'connecting', since: Date.now() }
    this.connections.set(id, conn)
    this.emit(id)

    const observed: { fingerprint?: string } = {}
    const promise = new Promise<Connection>((resolve, reject) => {
      const started = Date.now()
      let settled = false
      const fail = (message: string): void => {
        if (settled) return
        settled = true
        conn.status = 'error'
        conn.error = message
        this.emit(id)
        this.pending.delete(id)
        try {
          conn.client.end()
        } catch {
          /* socket déjà fermé */
        }
        reject(new Error(observed.fingerprint ? `${message} (empreinte: ${observed.fingerprint})` : message))
      }

      conn.client
        .on('ready', () => {
          if (settled) return
          settled = true
          conn.status = 'online'
          conn.error = undefined
          conn.latencyMs = Date.now() - started
          conn.since = Date.now()
          if (!host.hostFingerprint && observed.fingerprint) {
            host.hostFingerprint = observed.fingerprint
            this.fingerprintListener?.(host, observed.fingerprint)
          }
          this.pending.delete(id)
          this.emit(id)
          resolve(conn)
        })
        .on('error', (err) => {
          fail(err instanceof Error ? err.message : String(err))
        })
        .on('close', () => {
          this.shells.forEach((channel, key) => {
            if (key.startsWith(`${id}:`)) {
              try {
                channel.close()
              } catch {
                /* ignore */
              }
              this.shells.delete(key)
            }
          })
          if (this.connections.get(id) === conn) {
            this.connections.delete(id)
            const status: HostStatus = { id, status: 'offline' }
            for (const listener of this.listeners) {
              try {
                listener(status)
              } catch {
                /* ignore */
              }
            }
          }
        })

      try {
        conn.client.connect(this.buildConfig(host, observed))
      } catch (err) {
        fail(err instanceof Error ? err.message : String(err))
      }
    })

    this.pending.set(id, promise)
    return promise
  }

  disconnect(id: string): void {
    const conn = this.connections.get(id)
    this.pending.delete(id)
    if (!conn) return
    this.connections.delete(id)
    try {
      conn.client.end()
    } catch {
      /* ignore */
    }
    for (const [key, channel] of this.shells) {
      if (key.startsWith(`${id}:`)) {
        try {
          channel.close()
        } catch {
          /* ignore */
        }
        this.shells.delete(key)
      }
    }
    const status: HostStatus = { id, status: 'offline' }
    for (const listener of this.listeners) {
      try {
        listener(status)
      } catch {
        /* ignore */
      }
    }
  }

  disconnectAll(): void {
    for (const id of [...this.connections.keys()]) this.disconnect(id)
  }

  /** Exécute une commande et renvoie stdout/stderr/code. */
  async exec(id: string, command: string, options: ExecOptions = {}): Promise<ExecResult> {
    const conn = await this.ensure(id)
    const host = this.getHost(id)
    const useSudo = options.sudo && host.username !== 'root' && !!host.sudoPassword
    const finalCommand = useSudo ? withSudo(command) : command
    const started = Date.now()

    return new Promise<ExecResult>((resolve, reject) => {
      let stdout = ''
      let stderr = ''
      let exitCode = 0
      let done = false

      const finish = (code: number): void => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve({
          stdout: stripSudoNoise(stdout),
          stderr: stripSudoNoise(stderr),
          code,
          durationMs: Date.now() - started
        })
      }

      const timer = setTimeout(() => {
        if (done) return
        done = true
        stream?.close()
        reject(new Error(`Timeout (${Math.round((options.timeoutMs ?? 60_000) / 1000)}s) : ${command.slice(0, 120)}`))
      }, options.timeoutMs ?? 60_000)

      let stream: ClientChannel | undefined
      conn.client.exec(finalCommand, { env: { LANG: 'C', LC_ALL: 'C' } }, (err, channel) => {
        if (err) {
          done = true
          clearTimeout(timer)
          return reject(err)
        }
        stream = channel
        channel.on('data', (chunk: Buffer) => {
          if (stdout.length < MAX_OUTPUT) stdout += chunk.toString('utf8')
        })
        channel.stderr.on('data', (chunk: Buffer) => {
          if (stderr.length < MAX_OUTPUT) stderr += chunk.toString('utf8')
        })
        channel.on('exit', (code: number | null) => {
          exitCode = code ?? 0
        })
        channel.on('close', () => finish(exitCode))
        channel.on('error', (streamErr: Error) => {
          done = true
          clearTimeout(timer)
          reject(streamErr)
        })

        if (useSudo) channel.write(`${host.sudoPassword}\n`)
        if (options.stdin !== undefined) channel.end(options.stdin)
        else if (useSudo) channel.end()
      })
    })
  }

  /** Ouvre un shell interactif (terminal). */
  async openShell(
    id: string,
    cols: number,
    rows: number,
    handlers: { onData: (termId: string, data: string) => void; onClose: (termId: string) => void }
  ): Promise<string> {
    const conn = await this.ensure(id)
    const termId = `${id}:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`
    return new Promise<string>((resolve, reject) => {
      conn.client.shell(
        { term: 'xterm-256color', cols, rows, width: cols * 8, height: rows * 17 },
        (err, stream) => {
          if (err) return reject(err)
          this.shells.set(termId, stream)
          stream.on('data', (chunk: Buffer) => handlers.onData(termId, chunk.toString('utf8')))
          stream.stderr.on('data', (chunk: Buffer) => handlers.onData(termId, chunk.toString('utf8')))
          stream.on('close', () => {
            this.shells.delete(termId)
            handlers.onClose(termId)
          })
          resolve(termId)
        }
      )
    })
  }

  writeShell(termId: string, data: string): void {
    this.shells.get(termId)?.write(data)
  }

  resizeShell(termId: string, cols: number, rows: number): void {
    const channel = this.shells.get(termId) as (ClientChannel & { setWindow?: (r: number, c: number, h: number, w: number) => void }) | undefined
    try {
      channel?.setWindow?.(rows, cols, rows * 17, cols * 8)
    } catch {
      /* channel fermé */
    }
  }

  closeShell(termId: string): void {
    const channel = this.shells.get(termId)
    if (!channel) return
    this.shells.delete(termId)
    try {
      channel.end('exit\n')
      channel.close()
    } catch {
      /* ignore */
    }
  }

  /** Exécute en parallèle sur plusieurs hôtes (commandes de flotte). */
  async execMany(ids: string[], command: string, options: ExecOptions = {}): Promise<Record<string, ExecResult | { error: string }>> {
    const entries = await Promise.all(
      ids.map(async (id) => {
        try {
          return [id, await this.exec(id, command, options)] as const
        } catch (err) {
          return [id, { error: err instanceof Error ? err.message : String(err) }] as const
        }
      })
    )
    return Object.fromEntries(entries)
  }
}
