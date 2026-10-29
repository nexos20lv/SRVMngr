import { useState, type ReactNode } from 'react'
import { CalendarClock, Pencil, RefreshCw, Save, TriangleAlert } from 'lucide-react'
import type { CronJob, HostPublic } from '@shared/types'
import { Badge, Btn, Card, Empty, ErrorBox, Loading, Modal, useToast } from '@/components/ui'
import { useAsync } from '@/lib/hooks'

export function CronView({ host }: { host: HostPublic }): ReactNode {
  const { notify } = useToast()
  const cron = useAsync<{ available: boolean; jobs: CronJob[]; rootRaw: string }>(() => window.srv.tools.cron(host.id), [host.id])
  const [editing, setEditing] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const save = async (): Promise<void> => {
    if (editing === null) return
    setSaving(true)
    try {
      await window.srv.tools.cronSave(host.id, editing)
      notify('Crontab enregistrée', 'ok')
      setEditing(null)
      cron.reload()
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="stack">
      <Card
        title="Tâches planifiées"
        icon={<CalendarClock size={14} />}
        subtitle={cron.data ? `${cron.data.jobs.length} tâche(s)` : undefined}
        actions={
          <>
            <Btn
              variant="ghost"
              size="sm"
              icon={<Pencil size={13} />}
              onClick={() => setEditing(cron.data?.rootRaw ?? '')}
              disabled={!cron.data?.available}
            >
              Éditer la crontab root
            </Btn>
            <Btn variant="ghost" size="sm" icon={<RefreshCw size={13} />} onClick={cron.reload} loading={cron.loading} />
          </>
        }
      >
        {cron.error ? (
          <ErrorBox message={cron.error} onRetry={cron.reload} />
        ) : cron.loading && !cron.data ? (
          <Loading />
        ) : !cron.data?.jobs.length ? (
          <Empty
            title="Aucune tâche planifiée"
            hint={cron.data?.available ? 'La crontab root est vide.' : 'Le paquet cron n’est pas installé sur cet hôte.'}
            icon={<CalendarClock size={18} />}
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 170 }}>Planification</th>
                <th>Commande</th>
                <th style={{ width: 200 }}>Source</th>
              </tr>
            </thead>
            <tbody>
              {cron.data.jobs.map((job) => (
                <tr key={job.id}>
                  <td className="mono" style={{ color: 'var(--accent)' }}>
                    {job.schedule}
                  </td>
                  <td className="mono" style={{ wordBreak: 'break-all' }}>
                    {job.command}
                  </td>
                  <td className="hint truncate" title={job.source}>
                    {job.source}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {!cron.data?.available && (
        <div className="alert">
          <TriangleAlert size={15} />
          <span>
            La commande <span className="mono">crontab</span> est absente : seules les tâches de <span className="mono">/etc/cron.d</span> sont visibles
            et l&apos;édition est désactivée. Installe le paquet <span className="mono">cron</span> pour gérer les crontabs utilisateur.
          </span>
        </div>
      )}

      <Modal
        open={editing !== null}
        title="Crontab root"
        onClose={() => setEditing(null)}
        wide
        footer={
          <>
            <Btn variant="ghost" onClick={() => setEditing(null)}>
              Annuler
            </Btn>
            <Btn variant="primary" icon={<Save size={14} />} onClick={save} loading={saving}>
              Enregistrer
            </Btn>
          </>
        }
      >
        <div className="alert alert--info">
          <CalendarClock size={15} />
          <span>
            Format : <span className="mono">min heure jour mois semaine commande</span>. Le contenu remplace intégralement la crontab root.
          </span>
        </div>
        <textarea
          className="editor"
          style={{ minHeight: '40vh' }}
          value={editing ?? ''}
          onChange={(e) => setEditing(e.target.value)}
          spellCheck={false}
          placeholder="0 4 * * * /usr/local/bin/backup.sh"
        />
        <Badge tone="muted">Un commentaire par ligne commence par #</Badge>
      </Modal>
    </div>
  )
}
