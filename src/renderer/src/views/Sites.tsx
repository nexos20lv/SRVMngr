import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  FileCode2,
  FolderOpen,
  Globe,
  Lock,
  Pencil,
  Plug,
  Plus,
  Power,
  RefreshCw,
  RotateCw,
  Save,
  ShieldCheck,
  SquareCode,
  Trash2,
  TriangleAlert
} from 'lucide-react'
import type { HostPublic, SiteInfo, SiteType } from '@shared/types'
import { Badge, Btn, Card, Empty, ErrorBox, Loading, Modal, SearchInput, useToast } from '@/components/ui'
import { useAsync } from '@/lib/hooks'

interface Props {
  host: HostPublic
  onOpenFiles: (path: string) => void
}

interface FormState {
  name: string
  domains: string
  type: SiteType
  root: string
  port: string
  proxyTarget: string
  createIndex: boolean
}

const emptyForm: FormState = {
  name: '',
  domains: '',
  type: 'static',
  root: '',
  port: '80',
  proxyTarget: 'http://127.0.0.1:3000',
  createIndex: true
}

const slugify = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)

export function SitesView({ host, onOpenFiles }: Props): ReactNode {
  const { notify } = useToast()
  const sites = useAsync<SiteInfo[]>(() => window.srv.sites.list(host.id), [host.id])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  const [editing, setEditing] = useState<{ site: SiteInfo; content: string; path: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveFeedback, setSaveFeedback] = useState<{ ok: boolean; text: string; backup?: string } | null>(null)

  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [createBusy, setCreateBusy] = useState(false)

  const [certFor, setCertFor] = useState<SiteInfo | null>(null)
  const [email, setEmail] = useState('')
  const [certBusy, setCertBusy] = useState(false)
  const [certOutput, setCertOutput] = useState('')

  const [deleting, setDeleting] = useState<SiteInfo | null>(null)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const list = sites.data ?? []
    if (!needle) return list
    return list.filter((s) => s.name.toLowerCase().includes(needle) || s.domains.some((d) => d.toLowerCase().includes(needle)))
  }, [sites.data, query])

  useEffect(() => {
    if (!creating) return
    setForm((prev) => ({ ...prev, root: prev.root || `/var/www/${prev.name || 'mon-site'}` }))
  }, [creating])

  const run = async (site: SiteInfo, action: 'enable' | 'disable'): Promise<void> => {
    setBusy(`${site.name}:${action}`)
    try {
      const res = await window.srv.sites.toggle(host.id, site.name, action === 'enable')
      if (res.ok) {
        notify(`Site ${action === 'enable' ? 'activé' : 'désactivé'}`, 'ok')
        sites.reload()
      } else {
        notify(res.test || 'Échec de la modification', 'err')
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      setBusy(null)
    }
  }

  const openEditor = async (site: SiteInfo): Promise<void> => {
    setBusy(`${site.name}:edit`)
    try {
      const res = await window.srv.sites.read(host.id, site.name)
      setSaveFeedback(null)
      setEditing({ site, content: res.content, path: res.path })
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      setBusy(null)
    }
  }

  const saveConfig = async (): Promise<void> => {
    if (!editing) return
    setSaving(true)
    try {
      const res = await window.srv.sites.save(host.id, editing.site.name, editing.content)
      setSaveFeedback({ ok: res.ok, text: res.test, backup: res.backup })
      if (res.ok) {
        notify('Configuration enregistrée et nginx rechargé', 'ok')
        sites.reload()
      } else {
        notify('nginx a refusé la configuration', 'err')
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      setSaving(false)
    }
  }

  const restoreBackup = async (): Promise<void> => {
    if (!editing || !saveFeedback?.backup) return
    setSaving(true)
    try {
      const res = await window.srv.sites.restore(host.id, editing.site.name, saveFeedback.backup)
      setSaveFeedback({ ok: res.ok, text: res.test })
      notify(res.ok ? 'Sauvegarde restaurée' : 'Restauration refusée par nginx', res.ok ? 'ok' : 'err')
      if (res.ok) {
        const fresh = await window.srv.sites.read(host.id, editing.site.name)
        setEditing((prev) => (prev ? { ...prev, content: fresh.content } : prev))
        sites.reload()
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      setSaving(false)
    }
  }

  const removeSite = async (): Promise<void> => {
    if (!deleting) return
    setBusy(`${deleting.name}:remove`)
    try {
      const res = await window.srv.sites.remove(host.id, deleting.name)
      if (res.ok) {
        notify(`Site « ${deleting.name} » supprimé`, 'ok')
        setDeleting(null)
        sites.reload()
      } else {
        notify(res.test || 'Suppression incomplète', 'err')
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      setBusy(null)
    }
  }

  const createSite = async (): Promise<void> => {
    const domains = form.domains
      .split(/[\s,;]+/)
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean)
    if (!domains.length) {
      notify('Indique au moins un domaine', 'err')
      return
    }
    const name = slugify(form.name || domains[0])
    setCreateBusy(true)
    try {
      const res = await window.srv.sites.create(host.id, {
        name,
        domains,
        type: form.type,
        root: form.type === 'proxy' ? undefined : form.root || `/var/www/${name}`,
        port: Number(form.port) || 80,
        proxyTarget: form.type === 'proxy' ? form.proxyTarget : undefined,
        createIndex: form.createIndex
      })
      if (res.ok) {
        notify(`Site « ${name} » créé`, 'ok')
        setCreating(false)
        setForm(emptyForm)
        sites.reload()
      } else {
        notify(res.message || res.test || 'Création refusée', 'err')
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      setCreateBusy(false)
    }
  }

  const requestCert = async (): Promise<void> => {
    if (!certFor) return
    setCertBusy(true)
    setCertOutput('')
    try {
      const res = await window.srv.sites.cert(host.id, certFor.domains, email)
      setCertOutput(res.output || (res.ok ? 'Certificat obtenu.' : 'Échec sans message.'))
      if (res.ok) {
        notify('Certificat SSL installé', 'ok')
        sites.reload()
      } else {
        notify('certbot a échoué', 'err')
      }
    } catch (err) {
      setCertOutput(err instanceof Error ? err.message : String(err))
      notify(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      setCertBusy(false)
    }
  }

  const suggestion = slugify(form.name || form.domains.split(/[\s,;]+/)[0] || 'mon-site')

  return (
    <div className="stack">
      <Card
        title="Sites web"
        icon={<Globe size={14} />}
        subtitle={sites.data ? `${sites.data.filter((s) => s.enabled).length} actifs / ${sites.data.length}` : undefined}
        actions={
          <>
            <Btn variant="primary" size="sm" icon={<Plus size={13} />} onClick={() => setCreating(true)}>
              Nouveau site
            </Btn>
            <Btn variant="ghost" size="sm" icon={<ShieldCheck size={13} />} onClick={() => void testConfig()}>
              Tester nginx
            </Btn>
            <Btn variant="ghost" size="sm" icon={<RefreshCw size={13} />} onClick={sites.reload} loading={sites.loading} />
          </>
        }
      >
        <div className="toolbar" style={{ paddingLeft: 0, paddingRight: 0, borderBottom: 'none' }}>
          <SearchInput value={query} onChange={setQuery} placeholder="Filtrer par nom ou domaine…" />
          <span className="hint" style={{ marginLeft: 'auto' }}>
            sites-available + sites-enabled
          </span>
        </div>

        {sites.error ? (
          <ErrorBox message={sites.error} onRetry={sites.reload} />
        ) : sites.loading && !sites.data ? (
          <Loading />
        ) : !filtered.length ? (
          <Empty
            title="Aucun site"
            hint="Crée ton premier site : domaine, racine web, PHP ou proxy — nginx est configuré et rechargé automatiquement."
            icon={<Globe size={18} />}
          />
        ) : (
          <div className="grid grid--2">
            {filtered.map((site) => (
              <div key={site.name} className="card" style={{ background: 'var(--panel-2)' }}>
                <div className="card__head">
                  <div className="card__title" style={{ minWidth: 0 }}>
                    <SquareCode size={14} />
                    <span className="truncate" style={{ maxWidth: 240 }} title={site.name}>
                      {site.name}
                    </span>
                  </div>
                  <div className="card__actions">
                    {site.ssl && (
                      <Badge tone="ok">
                        <Lock size={10} /> SSL
                      </Badge>
                    )}
                    <Badge tone={site.enabled ? 'accent' : 'muted'}>{site.enabled ? 'actif' : 'désactivé'}</Badge>
                  </div>
                </div>

                <div className="card__body stack" style={{ gap: 10 }}>
                  <div className="site-card__domains">
                    {site.domains.length ? (
                      site.domains.map((domain) => (
                        <span key={domain} className="chip">
                          {domain}
                        </span>
                      ))
                    ) : (
                      <span className="hint">Aucun server_name détecté</span>
                    )}
                  </div>

                  <dl className="kv" style={{ gridTemplateColumns: '86px minmax(0, 1fr)' }}>
                    <dt>Écoute</dt>
                    <dd>{site.listens.join(', ') || '—'}</dd>
                    {!!site.roots.length && (
                      <>
                        <dt>Racine</dt>
                        <dd title={site.roots.join(' ')}>{site.roots.join(' ')}</dd>
                      </>
                    )}
                    {!!site.proxies.length && (
                      <>
                        <dt>Proxy</dt>
                        <dd title={site.proxies.join(' ')}>{site.proxies.join(' ')}</dd>
                      </>
                    )}
                    {!!site.php.length && (
                      <>
                        <dt>PHP-FPM</dt>
                        <dd title={site.php.join(' ')}>{site.php.join(' ')}</dd>
                      </>
                    )}
                  </dl>

                  <div className="site-actions">
                    <Btn size="sm" icon={<Pencil size={12} />} onClick={() => void openEditor(site)} loading={busy === `${site.name}:edit`}>
                      Éditer
                    </Btn>
                    <Btn
                      size="sm"
                      icon={<Power size={12} />}
                      onClick={() => void run(site, site.enabled ? 'disable' : 'enable')}
                      loading={busy === `${site.name}:enable` || busy === `${site.name}:disable`}
                    >
                      {site.enabled ? 'Désactiver' : 'Activer'}
                    </Btn>
                    <Btn size="sm" variant="ghost" icon={<Lock size={12} />} onClick={() => setCertFor(site)}>
                      SSL
                    </Btn>
                    {!!site.roots.length && (
                      <Btn size="sm" variant="ghost" icon={<FolderOpen size={12} />} onClick={() => onOpenFiles(site.roots[0])}>
                        Fichiers
                      </Btn>
                    )}
                    <Btn size="sm" variant="ghost" icon={<Trash2 size={12} />} onClick={() => setDeleting(site)}>
                      Supprimer
                    </Btn>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="alert alert--info">
        <Plug size={15} />
        <span>
          Les modifications écrivent dans <span className="mono">/etc/nginx/sites-available</span>, testent la configuration puis rechargent nginx.
          Une sauvegarde horodatée est créée avant chaque édition.
        </span>
      </div>

      {/* ------------------------------------------------------------ éditeur */}
      <Modal
        open={!!editing}
        title={`Configuration · ${editing?.site.name ?? ''}`}
        onClose={() => setEditing(null)}
        wide
        footer={
          <>
            {saveFeedback?.backup && (
              <Btn variant="ghost" icon={<RotateCw size={14} />} onClick={restoreBackup} loading={saving} style={{ marginRight: 'auto' }}>
                Restaurer la sauvegarde
              </Btn>
            )}
            <Btn variant="ghost" onClick={() => setEditing(null)}>
              Fermer
            </Btn>
            <Btn variant="primary" icon={<Save size={14} />} onClick={saveConfig} loading={saving}>
              Enregistrer et recharger
            </Btn>
          </>
        }
      >
        <div className="hint mono">{editing?.path}</div>
        {saveFeedback && (
          <div className={`alert ${saveFeedback.ok ? 'alert--info' : 'alert--err'}`}>
            {saveFeedback.ok ? <ShieldCheck size={15} /> : <TriangleAlert size={15} />}
            <span>{saveFeedback.ok ? 'Configuration valide, nginx rechargé.' : 'nginx a refusé la configuration :'}</span>
          </div>
        )}
        {saveFeedback && !saveFeedback.ok && <pre className="console" style={{ maxHeight: 140 }}>{saveFeedback.text}</pre>}
        <textarea
          className="editor"
          style={{ minHeight: '46vh' }}
          value={editing?.content ?? ''}
          onChange={(e) => setEditing((prev) => (prev ? { ...prev, content: e.target.value } : prev))}
          spellCheck={false}
        />
      </Modal>

      {/* ------------------------------------------------------------ création */}
      <Modal
        open={creating}
        title="Nouveau site"
        onClose={() => setCreating(false)}
        wide
        footer={
          <>
            <Btn variant="ghost" onClick={() => setCreating(false)}>
              Annuler
            </Btn>
            <Btn variant="primary" icon={<Plus size={14} />} onClick={createSite} loading={createBusy}>
              Créer le site
            </Btn>
          </>
        }
      >
        <div className="field-row" style={{ gridTemplateColumns: '1fr 140px' }}>
          <div className="field">
            <label>Domaine(s) — séparés par des virgules</label>
            <input
              className="input"
              value={form.domains}
              onChange={(e) => {
                const value = e.target.value
                setForm((prev) => ({
                  ...prev,
                  domains: value,
                  name: prev.name || slugify(value.split(/[\s,;]+/)[0] ?? ''),
                  root: prev.root && prev.root !== `/var/www/${prev.name}` ? prev.root : `/var/www/${slugify(value.split(/[\s,;]+/)[0] || 'mon-site')}`
                }))
              }}
              placeholder="mon-site.fr, www.mon-site.fr"
            />
          </div>
          <div className="field">
            <label>Port d&apos;écoute</label>
            <input className="input" value={form.port} onChange={(e) => setForm((prev) => ({ ...prev, port: e.target.value }))} />
          </div>
        </div>

        <div className="field">
          <label>Nom du fichier de config</label>
          <input
            className="input mono"
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            placeholder={suggestion}
          />
        </div>

        <div className="field">
          <label>Type de site</label>
          <div className="segmented" style={{ alignSelf: 'flex-start' }}>
            {(
              [
                ['static', 'Statique'],
                ['php', 'PHP'],
                ['proxy', 'Reverse proxy']
              ] as [SiteType, string][]
            ).map(([value, label]) => (
              <button key={value} className={form.type === value ? 'active' : ''} onClick={() => setForm((prev) => ({ ...prev, type: value }))}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {form.type === 'proxy' ? (
          <div className="field">
            <label>Destination du proxy</label>
            <input
              className="input mono"
              value={form.proxyTarget}
              onChange={(e) => setForm((prev) => ({ ...prev, proxyTarget: e.target.value }))}
              placeholder="http://127.0.0.1:3000"
            />
            <span className="hint">WebSocket, X-Forwarded-* et client_max_body_size 64M sont déjà configurés.</span>
          </div>
        ) : (
          <>
            <div className="field">
              <label>Racine web</label>
              <input
                className="input mono"
                value={form.root}
                onChange={(e) => setForm((prev) => ({ ...prev, root: e.target.value }))}
                placeholder={`/var/www/${suggestion}`}
              />
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={form.createIndex}
                onChange={(e) => setForm((prev) => ({ ...prev, createIndex: e.target.checked }))}
              />
              Créer le dossier et une page d&apos;accueil
            </label>
          </>
        )}

        <div className="alert alert--info">
          <FileCode2 size={15} />
          <span>
            Va créer <span className="mono">/etc/nginx/sites-available/{suggestion}</span>, l&apos;activer, vérifier la configuration et recharger
            nginx. En cas d&apos;erreur, tout est annulé.
          </span>
        </div>
      </Modal>

      {/* ---------------------------------------------------------- certificat */}
      <Modal
        open={!!certFor}
        title={`Certificat SSL · ${certFor?.name ?? ''}`}
        onClose={() => {
          setCertFor(null)
          setCertOutput('')
        }}
        wide
        footer={
          <>
            <Btn variant="ghost" onClick={() => setCertFor(null)}>
              Fermer
            </Btn>
            <Btn variant="primary" icon={<Lock size={14} />} onClick={requestCert} loading={certBusy} disabled={!email.trim()}>
              Obtenir le certificat
            </Btn>
          </>
        }
      >
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {(certFor?.domains ?? []).map((domain) => (
            <span key={domain} className="chip">
              {domain}
            </span>
          ))}
        </div>
        <div className="field">
          <label>E-mail Let&apos;s Encrypt (renouvellement / notifications)</label>
          <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@mon-site.fr" />
        </div>
        <div className="alert">
          <TriangleAlert size={15} />
          <span>
            Le domaine doit pointer vers ce serveur et le port 80 être joignable. Derrière Cloudflare, désactive le proxy (nuage gris) le temps de la
            validation.
          </span>
        </div>
        {!!certOutput && <pre className="console" style={{ maxHeight: 220 }}>{certOutput}</pre>}
      </Modal>

      {/* --------------------------------------------------------- suppression */}
      <Modal
        open={!!deleting}
        title={`Supprimer ${deleting?.name ?? ''} ?`}
        onClose={() => setDeleting(null)}
        footer={
          <>
            <Btn variant="ghost" onClick={() => setDeleting(null)}>
              Annuler
            </Btn>
            <Btn variant="danger" icon={<Trash2 size={14} />} onClick={removeSite} loading={busy === `${deleting?.name}:remove`}>
              Supprimer
            </Btn>
          </>
        }
      >
        <div className="alert alert--err">
          <TriangleAlert size={15} />
          <span>
            Le fichier de configuration et le lien dans <span className="mono">sites-enabled</span> seront supprimés. Une copie est conservée dans{' '}
            <span className="mono">/root/srvmngr-backups</span>. Les fichiers du site ne sont pas touchés.
          </span>
        </div>
      </Modal>
    </div>
  )

  async function testConfig(): Promise<void> {
    setBusy('test')
    try {
      const res = await window.srv.sites.test(host.id)
      const text = `${res.stdout}${res.stderr}`.trim()
      if (res.code === 0) notify('Configuration nginx valide', 'ok')
      else notify(text.split('\n').slice(0, 3).join(' ') || 'Configuration invalide', 'err')
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      setBusy(null)
    }
  }
}
