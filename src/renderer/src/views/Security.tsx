import { useState, type ReactNode } from 'react'
import {
  Activity,
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronRight,
  Download,
  Flame,
  KeyRound,
  Lock,
  Network,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  ShieldOff,
  ShieldQuestion,
  UserCog,
  XCircle
} from 'lucide-react'
import type { HostPublic } from '@shared/types'
import type {
  AccessInfo,
  AccountInfo,
  CheckStatus,
  FirewallInfo,
  SecurityAudit,
  SecurityCheck,
  SecurityUpdatesInfo,
  SshConfigInfo
} from '@shared/security-types'
import { Badge, Btn, Card, Empty, ErrorBox, KpiCard, Loading, Modal, useToast } from '@/components/ui'
import { useAsync } from '@/lib/hooks'

type Section = 'audit' | 'ssh' | 'firewall' | 'accounts' | 'access' | 'updates'

const SECTIONS: { key: Section; label: string; icon: ReactNode }[] = [
  { key: 'audit', label: 'Audit', icon: <ShieldQuestion size={13} /> },
  { key: 'ssh', label: 'SSH', icon: <KeyRound size={13} /> },
  { key: 'firewall', label: 'Pare-feu', icon: <Flame size={13} /> },
  { key: 'accounts', label: 'Comptes', icon: <UserCog size={13} /> },
  { key: 'access', label: 'Accès', icon: <Activity size={13} /> },
  { key: 'updates', label: 'Mises à jour', icon: <Download size={13} /> }
]

const statusTone: Record<CheckStatus, 'ok' | 'warn' | 'err' | 'muted'> = {
  ok: 'ok',
  warn: 'warn',
  fail: 'err',
  info: 'muted'
}

const statusIcon: Record<CheckStatus, ReactNode> = {
  ok: <CheckCircle2 size={13} />,
  warn: <AlertTriangle size={13} />,
  fail: <XCircle size={13} />,
  info: <ShieldQuestion size={13} />
}

const scoreColor = (score: number): string => (score >= 85 ? 'var(--ok)' : score >= 60 ? 'var(--warn)' : 'var(--err)')

