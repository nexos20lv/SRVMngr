import { Notification, type WebContents } from 'electron'
import type { MetricsSnapshot } from '@shared/types'
import { METRICS_COMMAND, parseMetrics, type ParsedRaw } from './metrics'
import type { SshManager } from './ssh-manager'
import { loadMetricHistory, saveMetricHistory } from './store'

const INTERVAL = 3000

/** Échantillonne chaque hôte actif et pousse les métriques au renderer. */
export class MetricsService {
  private timers = new Map<string, NodeJS.Timeout>()
  private previous = new Map<string, ParsedRaw['raw']>()
  private busy = new Set<string>()
  private failures = new Map<string, number>()
  private retries = new Map<string, NodeJS.Timeout>()
  private activeAlerts = new Set<string>()
  private history = new Map<string, MetricsSnapshot[]>()
  private historyWrites = new Map<string, number>()

  constructor(
    private ssh: SshManager,
    private getContents: () => WebContents | null
  ) {}

  start(hostId: string): void {
    if (this.timers.has(hostId)) return
    this.failures.set(hostId, 0)
    if (!this.history.has(hostId)) this.history.set(hostId, loadMetricHistory(hostId))
    const tick = (): void => {
      void this.poll(hostId)
    }
    this.timers.set(hostId, setInterval(tick, INTERVAL))
    tick()
  }

  historyOf(hostId: string): MetricsSnapshot[] {
    if (!this.history.has(hostId)) this.history.set(hostId, loadMetricHistory(hostId))
    return this.history.get(hostId) ?? []
  }

  refresh(hostId: string): void {
    if (!this.timers.has(hostId)) this.start(hostId)
    else void this.poll(hostId)
  }

  stop(hostId: string): void {
    const timer = this.timers.get(hostId)
    if (timer) clearInterval(timer)
    this.timers.delete(hostId)
    this.previous.delete(hostId)
    const retry = this.retries.get(hostId)
    if (retry) clearTimeout(retry)
    this.retries.delete(hostId)
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
      if (!parsed.snapshot.hostname || parsed.snapshot.mem.total <= 0 || parsed.snapshot.cores <= 0) {
        throw new Error(res.stderr.trim() || 'Réponse de métriques incomplète')
      }
      this.previous.set(hostId, parsed.raw)
      const history = [...this.historyOf(hostId), parsed.snapshot].slice(-480)
      this.history.set(hostId, history)
      const writes = (this.historyWrites.get(hostId) ?? 0) + 1
      if (writes >= 10 || history.length === 1) {
        saveMetricHistory(hostId, history)
        this.historyWrites.set(hostId, 0)
      } else {
        this.historyWrites.set(hostId, writes)
      }
      this.failures.set(hostId, 0)
      const retry = this.retries.get(hostId)
      if (retry) clearTimeout(retry)
      this.retries.delete(hostId)
      this.getContents()?.send('metrics:update', hostId, parsed.snapshot satisfies MetricsSnapshot)
      this.notifyCritical(hostId, parsed.snapshot)
    } catch (err) {
      const count = (this.failures.get(hostId) ?? 0) + 1
      this.failures.set(hostId, count)
      this.getContents()?.send('metrics:error', hostId, err instanceof Error ? err.message : String(err))
      if (count >= 3) {
        const timer = this.timers.get(hostId)
        if (timer) clearInterval(timer)
        this.timers.delete(hostId)
        const delay = Math.min(30_000, 3_000 * 2 ** Math.min(count - 3, 3))
        if (!this.retries.has(hostId)) {
          this.retries.set(
            hostId,
            setTimeout(() => {
              this.retries.delete(hostId)
              this.start(hostId)
            }, delay)
          )
        }
      }
    } finally {
      this.busy.delete(hostId)
    }
  }

  private notifyCritical(hostId: string, snapshot: MetricsSnapshot): void {
    const disk = snapshot.disks.find((item) => item.mount === '/') ?? snapshot.disks[0]
    const reasons = [
      snapshot.cpu >= 95 ? `CPU à ${Math.round(snapshot.cpu)} %` : '',
      snapshot.mem.total > 0 && snapshot.mem.used / snapshot.mem.total >= 0.95
        ? `RAM à ${Math.round((snapshot.mem.used / snapshot.mem.total) * 100)} %`
        : '',
      disk && disk.pct >= 95 ? `disque ${disk.mount} à ${Math.round(disk.pct)} %` : ''
    ].filter(Boolean)
    const key = `${hostId}:${reasons.join('|')}`
    if (reasons.length === 0) {
      for (const alert of this.activeAlerts) {
        if (alert.startsWith(`${hostId}:`)) this.activeAlerts.delete(alert)
      }
      return
    }
    if (this.activeAlerts.has(key) || !Notification.isSupported()) return
    this.activeAlerts.add(key)
    new Notification({
      title: 'Alerte VPS',
      body: `${reasons.join(' · ')}`
    }).show()
  }
}
