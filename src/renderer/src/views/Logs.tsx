import { useMemo, useState, type ReactNode } from 'react'
import { RefreshCw, ScrollText } from 'lucide-react'
import type { HostPublic, ServiceInfo } from '@shared/types'
import { Btn, Card, ErrorBox, Loading, SearchInput } from '@/components/ui'
import { useAsync, useTicker } from '@/lib/hooks'

export function LogsView({ host }: { host: HostPublic }): ReactNode {
  const [unit, setUnit] = useState('')
  const [lines, setLines] = useState(300)
  const [auto, setAuto] = useState(false)
  const [query, setQuery] = useState('')
  const tick = useTicker(auto, 5000)

  const services = useAsync<ServiceInfo[]>(() => window.srv.services.list(host.id), [host.id])
  const logs = useAsync<string>(() => window.srv.services.journal(host.id, unit || null, lines), [host.id, unit, lines, tick])

  const filtered = useMemo(() => {
    const text = logs.data ?? ''
    if (!query.trim()) return text
    return text
      .split('\n')
      .filter((line) => line.toLowerCase().includes(query.toLowerCase()))
      .join('\n')
  }, [logs.data, query])

  return (
    <div className="stack" style={{ height: '100%' }}>
      <Card
        title="Journaux systemd"
        icon={<ScrollText size={14} />}
        subtitle={unit ? unit : 'journal complet de l’hôte'}
        bodyClassName="card__body--flush"
        style={{ minHeight: 0 }}
        actions={
          <>
            <label className="switch">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
              auto
            </label>
            <Btn variant="ghost" size="sm" icon={<RefreshCw size={13} />} onClick={logs.reload} loading={logs.loading} />
          </>
        }
      >
        <div className="toolbar">
          <select className="select" value={unit} onChange={(e) => setUnit(e.target.value)} style={{ minWidth: 230, maxWidth: 320 }}>
            <option value="">Tout le système</option>
            {(services.data ?? []).map((service) => (
              <option key={service.unit} value={service.unit}>
                {service.unit}
              </option>
            ))}
          </select>
          <select className="select" value={lines} onChange={(e) => setLines(Number(e.target.value))}>
            {[100, 300, 500, 1000, 2000].map((n) => (
              <option key={n} value={n}>
                {n} lignes
              </option>
            ))}
          </select>
          <SearchInput value={query} onChange={setQuery} placeholder="Filtrer dans les logs…" />
        </div>

        <div style={{ padding: 14 }}>
          {logs.error ? (
            <ErrorBox message={logs.error} onRetry={logs.reload} />
          ) : logs.loading && !logs.data ? (
            <Loading label="Lecture de journalctl…" />
          ) : (
            <pre className="console" style={{ maxHeight: 'calc(100vh - 330px)' }}>
              {filtered || 'Aucune entrée.'}
            </pre>
          )}
        </div>
      </Card>
    </div>
  )
}