export function SecurityView({ host }: { host: HostPublic }): ReactNode {
  const [section, setSection] = useState<Section>('audit')

  return (
    <div className="stack">
      <div className="segmented">
        {SECTIONS.map((item) => (
          <button
            key={item.key}
            className={section === item.key ? 'active' : ''}
            onClick={() => setSection(item.key)}
            type="button"
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>

      {section === 'audit' && <AuditPanel host={host} onJump={setSection} />}
      {section === 'ssh' && <SshPanel host={host} />}
      {section === 'firewall' && <FirewallPanel host={host} />}
      {section === 'accounts' && <AccountsPanel host={host} />}
      {section === 'access' && <AccessPanel host={host} />}
      {section === 'updates' && <UpdatesPanel host={host} />}
    </div>
  )
}

/* ------------------------------------------------------------------- audit */

function AuditPanel({ host, onJump }: { host: HostPublic; onJump: (section: Section) => void }): ReactNode {
  const audit = useAsync<SecurityAudit>(() => window.srv.security.audit(host.id), [host.id])

  if (audit.error) return <ErrorBox message={audit.error} onRetry={audit.reload} />
  if (!audit.data) return <Loading label="Audit de sécurité en cours…" />

  const issues = audit.data.checks.filter((check) => check.status === 'fail')
  const warns = audit.data.checks.filter((check) => check.status === 'warn')
  const okCount = audit.data.checks.filter((check) => check.status === 'ok').length

  return (
    <div className="stack">
      <div className="grid grid--kpi">
        <KpiCard
          label="Score de sécurité"
          value={`${audit.data.score}/100`}
          hint={`${audit.data.checks.length} contrôles · ${new Date(audit.data.generatedAt).toLocaleTimeString('fr-FR')}`}
          ringValue={audit.data.score}
          color={scoreColor(audit.data.score)}
        />
        <KpiCard label="Contrôles réussis" value={okCount} hint={`sur ${audit.data.checks.length}`} icon={<ShieldCheck size={18} />} />
        <KpiCard label="Points critiques" value={issues.length} hint={issues.length ? 'à corriger en priorité' : 'aucun'} icon={<XCircle size={18} />} />
        <KpiCard label="Avertissements" value={warns.length} hint="durcissement recommandé" icon={<AlertTriangle size={18} />} />
      </div>

      <Card
        title="Contrôles"
        icon={<ShieldCheck size={14} />}
        subtitle="clique sur une ligne pour ouvrir l’outil correspondant"
        actions={<Btn variant="ghost" size="sm" icon={<RefreshCw size={13} />} onClick={audit.reload} loading={audit.loading} />}
      >
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>État</th>
                <th>Contrôle</th>
                <th>Détail</th>
                <th className="num">Pénalité</th>
                <th style={{ width: 28 }} />
              </tr>
            </thead>
            <tbody>
              {audit.data.checks.map((check: SecurityCheck) => (
                <tr
                  key={check.id}
                  style={{ cursor: check.target ? 'pointer' : 'default' }}
                  onClick={() => check.target && onJump(check.target)}
                  title={check.target ? 'Ouvrir l’outil correspondant' : undefined}
                >
                  <td>
                    <Badge tone={statusTone[check.status]}>
                      <span style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>
                        {statusIcon[check.status]}
                        {check.status === 'ok' ? 'OK' : check.status === 'warn' ? 'Vigilance' : 'À corriger'}
                      </span>
                    </Badge>
                  </td>
                  <td>{check.label}</td>
                  <td className="muted">{check.detail}</td>
                  <td className="num mono" style={{ color: check.status === 'ok' ? 'var(--dim)' : undefined }}>
                    {check.status === 'ok'
                      ? '—'
                      : `−${check.status === 'warn' ? Math.round(check.weight / 2) : check.weight}`}
                  </td>
                  <td style={{ color: 'var(--dim)' }}>{check.target ? <ChevronRight size={14} /> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

/* --------------------------------------------------------------------- ssh */

function SshPanel({ host }: { host: HostPublic }): ReactNode {
  const { notify } = useToast()
  const config = useAsync<SshConfigInfo>(() => window.srv.security.ssh(host.id), [host.id])
  const [disablePassword, setDisablePassword] = useState(false)
  const [disableRoot, setDisableRoot] = useState(false)
  const [maxTries, setMaxTries] = useState(4)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [keyUser, setKeyUser] = useState('root')
  const [keyValue, setKeyValue] = useState('')
  const [keyBusy, setKeyBusy] = useState(false)

  const apply = async (): Promise<void> => {
    setBusy(true)
    try {
      const res = await window.srv.security.sshApply(host.id, {
        disablePasswordAuth: disablePassword,
        disableRootLogin: disableRoot,
        maxAuthTries: maxTries
      })
      if (res.ok) {
        notify('Configuration SSH appliquée et testée (sshd -t) — service rechargé', 'ok')
        setConfirm(false)
        config.reload()
      } else {
        notify(`Refusé par sshd, configuration annulée : ${res.output}`, 'err')
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      setBusy(false)
    }
  }

  const revert = async (): Promise<void> => {
    setBusy(true)
    try {
      const res = await window.srv.security.sshRevert(host.id)
      notify(res.ok ? 'Durcissement retiré : configuration d’origine restaurée' : `Échec : ${res.output}`, res.ok ? 'ok' : 'err')
      config.reload()
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      setBusy(false)
    }
  }

  const addKey = async (): Promise<void> => {
    setKeyBusy(true)
    try {
      const res = await window.srv.security.sshAddKey(host.id, keyUser, keyValue)
      notify(res.output, 'ok')
      setKeyValue('')
      config.reload()
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      setKeyBusy(false)
    }
  }

  if (config.error) return <ErrorBox message={config.error} onRetry={config.reload} />
  if (!config.data) return <Loading label="Lecture de sshd_config…" />
  const data = config.data
  const totalKeys = data.keys.reduce((sum, key) => sum + key.count, 0)

  return (
    <div className="stack">
      <div className="grid grid--2">
        <Card
          title="Configuration active"
          icon={<KeyRound size={14} />}
          subtitle={`sshd -T · port ${data.port}`}
          actions={
            <Badge tone={data.serviceActive ? 'ok' : 'err'}>{data.serviceActive ? 'service actif' : 'service inactif'}</Badge>
          }
        >
          <div className="stack" style={{ gap: 8 }}>
            <Row label="Port" value={data.port} />
            <Row label="Mot de passe" value={data.passwordAuthentication === 'no' ? 'refusé' : 'accepté'} ok={data.passwordAuthentication === 'no'} />
            <Row
              label="Connexion root"
              value={data.permitRootLogin === 'no' ? 'interdite' : data.permitRootLogin === 'prohibit-password' ? 'clé uniquement' : 'autorisée'}
              ok={data.permitRootLogin !== 'yes'}
            />
            <Row label="Clés publiques" value={`${totalKeys} clé(s)`} ok={totalKeys > 0} />
            <Row label="MaxAuthTries" value={data.maxAuthTries} ok={Number(data.maxAuthTries) <= 4} />
            <div className="row row--between" style={{ marginTop: 6 }}>
              <Btn size="sm" variant="ghost" icon={<RefreshCw size={13} />} onClick={config.reload} loading={config.loading}>
                Relire
              </Btn>
              {data.dropInActive && (
                <Btn size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={revert} loading={busy}>
                  Retirer le durcissement
                </Btn>
              )}
            </div>
          </div>
        </Card>

        <Card title="Durcissement" icon={<Lock size={14} />} subtitle="écrit un fichier dédié + sshd -t avant reload">
          <div className="stack" style={{ gap: 12 }}>
            <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={disablePassword} onChange={(e) => setDisablePassword(e.target.checked)} />
              <span>Refuser l’authentification par mot de passe (clés uniquement)</span>
            </label>
            <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={disableRoot} onChange={(e) => setDisableRoot(e.target.checked)} />
              <span>Interdire la connexion directe de root</span>
            </label>
            <div className="row" style={{ gap: 8 }}>
              <span className="muted">Tentatives max</span>
              <input
                className="input"
                style={{ width: 80 }}
                type="number"
                min={3}
                max={10}
                value={maxTries}
                onChange={(e) => setMaxTries(Number(e.target.value) || 4)}
              />
            </div>
            {data.includeDropIn ? (
              <div className="hint">
                Fichier utilisé : /etc/ssh/sshd_config.d/00-srvmngr.conf (sauvegarde dans /root/srvmngr-backups). Le préfixe 00 garantit qu’il
                l’emporte sur les autres fichiers .conf.
              </div>
            ) : (
              <div className="hint" style={{ color: 'var(--warn)' }}>
                sshd_config n’inclut pas sshd_config.d : le durcissement automatique est désactivé pour ne pas toucher au fichier principal.
              </div>
            )}
            <div className="row" style={{ gap: 8 }}>
              <Btn variant="primary" icon={<ShieldCheck size={14} />} onClick={() => setConfirm(true)} disabled={!data.includeDropIn}>
                Appliquer
              </Btn>
              {!disablePassword && !disableRoot && <span className="hint">Aucune option sélectionnée : seule la limite de tentatives changera.</span>}
            </div>
          </div>
        </Card>
      </div>

      <Card
        title="Clés autorisées"
        icon={<KeyRound size={14} />}
        subtitle={`${totalKeys} clé(s) sur ${data.keys.length} compte(s)`}
        actions={<Btn variant="ghost" size="sm" icon={<RefreshCw size={13} />} onClick={config.reload} loading={config.loading} />}
      >
        <div className="stack">
          {data.keys.length === 0 ? (
            <Empty title="Aucune clé publique" hint="Ajoute une clé avant de désactiver les mots de passe." icon={<KeyRound size={18} />} />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Compte</th>
                    <th>Clés</th>
                    <th>Empreintes</th>
                  </tr>
                </thead>
                <tbody>
                  {data.keys.map((entry) => (
                    <tr key={entry.path}>
                      <td className="mono">{entry.user}</td>
                      <td>{entry.count}</td>
                      <td className="mono muted" style={{ fontSize: 11 }}>
                        {entry.fingerprints.length ? entry.fingerprints.slice(0, 3).join(' · ') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
            <input
              className="input"
              style={{ width: 150 }}
              value={keyUser}
              onChange={(e) => setKeyUser(e.target.value)}
              placeholder="utilisateur"
            />
            <textarea
              className="textarea mono"
              style={{ minHeight: 62 }}
              placeholder="ssh-ed25519 AAAAC3… user@machine"
              value={keyValue}
              onChange={(e) => setKeyValue(e.target.value)}
            />
            <Btn variant="primary" onClick={addKey} loading={keyBusy} disabled={!keyValue.trim()}>
              Ajouter
            </Btn>
          </div>
        </div>
      </Card>

      <Modal
        open={confirm}
        title="Appliquer le durcissement SSH ?"
        onClose={() => setConfirm(false)}
        footer={
          <>
            <Btn variant="ghost" onClick={() => setConfirm(false)}>
              Annuler
            </Btn>
            <Btn variant="primary" onClick={apply} loading={busy}>
              Appliquer et recharger
            </Btn>
          </>
        }
      >
        <div className="stack">
          <p>Les changements sont écrits dans un fichier dédié, testés avec <code className="mono">sshd -t</code> puis rechargés. Si le test échoue, tout est annulé automatiquement.</p>
          {disablePassword && (
            <div className="hint" style={{ color: 'var(--warn)' }}>
              Mot de passe refusé : garde une session terminal ouverte pendant le test, et vérifie qu’une clé fonctionne avant de fermer.
            </div>
          )}
          {disableRoot && (
            <div className="hint" style={{ color: 'var(--warn)' }}>
              Root bloqué : le panel ne pourra plus se connecter en root (la connexion en cours reste active jusqu’à la déconnexion).
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }): ReactNode {
  return (
    <div className="row row--between">
      <span className="muted">{label}</span>
      <span className="row" style={{ gap: 6 }}>
        <span className="mono">{value}</span>
        {ok !== undefined && <Badge tone={ok ? 'ok' : 'warn'}>{ok ? 'OK' : 'à revoir'}</Badge>}
      </span>
    </div>
  )
}

/* ---------------------------------------------------------------- firewall */

function FirewallPanel({ host }: { host: HostPublic }): ReactNode {
  const { notify } = useToast()
  const info = useAsync<FirewallInfo>(() => window.srv.security.firewall(host.id), [host.id])
  const [busy, setBusy] = useState<string | null>(null)
  const [port, setPort] = useState('')
  const [proto, setProto] = useState('tcp')

  const act = async (
    action: 'install' | 'enable' | 'disable' | 'allow' | 'delete' | 'default-deny',
    options?: { port?: number; proto?: string; rule?: string }
  ): Promise<void> => {
    setBusy(action)
    try {
      const res = await window.srv.security.firewallAction(host.id, action, options)
      notify(res.ok ? res.output || 'Fait' : `Échec : ${res.output}`, res.ok ? 'ok' : 'err')
      info.reload()
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      setBusy(null)
    }
  }

  if (info.error) return <ErrorBox message={info.error} onRetry={info.reload} />
  if (!info.data) return <Loading label="Lecture du pare-feu…" />
  const data = info.data

  return (
    <div className="stack">
      <div className="grid grid--kpi">
        <KpiCard
          label="Pare-feu"
          value={data.backend === 'none' ? 'aucun' : data.backend}
          hint={data.active ? 'actif' : 'inactif'}
          icon={data.active ? <ShieldCheck size={18} /> : <ShieldOff size={18} />}
        />
        <KpiCard label="Règles" value={data.rules.length} hint="règles ufw visibles" icon={<Network size={18} />} />
        <KpiCard label="Entrant par défaut" value={data.defaultIncoming ?? '—'} hint="politique par défaut" icon={<Flame size={18} />} />
        <KpiCard label="Sortant par défaut" value={data.defaultOutgoing ?? '—'} hint="politique par défaut" icon={<Flame size={18} />} />
      </div>

      <Card
        title="Pare-feu"
        icon={<Flame size={14} />}
        subtitle={data.hint ?? 'ufw'}
        actions={
          <div className="row" style={{ gap: 6 }}>
            <Btn variant="ghost" size="sm" icon={<RefreshCw size={13} />} onClick={info.reload} loading={info.loading} />
            {data.backend !== 'ufw' && (
              <Btn size="sm" variant="primary" onClick={() => act('install')} loading={busy === 'install'}>
                Installer ufw
              </Btn>
            )}
            {data.backend === 'ufw' &&
              (data.active ? (
                <Btn size="sm" onClick={() => act('disable')} loading={busy === 'disable'}>
                  Désactiver
                </Btn>
              ) : (
                <Btn size="sm" variant="primary" onClick={() => act('enable')} loading={busy === 'enable'}>
                  Activer (en gardant SSH ouvert)
                </Btn>
              ))}
          </div>
        }
      >
        {data.backend === 'ufw' && data.active && (
          <div className="row" style={{ gap: 8, marginBottom: 12 }}>
            <input
              className="input"
              style={{ width: 120 }}
              placeholder="port"
              value={port}
              onChange={(e) => setPort(e.target.value.replace(/\D/g, '').slice(0, 5))}
            />
            <select className="select" style={{ width: 100 }} value={proto} onChange={(e) => setProto(e.target.value)}>
              <option value="tcp">tcp</option>
              <option value="udp">udp</option>
            </select>
            <Btn
              variant="primary"
              size="sm"
              onClick={() => act('allow', { port: Number(port), proto })}
              loading={busy === 'allow'}
              disabled={!port}
            >
              Autoriser
            </Btn>
            <Btn size="sm" variant="ghost" onClick={() => act('default-deny')} loading={busy === 'default-deny'}>
              Refuser tout en entrant par défaut
            </Btn>
          </div>
        )}

        {data.rules.length === 0 ? (
          <Empty
            title={data.backend === 'ufw' ? 'Aucune règle' : 'Gestion en lecture seule'}
            hint={data.hint ?? 'Ajoute une règle pour ouvrir un port.'}
            icon={<Flame size={18} />}
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Vers</th>
                  <th>Action</th>
                  <th>Depuis</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.rules.map((rule, index) => (
                  <tr key={`${rule.to}-${rule.action}-${index}`}>
                    <td className="mono">{rule.to}</td>
                    <td>
                      <Badge tone={/allow/i.test(rule.action) ? 'ok' : 'warn'}>{rule.action}</Badge>
                    </td>
                    <td className="mono muted">{rule.from}</td>
                    <td className="actions">
                      <Btn
                        size="sm"
                        variant="ghost"
                        icon={<Ban size={13} />}
                        onClick={() => act('delete', { rule: rule.to })}
                        loading={busy === 'delete'}
                      >
                        Retirer
                      </Btn>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data.backend !== 'ufw' && data.raw && (
          <pre className="mono" style={{ marginTop: 12, fontSize: 11, maxHeight: 220, overflow: 'auto' }}>
            {data.raw}
          </pre>
        )}
      </Card>
    </div>
  )
}

/* ---------------------------------------------------------------- comptes */

function AccountsPanel({ host }: { host: HostPublic }): ReactNode {
  const accounts = useAsync<AccountInfo[]>(() => window.srv.security.accounts(host.id), [host.id])

  if (accounts.error) return <ErrorBox message={accounts.error} onRetry={accounts.reload} />
  if (!accounts.data) return <Loading label="Lecture des comptes…" />

  return (
    <Card
      title="Comptes du système"
      icon={<UserCog size={14} />}
      subtitle={`${accounts.data.length} compte(s) privilégié(s) ou humain(s)`}
      actions={<Btn variant="ghost" size="sm" icon={<RefreshCw size={13} />} onClick={accounts.reload} loading={accounts.loading} />}
    >
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Utilisateur</th>
              <th>UID</th>
              <th>Shell</th>
              <th>Sudo</th>
              <th>Mot de passe</th>
              <th>Clés</th>
            </tr>
          </thead>
          <tbody>
            {accounts.data.map((account) => (
              <tr key={account.user}>
                <td className="mono">{account.user}</td>
                <td className="num">{account.uid}</td>
                <td className="mono muted">{account.shell}</td>
                <td>{account.sudo ? <Badge tone="accent">sudo</Badge> : <span className="dim">—</span>}</td>
                <td>
                  <Badge tone={account.passwordState === 'P' ? 'warn' : 'ok'}>
                    {account.passwordState === 'P' ? 'défini' : account.passwordState === 'L' ? 'verrouillé' : account.passwordState === 'NP' ? 'vide !' : '?'}
                  </Badge>
                </td>
                <td>
                  <Badge tone={account.keyCount > 0 ? 'ok' : 'muted'}>{account.keyCount}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

/* ------------------------------------------------------------------ accès */

function AccessPanel({ host }: { host: HostPublic }): ReactNode {
  const access = useAsync<AccessInfo>(() => window.srv.security.access(host.id), [host.id])

  if (access.error) return <ErrorBox message={access.error} onRetry={access.reload} />
  if (!access.data) return <Loading label="Lecture des connexions…" />
  const data = access.data

  return (
    <div className="stack">
      <div className="grid grid--kpi">
        <KpiCard label="Sessions ouvertes" value={data.sessions.length} hint="connexions interactives" icon={<Activity size={18} />} />
        <KpiCard label="Échecs 24 h" value={data.failedCount} hint="mots de passe refusés" icon={<AlertTriangle size={18} />} />
        <KpiCard label="Connexions établies" value={data.established.length} hint="sockets actifs" icon={<Network size={18} />} />
        <KpiCard label="Dernières connexions" value={data.lastLogins.length} hint="14 derniers jours" icon={<KeyRound size={18} />} />
      </div>

      <div className="grid grid--2">
        <Card title="Connexions récentes" icon={<KeyRound size={14} />} subtitle="journal sshd — Accepted">
          {data.lastLogins.length === 0 ? (
            <Empty title="Aucune connexion récente" icon={<KeyRound size={18} />} />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Compte</th>
                    <th>Depuis</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lastLogins.map((login, index) => (
                    <tr key={`${login.time}-${login.user}-${index}`}>
                      <td className="mono muted" style={{ fontSize: 11 }}>
                        {login.time}
                      </td>
                      <td className="mono">{login.user}</td>
                      <td className="mono">{login.from}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Sockets établis" icon={<Network size={14} />} subtitle="ss -tunp">
          {data.established.length === 0 ? (
            <Empty title="Aucune connexion établie" icon={<Network size={18} />} />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Processus</th>
                    <th>Local</th>
                    <th>Distant</th>
                  </tr>
                </thead>
                <tbody>
                  {data.established.slice(0, 15).map((entry, index) => (
                    <tr key={`${entry.local}-${entry.remote}-${index}`}>
                      <td className="mono">{entry.process}</td>
                      <td className="mono muted">{entry.local}</td>
                      <td className="mono">{entry.remote}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Card title="Tentatives échouées (24 h)" icon={<AlertTriangle size={14} />} subtitle={`${data.failedCount} au total`}>
        {data.failedRecent.length === 0 ? (
          <Empty title="Aucune tentative échouée" hint="Rien à signaler sur les dernières 24 h." icon={<ShieldCheck size={18} />} />
        ) : (
          <div className="stack" style={{ gap: 6 }}>
            {data.failedRecent.map((line, index) => (
              <div key={index} className="mono muted" style={{ fontSize: 12 }}>
                {line}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

/* ----------------------------------------------------------- mises à jour */

function UpdatesPanel({ host }: { host: HostPublic }): ReactNode {
  const { notify } = useToast()
  const updates = useAsync<SecurityUpdatesInfo>(() => window.srv.security.updates(host.id), [host.id])
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [output, setOutput] = useState<string | null>(null)

  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      const res = await window.srv.security.applyUpdates(host.id)
      setOutput(res.output)
      notify(res.ok ? 'Mises à jour de sécurité appliquées' : `Terminé avec des erreurs : ${res.output.slice(0, 200)}`, res.ok ? 'ok' : 'err')
      setConfirm(false)
      updates.reload()
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      setBusy(false)
    }
  }

  if (updates.error) return <ErrorBox message={updates.error} onRetry={updates.reload} />
  if (!updates.data) return <Loading label="Lecture des mises à jour…" />
  const data = updates.data

  return (
    <div className="stack">
      <div className="grid grid--kpi">
        <KpiCard label="Mises à jour" value={data.pending} hint="paquets en attente" icon={<Download size={18} />} />
        <KpiCard label="Dont sécurité" value={data.securityPending} hint={data.securityPending ? 'à appliquer' : 'à jour'} icon={<ShieldCheck size={18} />} />
        <KpiCard
          label="Automatiques"
          value={data.autoUpdates === 'enabled' ? 'activées' : 'off'}
          hint="unattended-upgrades"
          icon={<ShieldQuestion size={18} />}
        />
        <KpiCard
          label="Redémarrage"
          value={data.rebootRequired ? 'requis' : 'non'}
          hint={data.rebootRequired ? 'un noyau a été mis à jour' : 'système à jour'}
          icon={<AlertTriangle size={18} />}
        />
      </div>

      <Card
        title="Mises à jour de sécurité"
        icon={<ShieldCheck size={14} />}
        subtitle={data.lastAutoRun ? `dernier passage : ${data.lastAutoRun}` : 'unattended-upgrade -v'}
        actions={
          <div className="row" style={{ gap: 6 }}>
            <Btn variant="ghost" size="sm" icon={<RefreshCw size={13} />} onClick={updates.reload} loading={updates.loading} />
            <Btn size="sm" variant="primary" onClick={() => setConfirm(true)}>
              Appliquer maintenant
            </Btn>
          </div>
        }
      >
        <p className="muted">
          Lance <code className="mono">unattended-upgrade</code> en mode verbeux : seuls les dépôts de sécurité configurés sont appliqués, sans redémarrage.
          {data.rebootRequired && ' Un redémarrage sera nécessaire pour activer le nouveau noyau.'}
        </p>
        {output && (
          <pre className="mono" style={{ marginTop: 10, fontSize: 11, maxHeight: 320, overflow: 'auto' }}>
            {output}
          </pre>
        )}
      </Card>

      <Modal
        open={confirm}
        title="Appliquer les mises à jour de sécurité ?"
        onClose={() => setConfirm(false)}
        footer={
          <>
            <Btn variant="ghost" onClick={() => setConfirm(false)}>
              Annuler
            </Btn>
            <Btn variant="primary" onClick={run} loading={busy}>
              Lancer
            </Btn>
          </>
        }
      >
        <p>
          {data.securityPending} mise(s) de sécurité en attente sur {host.name}. L’opération peut prendre plusieurs minutes et redémarrer des services.
        </p>
      </Modal>
    </div>
  )
}
