import type { ReactNode } from 'react'
import { AlertTriangle, Boxes, LogIn, Plus, Server } from 'lucide-react'
import type { HostPublic, HostStatus, MetricsSnapshot } from '@shared/types'
import { clamp } from '@/lib/hooks'

interface Props {
  hosts: HostPublic[]
  statuses: Record<string, HostStatus>
  metrics: Record<string, MetricsSnapshot>
  active: string
  onSelect: (id: string) => void
  onAdd: () => void
  onEdit: (host: HostPublic) => void
  onAlerts: () => void
  onSync: () => void
  syncEmail?: string
}

export function Sidebar({ hosts, statuses, metrics, active, onSelect, onAdd, onEdit, onAlerts, onSync, syncEmail }: Props): ReactNode {
  const online = hosts.filter((h) => statuses[h.id]?.status === 'online').length

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <div className="brand-mark">
          <Boxes size={18} />
        </div>
        <div className="brand-text">
          <strong>SRV Mngr</strong>
          <span>Contrôle VPS</span>
        </div>
      </div>

      <div className="sidebar__section">
        <button className={`nav-item ${active === 'fleet' ? 'nav-item--active' : ''}`} onClick={() => onSelect('fleet')}>
          <Server size={15} />
          <span className="nav-item__label">Vue d&apos;ensemble</span>
          <span className="tab__count">{hosts.length}</span>
        </button>
        <button className={`nav-item ${active === 'alerts' ? 'nav-item--active' : ''}`} onClick={onAlerts}>
          <AlertTriangle size={15} />
          <span className="nav-item__label">Alertes</span>
        </button>
        <div className="sidebar__label">
          <span>Serveurs</span>
          <button className="btn btn--icon" onClick={onAdd} title="Ajouter un serveur">
            <Plus size={14} />
          </button>
        </div>

        {hosts.map((host) => {
          const status = statuses[host.id]?.status ?? 'offline'
          const snapshot = metrics[host.id]
          const cpu = snapshot?.cpu ?? 0
          const mem = snapshot ? (snapshot.mem.used / Math.max(1, snapshot.mem.total)) * 100 : 0
          return (
            <button
              key={host.id}
              className={`host-item ${active === host.id ? 'host-item--active' : ''}`}
              onClick={() => onSelect(host.id)}
              onDoubleClick={() => onEdit(host)}
              title={`${host.username}@${host.host}:${host.port}`}
            >
              <span className={`dot dot--${status}`} />
              <span style={{ minWidth: 0 }}>
                <div className="host-item__name">{host.name}</div>
                <div className="host-item__meta">
                  {host.host}
                  {host.group ? ` · ${host.group}` : ''}
                </div>
              </span>
              <span className="host-item__bars" title={`CPU ${Math.round(cpu)}% · RAM ${Math.round(mem)}%`}>
                <span
                  className="host-item__bar"
                  style={{ height: `${4 + (clamp(cpu) / 100) * 12}px`, background: cpu > 85 ? 'var(--err)' : 'var(--accent)' }}
                />
                <span
                  className="host-item__bar"
                  style={{ height: `${4 + (clamp(mem) / 100) * 12}px`, background: mem > 85 ? 'var(--err)' : 'var(--accent-2)' }}
                />
              </span>
            </button>
          )
        })}

        {hosts.length === 0 && (
          <div className="hint" style={{ padding: '8px 10px' }}>
            Aucun serveur. Ajoute ton premier VPS pour commencer.
          </div>
        )}
      </div>

      <div className="sidebar__footer">
        <span className={`dot dot--${online === hosts.length && hosts.length > 0 ? 'online' : online > 0 ? 'connecting' : 'offline'}`} />
        <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
          {online}/{hosts.length} en ligne
        </span>
        <span className="hint" style={{ marginLeft: 'auto' }}>double-clic : éditer</span>
      </div>
      <button className="sidebar__account" onClick={onSync}>
        <LogIn size={15} />
        <span>
          <strong>{syncEmail ?? 'Se connecter'}</strong>
          <small>{syncEmail ? 'Compte synchronisé' : 'Synchroniser mes VPS'}</small>
        </span>
      </button>
    </aside>
  )
}
