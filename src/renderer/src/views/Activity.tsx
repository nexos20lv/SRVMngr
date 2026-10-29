import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { CheckCircle, ClipboardList, Search, XCircle } from 'lucide-react'
import type { AuditEntry, HostPublic } from '@shared/types'
import { Badge, Card, Empty, Loading } from '@/components/ui'

export function Activity({ hosts }: { hosts: HostPublic[] }): ReactNode {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [query, setQuery] = useState('')
  const [hostId, setHostId] = useState('all')
  const [result, setResult] = useState<'all' | 'ok' | 'error'>('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    void window.srv.audit.list()
      .then((items) => {
        if (alive) setEntries([...items].sort((a, b) => b.time - a.time))
      })
      .catch((error: unknown) => console.error('[activity] lecture impossible:', error))
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  const hostNames = useMemo(() => new Map(hosts.map((host) => [host.id, host.name])), [hosts])
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return entries.filter((entry) => {
      if (hostId !== 'all' && entry.hostId !== hostId) return false
      if (result === 'ok' && !entry.ok) return false
      if (result === 'error' && entry.ok) return false
      if (!needle) return true
      return `${entry.action} ${entry.detail} ${hostNames.get(entry.hostId ?? '') ?? ''}`.toLowerCase().includes(needle)
    })
  }, [entries, hostId, result, query, hostNames])

  return (
    <div className="content stack">
      <div className="topbar__title">
        <h1><ClipboardList size={20} /> Activité</h1>
        <div className="topbar__sub">{filtered.length} événement(s) affiché(s) · journal local des actions</div>
      </div>
      <Card>
        <div className="toolbar">
          <label className="search-input">
            <Search size={14} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher une commande, une action…" />
          </label>
          <select className="input" value={hostId} onChange={(event) => setHostId(event.target.value)}>
            <option value="all">Tous les serveurs</option>
            {hosts.map((host) => <option key={host.id} value={host.id}>{host.name}</option>)}
          </select>
          <select className="input" value={result} onChange={(event) => setResult(event.target.value as typeof result)}>
            <option value="all">Tous les résultats</option>
            <option value="ok">Réussies</option>
            <option value="error">En erreur</option>
          </select>
        </div>
      </Card>
      {loading ? <Loading label="Chargement de l’activité…" /> : filtered.length === 0 ? (
        <Card><Empty title="Aucune activité" hint="Les connexions et commandes exécutées apparaîtront ici." icon={<ClipboardList size={20} />} /></Card>
      ) : (
        <Card bodyClassName="card__body--flush">
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Heure</th><th>Serveur</th><th>Action</th><th>Détail</th><th>Résultat</th></tr></thead>
              <tbody>
                {filtered.map((entry) => (
                  <tr key={entry.id}>
                    <td className="hint" style={{ whiteSpace: 'nowrap' }}>{new Date(entry.time).toLocaleString('fr-FR')}</td>
                    <td>{entry.hostId ? hostNames.get(entry.hostId) ?? 'Serveur supprimé' : '—'}</td>
                    <td><span className="mono">{entry.action}</span></td>
                    <td className="mono" style={{ maxWidth: 480, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{entry.detail}</td>
                    <td><Badge tone={entry.ok ? 'ok' : 'err'}>{entry.ok ? <><CheckCircle size={12} /> OK</> : <><XCircle size={12} /> Erreur</>}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}
