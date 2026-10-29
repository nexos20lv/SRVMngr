import { useEffect, useState, type ReactNode } from 'react'
import { KeyRound, PlugZap, Save, Server, Trash2 } from 'lucide-react'
import type { HostPublic } from '@shared/types'
import { Btn, Modal, useToast } from '@/components/ui'

interface Props {
  open: boolean
  host: HostPublic | null
  onClose: () => void
  onSaved: () => void
}

interface FormState {
  name: string
  host: string
  port: string
  username: string
  password: string
  sudoPassword: string
  group: string
  notes: string
  privateKey: string
  passphrase: string
  hostFingerprint: string
}

const empty: FormState = {
  name: '',
  host: '',
  port: '22',
  username: 'root',
  password: '',
  sudoPassword: '',
  group: '',
  notes: '',
  privateKey: '',
  passphrase: '',
  hostFingerprint: ''
}

export function HostDialog({ open, host, onClose, onSaved }: Props): ReactNode {
  const { notify } = useToast()
  const [form, setForm] = useState<FormState>(empty)
  const [advanced, setAdvanced] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!open) return
    setConfirmDelete(false)
    setAdvanced(!!host && host.hasKey)
    setForm(
      host
        ? {
            name: host.name,
            host: host.host,
            port: String(host.port),
            username: host.username,
            password: '',
            sudoPassword: '',
            group: host.group ?? '',
            notes: host.notes ?? '',
            privateKey: '',
            passphrase: '',
            hostFingerprint: host.hostFingerprint ?? ''
          }
        : empty
    )
  }, [open, host])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void => setForm((prev) => ({ ...prev, [key]: value }))

  const payload = (): Record<string, unknown> => {
    const data: Record<string, unknown> = {
      name: form.name.trim() || form.host.trim(),
      host: form.host.trim(),
      port: Number(form.port) || 22,
      username: form.username.trim(),
      group: form.group.trim() || undefined,
      notes: form.notes.trim() || undefined,
      hostFingerprint: form.hostFingerprint.trim() || undefined
    }
    if (form.password) data.password = form.password
    if (form.sudoPassword) data.sudoPassword = form.sudoPassword
    if (advanced && form.privateKey) data.privateKey = form.privateKey
    if (advanced && form.passphrase) data.passphrase = form.passphrase
    if (host) data.id = host.id
    return data
  }

  const save = async (): Promise<void> => {
    if (!form.host.trim() || !form.username.trim()) {
      notify('Hôte et utilisateur sont obligatoires', 'err')
      return
    }
    setSaving(true)
    try {
      await window.srv.hosts.save(payload() as never)
      notify(host ? 'Serveur mis à jour' : 'Serveur ajouté', 'ok')
      onSaved()
      onClose()
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      setSaving(false)
    }
  }

  const test = async (): Promise<void> => {
    setTesting(true)
    try {
      const res = await window.srv.ssh.test({
        host: form.host.trim(),
        port: Number(form.port) || 22,
        username: form.username.trim(),
        password: form.password || undefined,
        privateKey: advanced ? form.privateKey || undefined : undefined,
        passphrase: advanced ? form.passphrase || undefined : undefined,
        hostFingerprint: form.hostFingerprint.trim() || undefined
      })
      if (res.ok) notify(`Connexion réussie en ${res.latencyMs} ms`, 'ok')
      else if (res.fingerprint) {
        set('hostFingerprint', res.fingerprint)
        notify(`Empreinte détectée : ${res.fingerprint}. Enregistre pour l'approuver.`, 'ok')
      }
      else notify(`Échec : ${res.error}`, 'err')
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      setTesting(false)
    }
  }

  const remove = async (): Promise<void> => {
    if (!host) return
    try {
      await window.srv.hosts.remove(host.id)
      notify('Serveur supprimé', 'ok')
      onSaved()
      onClose()
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err')
    }
  }

  return (
    <Modal
      open={open}
      title={host ? `Modifier ${host.name}` : 'Ajouter un serveur'}
      onClose={onClose}
      footer={
        <>
          {host &&
            (confirmDelete ? (
              <Btn variant="danger" icon={<Trash2 size={14} />} onClick={remove} style={{ marginRight: 'auto' }}>
                Confirmer la suppression
              </Btn>
            ) : (
              <Btn variant="ghost" icon={<Trash2 size={14} />} onClick={() => setConfirmDelete(true)} style={{ marginRight: 'auto' }}>
                Supprimer
              </Btn>
            ))}
          <Btn variant="ghost" onClick={onClose}>
            Annuler
          </Btn>
          <Btn variant="primary" icon={<Save size={14} />} onClick={save} loading={saving}>
            Enregistrer
          </Btn>
        </>
      }
    >
      <div className="field-row">
        <div className="field">
          <label>Nom</label>
          <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="VPS Perso" />
        </div>
        <div className="field">
          <label>Port</label>
          <input className="input" value={form.port} onChange={(e) => set('port', e.target.value)} inputMode="numeric" />
        </div>
      </div>

      <div className="field">
        <label>Hôte / IP</label>
        <input className="input" value={form.host} onChange={(e) => set('host', e.target.value)} placeholder="10.66.0.1" />
      </div>

      <div className="field">
        <label>Utilisateur SSH</label>
        <input className="input" value={form.username} onChange={(e) => set('username', e.target.value)} placeholder="root" />
      </div>

      <div className="field">
        <label>Mot de passe SSH {host?.hasPassword && <span className="dim">(laisser vide pour conserver)</span>}</label>
        <input
          className="input"
          type="password"
          value={form.password}
          onChange={(e) => set('password', e.target.value)}
          placeholder={host?.hasPassword ? '••••••••' : 'mot de passe'}
          autoComplete="off"
        />
      </div>

      <div className="field">
        <label>Mot de passe sudo {host?.hasSudo && <span className="dim">(laisser vide pour conserver)</span>}</label>
        <input
          className="input"
          type="password"
          value={form.sudoPassword}
          onChange={(e) => set('sudoPassword', e.target.value)}
          placeholder="si l'utilisateur n'est pas root"
          autoComplete="off"
        />
        <span className="hint">
          Nécessaire pour Docker, systemctl, nginx et les fichiers système quand l&apos;utilisateur SSH n&apos;est pas root.
        </span>
      </div>

      <label className="switch">
        <input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />
        <KeyRound size={13} /> Authentification par clé privée
      </label>

      {advanced && (
        <>
          <div className="field">
            <label>Clé privée (PEM / OpenSSH)</label>
            <textarea
              className="input"
              rows={5}
              style={{ fontFamily: 'var(--mono)', fontSize: 11 }}
              value={form.privateKey}
              onChange={(e) => set('privateKey', e.target.value)}
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
            />
          </div>
          <div className="field">
            <label>Phrase secrète (optionnel)</label>
            <input className="input" type="password" value={form.passphrase} onChange={(e) => set('passphrase', e.target.value)} />
          </div>
        </>
      )}

      <div className="field">
        <div className="row row--between">
          <label>Empreinte de clé hôte SSH</label>
          <Btn variant="ghost" size="sm" onClick={async () => {
            try {
              const result = await window.srv.hosts.importKnownHosts()
              notify(`${result.imported} empreinte(s) importée(s) depuis known_hosts`, result.imported ? 'ok' : 'info')
            } catch (err) {
              notify(err instanceof Error ? err.message : String(err), 'err')
            }
          }}>
            Importer known_hosts
          </Btn>
        </div>
        <input
          className="input"
          value={form.hostFingerprint}
          onChange={(e) => set('hostFingerprint', e.target.value)}
          placeholder="SHA256:... (Tester puis Enregistrer)"
          autoComplete="off"
        />
        <span className="hint">Si vide, la première connexion approuve l'empreinte reçue (TOFU), puis les changements sont refusés.</span>
      </div>

      <div className="field-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="field">
          <label>Groupe (optionnel)</label>
          <input className="input" value={form.group} onChange={(e) => set('group', e.target.value)} placeholder="Perso, Lycée…" />
        </div>
        <div className="field">
          <label>Note (optionnel)</label>
          <input className="input" value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="rôle du serveur" />
        </div>
      </div>

      <div className="row">
        <Btn icon={<PlugZap size={14} />} onClick={test} loading={testing} disabled={!form.host.trim()}>
          Tester la connexion
        </Btn>
        <span className="hint" style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
          <Server size={12} /> Les identifiants sont chiffrés par le trousseau du système.
        </span>
      </div>
    </Modal>
  )
}
