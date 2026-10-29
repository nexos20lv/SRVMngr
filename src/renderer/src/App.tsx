import { useCallback, useEffect, useRef, useState } from 'react'
import type { HostPublic, HostStatus, MetricsSnapshot } from '@shared/types'
import { HostDialog } from '@/components/HostDialog'
import { Sidebar } from '@/components/Sidebar'
import { ToastProvider } from '@/components/ui'
import { Fleet } from '@/views/Fleet'
import { HostView } from '@/views/HostView'

const HISTORY_SIZE = 60

function Shell(): React.ReactNode {
  const [hosts, setHosts] = useState<HostPublic[]>([])
  const [statuses, setStatuses] = useState<Record<string, HostStatus>>({})
  const [metrics, setMetrics] = useState<Record<string, MetricsSnapshot>>({})
  const [history, setHistory] = useState<Record<string, MetricsSnapshot[]>>({})
  const [metricErrors, setMetricErrors] = useState<Record<string, string>>({})
  const [activeId, setActiveId] = useState<string>('fleet')
  const [dialog, setDialog] = useState<{ open: boolean; host: HostPublic | null }>({ open: false, host: null })
  const [booted, setBooted] = useState(false)

  const statusesRef = useRef(statuses)
  statusesRef.current = statuses

  const connectHost = useCallback(async (host: HostPublic) => {
    setStatuses((prev) => ({ ...prev, [host.id]: { id: host.id, status: 'connecting' } }))
    try {
      await window.srv.ssh.connect(host.id)
      await window.srv.metrics.start(host.id)
    } catch {
      // l'événement de statut porte déjà le message d'erreur
    }
  }, [])

  const refreshHosts = useCallback(
    async (connectNew = true) => {
      const list = await window.srv.hosts.list()
      setHosts(list)
      if (!connectNew) return
      for (const host of list) {
        if (statusesRef.current[host.id]?.status !== 'online') await connectHost(host)
      }
    },
    [connectHost]
  )

  useEffect(() => {
    void refreshHosts(true).finally(() => setBooted(true))
  }, [refreshHosts])

  useEffect(() => {
    const offStatus = window.srv.onStatus((status) => {
      setStatuses((prev) => ({ ...prev, [status.id]: status }))
    })
    const offMetrics = window.srv.metrics.onUpdate((hostId, snapshot) => {
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
    }
  }, [])

  useEffect(() => {
    if (activeId !== 'fleet' && !hosts.some((h) => h.id === activeId)) setActiveId('fleet')
  }, [hosts, activeId])

  const activeHost = hosts.find((h) => h.id === activeId)

  return (
    <div className={`app ${window.srv.platform === 'darwin' ? 'is-mac' : ''}`}>
      <Sidebar
        hosts={hosts}
        statuses={statuses}
        metrics={metrics}
        active={activeId}
        onSelect={setActiveId}
        onAdd={() => setDialog({ open: true, host: null })}
        onEdit={(host) => setDialog({ open: true, host })}
      />

      <main className="main">
        {activeHost ? (
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
