import type {
  AccessInfo,
  AccountInfo,
  FirewallInfo,
  FirewallRule,
  SecurityAudit,
  SecurityCheck,
  SecurityUpdatesInfo,
  SshConfigInfo,
  SshHardeningOptions,
  SshKeyInfo
} from '@shared/security-types'
import type { Remote } from './remote'
import { shQuote } from './shell'
import type { SshManager } from './ssh-manager'

// Préfixe 00- : sshd retient la PREMIÈRE valeur rencontrée, et les drop-ins sont lus par ordre
// alphabétique. Un 99- serait donc ignoré par 50-security.conf (observé sur le VPS Lyc).
const DROPIN = '/etc/ssh/sshd_config.d/00-srvmngr.conf'
const BACKUP_DIR = '/root/srvmngr-backups'

function sections(output: string): Map<string, string> {
  const map = new Map<string, string>()
  let key = ''
  for (const line of output.split('\n')) {
    const match = line.match(/^@@([A-Z0-9]+)$/)
    if (match) {
      key = match[1]
      map.set(key, '')
      continue
    }
    if (key) map.set(key, (map.get(key) ?? '') + line + '\n')
  }
  return map
}

const trimmed = (value: string | undefined): string => (value ?? '').trim()
const lines = (value: string | undefined): string[] =>
  trimmed(value)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

function keyValue(output: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of output.split('\n')) {
    const parts = line.trim().split(/\s+/)
    if (parts.length >= 2) result[parts[0].toLowerCase()] = parts.slice(1).join(' ')
  }
  return result
}

function parseKeys(keysBlock: string, fpBlock: string): SshKeyInfo[] {
  const fingerprints = new Map<string, string[]>()
  for (const line of lines(fpBlock)) {
    const match = line.match(/^(\/\S+?)\|(.+)$/)
    if (!match) continue
    const home = match[1].replace(/\/\.ssh\/authorized_keys$/, '')
    const list = fingerprints.get(home) ?? []
    list.push(match[2].trim())
    fingerprints.set(home, list)
  }
  return lines(keysBlock).map((line) => {
    const [home, count] = line.split('|')
    const prints = fingerprints.get(home) ?? []
    return {
      user: home === '/root' ? 'root' : home.split('/').pop() ?? home,
      path: `${home}/.ssh/authorized_keys`,
      count: Math.max(Number(count) || 0, prints.length),
      fingerprints: prints
    }
  })
}

const AUDIT_COMMAND = [
  `export LC_ALL=C`,
  `printf '\\n@@SSHT\\n'; sshd -T 2>/dev/null | grep -iE '^(port|permitrootlogin|passwordauthentication|pubkeyauthentication|maxauthtries|permitemptypasswords|kbdinteractiveauthentication) '`,
  `printf '\\n@@INCLUDE\\n'; grep -cE '^[[:space:]]*Include[[:space:]]+/etc/ssh/sshd_config.d' /etc/ssh/sshd_config 2>/dev/null || true`,
  `printf '\\n@@DROPIN\\n'; test -f ${DROPIN} && echo yes || echo no`,
  `printf '\\n@@KEYS\\n'; for h in /root /home/*; do f="$h/.ssh/authorized_keys"; [ -f "$f" ] && printf '%s|%s\\n' "$h" "$(grep -vcE '^[[:space:]]*(#|$)' "$f" 2>/dev/null)"; done`,
  `printf '\\n@@KEYFP\\n'; for f in /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys; do [ -f "$f" ] && ssh-keygen -lf "$f" 2>/dev/null | sed "s|^|$f\\||"; done`,
  `printf '\\n@@UFW\\n'; if command -v ufw >/dev/null 2>&1; then ufw status verbose 2>/dev/null; else echo NO_UFW; fi`,
  `printf '\\n@@NFT\\n'; nft list ruleset 2>/dev/null | head -30`,
  `printf '\\n@@IPT\\n'; iptables -S 2>/dev/null | head -20`,
  `printf '\\n@@F2B\\n'; systemctl is-active fail2ban 2>/dev/null || true`,
  `printf '\\n@@F2BJ\\n'; fail2ban-client status 2>/dev/null | grep -i 'Jail list' || true`,
  `printf '\\n@@F2BC\\n'; fail2ban-client status 2>/dev/null | sed -n 's/.*Jail list:[[:space:]]*//p' | tr ',' '\\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | grep -c . || true`,
  `printf '\\n@@UPG\\n'; apt list --upgradable 2>/dev/null | tail -n +2 | wc -l`,
  `printf '\\n@@SECUPG\\n'; apt list --upgradable 2>/dev/null | grep -ic security || true`,
  `printf '\\n@@AUTO\\n'; systemctl is-enabled unattended-upgrades 2>/dev/null || true`,
  `printf '\\n@@REBOOT\\n'; test -f /var/run/reboot-required && echo yes || echo no`,
  `printf '\\n@@ROOT\\n'; awk -F: '$3==0 {print $1}' /etc/passwd`,
  `printf '\\n@@EMPTY\\n'; awk -F: 'length($2)==0 {print $1}' /etc/shadow`,
  `printf '\\n@@WORLD\\n'; find /etc -maxdepth 2 -type f -perm -002 2>/dev/null | head -10`,
  `printf '\\n@@SSHPORT\\n'; sshd -T 2>/dev/null | awk '$1=="port"{print $2}' | head -1`
].join('\n')

