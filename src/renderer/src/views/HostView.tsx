import { useEffect, useState, type ReactNode } from 'react'
import {
  Activity,
  CalendarClock,
  Container,
  Database,
  Folder,
  Globe,
  LayoutDashboard,
  Lock,
  Network,
  Pencil,
  Power,
  RefreshCw,
  RotateCcw,
  ScrollText,
  Server,
  Settings,
  ShieldAlert,
  ShieldCheck,
  TerminalSquare,
  Wrench
} from 'lucide-react'
import type { HostPublic, HostStatus, MetricsSnapshot } from '@shared/types'
import { Badge, Btn, Dropdown, Modal, StatusDot, useToast } from '@/components/ui'
import { fmtPct, fmtRate, fmtUptime } from '@/lib/format'
import { CertificatesView } from './Certificates'
import { CronView } from './Cron'
import { DatabaseView } from './Database'
import { DockerView } from './DockerView'
import { Fail2banView } from './Fail2ban'
import { FilesView } from './Files'
import { LogsView } from './Logs'
import { MaintenanceView } from './Maintenance'
import { Overview } from './Overview'
import { PortsView } from './Ports'
import { ProcessesView } from './Processes'
import { SecurityView } from './Security'
import { ServicesView } from './Services'
import { SitesView } from './Sites'
import { TerminalView } from './TerminalView'

export type TabKey =
  | 'overview'
  | 'services'
  | 'docker'
  | 'sites'
  | 'processes'
  | 'files'
  | 'logs'
  | 'terminal'
  | 'database'
  | 'certs'
  | 'fail2ban'
  | 'cron'
  | 'maintenance'
  | 'ports'
  | 'security'

const TABS: { key: TabKey; label: string; icon: ReactNode }[] = [
  { key: 'overview', label: "Vue d'ensemble", icon: <LayoutDashboard size={14} /> },
  { key: 'services', label: 'Services', icon: <Settings size={14} /> },
  { key: 'docker', label: 'Docker', icon: <Container size={14} /> },
  { key: 'sites', label: 'Sites web', icon: <Globe size={14} /> },
  { key: 'processes', label: 'Processus', icon: <Activity size={14} /> },
  { key: 'files', label: 'Fichiers', icon: <Folder size={14} /> },
  { key: 'logs', label: 'Journaux', icon: <ScrollText size={14} /> },
  { key: 'terminal', label: 'Terminal', icon: <TerminalSquare size={14} /> }
]

const TOOL_TABS: { key: TabKey; label: string; icon: ReactNode }[] = [
  { key: 'security', label: 'Sécurité', icon: <ShieldCheck size={14} /> },
  { key: 'database', label: 'Base de données', icon: <Database size={14} /> },
  { key: 'certs', label: 'Certificats SSL', icon: <Lock size={14} /> },
  { key: 'fail2ban', label: 'Fail2ban', icon: <ShieldAlert size={14} /> },
  { key: 'cron', label: 'Tâches cron', icon: <CalendarClock size={14} /> },
  { key: 'maintenance', label: 'Maintenance', icon: <Wrench size={14} /> },
  { key: 'ports', label: 'Ports réseau', icon: <Network size={14} /> }
]

interface Props {
  host: HostPublic
  status?: HostStatus
  metrics?: MetricsSnapshot
  history: MetricsSnapshot[]
  metricError?: string
  onEdit: () => void
  onReconnect: () => void
  onChanged: () => void
}

