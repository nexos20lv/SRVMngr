import { useEffect, useState, type ReactNode } from 'react'
import { Database, Download, Play, RefreshCw, Table2 } from 'lucide-react'
import type { DatabaseInfo, DbQueryResult, DbTableInfo, HostPublic } from '@shared/types'
import { Badge, Btn, Card, Empty, ErrorBox, Loading, useToast } from '@/components/ui'
import { useAsync } from '@/lib/hooks'
import { fmtBytes } from '@/lib/format'

export function DatabaseView({ host }: { host: HostPublic }): ReactNode {
  const { notify } = useToast()
  const [selected, setSelected] = useState<string | null>(null)
  const [sql, setSql] = useState('SHOW TABLES;')
  const [result, setResult] = useState<DbQueryResult | null>(null)
  const [error, setError] = useState<string | undefined>()
  const [running, setRunning] = useState(false)
  const [dumping, setDumping] = useState(false)

  const databases = useAsync<DatabaseInfo[]>(() => window.srv.tools.databases(host.id), [host.id])
  const tables = useAsync<DbTableInfo[]>(
    () => (selected ? window.srv.tools.tables(host.id, selected) : Promise.resolve([])),
    [host.id, selected],
    !!selected
  )

  useEffect(() => {
    if (selected) setSql('SHOW TABLES;')
    setResult(null)
    setError(undefined)
  }, [selected])

  const run = async (): Promise<void> => {
    if (!sql.trim()) return
    setRunning(true)
    setError(undefined)
    try {
      setResult(await window.srv.tools.query(host.id, selected ?? '', sql))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setResult(null)
    } finally {
      setRunning(false)
    }
  }

  const exportDb = async (): Promise<void> => {
    if (!selected) return
    setDumping(true)
    try {
      const res = await window.srv.tools.dump(host.id, selected)
      notify(`Export prêt : ${res.path} (${res.size}) — récupérable dans Fichiers`, 'ok')
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      setDumping(false)
    }
  }

  return (
    <div className="stack">
      <div className="query-grid">
        <Card
          title="Bases de données"
          icon={<Database size={14} />}
          subtitle={databases.data ? `${databases.data.length}` : undefined}
          actions={
            <Btn variant="ghost" size="sm" icon={<RefreshCw size={13} />} onClick={databases.reload} loading={databases.loading} />
          }
        >
          {databases.error ? (
            <ErrorBox message={databases.error} onRetry={databases.reload} />
          ) : databases.loading && !databases.data ? (
            <Loading />
          ) : !databases.data?.length ? (
            <Empty title="Aucune base" hint="MariaDB tourne mais ne contient aucune base utilisateur." icon={<Database size={18} />} />
          ) : (
            <div className="db-list">
              {databases.data.map((db) => (
                <button
                  key={db.name}
                  className={`db-item ${selected === db.name ? 'db-item--active' : ''}`}
                  onClick={() => setSelected(db.name)}
                >
                  <span className="mono truncate">{db.name}</span>
                  <span className="hint nowrap">
                    {db.tables} tab. · {fmtBytes(db.sizeMb * 1024 * 1024)}
                  </span>
                </button>
              ))}
            </div>
          )}

          {selected && (
            <>
              <div className="row row--between" style={{ margin: '14px 0 8px' }}>
                <span className="hint">
                  <Table2 size={11} /> tables de {selected}
                </span>
                <Btn size="sm" variant="ghost" icon={<Download size={12} />} onClick={exportDb} loading={dumping}>
                  Exporter
                </Btn>
              </div>
              {tables.error ? (
                <ErrorBox message={tables.error} onRetry={tables.reload} />
              ) : tables.loading && !tables.data ? (
                <Loading />
              ) : (
                <div className="db-list" style={{ maxHeight: 220 }}>
                  {(tables.data ?? []).map((table) => (
                    <button
                      key={table.name}
                      className="db-item"
                      onClick={() => setSql(`SELECT * FROM \`${table.name}\` LIMIT 100;`)}
                      title="Cliquer pour générer un SELECT"
                    >
                      <span className="mono truncate">{table.name}</span>
                      <span className="hint nowrap">
                        {table.rows} lig. · {fmtBytes(table.sizeMb * 1024 * 1024)}
                      </span>
                    </button>
                  ))}
                  {!tables.data?.length && <span className="hint">Base vide.</span>}
                </div>
              )}
            </>
          )}
        </Card>

        <Card
          title="Console SQL"
          icon={<Play size={14} />}
          subtitle={selected ?? 'aucune base sélectionnée'}
          actions={
            <Btn variant="primary" size="sm" icon={<Play size={13} />} onClick={run} loading={running} disabled={!sql.trim()}>
              Exécuter
            </Btn>
          }
        >
          <textarea
            className="editor"
            style={{ minHeight: 160 }}
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void run()
            }}
            spellCheck={false}
            placeholder="SELECT * FROM ma_table LIMIT 50;"
          />

          {error && <div style={{ marginTop: 12 }}><ErrorBox message={error} /></div>}

          {result && (
            <div className="stack" style={{ marginTop: 12, gap: 8 }}>
              <div className="row row--between">
                <span className="hint">{result.message}</span>
                <Badge tone="muted">⌘/Ctrl + Entrée</Badge>
              </div>
              {result.headers.length > 0 && (
                <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 520px)', minHeight: 120 }}>
                  <table className="table">
                    <thead>
                      <tr>
                        {result.headers.map((header, index) => (
                          <th key={`${header}-${index}`} className="mono">
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.slice(0, 300).map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          {row.map((cell, cellIndex) => (
                            <td key={cellIndex} className="mono" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }} title={cell}>
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {result.rows.length > 300 && <span className="hint">Affichage limité aux 300 premières lignes.</span>}
            </div>
          )}
        </Card>
      </div>

      <div className="alert alert--info">
        <Database size={15} />
        <span>
          Accès via l&apos;utilisateur <span className="mono">root@localhost</span> (socket Unix, sudo). Les exports sont écrits dans{' '}
          <span className="mono">/root/srvmngr-dumps</span>.
        </span>
      </div>
    </div>
  )
}
