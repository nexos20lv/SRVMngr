export type SshStatus = 'offline' | 'connecting' | 'online' | 'error'

export interface HostConfig {
  id: string
  name: string
  host: string
  port: number
  username: string
  /** Mot de passe SSH (chiffré au repos). */
  password?: string
  /** Clé privée PEM/OpenSSH (alternative au mot de passe). */
  privateKey?: string
  /** Phrase secrète de la clé. */
  passphrase?: string
  /** Mot de passe sudo, utilisé si l'utilisateur n'est pas root. */
  sudoPassword?: string
  /** Empreinte SHA256 de la clé hôte SSH approuvée. */
  hostFingerprint?: string
  group?: string
  color?: string
  notes?: string
}

/** Version sans secrets, envoyée au renderer. */
export interface HostPublic {
  id: string
  name: string
  host: string
  port: number
  username: string
  sudoPassword?: undefined
  group?: string
  color?: string
  notes?: string
  hasPassword: boolean
  hasKey: boolean
  hasSudo: boolean
  hostFingerprint?: string
}

export interface HostStatus {
  id: string
  status: SshStatus
  error?: string
  latencyMs?: number
  since?: number
}

export interface ExecResult {
  stdout: string
  stderr: string
  code: number
  durationMs: number
}

export interface DiskInfo {
  fs: string
  mount: string
  size: number
  used: number
  avail: number
  pct: number
}

export interface ProcInfo {
  pid: number
  cpu: number
  mem: number
  rss: number
  comm: string
}

export interface NetInfo {
  rx: number
  tx: number
  rxRate: number
  txRate: number
}

export interface MetricsSnapshot {
  time: number
  cpu: number
  cores: number
  load: [number, number, number]
  mem: { total: number; used: number; available: number; swapTotal: number; swapUsed: number }
  disks: DiskInfo[]
  net: NetInfo
  uptime: number
  procs: ProcInfo[]
  users: number
  temp?: number
  hostname?: string
}

export interface AuditEntry {
  id: string
  time: number
  action: string
  hostId?: string
  detail: string
  ok: boolean
}

export interface HostAlert {
  hostId: string
  severity: 'warn' | 'critical'
  message: string
  time: number
}

export interface SysInfo {
  hostname: string
  os: string
  kernel: string
  arch: string
  uptime: number
  ip: string
  publicIp?: string
  timezone: string
  cpuModel: string
  cores: number
  memTotal: number
  user: string
  isRoot: boolean
  hasDocker: boolean
  hasNginx: boolean
  hasWings: boolean
  pterodactylNode?: string
  virtualization?: string
  initSystem?: string
  packageManager?: string
}

export interface ServiceInfo {
  unit: string
  description: string
  active: string
  sub: string
  load: string
  enabled: string
}

export interface ContainerInfo {
  id: string
  name: string
  image: string
  state: string
  status: string
  ports: string
  labels: string
  cpu?: number
  mem?: string
  memPct?: number
  pids?: string
  netIO?: string
}

export interface ComposeProject {
  name: string
  status: string
  configFiles: string
}

export interface ImageInfo {
  id: string
  repo: string
  tag: string
  size: string
  created: string
}

export interface FileEntry {
  name: string
  path: string
  type: 'file' | 'dir' | 'link' | 'other'
  size: number
  mtime: number
  mode: string
  owner: string
}

export interface SiteInfo {
  name: string
  /** Chemin du fichier actif, ou du fichier disponible si le site est désactivé. */
  file: string
  availablePath?: string
  enabled: boolean
  managed: boolean
  domains: string[]
  listens: string[]
  roots: string[]
  proxies: string[]
  php: string[]
  ssl: boolean
  aliases: string[]
  size: number
}

export type SiteType = 'static' | 'php' | 'proxy'

export interface SiteInput {
  name: string
  domains: string[]
  type: SiteType
  root?: string
  port?: number
  proxyTarget?: string
  createIndex?: boolean
}

export interface SiteActionResult {
  ok: boolean
  test: string
  backup?: string
  message?: string
}

/* ------------------------------------------------------------- boîte à outils */

export interface DatabaseInfo {
  name: string
  tables: number
  sizeMb: number
}

export interface DbTableInfo {
  name: string
  rows: number
  sizeMb: number
}

export interface DbQueryResult {
  headers: string[]
  rows: string[][]
  ms: number
  message: string
}

export interface CertInfo {
  name: string
  domains: string[]
  expiry: string
  daysLeft: number
  path: string
}

export interface Fail2banJail {
  name: string
  banned: number
  total: number
  ips: string[]
}

export interface CronJob {
  id: string
  schedule: string
  command: string
  source: string
  raw: string
}

export interface PortInfo {
  proto: string
  address: string
  port: number
  process: string
  scope: 'public' | 'local' | 'interface'
}

export interface MaintenanceInfo {
  diskUsage: { path: string; bytes: number }[]
  upgrades: number
  rebootRequired: boolean
  journalSize: string
  dockerReclaimable: string
  aptCacheSize: string
}

export interface ProcessRow {
  pid: number
  user: string
  cpu: number
  mem: number
  rss: number
  etime: string
  stat: string
  comm: string
}

export type HostAction =
  | 'start'
  | 'stop'
  | 'restart'
  | 'reload'
  | 'enable'
  | 'disable'
  | 'reboot'
  | 'shutdown'
