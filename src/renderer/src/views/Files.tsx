import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  Download,
  File as FileIcon,
  FileText,
  Folder,
  FolderPlus,
  HardDriveDownload,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
  Upload
} from 'lucide-react'
import type { FileEntry, HostPublic } from '@shared/types'
import { Badge, Btn, Card, Empty, ErrorBox, Loading, Modal, useToast } from '@/components/ui'
import { fmtBytes, fmtDate } from '@/lib/format'

type DiffLine = { kind: 'same' | 'add' | 'remove'; text: string; number: number }

function lineDiff(before: string, after: string): DiffLine[] {
  const left = before.split(/\r?\n/)
  const right = after.split(/\r?\n/)
  const table = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0))
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) table[i][j] = left[i] === right[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
  }
  const result: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) result.push({ kind: 'same', text: left[i], number: j + 1 }), i++, j++
    else if (j < right.length && (i === left.length || table[i][j + 1] >= table[i + 1][j])) result.push({ kind: 'add', text: right[j], number: j + 1 }), j++
    else result.push({ kind: 'remove', text: left[i], number: i + 1 }), i++
  }
  return result
}

function joinPath(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, '')}/${name}`
}

function parentOf(path: string): string {
  if (path === '/' || !path.includes('/')) return '/'
  const trimmed = path.replace(/\/+$/, '')
  const idx = trimmed.lastIndexOf('/')
  return idx <= 0 ? '/' : trimmed.slice(0, idx)
}

export function FilesView({ host, initialPath }: { host: HostPublic; initialPath?: string }): ReactNode {
  const { notify } = useToast()
  const [path, setPath] = useState(initialPath ?? '')
  const [root, setRoot] = useState(host.hasSudo)
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [editing, setEditing] = useState<{ path: string; content: string; original: string; truncated: boolean; binary: boolean } | null>(null)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [showDiff, setShowDiff] = useState(false)

  useEffect(() => {
    if (initialPath) {
      setPath(initialPath)
      return
    }
    let alive = true
    void window.srv.files.home(host.id).then((home) => {
      if (alive) setPath(home)
    })
    return () => {
      alive = false
    }
  }, [host.id, initialPath])

  const load = useCallback(
    async (target: string) => {
      if (!target) return
      setLoading(true)
      setError(undefined)
      try {
        setEntries(await window.srv.files.list(host.id, target, root))
      } catch (err) {
        setEntries([])
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    },
    [host.id, root]
  )

  useEffect(() => {
    void load(path)
  }, [path, root, load])

  const openFile = async (entry: FileEntry): Promise<void> => {
    if (entry.size > 2 * 1024 * 1024) {
      notify('Fichier trop gros pour l’éditeur (max 2 Mo) — utilise Télécharger', 'err')
      return
    }
    setBusy(entry.path)
    try {
      const res = await window.srv.files.read(host.id, entry.path, root)
      setEditing({ path: entry.path, content: res.content, original: res.content, truncated: res.truncated, binary: res.binary })
      setShowDiff(false)
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      setBusy(null)
    }
  }

  const save = async (): Promise<void> => {
    if (!editing) return
    setSaving(true)
    try {
      await window.srv.files.write(host.id, editing.path, editing.content, root)
      notify('Fichier enregistré', 'ok')
      setEditing(null)
      void load(path)
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      setSaving(false)
    }
  }

  const mkdir = async (): Promise<void> => {
    const name = window.prompt('Nom du nouveau dossier')
    if (!name) return
    try {
      await window.srv.files.mkdir(host.id, joinPath(path, name), root)
      notify('Dossier créé', 'ok')
      void load(path)
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err')
    }
  }

  const rename = async (entry: FileEntry): Promise<void> => {
    const name = window.prompt('Nouveau nom', entry.name)
    if (!name || name === entry.name) return
    try {
      await window.srv.files.rename(host.id, entry.path, joinPath(path, name), root)
      notify('Renommé', 'ok')
      void load(path)
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err')
    }
  }

  const remove = async (entry: FileEntry): Promise<void> => {
    if (!window.confirm(`Supprimer ${entry.path} ?${entry.type === 'dir' ? ' (récursif)' : ''}`)) return
    if (root || entry.type === 'dir') {
      const typed = window.prompt(`Pour confirmer, saisis exactement le chemin : ${entry.path}`)
      if (typed !== entry.path) {
        if (typed !== null) notify('Suppression annulée : le chemin ne correspond pas.', 'err')
        return
      }
    }
    try {
      await window.srv.files.remove(host.id, entry.path, root)
      notify('Supprimé', 'ok')
      void load(path)
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err')
    }
  }

  const upload = async (): Promise<void> => {
    setBusy('upload')
    try {
      const res = await window.srv.files.upload(host.id, path, root)
      if (res) {
        notify(`Envoyé : ${res.path} (${fmtBytes(res.size)})`, 'ok')
        void load(path)
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      setBusy(null)
    }
  }

  const download = async (entry: FileEntry): Promise<void> => {
    setBusy(entry.path)
    try {
      const res = await window.srv.files.download(host.id, entry.path, root)
      if (res) notify(`Téléchargé : ${res.path}`, 'ok')
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      setBusy(null)
    }
  }

  const segments = path.split('/').filter(Boolean)

  return (
    <div className="stack" style={{ height: '100%' }}>
      <Card
        title="Explorateur de fichiers"
        icon={<Folder size={14} />}
        subtitle={root ? 'mode root (sudo)' : 'utilisateur SSH'}
        bodyClassName="card__body--flush"
        style={{ minHeight: 0 }}
        actions={
          <>
            <label className="switch" title="Utiliser sudo pour les opérations">
              <input type="checkbox" checked={root} onChange={(e) => setRoot(e.target.checked)} disabled={!host.hasSudo} />
              root
            </label>
            <Btn variant="ghost" size="sm" icon={<FolderPlus size={13} />} onClick={mkdir}>
              Dossier
            </Btn>
            <Btn variant="ghost" size="sm" icon={<Upload size={13} />} onClick={upload} loading={busy === 'upload'}>
              Envoyer
            </Btn>
            <Btn variant="ghost" size="sm" icon={<RefreshCw size={13} />} onClick={() => void load(path)} loading={loading} />
          </>
        }
      >
        <div className="toolbar">
          <Btn variant="ghost" size="sm" icon={<ArrowLeft size={13} />} onClick={() => setPath(parentOf(path))} disabled={path === '/'}>
            Parent
          </Btn>
          <div className="crumbs">
            <button className="crumb" onClick={() => setPath('/')}>
              /
            </button>
            {segments.map((segment, index) => {
              const target = '/' + segments.slice(0, index + 1).join('/')
              const last = index === segments.length - 1
              return (
                <span key={target} className="row" style={{ gap: 2 }}>
                  <button className={`crumb ${last ? 'crumb--last' : ''}`} onClick={() => setPath(target)}>
                    {segment}
                  </button>
                  {!last && <span className="dim">/</span>}
                </span>
              )
            })}
          </div>
          <input
            className="input mono"
            style={{ width: 320 }}
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void load(path)}
            spellCheck={false}
          />
        </div>

        {error ? (
          <div style={{ padding: 16 }}>
            <ErrorBox message={error} onRetry={() => void load(path)} />
          </div>
        ) : loading && entries.length === 0 ? (
          <Loading />
        ) : entries.length === 0 ? (
          <Empty title="Dossier vide" hint={path} icon={<Folder size={18} />} />
        ) : (
          <div style={{ overflowY: 'auto', maxHeight: 'calc(100vh - 330px)' }}>
            {entries.map((entry) => (
              <div
                key={entry.path}
                className={`file-row ${entry.type === 'dir' ? 'file-row--dir' : ''}`}
                onClick={() => (entry.type === 'dir' ? setPath(entry.path) : void openFile(entry))}
                title={entry.path}
              >
                <span style={{ color: entry.type === 'dir' ? 'var(--accent)' : 'var(--dim)' }}>
                  {entry.type === 'dir' ? <Folder size={15} /> : entry.type === 'link' ? <FileText size={15} /> : <FileIcon size={15} />}
                </span>
                <span className="file-row__name">
                  <span>{entry.name}</span>
                  {entry.type === 'link' && <Badge tone="muted">lien</Badge>}
                </span>
                <span className="file-row__meta">{entry.type === 'dir' ? '—' : fmtBytes(entry.size)}</span>
                <span className="file-row__meta">{fmtDate(entry.mtime)}</span>
                <span className="file-row__meta">{entry.mode}</span>
                <span className="row" style={{ gap: 2, justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
                  {entry.type !== 'dir' && (
                    <button className="btn btn--icon" title="Télécharger" onClick={() => void download(entry)}>
                      <Download size={13} />
                    </button>
                  )}
                  <button className="btn btn--icon" title="Renommer" onClick={() => void rename(entry)}>
                    <Pencil size={13} />
                  </button>
                  <button className="btn btn--icon" title="Supprimer" onClick={() => void remove(entry)}>
                    <Trash2 size={13} />
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal
        open={!!editing}
        title={editing?.path ?? ''}
        onClose={() => setEditing(null)}
        wide
        footer={
          <>
            <Btn variant="ghost" onClick={() => setEditing(null)}>
              Fermer
            </Btn>
            <Btn variant="primary" icon={<Save size={14} />} onClick={save} loading={saving} disabled={editing?.binary}>
              Enregistrer
            </Btn>
            <Btn variant="ghost" onClick={() => setShowDiff((value) => !value)} disabled={!editing || editing.binary || editing.content === editing.original}>
              {showDiff ? 'Éditeur' : 'Diff'}
            </Btn>
          </>
        }
      >
        {editing?.binary ? (
          <Empty
            title="Fichier binaire"
            hint="L'éditeur ne gère que le texte. Utilise Télécharger pour récupérer le fichier."
            icon={<HardDriveDownload size={18} />}
          />
        ) : (
          <>
            {editing?.truncated && (
              <div className="alert">
                <Badge tone="warn">Tronqué</Badge>
                <span>Le fichier dépasse 2 Mo : seule la première partie est éditable.</span>
              </div>
            )}
            {showDiff ? (
              <pre className="console" style={{ maxHeight: '60vh', overflow: 'auto' }}>
                {lineDiff(editing?.original ?? '', editing?.content ?? '').map((line, index) => (
                  <div key={`${index}-${line.kind}`} style={{ color: line.kind === 'add' ? 'var(--ok)' : line.kind === 'remove' ? 'var(--err)' : 'var(--muted)', background: line.kind === 'add' ? 'rgba(80,200,120,.08)' : line.kind === 'remove' ? 'rgba(240,80,80,.08)' : undefined }}>
                    {line.kind === 'add' ? '+' : line.kind === 'remove' ? '-' : ' '} {String(line.number).padStart(4, ' ')} {line.text}
                  </div>
                ))}
              </pre>
            ) : (
              <textarea
                className="editor"
                value={editing?.content ?? ''}
                onChange={(e) => setEditing((prev) => (prev ? { ...prev, content: e.target.value } : prev))}
                spellCheck={false}
              />
            )}
            {editing && editing.content !== editing.original && (
              <div className="hint" style={{ marginTop: 8 }}>
                Modifications non enregistrées · {editing.content.length - editing.original.length >= 0 ? '+' : ''}
                {editing.content.length - editing.original.length} caractères
              </div>
            )}
          </>
        )}
      </Modal>
    </div>
  )
}
