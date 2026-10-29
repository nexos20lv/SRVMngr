import type { WebContents } from 'electron'
import type { MetricsSnapshot } from '@shared/types'
import { METRICS_COMMAND, parseMetrics, type ParsedRaw } from './metrics'
import type { SshManager } from './ssh-manager'

const INTERVAL = 3000

/** Échantillonne chaque hôte actif et pousse les métriques au renderer. */
export class MetricsService {
  private timers = new Map<string, NodeJS.Timeout>()
  private previous = new Map<string, ParsedRaw['raw']>()
  private busy = new Set<string>()
  private failures = new Map<string, number>()

  constructor(
    private ssh: SshManager,
    private getContents: () => WebContents | null
  ) {}

  start(hostId: string): void {
    if (this.timers.has(hostId)) return
    this.failures.set(hostId, 0)
    const tick = (): void => {
      void this.poll(hostId)
    }
    this.timers.set(hostId, setInterval(tick, INTERVAL))
    tick()
  }

  stop(hostId: string): void {
    const timer = this.timers.get(hostId)
    if (timer) clearInterval(timer)
    this.timers.delete(hostId)
    this.previous.delete(hostId)
  }

  stopAll(): void {
    for (const id of [...this.timers.keys()]) this.stop(id)
  }

  private async poll(hostId: string): Promise<void> {
    if (this.busy.has(hostId)) return
    this.busy.add(hostId)
    try {
      const res = await this.ssh.exec(hostId, METRICS_COMMAND, { timeoutMs: 15_000 })
      if (!res.stdout.includes('@@stat')) throw new Error(res.stderr.trim() || 'Réponse vide')
      const parsed = parseMetrics(res.stdout, this.previous.get(hostId))
      this.previous.set(hostId, parsed.raw)
      this.failures.set(hostId, 0)
      this.getContents()?.send('metrics:update', hostId, parsed.snapshot satisfies MetricsSnapshot)
    } catch (err) {
      const count = (this.failures.get(hostId) ?? 0) + 1
      this.failures.set(hostId, count)
      this.getContents()?.send('metrics:error', hostId, err instanceof Error ? err.message : String(err))
      // Après 3 échecs on arrête : évite de marteler SSH (fail2ban côté serveur).
      if (count >= 3) this.stop(hostId)
    } finally {
      this.busy.delete(hostId)
    }
  }
}
