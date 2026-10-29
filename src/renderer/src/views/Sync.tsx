import { useEffect, useState, type ReactNode } from 'react'
import { ArrowRight, Cloud, Globe, KeyRound, LockKeyhole, LogIn, UserPlus, X } from 'lucide-react'
import { Btn, Card, useToast } from '@/components/ui'

const DEFAULT_SYNC_URL = 'https://sync-srvmngr.nxslab.in'

type AuthMode = 'login' | 'register'
type SyncStep = 'auth' | 'master'

export function Sync({ onClose, onSessionChange }: { onClose: () => void; onSessionChange: (email?: string) => void }): ReactNode {
  const { notify } = useToast()
  const [url, setUrl] = useState(DEFAULT_SYNC_URL)
  const [customServer, setCustomServer] = useState(false)
  const [authMode, setAuthMode] = useState<AuthMode>('login')
  const [step, setStep] = useState<SyncStep>('auth')
  const [email, setEmail] = useState('')
  const [accountPassword, setAccountPassword] = useState('')
  const [token, setToken] = useState('')
  const [masterPassword, setMasterPassword] = useState('')
  const [busy, setBusy] = useState<'auth' | 'push' | 'pull' | null>(null)
  const [accountConnected, setAccountConnected] = useState(false)
  const [newAccountPassword, setNewAccountPassword] = useState('')

  const syncUrl = customServer ? url.trim() : DEFAULT_SYNC_URL

  useEffect(() => {
    void window.srv.sync.session().then((session) => {
      if (!session) return
      setEmail(session.email)
      setUrl(session.url)
      setCustomServer(session.url !== DEFAULT_SYNC_URL)
      setAccountConnected(true)
    }).catch((err) => console.error('[sync] lecture de session impossible:', err))
  }, [])

  const authenticate = async (): Promise<void> => {
    if (!syncUrl || !email || !accountPassword) {
      notify('Email et mot de passe du compte obligatoires', 'err')
      return
    }
    setBusy('auth')
    try {
      const sessionToken = authMode === 'login'
        ? await window.srv.sync.login(syncUrl, email, accountPassword)
        : await window.srv.sync.register(syncUrl, email, accountPassword)
      setToken(sessionToken)
      notify(authMode === 'login' ? 'Connexion réussie' : 'Compte créé', 'ok')
      setStep('master')
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      setBusy(null)
    }
  }

  const finishSetup = async (): Promise<void> => {
    if (!token || !masterPassword) {
      notify('Mot de passe maître obligatoire', 'err')
      return
    }
    if (masterPassword.length < 10) {
      notify('Le mot de passe maître doit contenir au moins 10 caractères', 'err')
      return
    }
    setBusy('push')
    try {
      try {
        await window.srv.sync.pull(syncUrl, token, masterPassword)
      } catch (err) {
        if (!(err instanceof Error) || !err.message.includes('Aucun coffre')) throw err
        await window.srv.sync.push(syncUrl, token, masterPassword)
      }
      setAccountConnected(true)
      onSessionChange(email)
      onClose()
      notify('Compte connecté et synchronisation activée', 'ok')
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'err')
    } finally {
      setBusy(null)
    }
  }

  const changeServer = (): void => {
    setCustomServer(true)
    setToken('')
    setStep('auth')
  }

  const logout = async (): Promise<void> => {
    await window.srv.sync.logout()
    onSessionChange(undefined)
    setAccountConnected(false)
    setToken('')
    setMasterPassword('')
  }

  if (accountConnected) {
    return (
      <div className="content sync-page">
        <button type="button" className="sync-close" onClick={onClose} aria-label="Fermer"><X size={18} /></button>
        <div className="sync-master">
          <div className="sync-master__icon"><Cloud size={25} /></div>
          <div className="sync-auth__eyebrow">Compte connecté</div>
          <h1>Bonjour.</h1>
          <p>{email} · synchronisation automatique activée</p>
          <Card title="Ton compte" icon={<LockKeyhole size={15} />}>
            <div className="stack">
              <div className="sync-provider"><Cloud size={18} /><div className="sync-provider__body"><div className="sync-provider__title">{email}</div><div className="sync-provider__url">{syncUrl}</div></div></div>
              <div className="sync-actions"><div><div className="sync-actions__title">Synchronisation automatique</div><div className="hint">Pull puis push au lancement de l'application.</div></div><Btn variant="primary" loading={busy === 'push'} onClick={async () => {
                setBusy('push')
                try {
                  const result = await window.srv.sync.auto()
                  if (!result.synced) throw new Error(result.error ?? 'Synchronisation non effectuée')
                  notify(`${result.count ?? 0} serveur(s) synchronisé(s)`, 'ok')
                } catch (err) { notify(err instanceof Error ? err.message : String(err), 'err') } finally { setBusy(null) }
              }}>Synchroniser</Btn></div>
              <label className="field"><span>Mot de passe actuel</span><input className="input" type="password" value={accountPassword} onChange={(event) => setAccountPassword(event.target.value)} /></label>
              <label className="field"><span>Nouveau mot de passe du compte</span><input className="input" type="password" value={newAccountPassword} onChange={(event) => setNewAccountPassword(event.target.value)} placeholder="10 caractères minimum" /></label>
              <Btn variant="ghost" onClick={async () => {
                if (!accountPassword || newAccountPassword.length < 10) return notify('Saisis ton mot de passe actuel et un nouveau de 10 caractères minimum', 'err')
                try {
                  await window.srv.sync.changePassword(accountPassword, newAccountPassword)
                  setAccountPassword(newAccountPassword)
                  setNewAccountPassword('')
                  notify('Mot de passe modifié', 'ok')
                } catch (err) { notify(err instanceof Error ? err.message : String(err), 'err') }
              }}>Modifier le mot de passe</Btn>
              <button type="button" className="sync-account-action" onClick={() => void logout()}><LogIn size={14} /> Se déconnecter</button>
            </div>
          </Card>
        </div>
      </div>
    )
  }

  if (step === 'auth') {
    return (
      <div className="content sync-page">
        <button type="button" className="sync-close" onClick={onClose} aria-label="Fermer"><X size={18} /></button>
        <div className="sync-auth">
          <div className="sync-auth__brand"><Cloud size={24} /></div>
          <div className="sync-auth__eyebrow">SRV Mngr Sync</div>
          <h1>{authMode === 'login' ? 'Content de te revoir.' : 'Crée ton compte.'}</h1>
          <p>{authMode === 'login' ? 'Connecte-toi pour retrouver tes VPS sur tous tes appareils.' : 'Un compte simple pour synchroniser ton coffre VPS.'}</p>
          <div className="sync-server-pill">
            <Globe size={14} />
            <span>{syncUrl}</span>
            <button type="button" onClick={changeServer}>Changer de serveur</button>
          </div>
          {customServer && (
            <label className="field sync-server-input">
              <span>URL du serveur custom</span>
              <input className="input" value={url} onChange={(event) => {
                setUrl(event.target.value)
                setToken('')
              }} placeholder="https://sync.example.com" autoFocus />
            </label>
          )}
          <div className="sync-auth__form">
            <label className="field">
              <span>Email</span>
              <input className="input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="toi@exemple.com" autoFocus={!customServer} />
            </label>
            <label className="field">
              <span>Mot de passe</span>
              <input className="input" type="password" value={accountPassword} onChange={(event) => setAccountPassword(event.target.value)} placeholder="10 caractères minimum" onKeyDown={(event) => {
                if (event.key === 'Enter') void authenticate()
              }} />
            </label>
            <Btn variant="primary" icon={authMode === 'login' ? <LogIn size={15} /> : <UserPlus size={15} />} loading={busy === 'auth'} onClick={() => void authenticate()}>
              {authMode === 'login' ? 'Se connecter' : "S'inscrire"}
            </Btn>
          </div>
          <button type="button" className="sync-auth__switch" onClick={() => setAuthMode((mode) => mode === 'login' ? 'register' : 'login')}>
            {authMode === 'login' ? 'Pas encore de compte ? ' : 'Tu as déjà un compte ? '}
            <strong>{authMode === 'login' ? "S'inscrire" : 'Se connecter'}</strong>
            <ArrowRight size={13} />
          </button>
          <div className="sync-auth__safe"><LockKeyhole size={13} /> Tes données sont chiffrées avant d’être envoyées.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="content sync-page">
      <div className="sync-master">
        <button type="button" className="sync-close" onClick={onClose} aria-label="Fermer"><X size={18} /></button>
        <div className="sync-master__icon"><KeyRound size={25} /></div>
        <div className="sync-auth__eyebrow">Dernière étape</div>
        <h1>Protège ton coffre.</h1>
        <p>Choisis ton mot de passe maître une seule fois. La synchronisation se fera ensuite automatiquement.</p>
        <Card title="Mot de passe maître" icon={<LockKeyhole size={15} />}>
          <div className="stack">
            <label className="field">
              <span>Mot de passe maître</span>
              <input className="input" type="password" value={masterPassword} onChange={(event) => setMasterPassword(event.target.value)} placeholder="10 caractères minimum" autoFocus onKeyDown={(event) => {
                if (event.key === 'Enter') void finishSetup()
              }} />
            </label>
            <div className="sync-master__note"><LockKeyhole size={14} /> Le serveur ne reçoit jamais ce mot de passe.</div>
            <div className="sync-actions">
              <div>
                <div className="sync-actions__title">Tout est automatique</div>
                <div className="hint">Pull puis push au lancement de l'application.</div>
              </div>
              <Btn variant="primary" loading={busy === 'push'} onClick={() => void finishSetup()}>Continuer</Btn>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
