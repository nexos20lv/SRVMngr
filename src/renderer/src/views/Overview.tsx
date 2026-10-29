import type { ReactNode } from 'react'
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Cpu,
  Database,
  HardDrive,
  MemoryStick,
  Network,
  RefreshCw,
  Server,
  Thermometer
} from 'lucide-react'
import type { HostPublic, MetricsSnapshot, SysInfo } from '@shared/types'
import { AreaChart, Badge, Card, Empty, ErrorBox, KpiCard, Loading, Meter } from '@/components/ui'
import { useAsync, useTicker } from '@/lib/hooks'
import { alertTone, fmtBytes, fmtPct, fmtRate, fmtUptime } from '@/lib/format'

interface Props {
  host: HostPublic
  metrics?: MetricsSnapshot
  history: MetricsSnapshot[]
  refreshing?: boolean
  onRefresh?: () => void
}

function Series({ values, color }: { values: number[]; color: string }): ReactNode {
  if (values.length < 2) {
    return <div className="hint" style={{ padding: '18px 0' }}>Collecte des données…</div>
  }
  return <AreaChart values={values} height={88} color={color} showScale />
}

export function Overview({ host, metrics, history, refreshing = false, onRefresh }: Props): ReactNode {
  const info = useAsync<Partial<SysInfo>>(() => window.srv.sysInfo(host.id), [host.id])
  const now = useTicker(Boolean(metrics), 1000)
  void now

  const cpuHistory = history.map((m) => m.cpu)
  const ramHistory = history.map((m) => (m.mem.used / Math.max(1, m.mem.total)) * 100)

  const memPct = metrics ? (metrics.mem.used / Math.max(1, metrics.mem.total)) * 100 : 0
  const swapPct = metrics && metrics.mem.swapTotal > 0 ? (metrics.mem.swapUsed / metrics.mem.swapTotal) * 100 : 0
  const rootDisk = metrics?.disks.find((d) => d.mount === '/') ?? metrics?.disks[0]
  const maxDisk = metrics?.disks.reduce((worst, d) => (d.pct > worst.pct ? d : worst), metrics.disks[0] ?? { pct: 0, mount: '—', fs: '', size: 0, used: 0, avail: 0 })

  const alerts: string[] = []
  if (memPct >= 90) alerts.push(`Mémoire à ${fmtPct(memPct)}`)
  if (metrics?.disks.some((d) => d.pct >= 85)) alerts.push(`Disque ${maxDisk?.mount} à ${fmtPct(maxDisk?.pct ?? 0)}`)
  if (metrics && metrics.load[0] > metrics.cores * 1.5) alerts.push(`Charge élevée (${metrics.load[0].toFixed(2)} pour ${metrics.cores} cœurs)`)
  if (swapPct >= 60) alerts.push(`Swap utilisé à ${fmtPct(swapPct)}`)

  return (
    <div className="stack">
      <div className="row row--between">
        {!metrics ? <Loading label="Connexion et collecte des métriques…" /> : (
          <span className="hint">
            {Date.now() - metrics.time < 10_000
              ? `Actualisé il y a ${Math.max(0, Math.round((Date.now() - metrics.time) / 1000))} s`
              : `Dernière donnée il y a ${Math.round((Date.now() - metrics.time) / 1000)} s`}
          </span>
        )}
        {onRefresh && (
          <button className="btn btn--ghost btn--sm" onClick={onRefresh} disabled={refreshing} type="button">
            <RefreshCw size={13} className={refreshing ? 'spin' : undefined} />
            {refreshing ? 'Actualisation…' : 'Actualiser'}
          </button>
        )}
      </div>

      {alerts.length > 0 && (
        <div className="stack" style={{ gap: 7 }}>
          {alerts.map((alert) => (
            <div key={alert} className="alert">
              <Activity size={15} />
              <span>{alert}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid--kpi">
        <KpiCard
          label="Processeur"
          value={metrics ? fmtPct(metrics.cpu) : '—'}
          hint={metrics ? `${metrics.cores} cœurs · charge ${metrics.load[0].toFixed(2)}` : 'En attente'}
          ringValue={metrics?.cpu ?? 0}
        />
        <KpiCard
          label="Mémoire"
          value={metrics ? fmtPct(memPct) : '—'}
          hint={metrics ? `${fmtBytes(metrics.mem.used)} / ${fmtBytes(metrics.mem.total)}` : 'En attente'}
          ringValue={memPct}
        />
        <KpiCard
          label={`Disque ${rootDisk?.mount ?? '/'}`}
          value={rootDisk ? fmtPct(rootDisk.pct) : '—'}
          hint={rootDisk ? `${fmtBytes(rootDisk.used)} / ${fmtBytes(rootDisk.size)}` : 'En attente'}
          ringValue={rootDisk?.pct ?? 0}
        />
        <KpiCard
          icon={<Network size={20} color="var(--info)" />}
          label="Réseau"
          value={metrics ? fmtRate(metrics.net.rxRate + metrics.net.txRate) : '—'}
          hint={
            metrics ? (
              <span className="row" style={{ gap: 10 }}>
                <span style={{ color: 'var(--ok)' }}>
                  <ArrowDownRight size={11} /> {fmtRate(metrics.net.rxRate)}
                </span>
                <span style={{ color: 'var(--info)' }}>
                  <ArrowUpRight size={11} /> {fmtRate(metrics.net.txRate)}
                </span>
              </span>
            ) : (
              'En attente'
            )
          }
        />
      </div>

      <div className="split-2">
        <Card
          title="Processeur"
          icon={<Cpu size={14} />}
          subtitle="60 derniers échantillons"
          actions={
            <span className="legend">
              <span>
                <i className="legend__dot" style={{ background: 'var(--accent)' }} />
                usage
              </span>
            </span>
          }
        >
          <Series values={cpuHistory} color="var(--accent)" />
          <div className="row row--between" style={{ marginTop: 10 }}>
            <div className="legend">
              <span>1 min {metrics?.load[0].toFixed(2) ?? '—'}</span>
              <span>5 min {metrics?.load[1].toFixed(2) ?? '—'}</span>
              <span>15 min {metrics?.load[2].toFixed(2) ?? '—'}</span>
            </div>
            {metrics?.temp !== undefined && (
              <Badge tone={metrics.temp > 80 ? 'err' : 'muted'}>
                <Thermometer size={11} /> {metrics.temp.toFixed(0)} °C
              </Badge>
            )}
          </div>
        </Card>

        <Card
          title="Mémoire"
          icon={<MemoryStick size={14} />}
          subtitle={metrics ? `${fmtBytes(metrics.mem.used)} utilisés` : undefined}
        >
          <Series values={ramHistory} color="var(--accent-2)" />
          <div className="stack" style={{ gap: 8, marginTop: 12 }}>
            <div>
              <div className="row row--between" style={{ marginBottom: 5 }}>
                <span className="hint">RAM ({fmtBytes(metrics?.mem.available ?? 0)} dispo)</span>
                <span className="hint">{fmtPct(memPct)}</span>
              </div>
              <Meter value={memPct} color="var(--accent-2)" />
            </div>
            <div>
              <div className="row row--between" style={{ marginBottom: 5 }}>
                <span className="hint">
                  Swap ({fmtBytes(metrics?.mem.swapUsed ?? 0)} / {fmtBytes(metrics?.mem.swapTotal ?? 0)})
                </span>
                <span className="hint">{metrics?.mem.swapTotal ? fmtPct(swapPct) : 'aucun'}</span>
              </div>
              <Meter value={swapPct} color="var(--warn)" />
            </div>
          </div>
        </Card>
      </div>

      <div className="split-2">
        <Card title="Stockage" icon={<HardDrive size={14} />} subtitle={`${metrics?.disks.length ?? 0} volume(s)`} bodyClassName="card__body--flush">
          {metrics?.disks.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Montage</th>
                    <th>Périphérique</th>
                    <th className="num">Utilisé</th>
                    <th style={{ width: 130 }}>Remplissage</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.disks.map((disk) => (
                    <tr key={disk.mount}>
                      <td className="mono">{disk.mount}</td>
                      <td className="mono muted truncate" title={disk.fs}>
                        {disk.fs}
                      </td>
                      <td className="num">
                        {fmtBytes(disk.used)} / {fmtBytes(disk.size)}
                      </td>
                      <td>
                        <div className="row" style={{ gap: 7 }}>
                          <div className="grow">
                            <Meter value={disk.pct} />
                          </div>
                          <span className={`badge badge--${alertTone(disk.pct)}`} style={{ minWidth: 44, justifyContent: 'center' }}>
                            {Math.round(disk.pct)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="Aucun volume détecté" />
          )}
        </Card>

        <Card
          title="Système"
          icon={<Server size={14} />}
          actions={
            <button className="btn btn--icon" onClick={info.reload} title="Rafraîchir">
              <RefreshCw size={13} />
            </button>
          }
        >
          {info.error ? (
            <ErrorBox message={info.error} onRetry={info.reload} />
          ) : info.loading && !info.data ? (
            <Loading />
          ) : (
            <dl className="kv">
              <dt>Nom</dt>
              <dd>{info.data?.hostname ?? '—'}</dd>
              <dt>Système</dt>
              <dd title={info.data?.os}>{info.data?.os ?? '—'}</dd>
              <dt>Noyau</dt>
              <dd>{info.data?.kernel ?? '—'}</dd>
              <dt>Architecture</dt>
              <dd>{info.data?.arch ?? '—'}</dd>
              <dt>CPU</dt>
              <dd title={info.data?.cpuModel}>{info.data?.cpuModel || '—'}</dd>
              <dt>Uptime</dt>
              <dd>{fmtUptime(metrics?.uptime ?? info.data?.uptime ?? 0)}</dd>
              <dt>Adresse IP</dt>
              <dd>{info.data?.ip || host.host}</dd>
              <dt>Fuseau</dt>
              <dd>{info.data?.timezone ?? '—'}</dd>
              <dt>Virtualisation</dt>
              <dd>{info.data?.virtualization ?? '—'}</dd>
              <dt>Init / paquets</dt>
              <dd>{[info.data?.initSystem, info.data?.packageManager].filter(Boolean).join(' · ') || '—'}</dd>
              <dt>Services</dt>
              <dd className="row" style={{ gap: 5 }}>
                {info.data?.hasDocker && <Badge tone="accent">Docker</Badge>}
                {info.data?.hasNginx && <Badge tone="accent">nginx</Badge>}
                {info.data?.hasWings && <Badge tone="accent">Wings</Badge>}
                {!info.data && '—'}
              </dd>
            </dl>
          )}
          {info.data?.pterodactylNode && (
            <p className="hint" style={{ marginTop: 10 }}>
              Nœud Pterodactyl : {info.data.pterodactylNode}
            </p>
          )}
        </Card>
      </div>

      <Card title="Processus les plus gourmands" icon={<Activity size={14} />} subtitle="instantané" bodyClassName="card__body--flush">
        {metrics?.procs.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="num">PID</th>
                  <th>Processus</th>
                  <th className="num">CPU</th>
                  <th className="num">RAM</th>
                  <th style={{ width: 120 }}>Charge</th>
                </tr>
              </thead>
              <tbody>
                {metrics.procs.map((proc) => (
                  <tr key={proc.pid}>
                    <td className="num muted">{proc.pid}</td>
                    <td className="mono">{proc.comm}</td>
                    <td className="num">{fmtPct(proc.cpu, 1)}</td>
                    <td className="num">{fmtBytes(proc.rss)}</td>
                    <td>
                      <Meter value={Math.min(100, proc.cpu)} color={proc.cpu > 60 ? 'var(--warn)' : 'var(--accent)'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Pas encore de données" icon={<Database size={18} />} />
        )}
      </Card>

    </div>
  )
}
