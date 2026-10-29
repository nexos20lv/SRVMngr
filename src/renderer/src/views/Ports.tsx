import { useMemo, useState, type ReactNode } from 'react'
import { Network, RefreshCw } from 'lucide-react'
import type { HostPublic, PortInfo } from '@shared/types'
import { Badge, Btn, Card, Empty, ErrorBox, Loading, SearchInput } from '@/components/ui'
import { useAsync } from '@/lib/hooks'

export function PortsView({ host }: { host: HostPublic }): ReactNode {
  const ports = useAsync<PortInfo[]>(() => window.srv.tools.ports(host.id), [host.id])
  const [query, setQuery] = useState('')
  const [publicOnly, setPublicOnly] = useState(false)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (ports.data ?? []).filter((entry) => {
      if (publicOnly && entry.scope === 'local') return false
      if (!needle) return true
      return (
        String(entry.port).includes(needle) ||
        entry.process.toLowerCase().includes(needle) ||
        entry.address.toLowerCase().includes(needle)
      )
    })
  }, [ports.data, query, publicOnly])

  const publicCount = (ports.data ?? []).filter((entry) => entry.scope === 'public').length

  return (
    <div className="stack">
      <Card
        title="Ports en écoute"
        icon={<Network size={14} />}
        subtitle={ports.data ? `${ports.data.length} socket(s) · ${publicCount} exposé(s)` : undefined}
        bodyClassName="card__body--flush"
        actions={<Btn variant="ghost" size="sm" icon={<RefreshCw size={13} />} onClick={ports.reload} loading={ports.loading} />}
      >
        <div className="toolbar">
          <SearchInput value={query} onChange={setQuery} placeholder="Port, processus, adresse…" />
          <label className="switch">
            <input type="checkbox" checked={publicOnly} onChange={(e) => setPublicOnly(e.target.checked)} />
            Exposés uniquement
          </label>
        </div>

        {ports.error ? (
          <ErrorBox message={ports.error} onRetry={ports.reload} />
        ) : ports.loading && !ports.data ? (
          <Loading />
        ) : !filtered.length ? (
          <Empty title="Aucun port" icon={<Network size={18} />} />
        ) : (
          <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 300px)' }}>
            <table className="table">
              <thead>
                <tr>
                  <th className="num" style={{ width: 90 }}>
                    Port
                  </th>
                  <th style={{ width: 80 }}>Proto</th>
                  <th>Adresse</th>
                  <th>Processus</th>
                  <th style={{ width: 110 }}>Portée</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((entry, index) => (
                  <tr key={`${entry.proto}-${entry.port}-${index}`}>
                    <td className="num" style={{ fontWeight: 600 }}>
                      {entry.port}
                    </td>
                    <td>
                      <Badge tone="muted">{entry.proto}</Badge>
                    </td>
                    <td className="mono muted">{entry.address}</td>
                    <td className="mono">{entry.process}</td>
                    <td>
                      <Badge tone={entry.scope === 'public' ? 'warn' : entry.scope === 'local' ? 'ok' : 'accent'}>
                        {entry.scope === 'public' ? 'public' : entry.scope === 'local' ? 'local' : 'interface'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="alert alert--info">
        <Network size={15} />
        <span>
          « public » = écoute sur toutes les interfaces, donc potentiellement joignable depuis Internet. Vérifie les règles du pare-feu du fournisseur
          (Oracle / hébergeur) pour les ports sensibles.
        </span>
      </div>
    </div>
  )
}
