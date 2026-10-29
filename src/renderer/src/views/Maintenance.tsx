import { useState, type ReactNode } from 'react'
import { Archive, Boxes, HardDrive, PackageCheck, RefreshCw, Sparkles, Trash2, TriangleAlert, Wrench } from 'lucide-react'
import type { HostPublic, MaintenanceInfo } from '@shared/types'
import { Badge, Btn, Card, ErrorBox, Loading, Meter, useToast } from '@/components/ui'
import { useAsync } from '@/lib/hooks'
import { fmtBytes } from '@/lib/format'

interface ActionDef {
  key: string
  label: string
  description: string
  icon: ReactNode
  danger?: boolean
  confirm?: string
}

const ACTIONS: ActionDef[] = [
  {
    key: 'journal-vacuum',
    label: 'Réduire les journaux',
    description: 'journalctl --vacuum-size=200M',
    icon: <Archive size={13} />
  },
  {
    key: 'docker-prune',
    label: 'Nettoyer Docker',
    description: 'conteneurs arrêtés, images et réseaux inutilisés (les volumes sont conservés)',
    icon: <Boxes size={13} />
  },
  {
    key: 'apt-clean',
    label: 'Vider le cache APT',
    description: 'supprime les .deb téléchargés',
    icon: <Trash2 size={13} />
  },
  {
    key: 'apt-autoremove',
    label: 'Paquets orphelins',
    description: 'apt-get autoremove --purge',
    icon: <Sparkles size={13} />,
    danger: true,
    confirm: 'Supprimer les paquets devenus inutiles ? Vérifie la liste avant de confirmer.'
  }
]

export function MaintenanceView({ host }: { host: HostPublic }): ReactNode {
  const { notify } = useToast()
  const info = useAsync<MaintenanceInfo>(() => window.srv.tools.maintenance(host.id), [host.id])
  const [busy, setBusy] = useState<string | null>(null)
  const [output, setOutput] = useState<{ title: string; text: string } | null>(null)

  const run = async (action: string, label: string, confirmText?: string): Promise<void> => {
    if (confirmText && !window.confirm(confirmText)) return
    setBusy(action)
    try {
      const res = await window.srv.tools.maintenanceAction(host.id, action)
      setOutput({ title: label, text: res })
      notify(`${label} : terminé`, 'ok')
      info.reload()
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      setBusy(null)
    }
  }

  const maxDisk = (info.data?.diskUsage ?? []).reduce((max, entry) => Math.max(max, entry.bytes), 1)

  return (
    <div className="stack">
      {info.data?.rebootRequired && (
        <div className="alert">
          <TriangleAlert size={15} />
          <span>Un redémarrage est requis après les mises à jour système.</span>
        </div>
      )}

      {info.error ? (
        <ErrorBox message={info.error} onRetry={info.reload} />
      ) : info.loading && !info.data ? (
        <Loading label="Analyse du serveur…" />
      ) : (
        <div className="grid grid--2">
          <Card
            title="Répartition du disque"
            icon={<HardDrive size={14} />}
            subtitle="du -x /"
            actions={<Btn variant="ghost" size="sm" icon={<RefreshCw size={13} />} onClick={info.reload} loading={info.loading} />}
          >
            <div className="stack" style={{ gap: 9 }}>
              {(info.data?.diskUsage ?? []).map((entry) => (
                <div key={entry.path}>
                  <div className="row row--between" style={{ marginBottom: 4 }}>
                    <span className="mono" style={{ fontSize: 11.5 }}>
                      {entry.path}
                    </span>
                    <span className="hint">{fmtBytes(entry.bytes)}</span>
                  </div>
                  <Meter value={(entry.bytes / maxDisk) * 100} color="var(--accent)" />
                </div>
              ))}
            </div>
          </Card>

          <Card title="Mises à jour" icon={<PackageCheck size={14} />} subtitle={`${info.data?.upgrades ?? 0} paquet(s)`}>
            <div className="stack" style={{ gap: 12 }}>
              <div className="row row--between">
                <div>
                  <div style={{ fontSize: 22, fontWeight: 650 }}>{info.data?.upgrades ?? 0}</div>
                  <span className="hint">mise(s) à jour disponible(s)</span>
                </div>
                <Btn
                  variant="primary"
                  size="sm"
                  icon={<RefreshCw size={13} />}
                  onClick={() => void run('apt-upgrade', 'Mise à jour système')}
                  loading={busy === 'apt-upgrade'}
                >
                  Mettre à jour
                </Btn>
              </div>
              <div className="hint">
                <span className="mono">apt-get update && apt-get upgrade -y</span> — les services ne sont pas redémarrés automatiquement, sauf si
                nécessaire.
              </div>
              <div className="row" style={{ gap: 8 }}>
                <Badge tone="muted">Cache APT : {info.data?.aptCacheSize ?? '—'}</Badge>
                <Badge tone="muted">Journaux : {info.data?.journalSize ?? '—'}</Badge>
              </div>
            </div>
          </Card>

          <Card title="Nettoyage" icon={<Wrench size={14} />} subtitle="libérer de l'espace">
            <div className="stack" style={{ gap: 8 }}>
              <div className="hint">Docker récupérable : {info.data?.dockerReclaimable ?? '—'}</div>
              {ACTIONS.map((action) => (
                <div key={action.key} className="row row--between">
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12 }}>{action.label}</div>
                    <div className="hint truncate" title={action.description}>
                      {action.description}
                    </div>
                  </div>
                  <Btn
                    size="sm"
                    variant={action.danger ? 'danger' : 'default'}
                    icon={action.icon}
                    onClick={() => void run(action.key, action.label, action.confirm)}
                    loading={busy === action.key}
                  >
                    Lancer
                  </Btn>
                </div>
              ))}
            </div>
          </Card>

          <Card title="État du système" icon={<PackageCheck size={14} />}>
            <dl className="kv">
              <dt>Redémarrage</dt>
              <dd>{info.data?.rebootRequired ? 'requis' : 'non requis'}</dd>
              <dt>Journal systemd</dt>
              <dd>{info.data?.journalSize ?? '—'}</dd>
              <dt>Cache APT</dt>
              <dd>{info.data?.aptCacheSize ?? '—'}</dd>
              <dt>Docker</dt>
              <dd className="truncate" title={info.data?.dockerReclaimable}>
                {info.data?.dockerReclaimable ?? '—'}
              </dd>
            </dl>
            <div className="alert alert--info" style={{ marginTop: 12 }}>
              <TriangleAlert size={15} />
              <span>Les opérations de maintenance ne sont jamais lancées automatiquement : chaque action demande une confirmation.</span>
            </div>
          </Card>
        </div>
      )}

      {output && (
        <Card
          title={output.title}
          icon={<Wrench size={14} />}
          actions={
            <Btn variant="ghost" size="sm" onClick={() => setOutput(null)}>
              Fermer
            </Btn>
          }
        >
          <pre className="console" style={{ maxHeight: 260 }}>{output.text}</pre>
        </Card>
      )}
    </div>
  )
}
