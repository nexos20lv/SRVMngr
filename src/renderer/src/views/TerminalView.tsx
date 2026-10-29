import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { RefreshCw, Terminal as TerminalIcon } from 'lucide-react'
import type { HostPublic } from '@shared/types'
import { Badge, Btn } from '@/components/ui'

const THEME = {
  background: '#06090e',
  foreground: '#d7e3f4',
  cursor: '#a78bfa',
  cursorAccent: '#06090e',
  selectionBackground: '#2d2350',
  black: '#1b2432',
  red: '#ff6b6b',
  green: '#3ddc97',
  yellow: '#ffc247',
  blue: '#8b5cf6',
  magenta: '#d946ef',
  cyan: '#4cc9f0',
  white: '#e9eefb',
  brightBlack: '#5d6a7e',
  brightRed: '#ff8f8f',
  brightGreen: '#72f0b8',
  brightYellow: '#ffd88a',
  brightBlue: '#b9a3ff',
  brightMagenta: '#f0a6ff',
  brightCyan: '#7ce0ff',
  brightWhite: '#ffffff'
}

export function TerminalView({ host, active }: { host: HostPublic; active: boolean }): ReactNode {
  const mountRef = useRef<HTMLDivElement>(null)
  const termIdRef = useRef<string | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<'connecting' | 'ready' | 'closed' | 'error'>('connecting')
  const [error, setError] = useState<string | undefined>()
  const [latency, setLatency] = useState<number | undefined>()

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    setState('connecting')
    setError(undefined)

    const term = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 12.5,
      lineHeight: 1.25,
      cursorBlink: true,
      scrollback: 8000,
      theme: THEME,
      allowProposedApi: true
    })
    const fit = new FitAddon()
    fitRef.current = fit
    term.loadAddon(fit)
    term.open(mount)
    try {
      fit.fit()
    } catch {
      /* conteneur pas encore mesuré */
    }

    term.writeln(`\x1b[38;2;167;139;250m▸ Connexion à ${host.username}@${host.host}:${host.port}…\x1b[0m`)

    let disposed = false
    const unsubscribeData = window.srv.term.onData((termId, data) => {
      if (termId === termIdRef.current) term.write(data)
    })
    const unsubscribeClose = window.srv.term.onClose((termId) => {
      if (termId !== termIdRef.current) return
      termIdRef.current = null
      setState('closed')
      term.writeln('\r\n\x1b[38;2;255;107;107m▸ Session terminée. Clique sur Reconnecter.\x1b[0m')
    })
    const inputDisposable = term.onData((data) => {
      if (termIdRef.current) window.srv.term.write(termIdRef.current, data)
    })

    const started = Date.now()
    window.srv.term
      .open(host.id, term.cols, term.rows)
      .then((termId) => {
        if (disposed) {
          void window.srv.term.close(termId)
          return
        }
        termIdRef.current = termId
        setLatency(Date.now() - started)
        setState('ready')
        term.focus()
      })
      .catch((err: unknown) => {
        if (disposed) return
        setError(err instanceof Error ? err.message : String(err))
        setState('error')
      })

    const resize = (): void => {
      try {
        fit.fit()
      } catch {
        return
      }
      if (termIdRef.current) void window.srv.term.resize(termIdRef.current, term.cols, term.rows)
    }
    const observer = new ResizeObserver(() => resize())
    observer.observe(mount)
    window.addEventListener('resize', resize)

    return () => {
      disposed = true
      observer.disconnect()
      window.removeEventListener('resize', resize)
      unsubscribeData()
      unsubscribeClose()
      inputDisposable.dispose()
      if (termIdRef.current) void window.srv.term.close(termIdRef.current)
      termIdRef.current = null
      term.dispose()
      fitRef.current = null
    }
  }, [host.id, host.host, host.username, host.port, attempt])

  useEffect(() => {
    if (!active) return
    const timer = setTimeout(() => {
      try {
        fitRef.current?.fit()
        if (mountRef.current) mountRef.current.focus()
      } catch {
        /* ignore */
      }
    }, 60)
    return () => clearTimeout(timer)
  }, [active])

  return (
    <div className="term-shell">
      <div className="term-bar">
        <TerminalIcon size={13} />
        <span className="mono">
          {host.username}@{host.host}
        </span>
        {state === 'ready' && <Badge tone="ok">connecté{latency ? ` · ${latency} ms` : ''}</Badge>}
        {state === 'connecting' && <Badge tone="warn">connexion…</Badge>}
        {state === 'closed' && <Badge tone="muted">session fermée</Badge>}
        {state === 'error' && <Badge tone="err">{error ?? 'erreur'}</Badge>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <Btn size="sm" variant="ghost" icon={<RefreshCw size={12} />} onClick={() => setAttempt((n) => n + 1)}>
            Reconnecter
          </Btn>
        </div>
      </div>
      <div className="term-host" ref={mountRef} />
    </div>
  )
}
