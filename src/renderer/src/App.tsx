import { useCallback, useEffect, useRef, useState } from 'react'
import type { HostPublic, HostStatus, MetricsSnapshot } from '@shared/types'
import { HostDialog } from '@/components/HostDialog'
import { Sidebar } from '@/components/Sidebar'
import { ToastProvider } from '@/components/ui'
import { Fleet } from '@/views/Fleet'
import { HostView } from '@/views/HostView'
import { Alerts } from '@/views/Alerts'
import { Sync } from '@/views/Sync'

const HISTORY_SIZE = 60
const SYNC_INTERVAL_MS = 30_000
const STATUS_FAILURE_DELAY_MS = 8_000
const STARTUP_CONNECT_ATTEMPTS = 3
const STARTUP_CONNECT_RETRY_MS = 1_500

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function Shell(): React.ReactNode {
  const [hosts, setHosts] = useState<HostPublic[]>([])
  const [statuses, setStatuses] = useState<Record<string, HostStatus>>({})
  const [metrics, setMetrics] = useState<Record<string, MetricsSnapshot>>({})
  const [history, setHistory] = useState<Record<string, MetricsSnapshot[]>>({})
  const [metricErrors, setMetricErrors] = useState<Record<string, string>>({})
  const [activeId, setActiveId] = useState<string>('fleet')
  const [dialog, setDialog] = useState<{ open: boolean; host: HostPublic | null }>({ open: false, host: null })
  const [booted, setBooted] = useState(false)
  const [update, setUpdate] = useState<{ state: string; version?: string; percent?: number; error?: string }>()
  const [syncEmail, setSyncEmail] = useState<string>()

  const statusesRef = useRef(statuses)
  statusesRef.current = statuses
  const pendingStatusTimers = useRef(new Map<string, number>())
  const pendingStatuses = useRef(new Map<string, HostStatus>())

  const connectHost = useCallback(async (host: HostPublic) => {
    setStatuses((prev) => ({ ...prev, [host.id]: { id: host.id, status: 'connecting' } }))
    try {
      const status = await window.srv.ssh.connect(host.id)
      setStatuses((prev) => ({ ...prev, [host.id]: status }))
      await window.srv.metrics.start(host.id)
    } catch {
      const status = (await window.srv.ssh.statuses()).find((entry) => entry.id === host.id)
      if (status) setStatuses((prev) => ({ ...prev, [host.id]: status }))
      try {
        await window.srv.metrics.start(host.id)
      } catch (metricError) {
        console.error(`[metrics] démarrage impossible pour ${host.name}:`, metricError)
      }
    }
  }, [])

  const refreshHosts = useCallback(
    async (connectNew = true) => {
      const list = await window.srv.hosts.list()
      setHosts(list)
      const saved = await Promise.all(list.map(async (host) => [host.id, await window.srv.metrics.history(host.id)] as const))
      setHistory((prev) => ({ ...prev, ...Object.fromEntries(saved) }))
      const backendStatuses = await window.srv.ssh.statuses()
      setStatuses((prev) => ({
        ...prev,
        ...Object.fromEntries(backendStatuses.map((status) => [status.id, status]))
      }))
      if (!connectNew) return
      const connectAtStartup = async (host: HostPublic): Promise<void> => {
        for (let attempt = 1; attempt <= STARTUP_CONNECT_ATTEMPTS; attempt += 1) {
          await connectHost(host)
          const status = (await window.srv.ssh.statuses()).find((entry) => entry.id === host.id)
          if (status?.status === 'online') return
          if (attempt < STARTUP_CONNECT_ATTEMPTS) await wait(STARTUP_CONNECT_RETRY_MS)
        }
      }
      await Promise.all(
        list
          .filter((host) => !backendStatuses.some((status) => status.id === host.id && status.status === 'online'))
          .map((host) => connectAtStartup(host))
      )
      const currentStatuses = await window.srv.ssh.statuses()
      setStatuses((prev) => ({
        ...prev,
        ...Object.fromEntries(currentStatuses.map((status) => [status.id, status]))
      }))
    },
    [connectHost]
  )

  useEffect(() => {
    void refreshHosts(true).finally(() => setBooted(true))
  }, [refreshHosts])

  useEffect(() => {
    if (!booted || hosts.length === 0) return
    const reconcileStatuses = async (): Promise<void> => {
      try {
        const currentStatuses = await window.srv.ssh.statuses()
        setStatuses((prev) => ({
          ...prev,
          ...Object.fromEntries(currentStatuses.map((status) => [status.id, status]))
        }))
      } catch (err) {
        console.error('[ssh] synchronisation des statuts impossible:', err)
      }
    }
    void reconcileStatuses()
    const timer = window.setInterval(() => {
      const offlineHosts = hosts.filter((host) => {
        const status = statusesRef.current[host.id]?.status
        return status === undefined || status === 'offline' || status === 'error'
      })
      void Promise.all(offlineHosts.map((host) => connectHost(host)))
      void reconcileStatuses()
    }, 15_000)
    return () => window.clearInterval(timer)
  }, [booted, connectHost, hosts])

  useEffect(() => {
    void window.srv.sync.session().then((session) => {
      setSyncEmail(session?.email)
    }).catch((err) => console.error('[sync] session automatique impossible:', err))
  }, [])

  useEffect(() => {
    if (!syncEmail) return
    let running = false
    const syncNow = async (): Promise<void> => {
      if (running) return
      running = true
      try {
        const result = await window.srv.sync.auto()
        if (result.synced) {
          await refreshHosts(false)
        } else if (result.error) {
          console.error('[sync] synchronisation automatique impossible:', result.error)
        }
      } catch (err) {
        console.error('[sync] synchronisation automatique impossible:', err)
      } finally {
        running = false
      }
    }
    void syncNow()
    const timer = window.setInterval(() => void syncNow(), SYNC_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [refreshHosts, syncEmail])

  useEffect(() => {
    const offStatus = window.srv.onStatus((status) => {
      const current = statusesRef.current[status.id]
      const timer = pendingStatusTimers.current.get(status.id)
      if (timer !== undefined) {
        window.clearTimeout(timer)
        pendingStatusTimers.current.delete(status.id)
      }
      pendingStatuses.current.delete(status.id)

      if (status.status === 'online') {
        setStatuses((prev) => ({ ...prev, [status.id]: status }))
        return
      }

      if (current?.status === 'online' && status.status === 'connecting') return

      if (
        current?.status === 'online' &&
        (status.status === 'offline' || status.status === 'error')
      ) {
        pendingStatuses.current.set(status.id, status)
        const delayed = window.setTimeout(() => {
          pendingStatusTimers.current.delete(status.id)
          const pending = pendingStatuses.current.get(status.id)
          if (pending) {
            pendingStatuses.current.delete(status.id)
            setStatuses((prev) => ({ ...prev, [status.id]: pending }))
          }
        }, STATUS_FAILURE_DELAY_MS)
        pendingStatusTimers.current.set(status.id, delayed)
        return
      }

      setStatuses((prev) => ({ ...prev, [status.id]: status }))
    })
    const offMetrics = window.srv.metrics.onUpdate((hostId, snapshot) => {
      setStatuses((prev) => {
        const current = prev[hostId]
        if (current?.status === 'online') return prev
        return {
          ...prev,
          [hostId]: {
            id: hostId,
            status: 'online',
            latencyMs: current?.latencyMs,
            since: current?.since ?? Date.now()
          }
        }
      })
      setMetrics((prev) => ({ ...prev, [hostId]: snapshot }))
      setHistory((prev) => ({
        ...prev,
        [hostId]: [...(prev[hostId] ?? []), snapshot].slice(-HISTORY_SIZE)
      }))
      setMetricErrors((prev) => {
        if (!prev[hostId]) return prev
        const next = { ...prev }
        delete next[hostId]
        return next
      })
    })
    const offErrors = window.srv.metrics.onError((hostId, message) => {
      // Le SSH peut rester en ligne : on affiche un bandeau, sans basculer l'hôte hors ligne.
      setMetricErrors((prev) => ({ ...prev, [hostId]: message }))
    })
    return () => {
      offStatus()
      offMetrics()
      offErrors()
      for (const timer of pendingStatusTimers.current.values()) window.clearTimeout(timer)
      pendingStatusTimers.current.clear()
      pendingStatuses.current.clear()
    }
  }, [])

  useEffect(() => window.srv.updater.onStatus(setUpdate), [])

  useEffect(() => {
    if (!['fleet', 'alerts', 'sync'].includes(activeId) && !hosts.some((h) => h.id === activeId)) setActiveId('fleet')
  }, [hosts, activeId])

  const activeHost = hosts.find((h) => h.id === activeId)

  return (
    <div className={`app ${window.srv.platform === 'darwin' ? 'is-mac' : ''} ${activeId === 'sync' ? 'app--sync' : ''}`}>
      {activeId !== 'sync' && <Sidebar
        hosts={hosts}
        statuses={statuses}
        metrics={metrics}
        active={activeId}
        onSelect={setActiveId}
        onAdd={() => setDialog({ open: true, host: null })}
        onEdit={(host) => setDialog({ open: true, host })}
        onAlerts={() => setActiveId('alerts')}
        onSync={() => setActiveId('sync')}
        syncEmail={syncEmail}
      />}

      <main className="main">
        {update && update.state !== 'current' && update.state !== 'checking' && (
          <div className={`update-banner update-banner--${update.state}`}>
            {update.state === 'available' && `Mise à jour ${update.version ?? ''} disponible…`}
            {update.state === 'downloading' && `Téléchargement de la mise à jour : ${Math.round(update.percent ?? 0)} %`}
            {update.state === 'downloaded' && 'Mise à jour prête : elle sera installée à la fermeture.'}
            {update.state === 'error' && `Mise à jour impossible : ${update.error ?? 'erreur inconnue'}`}
          </div>
        )}
        {activeId === 'alerts' ? (
          <Alerts hosts={hosts} statuses={statuses} metrics={metrics} onOpen={setActiveId} />
        ) : activeId === 'sync' ? (
          <Sync onClose={() => setActiveId('fleet')} onSessionChange={setSyncEmail} />
        ) : activeHost ? (
          <HostView
            key={activeHost.id}
            host={activeHost}
            status={statuses[activeHost.id]}
            metrics={metrics[activeHost.id]}
            history={history[activeHost.id] ?? []}
            metricError={metricErrors[activeHost.id]}
            onEdit={() => setDialog({ open: true, host: activeHost })}
            onReconnect={async () => {
              await window.srv.ssh.connect(activeHost.id)
              await window.srv.metrics.start(activeHost.id)
            }}
            onChanged={() => void refreshHosts(false)}
          />
        ) : (
          <>
            <div className="topbar">
              <div className="topbar__title">
                <h1>Vue d&apos;ensemble</h1>
                <div className="topbar__sub">
                  {booted ? `${hosts.length} serveur(s) configuré(s)` : 'Chargement…'}
                  {hosts.length > 0 && (
                    <>
                      <span className="dim">·</span>
                      <span>métriques temps réel toutes les 3 s</span>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className="content">
              <Fleet
                hosts={hosts}
                statuses={statuses}
                metrics={metrics}
                history={history}
                onOpen={setActiveId}
                onAdd={() => setDialog({ open: true, host: null })}
              />
            </div>
          </>
        )}
      </main>

      <HostDialog
        open={dialog.open}
        host={dialog.host}
        onClose={() => setDialog({ open: false, host: null })}
        onSaved={() => void refreshHosts(true)}
      />
    </div>
  )
}

export default function App(): React.ReactNode {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  )
}
