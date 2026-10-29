import { useMemo, useState, type ReactNode } from 'react'
import { Play, Power, RefreshCw, RotateCw, ScrollText, Search, Square } from 'lucide-react'
import type { HostPublic, ServiceInfo } from '@shared/types'
import { Badge, Btn, Card, Empty, ErrorBox, Loading, Modal, useToast } from '@/components/ui'
import { useAsync } from '@/lib/hooks'

type Filter = 'active' | 'failed' | 'all'

export function ServicesView({ host }: { host: HostPublic }): ReactNode {
  const { notify } = useToast()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('active')
  const [busy, setBusy] = useState<string | null>(null)
  const [logsFor, setLogsFor] = useState<ServiceInfo | null>(null)
  const [logs, setLogs] = useState<string>('')
  const [logsLoading, setLogsLoading] = useState(false)

  const services = useAsync<ServiceInfo[]>(() => window.srv.services.list(host.id), [host.id])

  const filtered = useMemo(() => {
    const list = services.data ?? []
    const needle = query.trim().toLowerCase()
    return list.filter((service) => {
      if (filter === 'active' && service.active !== 'active') return false
      if (filter === 'failed' && service.active !== 'failed') return false
      if (!needle) return true
      return service.unit.toLowerCase().includes(needle) || service.description.toLowerCase().includes(needle)
    })
  }, [services.data, query, filter])

  const run = async (service: ServiceInfo, action: string): Promise<void> => {
    setBusy(`${service.unit}:${action}`)
    try {
      const res = await window.srv.services.action(host.id, service.unit, action)
      if (res.code !== 0) notify(res.stderr.trim() || res.stdout.trim() || `Échec de ${action}`, 'err')
      else notify(`${service.unit} : ${action} effectué`, 'ok')
      services.reload()
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      setBusy(null)
    }
  }

  const openLogs = async (service: ServiceInfo): Promise<void> => {
    setLogsFor(service)
    setLogsLoading(true)
    setLogs('')
    try {
      setLogs(await window.srv.services.journal(host.id, service.unit, 400))
    } catch (err) {
      setLogs(err instanceof Error ? err.message : String(err))
    } finally {
      setLogsLoading(false)
    }
  }

  const count = (state: string): number => (services.data ?? []).filter((s) => s.active === state).length

  return (
    <div className="stack">
      <Card
        title="Services systemd"
        icon={<ScrollText size={14} />}
        subtitle={services.data ? `${count('active')} actifs · ${count('failed')} en échec` : undefined}
        bodyClassName="card__body--flush"
        actions={
          <Btn variant="ghost" size="sm" icon={<RefreshCw size={13} />} onClick={services.reload} loading={services.loading}>
            Rafraîchir
          </Btn>
        }
      >
        <div className="toolbar">
          <div className="search">
            <Search size={13} />
            <input className="input" placeholder="Filtrer un service…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="segmented">
            <button className={filter === 'active' ? 'active' : ''} onClick={() => setFilter('active')}>
              Actifs
            </button>
            <button className={filter === 'failed' ? 'active' : ''} onClick={() => setFilter('failed')}>
              En échec
            </button>
            <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>
              Tous
            </button>
          </div>
          <span className="hint" style={{ marginLeft: 'auto' }}>
            {filtered.length} service(s)
          </span>
        </div>

        {services.error ? (
          <ErrorBox message={services.error} onRetry={services.reload} />
        ) : services.loading && !services.data ? (
          <Loading />
        ) : filtered.length === 0 ? (
          <Empty title="Aucun service" hint="Aucun service ne correspond à ce filtre." />
        ) : (
          <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 300px)' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th style={{ width: 110 }}>État</th>
                  <th style={{ width: 120 }}>Démarrage</th>
                  <th style={{ width: 40 }} />
                  <th style={{ width: 230 }} />
                </tr>
              </thead>
              <tbody>
                {filtered.map((service) => {
                  const running = service.active === 'active'
                  const failed = service.active === 'failed'
                  return (
                    <tr key={service.unit}>
                      <td>
                        <div className="mono" style={{ fontWeight: 600 }}>
                          {service.unit.replace(/\.service$/, '')}
                        </div>
                        <div className="hint truncate" style={{ maxWidth: 420 }} title={service.description}>
                          {service.description || '—'}
                        </div>
                      </td>
                      <td>
                        <Badge tone={running ? 'ok' : failed ? 'err' : 'muted'}>
                          {running ? 'actif' : failed ? 'échec' : service.active}
                        </Badge>
                      </td>
                      <td>
                        <Badge tone={service.enabled === 'enabled' ? 'accent' : 'muted'}>{service.enabled}</Badge>
                      </td>
                      <td className="num">
                        <button className="btn btn--icon" title="Journaux" onClick={() => void openLogs(service)}>
                          <ScrollText size={14} />
                        </button>
                      </td>
                      <td>
                        <div className="actions">
                          {running ? (
                            <Btn
                              size="sm"
                              icon={<Square size={12} />}
                              loading={busy === `${service.unit}:stop`}
                              onClick={() => void run(service, 'stop')}
                            >
                              Stop
                            </Btn>
                          ) : (
                            <Btn
                              size="sm"
                              icon={<Play size={12} />}
                              loading={busy === `${service.unit}:start`}
                              onClick={() => void run(service, 'start')}
                            >
                              Start
                            </Btn>
                          )}
                          <Btn
                            size="sm"
                            icon={<RotateCw size={12} />}
                            loading={busy === `${service.unit}:restart`}
                            onClick={() => void run(service, 'restart')}
                          >
                            Restart
                          </Btn>
                          <Btn
                            size="sm"
                            variant="ghost"
                            icon={<Power size={12} />}
                            title={service.enabled === 'enabled' ? 'Désactiver au démarrage' : 'Activer au démarrage'}
                            loading={busy === `${service.unit}:enable` || busy === `${service.unit}:disable`}
                            onClick={() => void run(service, service.enabled === 'enabled' ? 'disable' : 'enable')}
                          />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={!!logsFor} title={`Journaux · ${logsFor?.unit ?? ''}`} onClose={() => setLogsFor(null)} wide>
        {logsLoading ? <Loading label="Lecture de journalctl…" /> : <pre className="console" style={{ maxHeight: '60vh' }}>{logs || 'Aucune entrée.'}</pre>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Btn size="sm" variant="ghost" onClick={() => logsFor && void openLogs(logsFor)} icon={<RefreshCw size={12} />}>
            Rafraîchir
          </Btn>
        </div>
      </Modal>
    </div>
  )
}
