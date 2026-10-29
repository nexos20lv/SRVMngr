# SRV Mngr — panneau de contrôle multi-VPS

Application Electron (macOS / Windows / Linux) pour piloter tous tes serveurs depuis une seule fenêtre :
métriques temps réel, services systemd, Docker, sites nginx, processus, explorateur de fichiers,
journaux et terminal SSH interactif.

Aucun agent à installer côté serveur : tout passe par SSH (et sudo quand c'est nécessaire).

---

## 1. Démarrage

```bash
npm install
npm run dev
```

L'application **démarre vide** : on ajoute ses serveurs avec le bouton « + » de la barre latérale.
Les identifiants sont chiffrés par le trousseau du système et rangés dans
`~/Library/Application Support/srvmngr/hosts.json` (macOS), `%APPDATA%\srvmngr\hosts.json` (Windows),
`~/.config/srvmngr/hosts.json` (Linux), avec des droits `600`.

> **Sécurité** — aucun identifiant n'est embarqué dans les installeurs (`electron-builder.yml` ne copie
> plus de fichier de configuration). En développement uniquement, un `hosts.seed.json` placé à la racine
> du projet est importé au premier lancement s'il existe ; il contient des mots de passe **en clair**,
> il est exclu de git et ne doit jamais être publié. La CI échoue si un tel fichier se retrouve dans un
> bundle (`package-check`).

## 2. Ce que fait chaque onglet

| Onglet | Contenu | Actions |
| --- | --- | --- |
| **Vue d'ensemble** | CPU / RAM / disque / réseau, charge, température, disques détaillés, infos système, top processus, alertes (> 85 % disque, > 90 % RAM, charge > 1,5 × cœurs) | rafraîchissement automatique 3 s |
| **Services** | toutes les unités systemd avec état, description et démarrage auto | start / stop / restart, activer/désactiver au boot, journaux par unité |
| **Docker** | conteneurs (état, CPU, RAM, ports), projets compose, images | start / stop / restart, suppression, logs, auto-refresh 10 s |
| **Sites web** | sites nginx (disponibles + actifs) : domaines, ports, racine, proxy, PHP-FPM, SSL | créer un site (statique / PHP / proxy), éditer la config, activer/désactiver, supprimer, obtenir un certificat SSL |
| **Processus** | liste triable par CPU / RAM / PID avec utilisateur et uptime | envoi de signal (TERM, KILL, HUP, INT) |
| **Fichiers** | navigation complète en SFTP-like via sudo, taille, droits, propriétaire | éditer et enregistrer, upload, download, renommer, supprimer, créer un dossier |
| **Journaux** | `journalctl` global ou par unité, filtre texte, auto-refresh | 100 → 2000 lignes |
| **Terminal** | vrai shell SSH (xterm.js, 256 couleurs, redimensionnement) | reconnexion à la demande |

### Boîte à outils (menu « Outils » de la barre d'onglets)

| Outil | Contenu | Actions |
| --- | --- | --- |
| **Base de données** | bases MariaDB/MySQL, tables, tailles, lignes | console SQL (résultats en tableau), export `.sql.gz` dans `/root/srvmngr-dumps` |
| **Certificats SSL** | certificats Let's Encrypt, domaines, expiration, jours restants | renouveler un certificat ou tous |
| **Fail2ban** | jails, IP actuellement bannies, total | débannir une IP, en bannir une manuellement |
| **Tâches cron** | crontab root + `/etc/cron.d`, planification lisible | éditeur de crontab complet |
| **Maintenance** | répartition du disque, mises à jour APT, taille des journaux, espace Docker récupérable | upgrade système, vacuum journal, prune Docker, autoremove, clean APT |
| **Ports réseau** | sockets en écoute avec processus et portée (public / local) | filtre « exposés uniquement » |
| **Sécurité** | audit scoré, SSH, pare-feu, comptes, connexions, mises à jour (voir ci-dessous) | durcir SSH, gérer ufw, ajouter des clés, appliquer les MAJ |

### Sécurité en détail

L'onglet **Sécurité** (menu Outils) est découpé en six volets :

- **Audit** : 11 contrôles pondérés (mot de passe SSH, root, MaxAuthTries, clés, pare-feu, fail2ban,
  mises à jour de sécurité, MAJ automatiques, comptes sans mot de passe, UID 0, fichiers `world-writable`)
  avec score sur 100 et pénalité affichée par contrôle. Un clic sur une ligne ouvre le volet concerné.
