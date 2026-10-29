import { useState, type ReactNode } from 'react'
import { Lock, RefreshCw, RotateCw, ShieldCheck } from 'lucide-react'
import type { CertInfo, HostPublic } from '@shared/types'
import { Badge, Btn, Card, Empty, ErrorBox, Loading, Modal, useToast } from '@/components/ui'
import { useAsync } from '@/lib/hooks'

export function CertificatesView({ host }: { host: HostPublic }): ReactNode {
  const { notify } = useToast()
  const certs = useAsync<CertInfo[]>(() => window.srv.tools.certs(host.id), [host.id])
  const [busy, setBusy] = useState<string | null>(null)
  const [output, setOutput] = useState('')

  const renew = async (name?: string): Promise<void> => {
    setBusy(name ?? 'all')
    setOutput('')
    try {
      const res = await window.srv.tools.renewCert(host.id, name)
      setOutput(res.output || (res.ok ? 'Renouvellement terminé.' : 'Échec.'))
      notify(res.ok ? 'Renouvellement effectué' : 'certbot a échoué', res.ok ? 'ok' : 'err')
      certs.reload()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setOutput(message)
      notify(message, 'err')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="stack">
      <Card
        title="Certificats Let's Encrypt"
        icon={<Lock size={14} />}
        subtitle={certs.data ? `${certs.data.length} certificat(s)` : undefined}
        actions={
          <>
            <Btn variant="ghost" size="sm" icon={<RotateCw size={13} />} onClick={() => renew()} loading={busy === 'all'}>
              Tout renouveler
            </Btn>
            <Btn variant="ghost" size="sm" icon={<RefreshCw size={13} />} onClick={certs.reload} loading={certs.loading} />
          </>
        }
      >
        {certs.error ? (
          <ErrorBox message={certs.error} onRetry={certs.reload} />
        ) : certs.loading && !certs.data ? (
          <Loading />
        ) : !certs.data?.length ? (
          <Empty
            title="Aucun certificat"
            hint="Utilise le bouton SSL sur un site pour en générer un."
            icon={<ShieldCheck size={18} />}
          />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Certificat</th>
                <th>Domaines</th>
                <th>Expiration</th>
                <th className="num">Validité</th>
                <th style={{ width: 130 }} />
              </tr>
            </thead>
            <tbody>
              {certs.data.map((cert) => (
                <tr key={cert.name}>
                  <td className="mono">{cert.name}</td>
                  <td>
                    <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
                      {cert.domains.map((domain) => (
                        <span key={domain} className="chip">
                          {domain}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="mono muted">{cert.expiry || '—'}</td>
                  <td className="num">
                    <Badge tone={cert.daysLeft > 20 ? 'ok' : cert.daysLeft > 7 ? 'warn' : 'err'}>{cert.daysLeft} j</Badge>
                  </td>
                  <td>
                    <div className="actions">
                      <Btn size="sm" icon={<RotateCw size={12} />} onClick={() => renew(cert.name)} loading={busy === cert.name}>
                        Renouveler
                      </Btn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <div className="alert alert--info">
        <ShieldCheck size={15} />
        <span>
          certbot renouvelle déjà automatiquement ses certificats (minuteur systemd + cron). Ce bouton force un renouvellement immédiat si un
          domaine est proche de l&apos;expiration.
        </span>
      </div>

      <Modal open={!!output} title="Sortie certbot" onClose={() => setOutput('')} wide>
        <pre className="console" style={{ maxHeight: '60vh' }}>{output}</pre>
      </Modal>
    </div>
  )
}
