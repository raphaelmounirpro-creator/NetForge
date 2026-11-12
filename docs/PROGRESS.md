# Suivi d'avancement

Push GitHub reporté en fin de projet (consigne du propriétaire) : commits locaux uniquement, CI jamais exécutée sur GitHub.

## Phase 0 — Socle technique : validée par le propriétaire (2026-11-10)

Détail des preuves : commits `6b49de3` à `aff43fc`. Limites restantes : Docker Compose non testé (Docker absent du poste) ; `pnpm db:local` exige un chemin de dépôt court sous Windows.

## Phase 1 — Éditeur et persistance locale : validée par le propriétaire (2026-11-11)

Commit `8ecf05e`. Limites reportées : quota et conflits vérifiés par tests unitaires seulement ; éditeur prévu pour ≥ 1 024 px.

## Phase active : 7 — Commutation avancée et services IP de base

**État : en cours (démarrée le 2026-11-12).** Tranches 1 (VLAN) et 2 (STP) terminées et vérifiées ; tranche 3 (DHCP) en cours.

### Périmètre retenu

La ligne « phase 7 » de la feuille de route (P-01, P-02, P-03, P-06) couvre une dizaine de protocoles : elle est découpée (spécification §17, « ne pas développer un module entier sans découpage »). Chaque tranche est livrée complète (format, moteur, console et formulaires équivalents, observation, documentation de protocole, tests) avant la suivante.

- Dépend de : phases 2 et 3 (moteur Ethernet/ARP/IPv4, console, inspecteur), phase 1 (format et commandes).
- Inclus, dans l'ordre :
  1. **VLAN 802.1Q** : ports d'accès et trunks (VLAN natif, VLAN autorisés), tables MAC par VLAN, diffusion limitée au VLAN, étiquette 802.1Q visible dans l'inspecteur, routage inter-VLAN par sous-interfaces de routeur (« router-on-a-stick »). Format .nfg.json version 5 (migration explicite).
  2. **STP** (802.1D, sous-ensemble pédagogique) : élection de la racine par BPDU, coûts, rôles et états des ports, blocage d'une boucle, reconvergence après une coupure.
  3. **DHCP** : serveur sur routeur (plages, passerelle, durée de bail), postes en adressage automatique, échange DORA dans le journal, table des baux.
  4. **DNS minimal** (si les tranches précédentes sont terminées) : noms enregistrés sur un serveur, résolution par les postes.
- Exclus (restent dans la feuille de route) : RSTP, agrégation, LLDP, sécurité de port, VTP, VLAN voix ; IPv6 (P-02) ; relais DHCP ; HTTP/HTTPS, FTP/TFTP, SMTP/POP3, Syslog, NTP, SSH, SNMP ; traceroute, Wi-Fi et clients applicatifs (P-06).
- Données : aucune donnée personnelle ; projets enrichis (configuration de ports de commutateur, sous-interfaces, puis STP et DHCP).

### Scénarios d'acceptation