const SSH_COMMAND = [
  `export LC_ALL=C`,
  `printf '\\n@@SSHT\\n'; sshd -T 2>/dev/null | grep -iE '^(port|permitrootlogin|passwordauthentication|pubkeyauthentication|maxauthtries|permitemptypasswords|kbdinteractiveauthentication) '`,
  `printf '\\n@@DROPIN\\n'; cat ${DROPIN} 2>/dev/null || echo '__NONE__'`,
  `printf '\\n@@INCLUDE\\n'; grep -cE '^[[:space:]]*Include[[:space:]]+/etc/ssh/sshd_config.d' /etc/ssh/sshd_config 2>/dev/null || true`,
  `printf '\\n@@SVC\\n'; systemctl is-active ssh 2>/dev/null || systemctl is-active sshd 2>/dev/null || true`,
  `printf '\\n@@KEYS\\n'; for h in /root /home/*; do f="$h/.ssh/authorized_keys"; [ -f "$f" ] && printf '%s|%s\\n' "$h" "$(grep -vcE '^[[:space:]]*(#|$)' "$f" 2>/dev/null)"; done`,
  `printf '\\n@@KEYFP\\n'; for f in /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys; do [ -f "$f" ] && ssh-keygen -lf "$f" 2>/dev/null | sed "s|^|$f\\||"; done`
].join('\n')

const FIREWALL_COMMAND = [
  `printf '\\n@@UFW\\n'; if command -v ufw >/dev/null 2>&1; then ufw status verbose 2>/dev/null; else echo NO_UFW; fi`,
  `printf '\\n@@NFT\\n'; nft list ruleset 2>/dev/null | head -60`,
  `printf '\\n@@IPT\\n'; iptables -S 2>/dev/null | head -30`,
  `printf '\\n@@SSHPORT\\n'; sshd -T 2>/dev/null | awk '$1=="port"{print $2}' | head -1`
].join('\n')

const ACCOUNTS_COMMAND = [
  `export LC_ALL=C`,
  `printf '\\n@@USERS\\n'; awk -F: '$3==0 || ($3>=1000 && $3<65534) {print $1"|"$3"|"$7}' /etc/passwd`,
  `printf '\\n@@SUDOGRP\\n'; getent group sudo 2>/dev/null | cut -d: -f4`,
  `printf '\\n@@PW\\n'; for u in $(awk -F: '$3==0 || ($3>=1000 && $3<65534) {print $1}' /etc/passwd); do echo "$u|$(passwd -S "$u" 2>/dev/null | awk '{print $2}')"; done`,
  `printf '\\n@@KEYS\\n'; for h in /root /home/*; do f="$h/.ssh/authorized_keys"; [ -f "$f" ] && printf '%s|%s\\n' "$h" "$(grep -vcE '^[[:space:]]*(#|$)' "$f" 2>/dev/null)"; done`
].join('\n')

