import type { ReactNode } from 'react'
import { AlertTriangle, Bell, CheckCircle } from 'lucide-react'
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
  const alerts = hosts.flatMap((host) => {
    const snapshot = metrics[host.id]
    const disk = snapshot?.disks.find((item) => item.mount === '/') ?? snapshot?.disks[0]
    const items: { message: string; tone: 'warn' | 'err' }[] = []
    if (statuses[host.id]?.status !== 'online') items.push({ message: 'Serveur hors ligne', tone: 'err' })
    if (snapshot?.cpu >= 85) items.push({ message: `CPU à ${fmtPct(snapshot.cpu)}`, tone: snapshot.cpu >= 95 ? 'err' : 'warn' })
    if (snapshot && snapshot.mem.used / Math.max(1, snapshot.mem.total) >= 0.85) {
      items.push({ message: `RAM à ${fmtPct((snapshot.mem.used / snapshot.mem.total) * 100)}`, tone: snapshot.mem.used / snapshot.mem.total >= 0.95 ? 'err' : 'warn' })
    }
    if (disk && disk.pct >= 85) items.push({ message: `Disque ${disk.mount} à ${fmtPct(disk.pct)}`, tone: disk.pct >= 95 ? 'err' : 'warn' })
    return items.map((item) => ({ host, ...item }))
  })

  return (
    <div className="content stack">
      <div className="topbar__title">
        <h1><Bell size={20} /> Alertes</h1>
        <div className="topbar__sub">État global de tes serveurs</div>
      </div>
      {alerts.length === 0 ? (
        <Card><Empty title="Aucune alerte" hint="Tous les serveurs semblent fonctionner normalement." icon={<CheckCircle size={20} />} /></Card>
      ) : (
        <div className="stack">
          {alerts.map((alert, index) => (
            <Card key={`${alert.host.id}-${alert.message}-${index}`} actions={<button className="btn btn--ghost btn--sm" onClick={() => onOpen(alert.host.id)}>Ouvrir</button>}>
              <div className="row" style={{ gap: 10 }}>
                <AlertTriangle size={17} color={alert.tone === 'err' ? 'var(--err)' : 'var(--warn)'} />
                <strong>{alert.host.name}</strong>
                <Badge tone={alert.tone}>{alert.message}</Badge>
                {metrics[alert.host.id] && <span className="hint">uptime {fmtUptime(metrics[alert.host.id].uptime)}</span>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
