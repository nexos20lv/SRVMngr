import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, Bell, Check, CheckCircle, Trash2 } from 'lucide-react'
import type { HostPublic, HostStatus, MetricsSnapshot } from '@shared/types'
import { Badge, Card, Empty } from '@/components/ui'
import { fmtPct, fmtUptime } from '@/lib/format'

export function Alerts({
  hosts,
  statuses,
  metrics,
  onOpen
}: {
  hosts: HostPublic[]
  statuses: Record<string, HostStatus>
  metrics: Record<string, MetricsSnapshot>
  onOpen: (id: string) => void
}): ReactNode {
  const alerts = useMemo(() => hosts.flatMap((host) => {
    const snapshot = metrics[host.id]
    const disk = snapshot?.disks.find((item) => item.mount === '/') ?? snapshot?.disks[0]
    const items: { message: string; tone: 'warn' | 'err' }[] = []
    if (statuses[host.id]?.status !== 'online') items.push({ message: 'Serveur hors ligne', tone: 'err' })
    if (snapshot?.cpu >= 85) items.push({ message: `CPU à ${fmtPct(snapshot.cpu)}`, tone: snapshot.cpu >= 95 ? 'err' : 'warn' })
    if (snapshot && snapshot.mem.used / Math.max(1, snapshot.mem.total) >= 0.85) {
      items.push({ message: `RAM à ${fmtPct((snapshot.mem.used / snapshot.mem.total) * 100)}`, tone: snapshot.mem.used / snapshot.mem.total >= 0.95 ? 'err' : 'warn' })
    }
    if (disk && disk.pct >= 85) items.push({ message: `Disque ${disk.mount} à ${fmtPct(disk.pct)}`, tone: disk.pct >= 95 ? 'err' : 'warn' })
    return items.map((item) => ({ host, ...item, key: `${host.id}:${item.message}` }))
  }), [hosts, statuses, metrics])
  const [history, setHistory] = useState<{ key: string; hostName: string; message: string; tone: 'warn' | 'err'; time: number }[]>([])
  const [acknowledged, setAcknowledged] = useState<string[]>([])

  useEffect(() => {
    try {
      setHistory(JSON.parse(localStorage.getItem('srvmngr-alert-history') ?? '[]') as typeof history)
      setAcknowledged(JSON.parse(localStorage.getItem('srvmngr-alert-acknowledged') ?? '[]') as string[])
    } catch (error) {
      console.error('[alerts] historique local illisible:', error)
    }
  }, [])

  useEffect(() => {
    setHistory((previous) => {
      const known = new Set(previous.map((item) => item.key))
      const added = alerts.filter((alert) => !known.has(alert.key)).map((alert) => ({
        key: alert.key,
        hostName: alert.host.name,
        message: alert.message,
        tone: alert.tone,
        time: Date.now()
      }))
      if (added.length === 0) return previous
      const next = [...added, ...previous].slice(0, 100)
      localStorage.setItem('srvmngr-alert-history', JSON.stringify(next))
      return next
    })
  }, [alerts])

  const visibleAlerts = alerts.filter((alert) => !acknowledged.includes(alert.key))
  const acknowledge = (key: string): void => {
    const next = [...new Set([...acknowledged, key])]
    setAcknowledged(next)
    localStorage.setItem('srvmngr-alert-acknowledged', JSON.stringify(next))
  }
  const clearHistory = (): void => {
    setHistory([])
    localStorage.removeItem('srvmngr-alert-history')
  }

  return (
    <div className="content stack">
      <div className="topbar__title">
        <h1><Bell size={20} /> Alertes</h1>
        <div className="topbar__sub">{visibleAlerts.length} active(s) · {history.length} événement(s) enregistré(s)</div>
      </div>
      <div className="row row--between">
        <strong>Alertes actives</strong>
        {history.length > 0 && <button className="btn btn--ghost btn--sm" onClick={clearHistory}><Trash2 size={13} /> Effacer l&apos;historique</button>}
      </div>
      {visibleAlerts.length === 0 ? (
        <Card><Empty title="Aucune alerte active" hint="Tous les serveurs semblent fonctionner normalement." icon={<CheckCircle size={20} />} /></Card>
      ) : (
        <div className="stack">
          {visibleAlerts.map((alert) => (
            <Card key={alert.key} actions={<button className="btn btn--ghost btn--sm" onClick={() => onOpen(alert.host.id)}>Ouvrir</button>}>
              <div className="row" style={{ gap: 10 }}>
                <AlertTriangle size={17} color={alert.tone === 'err' ? 'var(--err)' : 'var(--warn)'} />
                <strong>{alert.host.name}</strong>
                <Badge tone={alert.tone}>{alert.message}</Badge>
                {metrics[alert.host.id] && <span className="hint">uptime {fmtUptime(metrics[alert.host.id].uptime)}</span>}
                <button className="btn btn--ghost btn--sm" onClick={() => acknowledge(alert.key)}><Check size={13} /> Acquitter</button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <strong>Historique</strong>
      {history.length === 0 ? <Card><Empty title="Aucun événement" hint="Les nouvelles alertes apparaîtront ici." icon={<Bell size={18} />} /></Card> : (
        <div className="stack">
          {history.map((item) => (
            <Card key={`${item.key}-${item.time}`}>
              <div className="row" style={{ gap: 10 }}>
                <AlertTriangle size={15} color={item.tone === 'err' ? 'var(--err)' : 'var(--warn)'} />
                <strong>{item.hostName}</strong>
                <Badge tone={item.tone}>{item.message}</Badge>
                <span className="hint">{new Date(item.time).toLocaleString()}</span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
