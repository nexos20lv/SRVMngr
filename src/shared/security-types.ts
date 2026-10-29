export type CheckStatus = 'ok' | 'warn' | 'fail' | 'info'

export interface SecurityCheck {
  id: string
  label: string
  status: CheckStatus
  detail: string
  weight: number
  category: 'ssh' | 'firewall' | 'services' | 'updates' | 'accounts' | 'files'
  target?: 'ssh' | 'firewall' | 'accounts' | 'updates' | 'access'
}

export interface SecurityAudit {
  score: number
  checks: SecurityCheck[]
  generatedAt: number
}

export interface SshKeyInfo {
  user: string
  path: string
  count: number
  fingerprints: string[]
}

export interface SshConfigInfo {
  port: string
  permitRootLogin: string
  passwordAuthentication: string
  pubkeyAuthentication: string
  maxAuthTries: string
  permitEmptyPasswords: string
  includeDropIn: boolean
  dropInActive: boolean
  dropInContent: string
  serviceActive: boolean
  keys: SshKeyInfo[]
  raw: string
}

export interface FirewallRule {
  to: string
  action: string
  from: string
}

export interface FirewallInfo {
  backend: 'ufw' | 'nftables' | 'iptables' | 'none'
  active: boolean
  defaultIncoming?: string
  defaultOutgoing?: string
  rules: FirewallRule[]
  raw: string
  hint?: string
}

export interface AccountInfo {
  user: string
  uid: number
  shell: string
  sudo: boolean
  passwordState: string
  keyCount: number
}

export interface AccessInfo {
  sessions: { user: string; tty: string; from: string; since: string }[]
  lastLogins: { user: string; from: string; time: string }[]
  failedCount: number
  failedRecent: string[]
  established: { process: string; local: string; remote: string }[]
}

export interface SecurityUpdatesInfo {
  pending: number
  securityPending: number
  autoUpdates: string
  rebootRequired: boolean
  lastAutoRun?: string
}

export interface SshHardeningOptions {
  disablePasswordAuth: boolean
  disableRootLogin: boolean
  maxAuthTries: number
}

export interface FirewallEnableOptions {
  ports: number[]
}
