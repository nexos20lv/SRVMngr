import { useState, type ReactNode } from 'react'
import { Ban, RefreshCw, ShieldAlert, ShieldCheck, ShieldOff, Undo2 } from 'lucide-react'
import type { Fail2banJail, HostPublic } from '@shared/types'
import { Badge, Btn, Card, Empty, ErrorBox, Loading, useToast } from '@/components/ui'
import { useAsync } from '@/lib/hooks'

export function Fail2banView({ host }: { host: HostPublic }): ReactNode {
  const { notify } = useToast()
  const status = useAsync<{ active: boolean; jails: Fail2banJail[] }>(() => window.srv.tools.fail2ban(host.id), [host.id])
  const [busy, setBusy] = useState<string | null>(null)
  const [ipInputs, setIpInputs] = useState<Record<string, string>>({})

  const act = async (jail: string, ip: string, action: 'ban' | 'unban'): Promise<void> => {
    setBusy(`${jail}:${ip}`)
    try {
      const res = await window.srv.tools.fail2banAction(host.id, jail, ip, action)
      notify(`${action === 'ban' ? 'Banni' : 'Débanni'} : ${ip} — ${res}`, 'ok')
      status.reload()
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      setBusy(null)
    }
  }

  const totalBanned = (status.data?.jails ?? []).reduce((sum, jail) => sum + jail.banned, 0)

  return (
    <div className="stack">
      <Card
        title="Fail2ban"
        icon={<ShieldAlert size={14} />}
        subtitle={status.data?.active ? `${status.data.jails.length} jail(s) · ${totalBanned} IP bannie(s)` : 'inactif'}
        actions={<Btn variant="ghost" size="sm" icon={<RefreshCw size={13} />} onClick={status.reload} loading={status.loading} />}
      >
        {status.error ? (
          <ErrorBox message={status.error} onRetry={status.reload} />
        ) : status.loading && !status.data ? (
          <Loading />
        ) : !status.data?.active ? (
          <Empty
            title="Fail2ban n'est pas actif"
            hint="Le service est arrêté ou absent : aucune protection contre les tentatives répétées."
            icon={<ShieldOff size={18} />}
          />
        ) : (
          <div className="grid grid--2">
            {status.data.jails.map((jail) => (
              <div key={jail.name} className="card" style={{ background: 'var(--panel-2)' }}>
                <div className="card__head">
                  <div className="card__title">
                    <ShieldCheck size={14} />
                    {jail.name}
                  </div>
                  <div className="card__actions">
                    <Badge tone={jail.banned > 0 ? 'warn' : 'ok'}>{jail.banned} bannie(s)</Badge>
                    <span className="hint">total {jail.total}</span>
                  </div>
                </div>
                <div className="card__body stack" style={{ gap: 8 }}>
                  {jail.ips.length ? (
                    <div className="stack" style={{ gap: 4 }}>
                      {jail.ips.map((ip) => (
                        <div key={ip} className="row row--between" style={{ fontSize: 12 }}>
                          <span className="mono">{ip}</span>
                          <Btn
                            size="sm"
                            variant="ghost"
                            icon={<Undo2 size={11} />}
                            loading={busy === `${jail.name}:${ip}`}
                            onClick={() => void act(jail.name, ip, 'unban')}
                          >
                            Débannir
                          </Btn>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="hint">Aucune IP bannie actuellement.</span>
                  )}

                  <div className="row" style={{ gap: 6 }}>
                    <input
                      className="input grow mono"
                      placeholder="IP à bannir"
                      value={ipInputs[jail.name] ?? ''}
                      onChange={(e) => setIpInputs((prev) => ({ ...prev, [jail.name]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && ipInputs[jail.name]) void act(jail.name, ipInputs[jail.name], 'ban')
                      }}
                      spellCheck={false}
                    />
                    <Btn
                      size="sm"
                      icon={<Ban size={12} />}
                      disabled={!ipInputs[jail.name]}
                      onClick={() => void act(jail.name, ipInputs[jail.name] ?? '', 'ban')}
                      loading={busy === `${jail.name}:${ipInputs[jail.name]}`}
                    >
                      Bannir
                    </Btn>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="alert alert--info">
        <ShieldAlert size={15} />
        <span>
          Un bannissement dure selon <span className="mono">bantime</span> défini dans <span className="mono">/etc/fail2ban/jail.local</span>. Débannir
          une IP est immédiat mais elle pourra être re-bannie à la tentative suivante.
        </span>
      </div>
    </div>
  )
}
