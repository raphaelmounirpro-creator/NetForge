# Suivi d'avancement

Push GitHub reporté en fin de projet (consigne du propriétaire) : commits locaux uniquement, CI jamais exécutée sur GitHub.

## Phase 0 — Socle technique : validée par le propriétaire (2026-11-10)

Détail des preuves : commits `6b49de3` à `aff43fc`. Limites restantes : Docker Compose non testé (Docker absent du poste) ; `pnpm db:local` exige un chemin de dépôt court sous Windows.

## Phase active : 1 — Éditeur et persistance locale

**État : terminée localement, en attente de validation du propriétaire.**

### Périmètre retenu

- Inclus : PC, Switch S-24, Routeur R-200 ; liens ; IPv4 (adresse, masque, passerelle des PC) ; déplacement, suppression, zoom, annuler/rétablir ; enregistrement automatique IndexedDB ; export/import `.nfg.json` ; concurrence entre onglets ; navigation Projets/Laboratoire ; vues Topologie et Configuration.
- Exclus (phases ultérieures) : simulation et vue Simulation (2), routes statiques (2), annotations et CLI (3), connectiques multiples (4), comptes (5).

### Critères de sortie

| Critère | État | Preuve |
|---|---|---|
| PC, switch, routeur avec ports | atteint | catalogue `packages/project/src/catalog.ts` ; e2e « parcours invité » |
| Liens valides uniquement | atteint avec limite | refus port occupé/inexistant/même équipement (tests unitaires) ; compatibilité de connectique reportée (D-020) |
| Configuration IPv4 validée | atteint | `ipv4.test.ts`, `commands.test.ts` ; e2e « saisie invalide » ; [fiche](protocols/ipv4-adressage.md) |
| Déplacements, suppression, annuler/rétablir | atteint | e2e « canevas » (glisser à la souris) et « annuler et rétablir au clavier » ; tests du magasin |
| Sauvegarde automatique, états visibles | atteint | états « Modifications non enregistrées / Enregistrement… / Enregistré localement / Erreur / Conflit / Lecture seule » ; tests du service |
| Import/export validé | atteint | `io.test.ts` (version future, JSON étranger, champ inconnu, `__proto__`, profondeur, taille, références) ; e2e export puis réimport |
| Aller-retour sans perte de configuration | atteint | unitaire (`parseNfgText(serializeNfg(doc))` identique) ; e2e (topologie, configurations et disposition identiques après réimport) |
| Import invalide sans perte du projet courant | atteint | unitaire (stockage et projet inchangés) ; e2e (refus expliqué, projet toujours présent) |
| Récupération locale | atteint avec limite | e2e : rechargement → projet et onglets rouverts ; enregistrement immédiat quand l'onglet est masqué. Une fermeture brutale dans les 400 ms suivant une modification peut perdre cette dernière modification |
| Distinction données persistantes / état d'exécution | atteint | format sans état d'exécution ni session (D-016) ; sélection, vue, zoom et historique hors document |
| Aucune fausse simulation | atteint | aucune vue ni barre de simulation avant le moteur |
| Navigation et composants de la section 15 | atteint avec limite | Projets/Laboratoire, onglets de projets et de vues, panneaux repliables ; Parcours/Ressources absents faute de contenu |
| État conservé entre les vues | atteint | e2e « la sélection et le projet sont conservés » |
| Fermeture sûre des projets | atteint avec limite | enregistrement avant fermeture, refus silencieux impossible (unitaire) ; boîte « Exporter puis fermer » non couverte par un test navigateur (nécessite une panne de stockage) |
| Édition concurrente entre onglets | atteint | e2e deux onglets (lecture seule puis prise de main) ; conflit de révision (unitaire) |

### Vérifications exécutées (2026-11-10, Windows 11, Node 26.13.0, pnpm 12.18.0, Edge)

- `pnpm check` : lint, typecheck, **65 tests** (moteur 5, contrats 2, projet 38, interface 14, API 6) et builds réussis.
- `PLAYWRIGHT_CHANNEL=msedge pnpm test:e2e` : **8 parcours réussis**.
- Inspection visuelle réelle (captures Edge) : topologie de deux sous-réseaux reliés par un routeur, thèmes sombre et clair, 1440 et 1024 px, page Projets ; 768 px (message d'écran étroit, barre d'outils repliée sur deux lignes). Aucun défilement horizontal, aucune erreur console. Défauts trouvés et corrigés : étiquettes de port masquées, masque tronqué, libellé sur deux lignes, exemple grisé trompeur, barre d'outils tronquée à 768 px.
- Défaut de sécurité trouvé par les tests et corrigé : une clé `__proto__` dans un import était acceptée (désormais refusée partout).

### Limites connues

- Bundle web de 746 kB (227 kB gzip), surtout Konva : avertissement Vite conservé ; optimisation à mesurer avec le scénario de 100 équipements (phase 2).
- Éditeur prévu pour ≥ 1 024 px ; consultation seulement en dessous.
- Erreurs de quota et conflits vérifiés par tests unitaires (dépôt simulé), pas provoqués dans un vrai navigateur.
- Docker Compose toujours non testé ; CI jamais exécutée (pas de push).

### Prochaine action

Validation de la phase 1 par le propriétaire, puis phase 2 (moteur LAN Ethernet/ARP/IPv4/ICMP, puis routage statique).