- **SSH** : configuration effective lue avec `sshd -T` (le fichier réel, pas les commentaires), empreintes des
  clés autorisées par compte, ajout de clé publique, et durcissement en un clic : refus des mots de passe,
  blocage de root, `MaxAuthTries`. Le tout est écrit dans `/etc/ssh/sshd_config.d/00-srvmngr.conf`
  (sauvegarde dans `/root/srvmngr-backups`), testé par `sshd -t`, rechargé, puis **vérifié** : si une autre
  directive gagne (sshd garde la première valeur rencontrée) le panel indique le fichier fautif. En cas
  d'échec du test, le fichier est supprimé et sshd remis dans son état d'origine. Le panel refuse de couper
  le mot de passe ou root s'il se connecte lui-même par mot de passe (il perdrait l'accès).
- **Pare-feu** : état ufw, politique par défaut, règles avec action et source, ajout/suppression de règle.
  `Activer` autorise d'abord le port SSH courant (lu dans `sshd -T`) puis applique « deny incoming / allow
  outgoing ». Si nftables ou iptables sont utilisés à la place, le panel l'indique en lecture seule et
  propose d'installer ufw.
- **Comptes** : utilisateurs UID 0 ou ≥ 1000, shell, appartenance à sudo, état du mot de passe
  (`P` défini, `L` verrouillé, `NP` vide) et nombre de clés.