const ACCESS_COMMAND = [
  `printf '\\n@@WHO\\n'; who 2>/dev/null`,
  `printf '\\n@@ACCEPT\\n'; journalctl --since '14 days ago' --no-pager -g 'Accepted (password|publickey)' 2>/dev/null | tail -14`,
  `printf '\\n@@FAILC\\n'; journalctl --since '24 hours ago' --no-pager -g 'Failed password|Invalid user' 2>/dev/null | wc -l`,
  `printf '\\n@@FAIL\\n'; journalctl --since '24 hours ago' --no-pager -g 'Failed password|Invalid user' 2>/dev/null | tail -6`,
  `printf '\\n@@ESTAB\\n'; ss -tunpH state established 2>/dev/null | head -25`
].join('\n')

const UPDATES_COMMAND = [
  `printf '\\n@@UPG\\n'; apt list --upgradable 2>/dev/null | tail -n +2 | wc -l`,
  `printf '\\n@@SEC\\n'; apt list --upgradable 2>/dev/null | grep -ic security || true`,
  `printf '\\n@@AUTO\\n'; systemctl is-enabled unattended-upgrades 2>/dev/null || true`,
  `printf '\\n@@REBOOT\\n'; test -f /var/run/reboot-required && echo yes || echo no`,
  `printf '\\n@@LAST\\n'; ls -t /var/log/unattended-upgrades/*.log 2>/dev/null | head -1`
].join('\n')

export class SecurityManager {
  constructor(
    private ssh: SshManager,
    private remote: Remote
  ) {}

