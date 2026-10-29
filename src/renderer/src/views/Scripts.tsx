import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { CheckCircle, FileCode2, Play, Save, Trash2, XCircle } from 'lucide-react'
import type { HostPublic } from '@shared/types'
import { Badge, Btn, Card, Empty, useToast } from '@/components/ui'

interface SavedScript {
  id: string
  name: string
  command: string
}

interface ScriptResult {
  host: HostPublic
  output: string
  ok: boolean
}

const STORAGE_KEY = 'srvmngr-scripts'

function expand(command: string, host: HostPublic): string {
  return command
    .replaceAll('{host}', host.host)
    .replaceAll('{name}', host.name)
    .replaceAll('{user}', host.username)
    .replaceAll('{date}', new Date().toISOString())
}

export function Scripts({ hosts }: { hosts: HostPublic[] }): ReactNode {
  const { notify } = useToast()
  const [scripts, setScripts] = useState<SavedScript[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [name, setName] = useState('')
  const [command, setCommand] = useState('uptime')
  const [selectedHosts, setSelectedHosts] = useState<string[]>(hosts.map((host) => host.id))
  const [results, setResults] = useState<ScriptResult[]>([])
  const [running, setRunning] = useState(false)

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as SavedScript[]
      setScripts(saved)
      if (saved[0]) {
        setSelectedId(saved[0].id)
        setName(saved[0].name)
        setCommand(saved[0].command)
      }
    } catch (error) {
      console.error('[scripts] lecture locale impossible:', error)
    }
  }, [])

  useEffect(() => {
    setSelectedHosts((previous) => previous.filter((id) => hosts.some((host) => host.id === id)))
  }, [hosts])

  const selected = useMemo(() => hosts.filter((host) => selectedHosts.includes(host.id)), [hosts, selectedHosts])

  const save = (): void => {
    if (!name.trim() || !command.trim()) {
      notify('Nom et commande obligatoires', 'err')
      return
    }
    const script: SavedScript = { id: selectedId || crypto.randomUUID(), name: name.trim(), command }
    const next = [...scripts.filter((item) => item.id !== script.id), script]
    setScripts(next)
    setSelectedId(script.id)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    notify('Script enregistré localement', 'ok')
  }

  const remove = (): void => {
    if (!selectedId) return
    const next = scripts.filter((item) => item.id !== selectedId)
    setScripts(next)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    setSelectedId('')
    setName('')
    setCommand('')
  }

  const run = async (): Promise<void> => {
    if (!command.trim() || selected.length === 0) {
      notify('Sélectionne au moins un serveur et une commande', 'err')
      return
    }
    setRunning(true)
    setResults([])
    try {
      const expanded = Object.fromEntries(selected.map((host) => [host.id, expand(command, host)]))
      const response = Object.fromEntries(await Promise.all(selected.map(async (host) => {
        try {
          return [host.id, await window.srv.ssh.exec(host.id, expanded[host.id])] as const
        } catch (error) {
          return [host.id, { error: error instanceof Error ? error.message : String(error) }] as const
        }
      })))
      setResults(selected.map((host) => {
        const entry = response[host.id]
        if (!entry || 'error' in entry) return { host, ok: false, output: `✖ ${entry && 'error' in entry ? entry.error : 'Aucun résultat'}` }
        return { host, ok: entry.code === 0, output: `$ ${expanded[host.id]}\n${entry.stdout}${entry.stderr ? `\n${entry.stderr}` : ''}` }
      }))
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), 'err')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="content stack">
      <div className="topbar__title">
        <h1><FileCode2 size={20} /> Scripts</h1>
        <div className="topbar__sub">Commandes enregistrées et exécution parallèle sur plusieurs serveurs</div>
      </div>
      <div className="grid grid--2">
        <Card title="Scripts enregistrés" icon={<Save size={14} />}>
          {scripts.length === 0 ? <Empty title="Aucun script" hint="Enregistre une commande pour la réutiliser." icon={<FileCode2 size={18} />} /> : (
            <div className="stack">
              {scripts.map((script) => (
                <button key={script.id} className={`nav-item ${selectedId === script.id ? 'nav-item--active' : ''}`} onClick={() => {
                  setSelectedId(script.id)
                  setName(script.name)
                  setCommand(script.command)
                }}>
                  <FileCode2 size={14} /><span className="nav-item__label">{script.name}</span>
                </button>
              ))}
            </div>
          )}
          {selectedId && <Btn variant="danger" size="sm" icon={<Trash2 size={13} />} onClick={remove}>Supprimer</Btn>}
        </Card>
        <Card title="Éditeur" icon={<FileCode2 size={14} />} actions={<Btn size="sm" icon={<Save size={13} />} onClick={save}>Enregistrer</Btn>}>
          <div className="field">
            <label>Nom</label>
            <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Diagnostic système" />
          </div>
          <div className="field">
            <label>Commande</label>
            <textarea className="input mono" rows={6} value={command} onChange={(event) => setCommand(event.target.value)} spellCheck={false} />
            <span className="hint">Variables : {'{host}'} {'{name}'} {'{user}'} {'{date}'}</span>
          </div>
          <div className="row row--between">
            <strong>Serveurs ciblés ({selected.length})</strong>
            <button className="btn btn--ghost btn--sm" onClick={() => setSelectedHosts(selectedHosts.length === hosts.length ? [] : hosts.map((host) => host.id))}>
              {selectedHosts.length === hosts.length ? 'Aucun' : 'Tous'}
            </button>
          </div>
          <div className="stack" style={{ maxHeight: 180, overflow: 'auto', marginTop: 8 }}>
            {hosts.map((host) => <label key={host.id} className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={selectedHosts.includes(host.id)} onChange={(event) => setSelectedHosts((previous) => event.target.checked ? [...previous, host.id] : previous.filter((id) => id !== host.id))} />
              <span>{host.name}</span><span className="hint">{host.host}</span>
            </label>)}
          </div>
          <Btn variant="primary" icon={<Play size={14} />} onClick={() => void run()} loading={running} disabled={!command.trim() || selected.length === 0}>Exécuter le script</Btn>
        </Card>
      </div>
      {results.length > 0 && <Card title="Résultats" subtitle={`${results.filter((result) => result.ok).length}/${results.length} réussis`}>
        <div className="stack">
          {results.map((result) => <div key={result.host.id}>
            <div className="row" style={{ gap: 8 }}><span>{result.ok ? <CheckCircle size={14} color="var(--ok)" /> : <XCircle size={14} color="var(--err)" />}</span><strong>{result.host.name}</strong><Badge tone={result.ok ? 'ok' : 'err'}>{result.ok ? 'OK' : 'Erreur'}</Badge></div>
            <pre className="console" style={{ maxHeight: 220 }}>{result.output}</pre>
          </div>)}
        </div>
      </Card>}
    </div>
  )
}