export function HostView({ host, status, metrics, history, metricError, onEdit, onReconnect, onChanged }: Props): ReactNode {
  const { notify } = useToast()
  const [tab, setTab] = useState<TabKey>('overview')
  const [terminalMounted, setTerminalMounted] = useState(false)
  const [filesPath, setFilesPath] = useState<string | undefined>()
  const [power, setPower] = useState<'reboot' | 'shutdown' | null>(null)
  const [powerBusy, setPowerBusy] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [refreshingMetrics, setRefreshingMetrics] = useState(false)

  useEffect(() => {
    if (tab === 'terminal') setTerminalMounted(true)
  }, [tab])

  const online = status?.status === 'online'
  const memPct = metrics ? (metrics.mem.used / Math.max(1, metrics.mem.total)) * 100 : 0
  const rootDisk = metrics?.disks.find((d) => d.mount === '/') ?? metrics?.disks[0]

  const reconnect = async (): Promise<void> => {
    setReconnecting(true)
    try {
      await onReconnect()
      notify('Connexion rétablie', 'ok')
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      setReconnecting(false)
    }
  }

  const powerAction = async (): Promise<void> => {
    if (!power) return
    setPowerBusy(true)
    try {
      if (power === 'reboot') await window.srv.host.reboot(host.id)
      else await window.srv.host.shutdown(host.id)
      notify(power === 'reboot' ? 'Redémarrage lancé' : 'Extinction lancée', 'ok')
      setPower(null)
      setTimeout(onChanged, 1500)
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      setPowerBusy(false)
    }
  }

  const refreshMetrics = async (): Promise<void> => {
    setRefreshingMetrics(true)
    try {
      await window.srv.metrics.refresh(host.id)
    } finally {
      setRefreshingMetrics(false)
    }
  }

  return (
    <>
      <div className="topbar">
        <div className="topbar__title">
          <h1 className="row" style={{ gap: 9 }}>
            <StatusDot status={status?.status ?? 'offline'} />
            {host.name}
            {host.group && <Badge tone="muted">{host.group}</Badge>}
          </h1>
          <div className="topbar__sub">
            <span>
              {host.username}@{host.host}:{host.port}
            </span>
            {online && metrics && (
              <>
                <span className="dim">·</span>
                <span>{fmtUptime(metrics.uptime)}</span>
                <span className="dim">·</span>
                <span>{metrics.cores} cœurs</span>
                <span className="dim">·</span>
                <span>load {metrics.load[0].toFixed(2)}</span>
                <span className="dim">·</span>
                <span>
                  ↓ {fmtRate(metrics.net.rxRate)} ↑ {fmtRate(metrics.net.txRate)}
                </span>
              </>
            )}
            {status?.status === 'error' && <Badge tone="err">{status.error?.slice(0, 90)}</Badge>}
          </div>
        </div>

        <div className="topbar__actions">
          {metrics && (
            <span className="row" style={{ gap: 10, marginRight: 6 }}>
              <span className="hint">CPU {fmtPct(metrics.cpu)}</span>
              <span className="hint">RAM {fmtPct(memPct)}</span>
              <span className="hint">DISK {fmtPct(rootDisk?.pct ?? 0)}</span>
            </span>
          )}
          <Btn
            variant="ghost"
            size="sm"
            icon={<RefreshCw size={13} />}
            onClick={() => void reconnect()}
            loading={reconnecting}
            title="Reconnecter la session SSH"
          >
            Reconnecter
          </Btn>
          <Btn variant="ghost" size="sm" icon={<Pencil size={13} />} onClick={onEdit}>
            Modifier
          </Btn>
          <Btn variant="ghost" size="sm" icon={<RotateCcw size={13} />} onClick={() => setPower('reboot')} disabled={!online}>
            Reboot
          </Btn>
          <Btn variant="ghost" size="sm" icon={<Power size={13} />} onClick={() => setPower('shutdown')} disabled={!online}>
            Éteindre
          </Btn>
        </div>
      </div>

      <div className="tabbar">
        <div className="tabs">
          {TABS.map((item) => (
            <button key={item.key} className={`tab ${tab === item.key ? 'tab--active' : ''}`} onClick={() => setTab(item.key)}>
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
        <Dropdown
          label={TOOL_TABS.find((item) => item.key === tab)?.label ?? 'Outils'}
          icon={<Wrench size={14} />}
          active={TOOL_TABS.some((item) => item.key === tab)}
          items={TOOL_TABS.map((item) => ({
            key: item.key,
            label: item.label,
            icon: item.icon,
            active: tab === item.key,
            onSelect: () => setTab(item.key)
          }))}
        />
      </div>

      <div className="content" style={{ display: tab === 'terminal' ? 'none' : 'block' }}>
        {metricError && online && (
          <div className="alert" style={{ marginBottom: 14 }}>
            <Activity size={15} />
            <span className="grow">Métriques indisponibles : {metricError}</span>
            <Btn size="sm" variant="ghost" onClick={() => void reconnect()} loading={reconnecting}>
              Reconnecter
            </Btn>
          </div>
        )}
        {!online && tab !== 'terminal' ? (
          <div className="stack">
            <div className="alert alert--err">
              <Server size={15} />
              <span>
                {status?.status === 'connecting' ? 'Connexion en cours…' : 'Serveur hors ligne'}
                {status?.error ? ` : ${status.error}` : ''}
              </span>
            </div>
            <div className="card">
              <div className="empty">
                <strong>{host.name}</strong>
                <span>
                  {host.username}@{host.host}:{host.port}
                  {host.hasSudo ? ' · sudo configuré' : ' · sans sudo'}
                </span>
                <div className="row" style={{ marginTop: 8 }}>
                  <Btn icon={<RefreshCw size={14} />} onClick={() => void reconnect()} loading={reconnecting}>
                    Reconnecter
                  </Btn>
                  <Btn variant="ghost" icon={<Pencil size={14} />} onClick={onEdit}>
                    Modifier la connexion
                  </Btn>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            {tab === 'overview' && (
              <Overview
                host={host}
                metrics={metrics}
                history={history}
                refreshing={refreshingMetrics}
                onRefresh={() => void refreshMetrics()}
              />
            )}
            {tab === 'services' && <ServicesView host={host} />}
            {tab === 'docker' && <DockerView host={host} />}
            {tab === 'sites' && (
              <SitesView
                host={host}
                onOpenFiles={(path) => {
                  setFilesPath(path)
                  setTab('files')
                }}
              />
            )}
            {tab === 'processes' && <ProcessesView host={host} />}
            {tab === 'files' && <FilesView key={filesPath ?? 'home'} host={host} initialPath={filesPath} />}
            {tab === 'logs' && <LogsView host={host} />}
            {tab === 'database' && <DatabaseView host={host} />}
            {tab === 'certs' && <CertificatesView host={host} />}
            {tab === 'fail2ban' && <Fail2banView host={host} />}
            {tab === 'cron' && <CronView host={host} />}
            {tab === 'maintenance' && <MaintenanceView host={host} />}
            {tab === 'ports' && <PortsView host={host} />}
            {tab === 'security' && <SecurityView host={host} />}
          </>
        )}
      </div>

      <div className="content content--flush" style={{ display: tab === 'terminal' ? 'flex' : 'none' }}>
        {terminalMounted && <TerminalView host={host} active={tab === 'terminal'} />}
      </div>

      <Modal
        open={!!power}
        title={power === 'reboot' ? `Redémarrer ${host.name} ?` : `Éteindre ${host.name} ?`}
        onClose={() => setPower(null)}
        footer={
          <>
            <Btn variant="ghost" onClick={() => setPower(null)}>
              Annuler
            </Btn>
            <Btn variant="danger" onClick={powerAction} loading={powerBusy} icon={<Power size={14} />}>
              {power === 'reboot' ? 'Redémarrer' : 'Éteindre'}
            </Btn>
          </>
        }
      >
        <div className="alert alert--err">
          <Power size={15} />
          <span>
            {power === 'reboot'
              ? 'Le serveur va redémarrer immédiatement : tous les services et serveurs de jeux seront coupés quelques instants.'
              : 'Le serveur va s’éteindre et ne sera plus joignable jusqu’à une intervention manuelle (console du fournisseur).'}
          </span>
        </div>
        <p className="hint">
          Hôte : {host.username}@{host.host}. Une confirmation n’est pas demandée par le système distant.
        </p>
      </Modal>
    </>
  )
}
