import { useMemo, useState, type ReactNode } from 'react'
import { Activity, ArrowDownUp, RefreshCw, Skull } from 'lucide-react'
import type { HostPublic, ProcessRow } from '@shared/types'
import { Badge, Btn, Card, Empty, ErrorBox, Loading, Modal, SearchInput, useToast } from '@/components/ui'
import { useAsync, useTicker } from '@/lib/hooks'
import { fmtBytes, fmtPct } from '@/lib/format'

type SortKey = 'cpu' | 'mem' | 'rss' | 'pid' | 'comm'

export function ProcessesView({ host }: { host: HostPublic }): ReactNode {
  const { notify } = useToast()
  const [auto, setAuto] = useState(true)
  const tick = useTicker(auto, 5000)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('cpu')
  const [target, setTarget] = useState<ProcessRow | null>(null)
  const [signal, setSignal] = useState('TERM')
  const [killing, setKilling] = useState(false)

  const procs = useAsync<ProcessRow[]>(() => window.srv.proc.list(host.id), [host.id, tick])

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const list = (procs.data ?? []).filter(
      (p) => !needle || p.comm.toLowerCase().includes(needle) || p.user.toLowerCase().includes(needle) || String(p.pid) === needle
    )
    return [...list].sort((a, b) => {
      if (sort === 'comm') return a.comm.localeCompare(b.comm)
      return (b[sort] as number) - (a[sort] as number)
    })
  }, [procs.data, query, sort])

  const kill = async (): Promise<void> => {
    if (!target) return
    setKilling(true)
    try {
      const res = await window.srv.proc.kill(host.id, target.pid, signal)
      if (res.code !== 0) notify(res.stderr.trim() || 'Le processus a résisté', 'err')
      else notify(`Signal ${signal} envoyé à ${target.comm} (${target.pid})`, 'ok')
      setTarget(null)
      procs.reload()
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      setKilling(false)
    }
  }

  const header = (key: SortKey, label: string, className = ''): ReactNode => (
    <th className={className} style={{ cursor: 'pointer' }} onClick={() => setSort(key)}>
      <span className="row" style={{ gap: 4, justifyContent: className.includes('num') ? 'flex-end' : 'flex-start' }}>
        {label}
        {sort === key && <ArrowDownUp size={10} />}
      </span>
    </th>
  )

  return (
    <div className="stack">
      <Card
        title="Processus"
        icon={<Activity size={14} />}
        subtitle={procs.data ? `${rows.length} processus affichés` : undefined}
        bodyClassName="card__body--flush"
        actions={
          <>
            <label className="switch">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
              auto 5 s
            </label>
            <Btn variant="ghost" size="sm" icon={<RefreshCw size={13} />} onClick={procs.reload} loading={procs.loading} />
          </>
        }
      >
        <div className="toolbar">
          <SearchInput value={query} onChange={setQuery} placeholder="Nom, utilisateur ou PID…" />
        </div>

        {procs.error ? (
          <ErrorBox message={procs.error} onRetry={procs.reload} />
        ) : procs.loading && !procs.data ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty title="Aucun processus" />
        ) : (
          <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 300px)' }}>
            <table className="table">
              <thead>
                <tr>
                  {header('pid', 'PID', 'num')}
                  <th>Utilisateur</th>
                  {header('comm', 'Processus')}
                  {header('cpu', 'CPU', 'num')}
                  {header('mem', '% RAM', 'num')}
                  {header('rss', 'RAM', 'num')}
                  <th className="num">Temps</th>
                  <th style={{ width: 90 }} />
                </tr>
              </thead>
              <tbody>
                {rows.map((proc) => (
                  <tr key={proc.pid}>
                    <td className="num muted">{proc.pid}</td>
                    <td className="mono muted">{proc.user}</td>
                    <td>
                      <div className="proc-name" title={proc.comm}>
                        {proc.comm}
                      </div>
                    </td>
                    <td className="num" style={{ color: proc.cpu > 50 ? 'var(--warn)' : undefined }}>
                      {fmtPct(proc.cpu, 1)}
                    </td>
                    <td className="num">{fmtPct(proc.mem, 1)}</td>
                    <td className="num">{fmtBytes(proc.rss)}</td>
                    <td className="num muted">{proc.etime}</td>
                    <td>
                      <div className="actions">
                        <Btn variant="ghost" size="sm" icon={<Skull size={12} />} onClick={() => setTarget(proc)}>
                          Kill
                        </Btn>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={!!target}
        title={`Arrêter ${target?.comm ?? ''} (PID ${target?.pid ?? ''})`}
        onClose={() => setTarget(null)}
        footer={
          <>
            <Btn variant="ghost" onClick={() => setTarget(null)}>
              Annuler
            </Btn>
            <Btn variant="danger" icon={<Skull size={14} />} onClick={kill} loading={killing}>
              Envoyer le signal
            </Btn>
          </>
        }
      >
        <div className="field">
          <label>Signal</label>
          <select className="select" value={signal} onChange={(e) => setSignal(e.target.value)}>
            <option value="TERM">SIGTERM — arrêt propre (recommandé)</option>
            <option value="KILL">SIGKILL — arrêt immédiat</option>
            <option value="HUP">SIGHUP — rechargement</option>
            <option value="INT">SIGINT — interruption</option>
          </select>
        </div>
        <div className="alert">
          <Badge tone="warn">Attention</Badge>
          <span>Un SIGKILL peut corrompre les données du processus. Privilégie SIGTERM.</span>
        </div>
      </Modal>
    </div>
  )
}