  async audit(id: string): Promise<SecurityAudit> {
    const res = await this.ssh.exec(id, AUDIT_COMMAND, { sudo: true, timeoutMs: 90_000 })
    const s = sections(res.stdout)
    const sshd = keyValue(trimmed(s.get('SSHT')))
    const keys = parseKeys(trimmed(s.get('KEYS')), trimmed(s.get('KEYFP')))
    const keyCount = keys.reduce((sum, key) => sum + key.count, 0)
    const ufwRaw = trimmed(s.get('UFW'))
    const ufwActive = /Status:\s*active/i.test(ufwRaw)
    const nftRules = lines(s.get('NFT')).filter((line) => /(chain|rule|policy)/i.test(line)).length
    const iptRules = lines(s.get('IPT')).filter((line) => line.startsWith('-A')).length
    const f2b = trimmed(s.get('F2B'))
    const securityUpdates = Number(trimmed(s.get('SECUPG'))) || 0
    const autoUpdates = trimmed(s.get('AUTO'))
    const emptyPasswords = lines(s.get('EMPTY'))
    const rootUsers = lines(s.get('ROOT'))
    const worldWritable = lines(s.get('WORLD'))
    const sshPort = trimmed(s.get('SSHPORT')) || '22'
    const provider = sshd['passwordauthentication'] ?? 'unknown'
    const rootLogin = sshd['permitrootlogin'] ?? 'unknown'
    const maxTries = Number(sshd['maxauthtries'] ?? 0)

    const checks: SecurityCheck[] = [
      {
        id: 'ssh-password',
        label: 'Authentification SSH par mot de passe',
        status: provider === 'no' ? 'ok' : 'fail',
        detail: provider === 'no' ? 'Désactivée : seules les clés sont acceptées.' : 'Activée : vulnérable au brute force. Passe en clés SSH.',
        weight: 15,
        category: 'ssh',
        target: 'ssh'
      },
      {
        id: 'ssh-root',
        label: 'Connexion directe de root',
        status: rootLogin === 'no' ? 'ok' : rootLogin === 'prohibit-password' ? 'warn' : 'fail',
        detail:
          rootLogin === 'no'
            ? 'Root ne peut pas se connecter.'
            : rootLogin === 'prohibit-password'
              ? 'Root autorisé uniquement par clé.'
              : 'Root peut se connecter par mot de passe.',
        weight: 10,
        category: 'ssh',
        target: 'ssh'
      },
      {
        id: 'ssh-maxtries',
        label: 'Tentatives d’authentification limitées',
        status: maxTries > 0 && maxTries <= 4 ? 'ok' : 'warn',
        detail: maxTries ? `MaxAuthTries = ${maxTries}` : 'Valeur par défaut (6 tentatives).',
        weight: 5,
        category: 'ssh',
        target: 'ssh'
      },
      {
        id: 'ssh-keys',
        label: 'Clés SSH installées',
        status: keyCount > 0 ? 'ok' : 'fail',
        detail: keyCount > 0 ? `${keyCount} clé(s) sur ${keys.length} compte(s).` : 'Aucune clé : le durcissement SSH est impossible sans risque.',
        weight: 5,
        category: 'ssh',
        target: 'ssh'
      },
      {
        id: 'firewall',
        label: 'Pare-feu actif',
        status: ufwActive ? 'ok' : nftRules > 1 || iptRules > 2 ? 'warn' : 'fail',
        detail: ufwActive
          ? 'ufw actif.'
          : nftRules > 1 || iptRules > 2
            ? 'Règles nftables/iptables présentes mais ufw absent : vérifie manuellement.'
            : 'Aucun pare-feu : tous les ports en écoute sont exposés.',
        weight: 20,
        category: 'firewall',
        target: 'firewall'
      },
      {
        id: 'fail2ban',
        label: 'Fail2ban',
        status: f2b === 'active' ? 'ok' : 'fail',
        detail:
          f2b === 'active'
            ? `Actif — ${Number(trimmed(s.get('F2BC'))) || 0} jail(s) : ${(
                trimmed(s.get('F2BJ')).match(/Jail list:\s*(.+)$/i)?.[1] ?? 'aucune'
              ).trim()}`
            : 'Inactif : aucune protection contre le brute force.',
        weight: 15,
        category: 'services',
        target: 'access'
      },
      {
        id: 'updates-security',
        label: 'Mises à jour de sécurité',
        status: securityUpdates === 0 ? 'ok' : 'warn',
        detail: securityUpdates === 0 ? 'Aucune mise à jour de sécurité en attente.' : `${securityUpdates} mise(s) à jour de sécurité en attente.`,
        weight: 10,
        category: 'updates',
        target: 'updates'
      },
      {
        id: 'auto-updates',
        label: 'Mises à jour automatiques',
        status: autoUpdates === 'enabled' ? 'ok' : 'warn',
        detail: autoUpdates === 'enabled' ? 'unattended-upgrades activé.' : 'unattended-upgrades désactivé ou absent.',
        weight: 5,
        category: 'updates',
        target: 'updates'
      },
      {
        id: 'accounts-empty',
        label: 'Comptes sans mot de passe',
        status: emptyPasswords.length === 0 ? 'ok' : 'fail',
        detail: emptyPasswords.length ? `Comptes sans mot de passe : ${emptyPasswords.join(', ')}` : 'Aucun compte à mot de passe vide.',
        weight: 10,
        category: 'accounts',
        target: 'accounts'
      },
      {
        id: 'accounts-root',
        label: 'Comptes UID 0',
        status: rootUsers.length <= 1 ? 'ok' : 'warn',
        detail: `${rootUsers.length} compte(s) avec UID 0 : ${rootUsers.join(', ')}`,
        weight: 5,
        category: 'accounts',
        target: 'accounts'
      },
      {
        id: 'files-world',
        label: 'Fichiers modifiables par tous dans /etc',
        status: worldWritable.length === 0 ? 'ok' : 'warn',
        detail: worldWritable.length ? `${worldWritable.length} fichier(s) en écriture pour tous.` : 'Aucun fichier world-writable.',
        weight: 5,
        category: 'files',
        target: 'accounts'
      }
    ]

    void sshPort
    const total = checks.reduce((sum, check) => sum + check.weight, 0)
    const earned = checks.reduce(
      (sum, check) => sum + (check.status === 'ok' ? check.weight : check.status === 'warn' ? check.weight / 2 : 0),
      0
    )
    return { score: Math.round((earned / total) * 100), checks, generatedAt: Date.now() }
  }

  async sshConfig(id: string): Promise<SshConfigInfo> {
    const res = await this.ssh.exec(id, SSH_COMMAND, { sudo: true, timeoutMs: 45_000 })
    const s = sections(res.stdout)
    const values = keyValue(trimmed(s.get('SSHT')))
    const dropIn = trimmed(s.get('DROPIN'))
    return {
      port: values['port'] ?? '22',
      permitRootLogin: values['permitrootlogin'] ?? 'unknown',
      passwordAuthentication: values['passwordauthentication'] ?? 'unknown',
      pubkeyAuthentication: values['pubkeyauthentication'] ?? 'unknown',
      maxAuthTries: values['maxauthtries'] ?? '6',
      permitEmptyPasswords: values['permitemptypasswords'] ?? 'unknown',
      includeDropIn: (Number(trimmed(s.get('INCLUDE'))) || 0) > 0,
      dropInActive: dropIn !== '__NONE__' && dropIn.length > 0,
      dropInContent: dropIn === '__NONE__' ? '' : dropIn,
      serviceActive: trimmed(s.get('SVC')) === 'active',
      keys: parseKeys(trimmed(s.get('KEYS')), trimmed(s.get('KEYFP'))),
      raw: trimmed(s.get('SSHT'))
    }
  }