- **Accès** : sessions ouvertes, connexions acceptées des 14 derniers jours (journald, car `last` a disparu
  d'Ubuntu 24.10+), échecs d'authentification sur 24 h, sockets établis vus par `ss`.
- **Mises à jour** : paquets en attente, dont sécurité, état de `unattended-upgrades`, redémarrage requis,
  et exécution de `unattended-upgrade -v` avec sa sortie.

La vue **Flotte** ajoute un bouton **Auditer** qui lance l'audit sur tous les serveurs en ligne en parallèle
et affiche le score moyen, les points critiques et les avertissements de chacun.

### Gestion des sites en détail

- **Créer** : domaine(s), port, type (statique, PHP avec socket FPM détecté automatiquement, ou reverse proxy
  avec WebSocket et `X-Forwarded-*`), racine web et page d'accueil optionnelle. Le fichier est écrit dans
  `sites-available`, lié dans `sites-enabled`, puis `nginx -t` + reload ; en cas d'erreur tout est annulé.
- **Éditer** : éditeur de configuration complet, sauvegarde horodatée (`.bak-<timestamp>`) avant écriture,
  test et rechargement ; si nginx refuse, le bouton « Restaurer la sauvegarde » remet la version précédente.
- **Activer / désactiver** : manipulation du lien symbolique puis test + reload.
- **Supprimer** : copie de sécurité dans `/root/srvmngr-backups`, suppression du lien et du fichier (les
  fichiers du site ne sont pas touchés).
- **SSL** : `certbot --nginx` en mode non interactif avec redirection HTTP→HTTPS, sortie affichée en direct.
- **Fichiers** : ouvre directement l'explorateur sur la racine du site.

Vue **Flotte** (écran d'accueil) : une carte par serveur (jauges + sparkline), totaux RAM/CPU,
compteur d'alertes et **exécution d'une commande sur tous les serveurs en parallèle**.

Raccourcis : double-clic sur un serveur dans la barre latérale pour éditer sa connexion.

## 3. Connexions

Chaque serveur accepte :

- mot de passe SSH **ou** clé privée (PEM / OpenSSH + passphrase) ;
- un **mot de passe sudo** séparé : indispensable quand l'utilisateur SSH n'est pas root
  (Docker, `systemctl start/stop`, nginx, fichiers système). Le mot de passe est passé via `stdin`
  (`sudo -S`), il n'apparaît donc jamais dans `ps`.
- un bouton **Tester la connexion** avant d'enregistrer.

Stockage : `hosts.json` chiffré par `safeStorage` (trousseau macOS / DPAPI Windows / libsecret Linux),
permissions `0600`. Le renderer n'a jamais accès aux secrets : il ne reçoit que des indicateurs
(`hasPassword`, `hasSudo`).

## 4. Construire l'application

```bash
npm run dist:mac     # .dmg + .zip  → release/
npm run dist:win     # NSIS + portable (à lancer depuis Windows)
npm run dist:linux   # AppImage
```

`electron-builder.yml` définit les cibles. **Aucun identifiant n'est embarqué** : les ressources de
l'app ne contiennent que le code, et `hosts.seed.json` n'est lu qu'en développement (`app.isPackaged`
vaut `false`). Les serveurs s'ajoutent dans l'application, ou s'importent depuis une sauvegarde
`hosts.json` que tu fournis toi-même.

Les binaires ne sont pas signés : au premier lancement macOS demandera *Clic droit → Ouvrir*.

### Intégration continue (GitHub Actions)

- **`.github/workflows/ci.yml`** — sur chaque push / pull request : `npm ci`, `npm run typecheck`,
  `npm run build`, puis un packaging macOS non signé (`--dir`) qui **échoue si un fichier `*.seed.json`
  se trouve dans le bundle**. C'est le garde-fou contre une fuite d'identifiants.
- **`.github/workflows/release.yml`** — sur un tag `v*` : build des trois plateformes (dmg/zip macOS,
  NSIS + portable Windows, AppImage Linux), vérification anti-seed des artefacts, puis publication
  automatique dans la GitHub Release avec notes générées :

  ```bash
  git tag v1.0.0 && git push origin v1.0.0
  ```

  Les installeurs sont des artefacts de Release, jamais des fichiers du dépôt (`*.dmg`, `*.zip`,
  `*.exe`, `*.AppImage` sont dans `.gitignore`). Le runner `macos-latest` produit un binaire arm64 ;
  pour un Mac Intel, ajoute un job `macos-13` dans la matrice.

## 5. Architecture

```
src/
├── shared/            types partagés + contrat de l'API IPC
├── main/              processus principal (Node)
│   ├── ssh-manager.ts pool de connexions SSH (une par hôte, keepalive 20 s)
│   ├── metrics.ts     commande d'échantillonnage unique + parsing /proc, df, ps
│   ├── parsers.ts     systemd, docker (JSON), processus, fichiers, infos système
│   ├── sites.ts       gestion nginx : lecture, création, édition, activation, SSL
│   ├── tools.ts       bases de données, certificats, fail2ban, cron, ports, maintenance
│   ├── remote.ts      opérations métier (services, docker, fichiers, nginx…)
│   ├── metrics-service.ts  polling 3 s + diffusion au renderer
│   ├── store.ts       persistance chiffrée des hôtes
│   └── ipc.ts         handlers typés, retour { ok, data } / { ok, error }
├── preload/           contextBridge : API `window.srv` minimale
└── renderer/          React 19 + Vite (aucun accès Node)
```

Choix techniques :

- **Une seule connexion SSH par serveur**, réutilisée par tous les canaux (exec, shell, fichiers).
- **Une seule commande par échantillon** de métriques (lecture de `/proc`, `df`, `ps`) : ~10 ms de CPU
  par serveur toutes les 3 s.
- Calcul du CPU par delta de `/proc/stat`, débit réseau par delta de `/proc/net/dev`.
- Après **3 échecs consécutifs**, le polling s'arrête pour ne pas marteler SSH (fail2ban côté serveur) ;
  l'UI propose alors « Reconnecter ».
- `contextIsolation: true`, `nodeIntegration: false`, navigation externe bloquée, CSP locale.

## 6. Dépannage

| Symptôme | Cause / solution |
| --- | --- |
| `permission denied while trying to connect to the docker API` | renseigne le mot de passe sudo, ou ajoute l'utilisateur au groupe `docker` |
| `sudo: a password is required` | mot de passe sudo manquant ou erroné |
| `Accès refusé : /etc/...` dans Fichiers | active le mode **root** (sudo) en haut de l'onglet |
| Serveur « hors ligne » | vérifie le VPN (Netmaker/Tailscale) : les IP `10.66.0.x` ne sont joignables que connecté |
| Terminal vide | onglet Terminal → « Reconnecter » |

## 7. Vérification

```bash
npm run typecheck    # TS main + renderer
npm run build        # bundle production
npm run smoke        # connexion réelle + métriques/services/docker/nginx/fichiers (lit hosts.seed.json)
npm run smoke:tools  # sites (création/édition/suppression) + bases de données + certs + fail2ban + cron + ports
npm run smoke:security  # audit, sshd -T, pare-feu, comptes, connexions, mises à jour sur tous les hôtes
npm run smoke:security:apply  # durcissement SSH + règle ufw de test, avec retour arrière vérifié
```

`smoke:security:apply` n'agit que sur le **deuxième** serveur du seed : il applique `MaxAuthTries 3`, vérifie
que `sshd -T` le prend en compte, retire le fichier, contrôle le retour à la valeur d'origine, ajoute puis
supprime une règle ufw sur le port 9999, et vérifie qu'une clé invalide est rejetée.

`smoke:tools` crée un site de test (`srvmngr-smoke`, port 18081) sur le **deuxième** serveur du seed,
le désactive, le réactive, le supprime et nettoie `/tmp` — utile pour valider une machine avant de s'en servir.
