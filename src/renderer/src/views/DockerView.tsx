import { useState, type ReactNode } from 'react'
import { Boxes, Container, Layers, Play, RefreshCw, RotateCw, ScrollText, Square, Trash2 } from 'lucide-react'
import type { ContainerInfo, HostPublic } from '@shared/types'
import type { DockerOverviewPayload } from '@shared/api'
import { Badge, Btn, Card, Empty, ErrorBox, Loading, Meter, Modal, SearchInput, useToast } from '@/components/ui'
import { useAsync, useTicker } from '@/lib/hooks'
import { fmtPct, shortImage } from '@/lib/format'

const isPterodactyl = (container: ContainerInfo): boolean =>
  /ptero|yolks|parkervcp/i.test(container.image) || /pterodactyl/i.test(container.labels)

export function DockerView({ host }: { host: HostPublic }): ReactNode {
  const { notify } = useToast()
  const [auto, setAuto] = useState(true)
  const tick = useTicker(auto, 10_000)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [logsFor, setLogsFor] = useState<ContainerInfo | null>(null)
  const [logs, setLogs] = useState('')
  const [logsLoading, setLogsLoading] = useState(false)
  const [showImages, setShowImages] = useState(false)

  const docker = useAsync<DockerOverviewPayload>(() => window.srv.docker.overview(host.id), [host.id, tick])

  const containers = (docker.data?.containers ?? []).filter((container) => {
    const needle = query.trim().toLowerCase()
    if (!needle) return true
    return container.name.toLowerCase().includes(needle) || container.image.toLowerCase().includes(needle)
  })
  const running = (docker.data?.containers ?? []).filter((c) => c.state === 'running').length

  const act = async (container: ContainerInfo, action: 'start' | 'stop' | 'restart' | 'rm'): Promise<void> => {
    if (action === 'rm') {
      if (!window.confirm(`Supprimer définitivement le conteneur ${container.name} et ses données Docker ?`)) return
      const typed = window.prompt(`Pour confirmer, saisis exactement le nom du conteneur : ${container.name}`)
      if (typed !== container.name) {
        if (typed !== null) notify('Suppression annulée : le nom ne correspond pas.', 'err')
        return
      }
    }
    setBusy(`${container.name}:${action}`)
    try {
      const res = await window.srv.docker.action(host.id, container.name, action)
      if (res.code !== 0) notify(res.stderr.trim() || `Échec de ${action}`, 'err')
      else notify(`${container.name} : ${action} effectué`, 'ok')
      docker.reload()
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      setBusy(null)
    }
  }

  const openLogs = async (container: ContainerInfo): Promise<void> => {
    setLogsFor(container)
    setLogsLoading(true)
    setLogs('')
    try {
      setLogs(await window.srv.docker.logs(host.id, container.name, 400))
    } catch (err) {
      setLogs(err instanceof Error ? err.message : String(err))
    } finally {
      setLogsLoading(false)
    }
  }

  return (
    <div className="stack">
      <Card
        title="Conteneurs Docker"
        icon={<Container size={14} />}
        subtitle={docker.data ? `${running}/${docker.data.containers.length} en marche` : undefined}
        bodyClassName="card__body--flush"
        actions={
          <>
            <label className="switch">
              <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
              auto
            </label>
            <Btn variant="ghost" size="sm" icon={<RefreshCw size={13} />} onClick={docker.reload} loading={docker.loading}>
              Rafraîchir
            </Btn>
          </>
        }
      >
        <div className="toolbar">
          <SearchInput value={query} onChange={setQuery} placeholder="Filtrer par nom ou image…" />
          <span className="hint" style={{ marginLeft: 'auto' }}>
            {docker.data?.compose.length ? `${docker.data.compose.length} projet(s) compose` : 'aucun projet compose'}
          </span>
        </div>

        {docker.error ? (
          <ErrorBox message={docker.error} onRetry={docker.reload} />
        ) : docker.loading && !docker.data ? (
          <Loading />
        ) : docker.data && !docker.data.available ? (
          <Empty title="Docker indisponible" hint={docker.data.error ?? 'Docker ne répond pas sur cet hôte.'} icon={<Container size={18} />} />
        ) : containers.length === 0 ? (
          <Empty title="Aucun conteneur" hint="Docker tourne mais rien n'est déployé." icon={<Container size={18} />} />
        ) : (
          <div className="table-wrap" style={{ maxHeight: 'calc(100vh - 330px)' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Conteneur</th>
                  <th>Image</th>
                  <th style={{ width: 100 }}>État</th>
                  <th className="num" style={{ width: 70 }}>
                    CPU
                  </th>
                  <th style={{ width: 130 }}>RAM</th>
                  <th>Ports</th>
                  <th style={{ width: 250 }} />
                </tr>
              </thead>
              <tbody>
                {containers.map((container) => {
                  const up = container.state === 'running'
                  return (
                    <tr key={container.id || container.name}>
                      <td>
                        <div className="row" style={{ gap: 6 }}>
                          <span className="mono" style={{ fontWeight: 600 }} title={container.name}>
                            {container.name.length > 13 && /^[0-9a-f-]{20,}$/i.test(container.name)
                              ? `${container.name.slice(0, 8)}…`
                              : container.name}
                          </span>
                          {isPterodactyl(container) && <Badge tone="accent">Ptero</Badge>}
                        </div>
                        <div className="hint truncate" style={{ maxWidth: 220 }} title={container.status}>
                          {container.status}
                        </div>
                      </td>
                      <td className="mono muted truncate" style={{ maxWidth: 200 }} title={container.image}>
                        {shortImage(container.image)}
                      </td>
                      <td>
                        <Badge tone={up ? 'ok' : container.state === 'exited' ? 'muted' : 'warn'}>{container.state || '—'}</Badge>
                      </td>
                      <td className="num">{container.cpu !== undefined ? fmtPct(container.cpu, 1) : '—'}</td>
                      <td>
                        <div className="hint" style={{ marginBottom: 3 }}>
                          {container.mem ?? '—'}
                        </div>
                        <Meter value={container.memPct ?? 0} color="var(--accent-2)" />
                      </td>
                      <td className="mono" style={{ fontSize: 10.5, maxWidth: 210 }}>
                        <span className="truncate" style={{ display: 'block' }} title={container.ports}>
                          {container.ports || '—'}
                        </span>
                      </td>
                      <td>
                        <div className="actions">
                          {up ? (
                            <Btn size="sm" icon={<Square size={12} />} loading={busy === `${container.name}:stop`} onClick={() => void act(container, 'stop')}>
                              Stop
                            </Btn>
                          ) : (
                            <Btn size="sm" icon={<Play size={12} />} loading={busy === `${container.name}:start`} onClick={() => void act(container, 'start')}>
                              Start
                            </Btn>
                          )}
                          <Btn size="sm" icon={<RotateCw size={12} />} loading={busy === `${container.name}:restart`} onClick={() => void act(container, 'restart')}>
                            Restart
                          </Btn>
                          <button className="btn btn--icon" title="Journaux" onClick={() => void openLogs(container)}>
                            <ScrollText size={14} />
                          </button>
                          <button className="btn btn--icon" title="Supprimer" onClick={() => void act(container, 'rm')}>
                            <Trash2 size={14} />
                          </button>
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

      {!!docker.data?.compose.length && (
        <Card title="Projets Docker Compose" icon={<Layers size={14} />} bodyClassName="card__body--flush">
          <table className="table">
            <thead>
              <tr>
                <th>Projet</th>
                <th>Statut</th>
                <th>Fichier</th>
              </tr>
            </thead>
            <tbody>
              {docker.data.compose.map((project) => (
                <tr key={project.name}>
                  <td className="mono">{project.name}</td>
                  <td>
                    <Badge tone={/running/i.test(project.status) ? 'ok' : 'muted'}>{project.status || '—'}</Badge>
                  </td>
                  <td className="mono muted truncate">{project.configFiles}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card
        title="Images locales"
        icon={<Boxes size={14} />}
        subtitle={`${docker.data?.images.length ?? 0}`}
        actions={
          <Btn variant="ghost" size="sm" onClick={() => setShowImages((v) => !v)}>
            {showImages ? 'Masquer' : 'Afficher'}
          </Btn>
        }
        bodyClassName="card__body--flush"
      >
        {showImages ? (
          <table className="table">
            <thead>
              <tr>
                <th>Image</th>
                <th>Tag</th>
                <th className="num">Taille</th>
                <th>Créée</th>
              </tr>
            </thead>
            <tbody>
              {(docker.data?.images ?? []).map((image) => (
                <tr key={`${image.repo}:${image.tag}`}>
                  <td className="mono truncate" style={{ maxWidth: 320 }}>
                    {image.repo}
                  </td>
                  <td className="mono muted">{image.tag}</td>
                  <td className="num">{image.size}</td>
                  <td className="hint">{image.created}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="hint" style={{ padding: '12px 16px' }}>
            Les images occupent de l&apos;espace disque — clique sur Afficher pour la liste complète.
          </div>
        )}
      </Card>

      <Modal open={!!logsFor} title={`Logs · ${logsFor?.name ?? ''}`} onClose={() => setLogsFor(null)} wide>
        {logsLoading ? <Loading label="Lecture des logs…" /> : <pre className="console" style={{ maxHeight: '60vh' }}>{logs || 'Aucune sortie.'}</pre>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <Btn size="sm" variant="ghost" icon={<RefreshCw size={12} />} onClick={() => logsFor && void openLogs(logsFor)}>
            Rafraîchir
          </Btn>
        </div>
      </Modal>
    </div>
  )
}
