import { useState, type ReactNode } from 'react'
import { ChevronRight, Cpu, HardDrive, MemoryStick, Plus, Radio, Server, ShieldCheck, TerminalSquare } from 'lucide-react'
import type { HostPublic, HostStatus, MetricsSnapshot, SysInfo } from '@shared/types'
import type { SecurityAudit } from '@shared/security-types'
import { AreaChart, Badge, Btn, Card, Empty, KpiCard, Ring, StatusDot, useToast } from '@/components/ui'
import { useAsync } from '@/lib/hooks'
import { fmtBytes, fmtPct, fmtRate, fmtUptime } from '@/lib/format'

interface Props {
  hosts: HostPublic[]
  statuses: Record<string, HostStatus>
  metrics: Record<string, MetricsSnapshot>
  history: Record<string, MetricsSnapshot[]>
  onOpen: (id: string) => void
  onAdd: () => void
}

function FleetSecurity({
  hosts,
  statuses,
  onOpen
}: {
  hosts: HostPublic[]
  statuses: Record<string, HostStatus>
  onOpen: (id: string) => void
}): ReactNode {
  const { notify } = useToast()
  const [results, setResults] = useState<Record<string, SecurityAudit | { error: string }>>({})
  const [busy, setBusy] = useState(false)

  const online = hosts.filter((host) => statuses[host.id]?.status === 'online')

  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      const entries = await Promise.all(
        online.map(async (host) => {
          try {
            return [host.id, await window.srv.security.audit(host.id)] as const
          } catch (err) {
            return [host.id, { error: err instanceof Error ? err.message : String(err) }] as const
          }
        })
      )
      setResults(Object.fromEntries(entries))
    } finally {
      setBusy(false)
    }
  }

  const audited = online.filter((host) => results[host.id])
  const average =
    audited.length === 0
      ? null
      : Math.round(
          audited.reduce((sum, host) => {
            const entry = results[host.id]
            return sum + ('score' in entry ? entry.score : 0)
          }, 0) / audited.length
        )

  return (
    <Card
      title="Sécurité de la flotte"
      icon={<ShieldCheck size={14} />}
      subtitle={average !== null ? `score moyen ${average}/100` : 'audit à la demande, hôte par hôte'}
      actions={
        <Btn variant="primary" size="sm" icon={<ShieldCheck size={13} />} onClick={run} loading={busy} disabled={online.length === 0}>
          Auditer
        </Btn>
      }
    >
      {audited.length === 0 ? (
        <Empty
          title="Aucun audit lancé"
          hint="Lance l’audit pour comparer le niveau de durcissement de chaque VPS (SSH, pare-feu, fail2ban, comptes, mises à jour)."
          icon={<ShieldCheck size={18} />}
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Serveur</th>
                <th>Score</th>
                <th>Critiques</th>
                <th>Vigilance</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {audited.map((host) => {
                const entry = results[host.id]
                if ('error' in entry) {
                  return (
                    <tr key={host.id}>
                      <td>{host.name}</td>
                      <td colSpan={4} className="muted">
                        {entry.error}
                      </td>
                    </tr>
                  )
                }
                const critical = entry.checks.filter((check) => check.status === 'fail')
                const warn = entry.checks.filter((check) => check.status === 'warn')
                return (
                  <tr key={host.id}>
                    <td>{host.name}</td>
                    <td>
                      <Badge tone={entry.score >= 85 ? 'ok' : entry.score >= 60 ? 'warn' : 'err'}>{entry.score}/100</Badge>
                    </td>
                    <td>
                      {critical.length === 0 ? (
                        <span className="dim">—</span>
                      ) : (
                        <span className="hint" title={critical.map((check) => check.label).join(' · ')}>
                          {critical.length} : {critical[0].label}
                        </span>
                      )}
                    </td>
                    <td className="muted">{warn.length}</td>
                    <td className="actions">
                      <Btn size="sm" variant="ghost" icon={<ChevronRight size={13} />} onClick={() => onOpen(host.id)}>
                        Ouvrir
                      </Btn>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function HostCard({
  host,
  status,
  metrics,
  history,
  onOpen
}: {
  host: HostPublic
  status?: HostStatus
  metrics?: MetricsSnapshot
  history: MetricsSnapshot[]
  onOpen: () => void
}): ReactNode {
  const info = useAsync<Partial<SysInfo>>(() => window.srv.sysInfo(host.id), [host.id], status?.status === 'online')
  const memPct = metrics ? (metrics.mem.used / Math.max(1, metrics.mem.total)) * 100 : 0
  const disk = metrics?.disks.find((d) => d.mount === '/') ?? metrics?.disks[0]
  const series = history.slice(-40).map((m) => m.cpu)

  return (
    <div className="card" style={{ cursor: 'pointer' }} onClick={onOpen}>
      <div className="card__head">
        <div className="card__title">
          <StatusDot status={status?.status ?? 'offline'} />
          <span>{host.name}</span>
          {host.group && <Badge tone="muted">{host.group}</Badge>}
        </div>
        <div className="card__actions">
          <span className="mono dim" style={{ fontSize: 10.5 }}>
            {host.host}
          </span>
          <ChevronRight size={15} />
        </div>
      </div>
      <div className="card__body stack">
        <div className="row row--between">
          <div className="hint truncate" title={info.data?.os}>
            {info.data?.os ?? (status?.status === 'online' ? '…' : 'hors ligne')}
          </div>
          <span className="hint">{metrics ? fmtUptime(metrics.uptime) : ''}</span>
        </div>

        <div className="row" style={{ gap: 16 }}>
          <Ring value={metrics?.cpu ?? 0} size={62} />
          <Ring value={memPct} size={62} color="var(--accent-2)" />
          <Ring value={disk?.pct ?? 0} size={62} color={disk && disk.pct > 85 ? 'var(--err)' : 'var(--ok)'} />
          <div className="stack" style={{ gap: 2, fontSize: 11, color: 'var(--muted)', marginLeft: 'auto', textAlign: 'right' }}>
            <span>CPU · {metrics?.cores ?? '—'} cœurs</span>
            <span>RAM · {metrics ? fmtBytes(metrics.mem.total) : '—'}</span>
            <span>Disque · {disk ? fmtBytes(disk.size) : '—'}</span>
          </div>
        </div>

        <div>
          <AreaChart values={series} height={42} color="var(--accent)" />
        </div>

        <div className="row row--between hint">
          <span className="row" style={{ gap: 12 }}>
            <span className="row" style={{ gap: 4 }}>
              <Cpu size={11} /> {metrics ? fmtPct(metrics.cpu) : '—'}
            </span>
            <span className="row" style={{ gap: 4 }}>
              <MemoryStick size={11} /> {metrics ? fmtPct(memPct) : '—'}
            </span>
            <span className="row" style={{ gap: 4 }}>
              <HardDrive size={11} /> {disk ? fmtPct(disk.pct) : '—'}
            </span>
          </span>
          <span>{metrics ? `${fmtRate(metrics.net.rxRate)} ↓` : ''}</span>
        </div>
      </div>
    </div>
  )
}

export function Fleet({ hosts, statuses, metrics, history, onOpen, onAdd }: Props): ReactNode {
  const { notify } = useToast()
  const [command, setCommand] = useState('uptime')
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<Record<string, string> | null>(null)

  const online = hosts.filter((h) => statuses[h.id]?.status === 'online')
  const totalMem = online.reduce((sum, h) => sum + (metrics[h.id]?.mem.total ?? 0), 0)
  const usedMem = online.reduce((sum, h) => sum + (metrics[h.id]?.mem.used ?? 0), 0)
  const avgCpu = online.length
    ? online.reduce((sum, h) => sum + (metrics[h.id]?.cpu ?? 0), 0) / online.length
    : 0

  const run = async (): Promise<void> => {
    if (!command.trim()) return
    setRunning(true)
    try {
      const res = await window.srv.ssh.execMany(
        hosts.map((h) => h.id),
        command
      )
      const mapped: Record<string, string> = {}
      for (const host of hosts) {
        const entry = res[host.id]
        mapped[host.id] = entry
          ? 'error' in entry
            ? `✖ ${entry.error}`
            : `$ ${command}\n${entry.stdout}${entry.stderr ? `\n${entry.stderr}` : ''}`
          : '—'
      }
      setResults(mapped)
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="stack">
      {hosts.length === 0 ? (
        <Card>
          <Empty
            title="Aucun serveur configuré"
            hint="Ajoute ton premier VPS avec son adresse, son utilisateur et son mot de passe SSH."
            icon={<Server size={20} />}
          />
          <div className="row" style={{ justifyContent: 'center' }}>
            <Btn variant="primary" icon={<Plus size={14} />} onClick={onAdd}>
              Ajouter un serveur
            </Btn>
          </div>
        </Card>
      ) : (
        <>
          <div className="grid grid--kpi">
            <KpiCard
              icon={<Server size={20} color="var(--accent)" />}
              label="Serveurs en ligne"
              value={`${online.length} / ${hosts.length}`}
              hint={`${hosts.length - online.length} hors ligne`}
            />
            <KpiCard icon={<Cpu size={20} color="var(--accent)" />} label="CPU moyen" value={fmtPct(avgCpu)} hint="sur les hôtes connectés" />
            <KpiCard
              icon={<MemoryStick size={20} color="var(--accent-2)" />}
              label="RAM utilisée"
              value={fmtBytes(usedMem)}
              hint={`sur ${fmtBytes(totalMem)} au total`}
            />
            <KpiCard
              icon={<Radio size={20} color="var(--info)" />}
              label="Serveurs en alerte"
              value={String(
                online.filter((h) => {
                  const m = metrics[h.id]
                  if (!m) return false
                  return (m.mem.used / Math.max(1, m.mem.total)) * 100 > 90 || m.disks.some((d) => d.pct > 90)
                }).length
              )}
              hint="RAM ou disque > 90 %"
            />
          </div>

          <div className="fleet-grid">
            {hosts.map((host) => (
              <HostCard
                key={host.id}
                host={host}
                status={statuses[host.id]}
                metrics={metrics[host.id]}
                history={history[host.id] ?? []}
                onOpen={() => onOpen(host.id)}
              />
            ))}
          </div>

          <FleetSecurity hosts={hosts} statuses={statuses} onOpen={onOpen} />

          <Card
            title="Commande sur toute la flotte"
            icon={<TerminalSquare size={14} />}
            subtitle="exécution parallèle, sans sudo"
            actions={
              <Btn variant="primary" size="sm" onClick={run} loading={running} disabled={!command.trim()}>
                Exécuter
              </Btn>
            }
          >
            <div className="row">
              <input
                className="input mono grow"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void run()}
                placeholder="uptime"
                spellCheck={false}
              />
            </div>
            {results && (
              <div className="stack" style={{ marginTop: 12, gap: 10 }}>
                {hosts.map((host) => (
                  <div key={host.id}>
                    <div className="row" style={{ marginBottom: 4 }}>
                      <StatusDot status={statuses[host.id]?.status ?? 'offline'} />
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{host.name}</span>
                      <span className="mono dim" style={{ fontSize: 10.5 }}>
                        {host.host}
                      </span>
                    </div>
                    <pre className="console" style={{ maxHeight: 180 }}>
                      {results[host.id]}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
