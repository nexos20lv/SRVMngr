import type {
  CertInfo,
  ComposeProject,
  ContainerInfo,
  CronJob,
  DatabaseInfo,
  DbQueryResult,
  DbTableInfo,
  ExecResult,
  Fail2banJail,
  FileEntry,
  HostConfig,
  HostPublic,
  HostStatus,
  ImageInfo,
  MaintenanceInfo,
  MetricsSnapshot,
  PortInfo,
  ProcessRow,
  ServiceInfo,
  SiteActionResult,
  SiteInfo,
  SiteInput,
  SysInfo
} from './types'
import type {
  AccessInfo,
  AccountInfo,
  FirewallInfo,
  SecurityAudit,
  SecurityUpdatesInfo,
  SshConfigInfo,
  SshHardeningOptions
} from './security-types'

export interface DockerOverviewPayload {
  available: boolean
  error?: string
  containers: ContainerInfo[]
  images: ImageInfo[]
  compose: ComposeProject[]
}

export interface FileReadPayload {
  path: string
  content: string
  size: number
  binary: boolean
  truncated: boolean
}

export interface SrvApi {
  platform: NodeJS.Platform
  version: string
  hosts: {
    list(): Promise<HostPublic[]>
    save(host: Partial<HostConfig> & { id?: string }): Promise<HostPublic>
    remove(id: string): Promise<boolean>
  }
  ssh: {
    connect(id: string): Promise<HostStatus>
    disconnect(id: string): Promise<boolean>
    statuses(): Promise<HostStatus[]>
    test(host: Partial<HostConfig>): Promise<{ ok: boolean; latencyMs?: number; error?: string }>
    exec(id: string, command: string, sudo?: boolean): Promise<ExecResult>
    execMany(ids: string[], command: string): Promise<Record<string, ExecResult | { error: string }>>
  }
  metrics: {
    start(id: string): Promise<boolean>
    stop(id: string): Promise<boolean>
    onUpdate(cb: (hostId: string, snapshot: MetricsSnapshot) => void): () => void
    onError(cb: (hostId: string, message: string) => void): () => void
  }
  sysInfo(id: string): Promise<Partial<SysInfo>>
  services: {
    list(id: string): Promise<ServiceInfo[]>
    action(id: string, unit: string, action: string): Promise<ExecResult>
    journal(id: string, unit: string | null, lines?: number): Promise<string>
  }
  docker: {
    overview(id: string): Promise<DockerOverviewPayload>
    action(id: string, container: string, action: 'start' | 'stop' | 'restart' | 'rm'): Promise<ExecResult>
    logs(id: string, container: string, lines?: number): Promise<string>
  }
  sites: {
    list(id: string): Promise<SiteInfo[]>
    read(id: string, name: string): Promise<{ path: string; content: string }>
    save(id: string, name: string, content: string): Promise<SiteActionResult>
    create(id: string, input: SiteInput): Promise<SiteActionResult>
    toggle(id: string, name: string, enable: boolean): Promise<SiteActionResult>
    remove(id: string, name: string): Promise<SiteActionResult>
    restore(id: string, name: string, backup: string): Promise<SiteActionResult>
    cert(id: string, domains: string[], email: string): Promise<{ ok: boolean; output: string }>
    test(id: string): Promise<ExecResult>
    reload(id: string): Promise<ExecResult>
  }
  tools: {
    databases(id: string): Promise<DatabaseInfo[]>
    tables(id: string, db: string): Promise<DbTableInfo[]>
    query(id: string, db: string, sql: string): Promise<DbQueryResult>
    dump(id: string, db: string): Promise<{ path: string; size: string }>
    certs(id: string): Promise<CertInfo[]>
    renewCert(id: string, name?: string): Promise<{ ok: boolean; output: string }>
    fail2ban(id: string): Promise<{ active: boolean; jails: Fail2banJail[] }>
    fail2banAction(id: string, jail: string, ip: string, action: 'ban' | 'unban'): Promise<string>
    cron(id: string): Promise<{ available: boolean; jobs: CronJob[]; rootRaw: string }>
    cronSave(id: string, content: string): Promise<null>
    ports(id: string): Promise<PortInfo[]>
    maintenance(id: string): Promise<MaintenanceInfo>
    maintenanceAction(id: string, action: string): Promise<string>
  }
  security: {
    audit(id: string): Promise<SecurityAudit>
    ssh(id: string): Promise<SshConfigInfo>
    sshApply(id: string, options: SshHardeningOptions): Promise<{ ok: boolean; output: string }>
    sshRevert(id: string): Promise<{ ok: boolean; output: string }>
    sshAddKey(id: string, user: string, key: string): Promise<{ ok: boolean; output: string }>
    firewall(id: string): Promise<FirewallInfo>
    firewallAction(
      id: string,
      action: 'install' | 'enable' | 'disable' | 'allow' | 'delete' | 'default-deny',
      options?: { port?: number; proto?: string; rule?: string; ports?: number[] }
    ): Promise<{ ok: boolean; output: string }>
    accounts(id: string): Promise<AccountInfo[]>
    access(id: string): Promise<AccessInfo>
    updates(id: string): Promise<SecurityUpdatesInfo>
    applyUpdates(id: string): Promise<{ ok: boolean; output: string }>
  }
  proc: {
    list(id: string): Promise<ProcessRow[]>
    kill(id: string, pid: number, signal?: string): Promise<ExecResult>
  }
  host: {
    reboot(id: string): Promise<ExecResult>
    shutdown(id: string): Promise<ExecResult>
  }
  files: {
    home(id: string): Promise<string>
    list(id: string, dir: string, root: boolean): Promise<FileEntry[]>
    read(id: string, path: string, root: boolean): Promise<FileReadPayload>
    write(id: string, path: string, content: string, root: boolean): Promise<null>
    mkdir(id: string, path: string, root: boolean): Promise<null>
    remove(id: string, path: string, root: boolean): Promise<null>
    rename(id: string, from: string, to: string, root: boolean): Promise<null>
    tail(id: string, path: string, lines: number, root: boolean): Promise<string>
    upload(id: string, dir: string, root: boolean): Promise<{ path: string; size: number } | null>
    download(id: string, path: string, root: boolean): Promise<{ path: string; size: number } | null>
  }
  term: {
    open(id: string, cols: number, rows: number): Promise<string>
    write(termId: string, data: string): Promise<boolean>
    resize(termId: string, cols: number, rows: number): Promise<boolean>
    close(termId: string): Promise<boolean>
    onData(cb: (termId: string, data: string) => void): () => void
    onClose(cb: (termId: string) => void): () => void
  }
  onStatus(cb: (status: HostStatus) => void): () => void
}
