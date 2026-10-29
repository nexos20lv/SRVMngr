/** Helpers de quoting POSIX + construction de commandes (aucune dépendance Electron). */

export function shQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

/**
 * Enveloppe une commande dans `sudo -S` quand un mot de passe sudo est fourni.
 * Le mot de passe est passé via stdin (printf) pour ne jamais apparaître dans `ps`.
 */
export function withSudo(command: string): string {
  return `sudo -S -p '' bash -c ${shQuote(command)}`
}

/** Extrait la sortie utile d'une commande privilégiée (retire l'éventuel bruit sudo). */
export function stripSudoNoise(text: string): string {
  return text.replace(/^\[sudo\][^\n]*\n?/gm, '').replace(/^sudo: unable to resolve host[^\n]*\n?/gm, '')
}

export const MARK = '##SRV##'