| Tranche | Critère | État |
|---|---|---|
| VLAN | Deux postes du même réseau IP mais de VLAN différents ne communiquent pas (l'ARP reste dans son VLAN) | atteint : `vlan.test.ts` (aucune requête ARP reçue par PC1, diffusions limitées au VLAN 20) |
| VLAN | Un même VLAN traverse deux commutateurs par un trunk ; VLAN natif sans étiquette ; VLAN non autorisé bloqué | atteint : `vlan.test.ts` (trames étiquetées sur le trunk seulement, natif sans étiquette, `vlan.not-allowed`) |
| VLAN | Routage inter-VLAN par sous-interfaces : un poste du VLAN 10 joint un poste du VLAN 20 | atteint : `vlan.test.ts`, `vlan.spec.ts` (ping réussi dans le navigateur) |
| VLAN | Tables MAC par VLAN observables ; étiquette 802.1Q dans l'inspecteur ; console et formulaires équivalents | atteint : `vlan.test.ts` (même MAC dans deux VLAN), `cli.test.ts` (documents identiques, configuration rejouée), `vlan.spec.ts` (inspecteur « TPID 0x8100, VID 10 », formulaire puis `show vlans`) |
| VLAN | Projets version 4 migrés : comportement inchangé (tous les ports en VLAN 1) | atteint : migration testée ; 117 tests du moteur antérieurs inchangés ; parcours navigateur existants réussis |
| STP | La boucle de commutation de référence converge sans tempête ; un port bloqué ; le ping réussit ; reconvergence après coupure | atteint : `stp.test.ts` (même boucle interrompue sans STP, convergée avec ; écoute 0 s, apprentissage 15 s, transmission 30 s), `stp.spec.ts` (port bloqué, coupure, ping en échec puis réussi, `show spanning-tree`) |
| DHCP | Un poste obtient adresse et passerelle ; DORA observable ; plage épuisée signalée | ouvert |

### Vérifications de la tranche STP (2026-11-12)

- `pnpm check` : **385 tests** (format 124, moteur 135, interface 71, contrats 2, API 53) et builds réussis ; `pnpm test:e2e` : **25 parcours** (dont `stp.spec.ts`) ; `pnpm test:e2e:accounts` : **5 parcours**.
- Inspection visuelle (Edge, 1440 px) : port bloqué marqué « ⊘ bloqué » sur le canevas, section Spanning Tree du panneau d'exécution.
- Défauts trouvés et corrigés : sections du panneau d'exécution sans nom accessible (reliées à leur titre) ; référence erronée dans un commentaire (valeurs par défaut attribuées à la RFC 4188, qui ne les donne pas) ; modification de STP non protégée dans les évaluations (fonction « switching » couvrant VLAN et STP).

### Vérifications de la tranche VLAN (2026-11-12, Windows 11, Node 26.13.0, pnpm 12.18.0, Edge 157)

- `pnpm check` : lint, typecheck, **368 tests** (format 116, moteur 127, interface 70, contrats 2, API 53) et builds réussis.
- `PLAYWRIGHT_CHANNEL=msedge pnpm test:e2e` : **24 parcours** réussis (dont `vlan.spec.ts`) ; `pnpm test:e2e:accounts` : **5 parcours** réussis.
- Inspection visuelle (Edge, 1440 px) : formulaires de port de switch et de sous-interfaces, canevas annoté. Défaut trouvé et corrigé : étiquettes de port annotées qui couvraient le nom du switch (éloignées du symbole).
- Défauts trouvés par les tests et corrigés : configuration vide d'un équipement ajouté comptée comme changement d'adressage (évaluations) ; ports de switch non protégés par les fonctions autorisées des évaluations (fonction « vlans », correcteur version 2) ; test d'API qui attendait la version 4 du format en dur.

## Phase 6 — Exercices éditables et notes vérifiées : validée par le propriétaire (2026-11-12)

**État : terminée et validée le 2026-11-12, déployée le même jour.** Tous les critères de la phase sont vérifiés localement (moteur, API sur PostgreSQL réel, parcours navigateur). Production : migration additive appliquée à la base Neon par le build de prévisualisation ; prévisualisation puis https://netforge-amber.vercel.app vérifiées (base prête, sécurité inchangée, nouvelles routes protégées : 401 sans session ; pages Parcours, /exercices et /evaluation/… sans erreur ni violation de la politique de contenu dans Edge). Parcours connecté complet non rejoué en production (comptes de test impossibles sans boîte de courrier lisible) : vérifié en local de bout en bout.

### Périmètre retenu

- Dépend de : phase 3 (format d'exercice, critères comportementaux, moteur), phase 5 (comptes vérifiés, API, base, sécurité).
- Inclus :
  - **Éditeur d'exercices** (compte requis) : énoncé, objectif, niveau, topologie initiale copiée d'un projet, fonctions autorisées, étapes (observer, hypothèse, mesure, correction, retest, bilan), critères comportementaux, barème, indices progressifs et pénalité ; validation en direct par le schéma du moteur ; essai en mode entraînement. Exercices enregistrés dans le compte, privés à leur auteur.
  - **Publication en évaluation** : instantané immuable d'une révision, lien non devinable, nombre de tentatives, fermeture par l'auteur.
  - **Passage d'une évaluation** (compte vérifié) : partie publique seulement (sans critères, bonnes réponses, retours, bilan ni indices non demandés) ; indices délivrés et comptés par le serveur ; soumission du projet final et des réponses.
  - **Correction serveur bornée et versionnée** : moteur exécuté par l'API, graine fixe, limites de taille, d'équipements, de critères et d'événements ; dépassement → diagnostic explicite sans note ; résultat immuable avec version du correcteur, révision et empreinte de l'exercice, empreinte de la soumission.
  - Notation en évaluation : hypothèse et mesure par réponse, correction par critères sur le projet soumis, retest par re-simulation du contrôle sur le projet soumis ; l'étape « observer » (démarche, invérifiable a posteriori) n'est pas notée.
- Exclus : classes, rôles formateur et consultation des notes par l'auteur, export des notes (phase 17, J-02) ; édition d'exercices en invité et échange de fichiers d'exercice ; quiz (J-01) ; nouveaux types de critères au-delà du ping et du service optique.
- Données : aucune nouvelle donnée personnelle ; une tentative relie un compte, un instantané d'évaluation, les indices demandés et le résultat.

### Scénarios d'acceptation (spécification §13 et §17)

| Critère | État | Preuve |
|---|---|---|
| Exercice créé dans l'éditeur puis joué | atteint | `evaluations.spec.ts` : création depuis le projet ouvert, hypothèse, critère, indice, enregistrement, essai en entraînement, publication, passage par un élève avec correction à la console, note 30/30 |
| Plusieurs solutions valides acceptées | atteint | route exacte et route par défaut notées au maximum : `evaluation.test.ts` (moteur) et `exercises.e2e.test.ts` (deux élèves, API) |
| Score falsifié côté client rejeté | atteint | corps portant `score`, `result` ou des points refusés (400) sans consommer la tentative ; note recalculée par le serveur (20/70 pour un projet non corrigé) et enregistrée avec les versions |
| Critères privés jamais envoyés au navigateur | atteint | toutes les réponses destinées à l'élève inspectées (évaluation, tentative, indice, note) : ni critères, bonnes réponses, retours, bilan avant la note, ni indices non demandés ; page de l'élève sans critère (parcours navigateur) |
| Diagnostic clair d'une limite d'évaluation | atteint | boucle de commutation soumise : 422 `evaluation.limit-exceeded` (limite, maximum, étape), aucune note, tentative intacte ; message français dans le panneau |
| Versionnement des évaluations | atteint | nouvelle révision republiée : instantanés distincts (révision, empreinte), note passée inchangée ; version du correcteur, du moteur et empreinte de la soumission enregistrées |

### Vérifications exécutées (2026-11-12, Windows 11, Node 26.13.0, pnpm 12.18.0, Edge 157)

- `pnpm check` : lint, typecheck, **343 tests** (format 102, moteur 117, interface 69, contrats 2, API 53 sur PostgreSQL embarqué réel) et builds réussis.
- `PLAYWRIGHT_CHANNEL=msedge pnpm test:e2e` : **23 parcours** réussis ; `pnpm test:e2e:accounts` : **5 parcours** réussis (4 de compte + l'évaluation de bout en bout), pile isolée arrêtée proprement.
- Inspection visuelle réelle (Edge, 1440 et 360 px) : Parcours, éditeur, publications, page de l'évaluation, panneau du laboratoire, confirmation, résultat. Défauts trouvés et corrigés : contrôle de retest par défaut vers la passerelle du poste (réussi sans rien corriger), bilan affiché vide avant la note, « À retenir » répété dans le résultat, libellé « Contrôle du moteur » en double, police à chasse fixe sur les champs de texte libre ; sélecteur ambigu « Indice 1 » / « Retirer l'indice 1 ».
- Défauts trouvés par les tests et corrigés : configuration vide d'un équipement ajouté comptée comme un changement d'adressage ; références d'équipement des exercices plus strictes que les identifiants de projet (projets importés refusés).

### Limites connues

- Exercice local ou évaluation : la topologie initiale (pannes optiques comprises) est envoyée au navigateur, qui exécute la simulation ; un élève déterminé peut lire ces données. Seuls les critères, réponses, retours, bilans et indices non demandés restent sur le serveur (spécification §13).
- L'étape « observer » n'est pas notée en évaluation (démarche invérifiable après coup) ; une hypothèse se joue en une réponse (pas de second essai) ; une correction n'est accordée que si tous ses critères passent.
- L'auteur ne voit que le nombre de tentatives de ses publications, pas les notes ni les élèves (phase 17).
- Les fonctions « simulation » et « console » ne sont pas contrôlées : elles ne modifient pas le projet.


## Phase 5 — Comptes, projets privés et déploiement : validée par le propriétaire (2026-11-12)

**État : terminée le 2026-11-11, validée le 2026-11-12.** Partie locale vérifiée, puis mise en production sur https://netforge-amber.vercel.app (projet Vercel existant, base Neon, courrier Gmail dédié) : prévisualisation et production vérifiées, courrier de validation réel reçu par le propriétaire (dans les indésirables, voir limites).

### Périmètre retenu

- Dépend de : phase 1 (projets, stockage), phase 0 (API, Prisma).
- Inclus : inscription, validation d'adresse (reprise contre un compte précréé), connexion, récupération, sessions révocables, CSRF, en-têtes, limites anti-abus partagées, capture SMTP locale, projets privés avec révisions et copie volontaire des projets locaux, pages de compte (360 px, clavier), déploiement sur le projet Vercel existant.
- Exclus : changement d'adresse et suppression de compte depuis l'interface, second facteur, classes et notes (phases 6 et 17).
- Données : aucune donnée personnelle autre que l'adresse e-mail ; détails dans [securite.md](securite.md).

### Critères de sortie (spécification §14.7 et §17)

| Critère | État | Preuve |
|---|---|---|
| Authentification : adresse vérifiée avant accès privé | atteint | `auth.e2e.test.ts`, `accounts.spec.ts` ; inscription, validation et connexion réelles en production |
| Tests de la section 14.7 | atteints | tableau de [securite.md](securite.md) ; CSRF, origine et cookies revérifiés sur l'adresse déployée |
| Isolation des utilisateurs | atteint (local) | `projects.e2e.test.ts` |
| Sessions : déconnexion, expiration, révocation globale | atteint (local) | `auth.e2e.test.ts` (horloge contrôlée) |
| Sauvegarde et relecture après rechargement et redémarrage | atteint (local) | relecture en base, redémarrage de l'API, navigateur vierge |
| Page de connexion, accès invité, mobile, clavier | atteint | `accounts.spec.ts` (360 px, clavier), captures Edge 1440/1024/360, sombre/clair ; photo du propriétaire (D-047) |
| Courrier de validation réel en production | atteint, avec limite | courrier reçu par le propriétaire depuis l'adresse dédiée, lien de validation fonctionnel ; classé en indésirables |
| Déploiement vérifié (prévisualisation, production) | atteint | deux prévisualisations protégées puis production : voir ci-dessous |

### Vérifications exécutées (2026-11-11, Windows 11, Node 26.13.0, pnpm 12.18.0, Edge 157)

- `pnpm check` (après les corrections du déploiement et D-050) : lint, typecheck, **308 tests** (format 102, moteur 101, interface 60, contrats 2, API 43 sur PostgreSQL embarqué réel) et builds réussis ; `pnpm test:e2e:accounts` relancé après D-050 : 4 parcours réussis.
- `PLAYWRIGHT_CHANNEL=msedge pnpm test:e2e` : **23 parcours** réussis ; `pnpm test:e2e:accounts` : **4 parcours de compte** réussis sur pile isolée (PostgreSQL, courrier, API, interface).
- `pnpm test:perf` : inchangé (calcul 100 équipements et tempête sans tâche longue).
- Parcours réel par l'API locale (`curl`/Node) : inscription, courrier capturé par `pnpm mail:local`, validation, connexion, projet en base, déconnexion.
- Inspection visuelle réelle (Edge) : connexion 1440 px (sombre) et 360 px (clair), erreur de politique, « Vérifiez votre adresse », confirmation, projets du compte. Défauts trouvés et corrigés : en-tête débordant de 192 px à 360 px, jeton de session à rafraîchir après connexion, cookie de session effacé puis reposé dans la même réponse, délai de renvoi qui bloquait un courrier d'un autre type, processus `io_worker` orphelins de PostgreSQL 18 sous Windows, test de session générant une erreur 401 dans la console à chaque visite.

### Mise en production (2026-11-11, D-048, D-049)

Services validés par le propriétaire : Vercel Hobby (projet `netforge` existant, usage personnel non commercial), PostgreSQL Neon formule gratuite (base `neon-bronze-flask`, Frankfurt, sans moyen de paiement), courrier par un compte Gmail dédié. Secrets saisis par le propriétaire dans Vercel ou injectés par l'intégration Neon ; `CSRF_SECRET` généré sur le poste et transmis à Vercel sans affichage, distinct pour Production et Preview.

- **Build Vercel** : installation figée, pnpm 12.18.0 par Corepack, client Prisma généré, 3 migrations appliquées à la base Neon, puis « No pending migrations » aux déploiements suivants (schéma conservé).
- **Prévisualisation** (protégée par l'authentification Vercel, interrogée par `vercel curl`) puis **production** (adresse publique, `curl` ordinaire) : `/api/health/ready` 200 avec la base ; `/api/auth/session` 200 sans compte, `Cache-Control: no-store`, cookie `__Host-nf_pre; Path=/; HttpOnly; SameSite=Lax; Secure` sans `Domain` ; écriture depuis une autre origine sans jeton → 403 `csrf.invalid` ; même origine avec jeton → 401 `auth.invalid-credentials` (CSRF et origine `https://netforge-amber.vercel.app` acceptés) ; route d'API inconnue → 404 `request.not-found` ; pages avec CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP ; routes de l'application servies par `index.html` ; ressources en cache immuable. Fonction exécutée à Frankfurt (`x-vercel-id` … `fra1`).
- **Navigateur réel sur la production** (Edge sans interface) : exercice lancé, ping simulé dans le worker, export téléchargé, vue Optique, page de connexion ; aucune erreur ni violation de la politique de contenu dans la console.
- **Parcours réel du propriétaire** : inscription avec sa propre adresse, courrier reçu, validation et connexion réussies. Compte conservé (pas une donnée de test).
- **Changement demandé par le propriétaire** : mot de passe de 12 caractères au moins, 15 recommandés (D-050). Déployé en production et vérifié sans créer de compte : 11 caractères → `auth.password-too-short`, 12 caractères triviaux → `auth.password-weak` (longueur acceptée) ; nouvelle indication présente dans l'interface servie. Changement de mot de passe depuis le compte connecté non ajouté : le parcours « Mot de passe oublié ? » suffit (choix du propriétaire).
- **Photo de connexion du propriétaire (D-047)** : déployée et vérifiée en production dans Edge (1440, 1024 et 360 px, thèmes sombre et clair) : image adaptée à la largeur, aucun défilement horizontal, aucune erreur ni violation de la politique de contenu ; WebP servi en cache immuable.
- **Défauts trouvés et corrigés** : build exécuté deux fois (Vercel relançait le script `vercel-build`, renommé `build:vercel`) ; script d'installation Linux de PostgreSQL embarqué non autorisé (nécessaire à la CI ; lu puis autorisé) ; `vercel link` ajoutait `.env*` au `.gitignore`, ce qui aurait ignoré les `.env.example` (ajout annulé).

### Limites connues

- Le courrier de validation est arrivé dans les **indésirables** : adresse Gmail neuve sans réputation d'envoi, liens vers un domaine partagé `vercel.app`. Contournements gratuits : « Non spam » et ajout de l'expéditeur aux contacts côté destinataire ; la réputation s'améliore avec l'usage. Une amélioration nette demanderait un domaine propre (payant), écarté par les contraintes du projet. L'interface prévient déjà que la réception n'est pas garantie.
- Prévisualisations et production partagent la même base : une prévisualisation qui contient une nouvelle migration l'applique à la base de production (D-049).
- Non vérifié en production : copie d'un projet local vers le compte et relecture après rechargement (vérifiée en local et dans les parcours de compte) ; récupération du mot de passe par courrier réel.
- Neon a activé par défaut sa propre authentification (« Neon Auth », variables `NEON_AUTH_BASE_URL` et `VITE_NEON_AUTH_URL`) : inutilisée par NetForge, non lue par l'interface, réglage non modifiable après création.


## Phase 4 — Premier laboratoire FTTH : validée par le propriétaire (2026-11-11)

Commit `368d93d`. Détail ci-dessous.

### Périmètre retenu

- Dépend de : phase 2 (projet, éditeur) ; indépendant du moteur à événements (le bilan optique est un calcul statique).
- Inclus : équipements passifs génériques (OLT-16, ONT-1G, tiroir optique ODF-12, coupleurs 1:2 à 1:64, PBO-8, PTO, boîtier d'épissure BPE-12) à ports explicites ; fibres G.652.D et G.657.A2, câble de transport/distribution ou câble court (jarretière, intérieur, raccordement), longueurs en mètres ; connecteurs SC/LC APC/UPC ; compatibilité des connectiques (cuivre/fibre, E-13) ; chemins OLT → ONT et bilan par direction (1 490 nm descendant, 1 310 nm montant) avec contribution de chaque composant, marges, réserve d'ingénierie et limites du profil GPON classe B+ ; photomètre ; pannes simples (coupure, courbure, connecteur sale, épissure défectueuse, incompatibilité de polissage) et interventions de réparation ; exercice local de dépannage.
- Exclus : enregistrement PON (numéro de série), VLAN de service et partage de bande passante, OTDR, XGS-PON (phase 9) ; exports CSV/PDF des bilans (phase 15).
- Scénarios d'acceptation : chemin calculé à la main retrouvé à 0,01 dB ; cascade de coupleurs ; plusieurs branches ; limites de réception (sensibilité, surcharge) ; fibre coupée ; aucun double comptage d'une connexion ; exercice de dépannage terminé.
- Données : valeurs normatives vérifiées (UIT-T G.984.2 annexe A, G.652, G.657, G.671), consignées dans docs/protocols/ftth-bilan-optique.md.

### Critères de sortie (spécification §12 et §17)

| Critère | État | Preuve |
|---|---|---|
| Calculs manuels de référence | atteint | chemin ONT1 calculé à la main (24,974 dB, marge 3,026 dB dans les deux sens) retrouvé à 10⁻⁹ dB près ; contributions élément par élément dans l'ordre de chaque sens (`optics.test.ts`) ; valeurs affichées vérifiées dans le navigateur (e2e « formateur ») |
| Absence de double comptage | atteint | une connexion par extrémité de câble sur un connecteur, une épissure par équipement : 4 connexions, 7 épissures, 2 coupleurs, 6 fibres, chacun une seule fois (`optics.test.ts`) |
| Marges explicables | atteint | puissance reçue au pire cas, seuil (sensibilité + pénalité), marge, marge avant surcharge, budget disponible, réserve conseillée, contribution de chaque élément ; sensibilité insuffisante, surcharge et marge faible testées |
| Cascade, branches, fibre coupée, limites | atteint | coupleurs 1:8 puis 1:4 et trois branches ; coupure (plus de lumière en aval, lumière normale en amont) ; cascade 1:64 + 1:8 sous la sensibilité ; ONT relié directement à l'OLT en surcharge |
| Pannes simples, symptômes seuls pour l'élève | atteint | coupure, courbure, connecteur sale, épissure défectueuse, polissage APC/UPC (sans pénalité inventée) ; onglet Pannes et pertes de panne masqués en exercice (e2e) |
| Photomètre | atteint avec limite | mesure au pire cas, écart au bilan égal à la perte de panne, descendant et montant ; source lumineuse séparée non modélisée |
| Exercice local de dépannage | atteint | « L'abonné sans service » : mesurer, situer, mesurer de proche en proche, inspecter, nettoyer, remesurer, 100/100 (e2e) |
| Compatibilité des connectiques (E-13) | atteint avec limite | cuivre ↔ fibre refusé avec explication ; ports compatibles seuls proposés ; modules SFP reportés |
| Format et migrations | atteint | format v4 (fibres, pannes, catalogue 2) ; migration v3 → v4 et chaîne v1 → v4 testées ; format d'exercice v2 compatible v1 |

### Vérifications exécutées (2026-11-11, Windows 11, Node 26.13.0, pnpm 12.18.0, Edge 157)

- `pnpm check` : lint, typecheck, **268 tests** (format 102, moteur 101, interface 57, contrats 2, API 6) et builds réussis.
- `PLAYWRIGHT_CHANNEL=msedge pnpm test:e2e` : **23 parcours réussis** (dont 3 de la phase 4 : formateur, éditeur, exercice).
- `PLAYWRIGHT_CHANNEL=msedge pnpm test:perf` : seuils respectés (calcul 7 ms pour 100 équipements, aucune tâche longue pendant le calcul ; tempête interrompue sans tâche longue).
- Bilan optique sur un grand PON (456 équipements, 448 chemins) : 7 ms ; mesure au photomètre : 2 ms.
- Inspection visuelle réelle (captures Edge) : vue Optique en exercice (liste des chemins, état sous chaque ONT, bilan, photomètre, inspection, intervention), thèmes sombre et clair, 1440 et 1024 px ; aucun défilement horizontal, aucune erreur console. Défauts trouvés et corrigés : topologie FTTH hors de la zone visible à l'ouverture (ajustement automatique, D-040), bilan illisible dans le panneau étroit (une grandeur par ligne), marge de conception confondue avec l'état réel en exercice (libellé explicite), liste « Équipements du projet » écrasée sous les notes par la palette allongée (sections non compressibles).
- Relecture des références : la note 1 du tableau 2 de G.652 exclut aussi les câbles de raccordement de la valeur 0,40 dB/km ; les catégories de câble ont été corrigées en conséquence et les références recalculées (D-037).

### Limites connues

- Mesures déterministes au pire cas ; affaiblissement identique à 1 310 et 1 490 nm ; épissures par fusion à alignement actif seulement ; ni réflectance, ni OTDR, ni atténuateur.
- Service PON non simulé : un ONT « conforme » a un chemin optique correct, il n'est pas enregistré (phase 9).
- Exercice FTTH : la panne reste lisible dans le fichier exporté (entraînement local, D-038).
- Modules SFP et connectique cuivre détaillée reportés (phases 9 et 12).

## Phase 3 — Observation, CLI et premier exercice : validée par le propriétaire (2026-11-11)

Commits `e868461` et `4860f4c` (rappel quand la simulation est en pause). Détail ci-dessous.

### Périmètre retenu

- Dépend de : phase 2 (moteur, trace structurée, vue Simulation).
- Inclus : inspecteur des décisions et des unités de données (champs modélisés uniquement, correspondance OSI) ; explications à deux niveaux (débutant, technique) produites depuis les faits du moteur ; suivi d'un échange de bout en bout et « Pourquoi ? » sur un écho en échec ; animation des trames issues des événements du moteur (arrêt en pause, rendu statique avec mouvement réduit) ; console d'équipement originale (modes, aide, historique, complétion, erreurs pédagogiques) utilisant les mêmes commandes métier que les formulaires ; outils PC minimaux (ping, configuration IP, table ARP) ; effacement des tables ARP/MAC ; premier exercice local guidé (observer, hypothèse, mesure, correction, nouveau test, explication) dans une page Parcours ; annotations libres (format v3) ; mini-carte et glisser-déposer depuis la palette (reportés de la phase 2).
- Exclus : traceroute et autres outils PC (phase 14) ; éditeur d'exercices et notes vérifiées côté serveur (phase 6) ; comptes (phase 5).
- Scénarios d'acceptation : suivre un écho de bout en bout (journal filtré, inspecteur, animation) ; expliquer l'échec d'un ping au niveau débutant et technique ; configurer une adresse et une route par la console puis par le formulaire et obtenir le même projet ; terminer l'exercice guidé avec plusieurs corrections valides acceptées.
- Données : exercice embarqué validé à l'exécution (Zod), progression locale à l'appareil.

### Critères de sortie (spécification §10, §13, §15.5 et §17)

| Critère | État | Preuve |
|---|---|---|
| Suivre un échange de bout en bout | atteint | « Suivre cet échange » : journal filtré, chemin en cyan sur le canevas, inspecteur, cause remontable ; e2e « suivre un échange » |
| Expliquer un échec | atteint | « Pourquoi ? » mène à la décision fautive ; deux niveaux d'explication pour chaque code ; e2e « expliquer un échec » ; `simulation.test.ts` (toutes les phrases sur des traces réelles) |
| Même comportement par CLI et formulaire | atteint | `cli.test.ts` : documents identiques (adresse, route, configuration PC), mêmes refus ; e2e « console » (adresse saisie à la console visible dans le formulaire) |
| Terminer un exercice local guidé | atteint | « Le retour manquant » : observer, hypothèse, mesure, correction par la console, nouveau test, explication, score 80/100 ; progression conservée au rechargement (e2e) ; corrections multiples acceptées (`exercise.test.ts`) |
| Inspecteur limité aux champs modélisés, couches OSI | atteint | couches Ethernet, ARP, IPv4, ICMP, datagramme recopié ; [docs/protocols](protocols/README.md) |
| Animer uniquement les échanges réels, arrêt en pause, mouvement réduit | atteint | une animation par décision `eth.transmit`, croix sur abandon (`animation.test.ts`) ; arrêt en pause ; rendu immobile avec `prefers-reduced-motion` (D-032) |
| CLI originale à modes, aide, historique, complétion, erreurs pédagogiques | atteint | [docs/cli.md](cli.md) ; 18 tests de l'interpréteur ; e2e |
| Outils PC minimaux | atteint avec limite | `ping`, `ipconfig`, `arp -a`/`-d` ; traceroute reporté |
| Annotations (E-11), mini-carte et glisser-déposer (E-12) | atteint | format v3 (`annotations.test.ts`, migrations) ; e2e « notes libres » et « glisser-déposer » |
| Interface fluide | atteint | mesures inchangées : aucune tâche longue pendant le calcul (100 équipements et tempête) |

### Vérifications exécutées (2026-11-11, Windows 11, Node 26.13.0, pnpm 12.18.0, Edge 157)

- `pnpm check` : lint, typecheck, **215 tests** (format 85, moteur 76, interface 46, contrats 2, API 6) et builds réussis.
- `PLAYWRIGHT_CHANNEL=msedge pnpm test:e2e` : **19 parcours réussis** (phase 1 : 8, phase 2 : 5, phase 3 : 6).
- `PLAYWRIGHT_CHANNEL=msedge pnpm test:perf` : seuils respectés, 3 essais (calcul 4–7 ms, aucune tâche longue pendant le calcul ; import : une tâche de 65–95 ms).
- Inspection visuelle réelle (captures Edge) : inspecteur, niveau technique, échange suivi, animation en cours de saut, « Pourquoi ? », console, page Parcours, guide d'exercice, notes et mini-carte ; thèmes sombre et clair ; 1440 et 1024 px ; aucun défilement horizontal, aucune erreur console. Défauts corrigés : guide d'exercice qui écrasait le canevas (déplacé dans le panneau droit), mini-carte trop envahissante sur un canevas étroit (masquée sous 640 px), invite de console non annoncée (désormais dans le nom accessible du champ).

### Limites connues

- Un seul exercice embarqué ; correction locale, non vérifiée par un serveur (phase 6).
- Pas de traceroute ni de ping depuis un routeur ; console disponible seulement dans la vue Simulation.
- Une note ajoutée au centre de la vue peut recouvrir un équipement (déplaçable à la souris ou aux flèches).
- Bundle web : 908 kB (274 kB gzip) + Worker 145 kB ; la correction des exercices embarque le moteur côté interface. Avertissement Vite conservé.
- Docker Compose toujours non testé ; CI jamais exécutée (pas de push).

### Prochaine action

Validation de la phase 3 par le propriétaire, puis phase 4 (premier laboratoire FTTH : bilan optique, photomètre, pannes simples, exercice de dépannage).

## Phase 2 — Moteur LAN puis routage statique : validée par le propriétaire (2026-11-11)

Commits `5332c15` et `b599f4b` (pertes et erreurs en rouge, demandé pendant la validation). Détail ci-dessous.

### Périmètre retenu

- Inclus : moteur à événements discrets (horloge virtuelle, file stable, générateur à graine, limites) ; Ethernet, commutation (apprentissage, vieillissement, inondation), ARP, IPv4, ICMP (écho, inaccessible, temps dépassé), routage statique ; ping ; coupure de câble injectée ; adaptateur Web Worker ; vue Simulation (barre, journal, pings, tables) ; routes statiques dans l'éditeur (format v2) ; avertissement de boucle de commutation ; scénario de performance de 100 équipements.
- Exclus (phases ultérieures) : animations des paquets, inspecteur de trames, explications à deux niveaux, CLI, outils PC, exercice (phase 3) ; mini-carte et glisser-déposer (reportés en phase 3, D-028) ; VLAN, STP, DHCP, DNS (phase 7) ; routage dynamique (phase 8).

### Critères de sortie (spécification §9 et §17)

| Critère | État | Preuve |
|---|---|---|
| Même sous-réseau, caches vides : ARP puis ICMP | atteint | `lan.test.ts` (ordre des décisions) ; e2e « premier parcours » (LAN construit à la main) |
| Nouveau ping avant expiration : entrée ARP réutilisée | atteint | `lan.test.ts` ; e2e « premier parcours » |
| Destination distante : route et prochain saut appropriés | atteint | `routing.test.ts` (passerelle, deux routeurs, plus long préfixe) ; e2e « routage statique » |
| Destination distante sans route ni passerelle : échec expliqué | atteint | `routing.test.ts` (PC sans passerelle, passerelle hors réseau, routeur sans route + ICMP) ; e2e « panne de câble » |
| Aller possible, retour impossible : cause identifiable | atteint | `routing.test.ts` (chez la destination et chez un routeur) ; e2e : « R2 abandonne le paquet : aucune route ne correspond à 10.0.1.10… » |
| Lien déconnecté : aucune transmission | atteint | `lan.test.ts` (câble absent, coupé, trame perdue en transit) ; e2e « panne de câble » |
| Réinitialisation puis scénario identique : même trace | atteint | `determinism.test.ts` (même graine, rejeu du journal des commandes, ordre du document) ; `host.test.ts` (réinitialisation) |
| Apprentissage et vieillissement MAC, destination inconnue, expiration ARP, TTL, sélection des routes | atteint | fiches [docs/protocols](protocols/README.md) et tests associés ; expirations testées en temps virtuel |
| Pertes et erreurs mises en évidence (demande du propriétaire, 2026-11-11) | atteint | journal et bilans de ping en rouge avec symbole « ✕ » et texte, filtre « Pertes et erreurs uniquement » ; `simulation.test.ts` (classement sur des traces réelles), e2e « routage statique » |
| Caches et tables observables | atteint | panneau « État d'exécution » (interfaces, table MAC, cache ARP, résolutions en cours, table de routage avec routes inactives) ; e2e |
| Trace structurée | atteint | événement, cause, instant, équipement, port, échange, code stable, paramètres, unité de données ; phrase française pour chaque code (`simulation.test.ts` de l'interface, sur des traces réelles) |
| Limites d'exécution | atteint | interruption propre et expliquée (événements en attente, total, temps simulé) ; budget de calcul de « Terminer » ; journal affiché limité avec compteur |
| Absence de blocage de l'interface | atteint | moteur dans un Web Worker ; aucune tâche longue (> 50 ms) du fil principal pendant le calcul, sur le build de production (mesures ci-dessous) |
| Deux sous-étapes : LAN puis deux sous-réseaux via routeur | atteint | scénarios `lanScenario`, `routedScenario`, `twoRoutersScenario` (packages/engine/src/scenarios.ts) |
| Modification pendant la simulation : arrêt et réinitialisation | atteint | D-022 ; e2e « routage statique » (bannière, commandes bloquées, réinitialisation avec la nouvelle configuration) |
| Une seule simulation active | atteint | D-027 ; test unitaire de mise en pause au changement de projet |

### Vérifications exécutées (2026-11-11, Windows 11, Node 26.13.0, pnpm 12.18.0, Edge 157.0.4341.42)

- `pnpm check` : lint, typecheck, **173 tests** (format 61, moteur 63, interface 41, contrats 2, API 6) et builds réussis.
- `PLAYWRIGHT_CHANNEL=msedge pnpm test:e2e` : **13 parcours réussis** (8 de la phase 1, 5 de simulation).
- `PLAYWRIGHT_CHANNEL=msedge pnpm test:perf` : 2 mesures réussies, répétées 5 fois à la suite (seuils ci-dessous).
- Inspection visuelle réelle (captures Edge) de la vue Simulation : thèmes sombre et clair, 1440 et 1024 px, aucun défilement horizontal, aucune erreur console. Défauts trouvés et corrigés : tables trop larges pour le panneau, libellés de câbles tronqués, message « ping programmé » persistant, zoom absent de la barre d'outils, coupure de câble sans effet visible en pause (D-025), journal à colonnes trop étroites à 1024 px.
- Sources des fiches protocoles vérifiées en ligne le 2026-11-11 (RFC 826, 792, 894, 1122, 1812, 2644, 4188, 7042 ; documentation Microsoft de `ping` ; code de référence xoshiro128**).

### Mesures de performance (M-11) — première mesure et seuils

Poste de référence : AMD Ryzen 5 5600X (12 fils), 16 Go, Windows 11, Edge 157 (Playwright, sans interface), Node 26.13.0. Mesures sur le **build de production** servi par `vite preview`, une à la fois. Scénario versionné `performanceScenario` : 100 équipements (1 switch de cœur, 9 switches d'accès, 90 PC), 99 liens, un réseau /24. Tâche longue = tâche du fil principal de plus de 50 ms (API Long Tasks).

| Mesure | Charge | Mesuré (5 essais) | Seuil retenu |
|---|---|---|---|
| Calcul du moteur dans le Worker | 8 pings × 4 échos, caches vides (1 112 événements) | 4–6 ms | < 100 ms |
| Durée réelle de « Terminer les échanges » | idem | 0,12–0,14 s | < 1 s |
| Tâche longue du fil principal pendant le calcul | idem | aucune | < 100 ms |
| Intégration d'un lot dans l'interface | idem | ≤ 1 ms | — |
| Import du projet et chargement de la vue Simulation | une fois par chargement | ≤ 0,46 s ; une tâche de 74–109 ms à l'import | < 2 s ; < 300 ms |
| Tempête de diffusion jusqu'à la limite | boucle de 3 câbles, 92 711 événements | calcul 0,19–0,21 s ; durée 0,34–0,45 s ; aucune tâche longue | < 2 s ; < 3 s ; < 100 ms |
| Moteur seul (Node, `pnpm perf:engine`, médiane de 5) | 8 pings × 4 / 90 pings × 4 (12 510 événements) / tempête | 4,9 ms / 19,9 ms / 232 ms | indicatif |

Démarche : les premières mesures, faites sur le serveur de développement, relevaient des tâches de 392 ms (100 équipements) et 531 ms (tempête). Masquer le journal les faisait disparaître : rendu du journal à chaque lot, index des noms recalculé, canevas redessiné (corrigés, D-026). Un profil CPU a ensuite montré que le reste venait du mode développement de React : les seuils sont donc mesurés sur le build de production. Tris par nom et formatage des nombres utilisent désormais des comparateurs et formateurs partagés.

### Limites connues

- Import d'un projet de 100 équipements : une tâche d'environ 0,1 s (rendu initial du canevas), une seule fois par chargement ; plus lent en mode développement.
- Journal : 2 000 décisions conservées, 100 rendues d'emblée (bouton pour en afficher plus) ; le moteur calcule toujours tout.
- Durées de vie ARP fixes (PC 60 s, routeur 4 h) et délais forfaitaires documentés ; pas de STP, VLAN, DHCP ni routage dynamique.
- Le prochain saut d'une route statique doit être directement connecté (pas de résolution récursive) ; une route par destination.
- Les mesures de performance dépendent du poste : elles ne font pas partie de la CI.
- Docker Compose toujours non testé ; CI jamais exécutée (pas de push).
- Bundle web : 801 kB (243 kB gzip) + Worker 143 kB, avertissement Vite conservé.

### Prochaine action

Validation de la phase 2 par le propriétaire, puis phase 3 (observation : animations issues des événements, inspecteur, explications débutant/technique, CLI, outils PC, premier exercice ; mini-carte).
