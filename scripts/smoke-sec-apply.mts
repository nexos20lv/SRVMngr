/** Teste les actions de sécurité MUTANTES sur le VPS Lyc, avec retour arrière systématique. */
import { readFileSync } from 'node:fs'
import { SshManager } from '../src/main/ssh-manager'
import { Remote } from '../src/main/remote'
import { SecurityManager } from '../src/main/security'
import type { HostConfig } from '../src/shared/types'

const seed = JSON.parse(readFileSync(new URL('../hosts.seed.json', import.meta.url), 'utf8')) as HostConfig[]
const host: HostConfig = { ...seed[1], id: 'apply-test' } // VPS Lyc
const ssh = new SshManager()
const remote = new Remote(ssh)
const security = new SecurityManager(ssh, remote)
ssh.register(host)

let failures = 0
const check = (label: string, ok: boolean, detail?: unknown): void => {
  if (!ok) failures += 1
  console.log(`${ok ? '✓' : '✗'} ${label}${detail !== undefined ? ` — ${String(detail).slice(0, 300)}` : ''}`)
}

const maxtries = async (): Promise<string> => {
  const res = await ssh.exec(host.id, 'sshd -T | grep -i "^maxauthtries"', { sudo: true, timeoutMs: 20_000 })
  return res.stdout.trim()
}

console.log(`=== ${host.name} (${host.host}) ===`)

// 1. garde-fou : le panel se connecte par mot de passe, couper le mot de passe doit être refusé
const before = await maxtries()
check('MaxAuthTries initial', Boolean(before), before)

try {
  await security.applySshHardening(host.id, { disablePasswordAuth: true, disableRootLogin: false, maxAuthTries: 4 })
  check('garde-fou mot de passe (doit lever une erreur)', false, 'aucune erreur levée !')
} catch (err) {
  check('garde-fou mot de passe', err instanceof Error && /clé privée/.test(err.message), err instanceof Error ? err.message : err)
}

// 2. durcissement sûr : limite de tentatives seulement
const applied = await security.applySshHardening(host.id, {
  disablePasswordAuth: false,
  disableRootLogin: false,
  maxAuthTries: 3
})
check('application MaxAuthTries 3', applied.ok, applied.output)
const after = await maxtries()
check('sshd -T reflète la valeur', after.includes('3'), after)

const svc = await ssh.exec(host.id, 'systemctl is-active ssh || systemctl is-active sshd', { sudo: true, timeoutMs: 15_000 })
check('ssh toujours actif après reload', /active/.test(svc.stdout), svc.stdout.trim())

const reconnect = await ssh.exec(host.id, 'echo ok', { timeoutMs: 15_000 })
check('connexion panel toujours fonctionnelle', reconnect.stdout.trim() === 'ok', reconnect.stdout.trim())

// 3. retour arrière
const reverted = await security.revertSshHardening(host.id)
check('retrait du durcissement', reverted.ok, reverted.output)
const restored = await maxtries()
check('valeur d’origine restaurée', restored === before, `${before} → ${restored}`)

// 4. pare-feu : autoriser puis retirer un port de test
const allow = await security.firewallAction(host.id, 'allow', { port: 9999, proto: 'tcp' })
check('ufw allow 9999/tcp', allow.ok, allow.output)
const fw = await security.firewall(host.id)
check('règle visible', fw.rules.some((rule) => rule.to.includes('9999')), fw.rules.map((r) => r.to).join(', '))
const del = await security.firewallAction(host.id, 'delete', { rule: '9999/tcp' })
check('ufw delete 9999/tcp', del.ok, del.output)
const fw2 = await security.firewall(host.id)
check('règle retirée', !fw2.rules.some((rule) => rule.to.includes('9999')), `${fw2.rules.length} règles restantes`)

// 5. validation des clés
try {
  await security.addKey(host.id, 'root', 'pas-une-cle')
  check('clé invalide rejetée', false, 'aucune erreur levée !')
} catch (err) {
  check('clé invalide rejetée', true, err instanceof Error ? err.message : err)
}

console.log(`\n${failures === 0 ? 'TOUT OK' : `${failures} échec(s)`}`)
process.exit(failures === 0 ? 0 : 1)