  private async testAndReloadSsh(id: string): Promise<{ ok: boolean; output: string }> {
    const test = await this.ssh.exec(id, 'sshd -t 2>&1', { sudo: true, timeoutMs: 20_000 })
    if (test.code !== 0) return { ok: false, output: `${test.stdout}${test.stderr}`.trim() }
    const reload = await this.ssh.exec(id, 'systemctl reload ssh 2>&1 || systemctl reload sshd 2>&1', {
      sudo: true,
      timeoutMs: 30_000
    })
    return { ok: reload.code === 0, output: `${test.stdout}${reload.stdout}${reload.stderr}`.trim() || 'OK' }
  }

  /** Vérifie que sshd applique réellement les directives écrites (le premier fichier gagne). */
  private async verifySsh(
    id: string,
    expected: { maxAuthTries: number; passwordAuth?: boolean; rootLogin?: boolean }
  ): Promise<{ ok: boolean; output: string }> {
    const res = await this.ssh.exec(
      id,
      `sshd -T 2>/dev/null | grep -iE '^(maxauthtries|passwordauthentication|permitrootlogin) '; echo '--FILES--'; grep -rniE '^[[:space:]]*(maxauthtries|passwordauthentication|permitrootlogin)[[:space:]]' /etc/ssh/sshd_config.d/ /etc/ssh/sshd_config 2>/dev/null`,
      { sudo: true, timeoutMs: 25_000 }
    )
    const [effectiveRaw, filesRaw = ''] = res.stdout.split('--FILES--')
    const effective = keyValue(effectiveRaw ?? '')
    const problems: string[] = []
    if (Number(effective['maxauthtries']) !== expected.maxAuthTries) {
      problems.push(`MaxAuthTries = ${effective['maxauthtries'] ?? '?'} au lieu de ${expected.maxAuthTries}`)
    }
    if (expected.passwordAuth && effective['passwordauthentication'] !== 'no') {
      problems.push(`PasswordAuthentication = ${effective['passwordauthentication'] ?? '?'}`)
    }
    if (expected.rootLogin && effective['permitrootlogin'] !== 'no') {
      problems.push(`PermitRootLogin = ${effective['permitrootlogin'] ?? '?'}`)
    }
    if (problems.length === 0) return { ok: true, output: 'Configuration effective vérifiée.' }

    const culprit = filesRaw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith(DROPIN))
      .slice(0, 4)
      .join('\n')
    return {
      ok: false,
      output: `${problems.join(' · ')}\nsshd retient la première valeur rencontrée :\n${culprit}`
    }
  }

  async applySshHardening(id: string, options: SshHardeningOptions): Promise<{ ok: boolean; output: string }> {
    const info = await this.sshConfig(id)
    if (!info.includeDropIn) {
      throw new Error('sshd_config n’inclut pas /etc/ssh/sshd_config.d — durcissement refusé pour ne pas modifier le fichier principal.')
    }
    const keyCount = info.keys.reduce((sum, key) => sum + key.count, 0)
    if (options.disablePasswordAuth && keyCount === 0) {
      throw new Error('Aucune clé publique installée : refus de désactiver le mot de passe (risque de perdre l’accès).')
    }
    if (options.disableRootLogin && keyCount === 0) {
      throw new Error('Aucune clé publique installée : refuse de bloquer root sans clé de secours.')
    }

    const host = this.ssh.getHost(id)
    const panelUsesPassword = Boolean(host.password) && !host.privateKey
    if (panelUsesPassword && (options.disablePasswordAuth || options.disableRootLogin)) {
      throw new Error(
        'Le panel se connecte à cet hôte avec un mot de passe : couper le mot de passe ou root couperait aussi son propre accès. Commence par ajouter une clé privée dans la fiche de l’hôte.'
      )
    }

    const tries = Math.min(10, Math.max(3, Math.round(options.maxAuthTries)))
    // On n’écrit que ce qui est demandé : jamais de « PermitRootLogin prohibit-password »
    // implicite, qui couperait une connexion root par mot de passe en cours d’utilisation.
    const content = [
      '# Géré par SRV Mngr — durcissement SSH (fichier généré)',
      `MaxAuthTries ${tries}`,
      'PermitEmptyPasswords no',
      ...(options.disablePasswordAuth ? ['PasswordAuthentication no', 'KbdInteractiveAuthentication no'] : []),
      ...(options.disableRootLogin ? ['PermitRootLogin no'] : []),
      ''
    ].join('\n')

    await this.ssh.exec(id, `mkdir -p ${BACKUP_DIR} && cp -p ${DROPIN} ${BACKUP_DIR}/sshd-dropin-$(date +%s) 2>/dev/null; true`, {
      sudo: true,
      timeoutMs: 20_000
    })
    await this.remote.writeFile(id, DROPIN, content, true)
    await this.ssh.exec(id, `chmod 644 ${DROPIN}`, { sudo: true, timeoutMs: 10_000 })

    const result = await this.testAndReloadSsh(id)
    if (!result.ok) {
      // rollback immédiat : on ne laisse jamais une config sshd invalide
      await this.ssh.exec(id, `rm -f ${DROPIN}`, { sudo: true, timeoutMs: 10_000 })
      await this.testAndReloadSsh(id)
      return { ok: false, output: result.output }
    }

    const verdict = await this.verifySsh(id, {
      maxAuthTries: tries,
      passwordAuth: options.disablePasswordAuth,
      rootLogin: options.disableRootLogin
    })
    if (!verdict.ok) return { ok: false, output: verdict.output }
    return { ok: true, output: verdict.output }
  }

  async revertSshHardening(id: string): Promise<{ ok: boolean; output: string }> {
    await this.ssh.exec(id, `mkdir -p ${BACKUP_DIR} && cp -p ${DROPIN} ${BACKUP_DIR}/sshd-dropin-$(date +%s) 2>/dev/null; true`, {
      sudo: true,
      timeoutMs: 20_000
    })
    await this.ssh.exec(id, `rm -f ${DROPIN}`, { sudo: true, timeoutMs: 10_000 })
    return this.testAndReloadSsh(id)
  }

  async addKey(id: string, user: string, publicKey: string): Promise<{ ok: boolean; output: string }> {
    if (!/^[a-z_][a-z0-9_-]{0,31}$/.test(user)) throw new Error('Utilisateur invalide')
    const key = publicKey.trim()
    if (!/^(ssh-(rsa|ed25519)|ecdsa-sha2-nistp(256|384|521)|sk-(ssh-ed25519|ecdsa-sha2-nistp256)@openssh\.com)\s+AAAA[0-9A-Za-z+/=]+/.test(key)) {
      throw new Error('Clé publique invalide (format OpenSSH attendu)')
    }
    const homeRes = await this.ssh.exec(id, `getent passwd ${shQuote(user)} | cut -d: -f6`, { timeoutMs: 10_000 })
    const home = homeRes.stdout.trim()
    if (!home) throw new Error(`Utilisateur « ${user} » introuvable`)

    const dir = `${home}/.ssh`
    const file = `${dir}/authorized_keys`
    let existing = ''
    try {
      existing = (await this.remote.readFile(id, file, true)).content
    } catch {
      existing = ''
    }
    if (existing.includes(key.split(/\s+/)[1] ?? '__none__')) {
      return { ok: true, output: 'Cette clé est déjà autorisée.' }
    }
    const content = `${existing.replace(/\s*$/, '')}\n${key}\n`.replace(/^\n/, '')
    await this.ssh.exec(id, `mkdir -p ${shQuote(dir)}`, { sudo: true, timeoutMs: 15_000 })
    await this.remote.writeFile(id, file, content, true)
    await this.ssh.exec(id, `chmod 700 ${shQuote(dir)} && chmod 600 ${shQuote(file)} && chown -R ${shQuote(user)}: ${shQuote(dir)}`, {
      sudo: true,
      timeoutMs: 20_000
    })
    return { ok: true, output: `Clé ajoutée pour ${user} (${file}).` }
  }

  async firewall(id: string): Promise<FirewallInfo> {
    const res = await this.ssh.exec(id, FIREWALL_COMMAND, { sudo: true, timeoutMs: 45_000 })
    const s = sections(res.stdout)
    const ufwRaw = trimmed(s.get('UFW'))
    const nftRaw = trimmed(s.get('NFT'))
    const iptRaw = trimmed(s.get('IPT'))

    if (/NO_UFW/.test(ufwRaw) || !ufwRaw) {
      const nftActive = lines(nftRaw).filter((line) => line.includes('rule')).length > 0
      const iptActive = lines(iptRaw).filter((line) => line.startsWith('-A')).length > 2
      if (nftActive) {
        return {
          backend: 'nftables',
          active: true,
          rules: [],
          raw: nftRaw,
          hint: 'nftables actif — gestion en lecture seule. Installe ufw pour piloter les règles depuis le panel.'
        }
      }
      if (iptActive) {
        return {
          backend: 'iptables',
          active: true,
          rules: [],
          raw: iptRaw,
          hint: 'iptables actif — gestion en lecture seule. Installe ufw pour piloter les règles depuis le panel.'
        }
      }
      return {
        backend: 'none',
        active: false,
        rules: [],
        raw: '',
        hint: 'Aucun pare-feu. Installe ufw puis active-le depuis ce panneau.'
      }
    }

    const active = /Status:\s*active/i.test(ufwRaw)
    const defaults = ufwRaw.match(/Default:\s*([a-z]+)\s*\(incoming\),\s*([a-z]+)\s*\(outgoing\)/i)
    const rules: FirewallRule[] = []
    const ruleLines = ufwRaw.split('\n')
    const headerIndex = ruleLines.findIndex((line) => /^To\s+Action\s+From/i.test(line.trim()))
    if (headerIndex >= 0) {
      for (const line of ruleLines.slice(headerIndex + 2)) {
        const trimmedLine = line.trim()
        if (!trimmedLine || trimmedLine.startsWith('--')) continue
        const cols = trimmedLine.split(/\s{2,}/)
        if (cols.length < 3) continue
        rules.push({ to: cols[0].trim(), action: cols[1].trim(), from: cols[2].trim() })
      }
    }
    return {
      backend: 'ufw',
      active,
      defaultIncoming: defaults?.[1],
      defaultOutgoing: defaults?.[2],
      rules,
      raw: ufwRaw
    }
  }

  async firewallAction(
    id: string,
    action: 'install' | 'enable' | 'disable' | 'allow' | 'delete' | 'default-deny',
    options: { port?: number; proto?: string; rule?: string; ports?: number[] } = {}
  ): Promise<{ ok: boolean; output: string }> {
    const run = async (command: string, timeout = 90_000): Promise<{ ok: boolean; output: string }> => {
      const res = await this.ssh.exec(id, `${command} 2>&1`, { sudo: true, timeoutMs: timeout })
      return { ok: res.code === 0, output: `${res.stdout}${res.stderr}`.trim() }
    }

    if (action === 'install') {
      return run('DEBIAN_FRONTEND=noninteractive apt-get install -y ufw', 600_000)
    }
    if (action === 'enable') {
      const info = await this.sshConfig(id)
      const sshPort = Number(info.port) || 22
      const ports = new Set<number>([sshPort, ...(options.ports ?? [])])
      for (const port of ports) {
        await run(`ufw allow ${port}/tcp`)
        await run(`ufw allow ${port}/udp`)
      }
      await run('ufw default deny incoming')
      await run('ufw default allow outgoing')
      return run('ufw --force enable')
    }
    if (action === 'disable') return run('ufw --force disable')
    if (action === 'default-deny') return run('ufw default deny incoming')
    if (action === 'allow') {
      const port = Number(options.port)
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port invalide')
      const proto = options.proto === 'udp' ? 'udp' : 'tcp'
      return run(`ufw allow ${port}/${proto}`)
    }
    if (action === 'delete') {
      const rule = (options.rule ?? '').trim()
      if (!/^[0-9A-Za-z ,./:_-]{1,60}$/.test(rule)) throw new Error('Règle invalide')
      return run(`ufw delete allow ${shQuote(rule)}`)
    }
    throw new Error('Action pare-feu inconnue')
  }

  async accounts(id: string): Promise<AccountInfo[]> {
    const res = await this.ssh.exec(id, ACCOUNTS_COMMAND, { sudo: true, timeoutMs: 60_000 })
    const s = sections(res.stdout)
    const sudoUsers = new Set(trimmed(s.get('SUDOGRP')).split(/[\s,]+/).filter(Boolean))
    const passwordStates = new Map<string, string>()
    for (const line of lines(s.get('PW'))) {
      const [user, state] = line.split('|')
      passwordStates.set(user, state ?? '?')
    }
    const keyCounts = new Map<string, number>()
    for (const line of lines(s.get('KEYS'))) {
      const [home, count] = line.split('|')
      const user = home === '/root' ? 'root' : home.split('/').pop() ?? home
      keyCounts.set(user, Number(count) || 0)
    }
    return lines(s.get('USERS')).map((line) => {
      const [user, uid, shell] = line.split('|')
      return {
        user,
        uid: Number(uid) || 0,
        shell: shell ?? '',
        sudo: user === 'root' || sudoUsers.has(user),
        passwordState: passwordStates.get(user) ?? '?',
        keyCount: keyCounts.get(user) ?? 0
      }
    })
  }

  async access(id: string): Promise<AccessInfo> {
    const res = await this.ssh.exec(id, ACCESS_COMMAND, { sudo: true, timeoutMs: 60_000 })
    const s = sections(res.stdout)

    const sessions = lines(s.get('WHO')).map((line) => {
      const match = line.match(/^(\S+)\s+(\S+)\s+(.+?)\s+\(([^)]+)\)$/)
      return match ? { user: match[1], tty: match[2], since: match[3], from: match[4] } : { user: line, tty: '', since: '', from: '' }
    })

    // `last` n'existe plus sur Ubuntu 24.10+ (wtmpdb) : on lit les connexions acceptées dans journald.
    const lastLogins = lines(s.get('ACCEPT'))
      .map((line) => {
        const match = line.match(/^(\w{3}\s+\d+\s+\S+).*Accepted (\S+) for (\S+) from (\S+)/)
        if (!match) return null
        return { user: match[3], from: match[4], time: match[1] }
      })
      .filter((entry): entry is { user: string; from: string; time: string } => entry !== null)
      .reverse()

    const failedRecent = lines(s.get('FAIL')).map((line) => {
      const from = (line.match(/from (\S+)/) ?? [])[1] ?? ''
      const user = (line.match(/for (?:invalid user )?(\S+)/) ?? [])[1] ?? ''
      return `${user || 'inconnu'} depuis ${from || '?'}`
    })

    const established = lines(s.get('ESTAB'))
      .filter((line) => line && !/^Netid/i.test(line) && !/^State/i.test(line))
      .map((line) => {
        const cols = line.trim().split(/\s+/)
        return {
          process: (line.match(/users:\(\("([^"]+)"/) ?? [])[1] ?? '—',
          local: cols[4] ?? '',
          remote: cols[5] ?? ''
        }
      })
      .filter((entry) => entry.remote)

    return {
      sessions,
      lastLogins: lastLogins.slice(0, 12),
      failedCount: Number(trimmed(s.get('FAILC'))) || 0,
      failedRecent,
      established
    }
  }

  async updates(id: string): Promise<SecurityUpdatesInfo> {
    const res = await this.ssh.exec(id, UPDATES_COMMAND, { sudo: true, timeoutMs: 60_000 })
    const s = sections(res.stdout)
    return {
      pending: Number(trimmed(s.get('UPG'))) || 0,
      securityPending: Number(trimmed(s.get('SEC'))) || 0,
      autoUpdates: trimmed(s.get('AUTO')) || 'unknown',
      rebootRequired: trimmed(s.get('REBOOT')).includes('yes'),
      lastAutoRun: trimmed(s.get('LAST')) || undefined
    }
  }

  async applySecurityUpdates(id: string): Promise<{ ok: boolean; output: string }> {
    const res = await this.ssh.exec(id, 'DEBIAN_FRONTEND=noninteractive unattended-upgrade -v 2>&1', {
      sudo: true,
      timeoutMs: 900_000
    })
    return { ok: res.code === 0, output: `${res.stdout}${res.stderr}`.trim() || 'Terminé' }
  }
}
