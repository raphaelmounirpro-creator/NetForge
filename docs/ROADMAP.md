# Feuille de route et matrice de couverture

Statuts : **prévu**, **en cours**, **disponible**, **disponible avec limites**, **retiré par décision explicite**. Une exigence reportée reste ici ; rien n'est supprimé silencieusement. Avant chaque phase : préciser dépendances, inclusions, exclusions, scénarios d'acceptation et données.

## Phases

| Phase | Contenu | Dépend de |
|---|---|---|
| 0 | Socle technique, documentation, CI | — |
| 1 | Éditeur de topologie et persistance locale (invité) | 0 |
| 2 | Moteur LAN (Ethernet/ARP/IPv4/ICMP) puis routage statique | 1 |
| 3 | Observation, explications, CLI, outils PC, premier exercice | 2 |
| 4 | Premier laboratoire FTTH (bilan optique, photomètre, pannes) | 2 |
| 5 | Comptes, projets privés, sécurité, déploiement | 1 |
| 6 | Exercices éditables et notes vérifiées côté serveur | 3, 5 |
| 7 | Services IP et commutation avancée (DHCP, DNS, VLAN, STP…) | 3 |
| 8 | Routage dynamique et redondance | 7 |
| 9 | FTTH/PON avancé et OTDR | 4 |
| 10 | NG Firewall | 8 |
| 11 | Cloud Manager simulé | 7, 10 |
| 12 | Cuivre et câblage physique | 3 |
| 13 | Téléphonie et xDSL | 7, 12 |
| 14 | Supervision, captures, PCAP, calculateurs | 3 |
| 15 | Documentation technique et métré | 12, 9 |
| 16 | Automatisation et cybersécurité défensive | 7, 10 |
| 17 | Classes, partage et collaboration | 6 |
| 18 | PWA hors ligne, accessibilité, tutoriel, licence | toutes |

## Matrice de couverture

### Socle (phase 0)

| ID | Exigence | Phase | Statut | Dépend | Critère vérifiable |
|---|---|---|---|---|---|
| S-01 | Monorepo pnpm, TypeScript strict, lint/typecheck/test/build | 0 | disponible | — | `pnpm check` réussit depuis un clone propre |
| S-02 | CI minimale (vérifications + migrations sur PostgreSQL) | 0 | disponible avec limites | S-01 | Workflow présent ; exécution sur GitHub après le push de fin de projet |
| S-03 | API `/api/health` (vivacité) et `/api/health/ready` (préparation) | 0 | disponible | S-01 | 200 / 503 selon la base, tests e2e |
| S-04 | PostgreSQL local (Docker Compose ou embarqué) + première migration utile | 0 | disponible avec limites | S-03 | `pnpm db:migrate` puis `db:status` à jour ; Docker non testé sur le poste de référence |
| S-05 | Interface lancée sans API ni base | 0 | disponible | S-01 | `pnpm dev:web` seul ; le laboratoire invité n'appelle pas l'API |
| S-06 | Jetons de design, composants de base, `docs/DESIGN.md` | 0 | disponible | — | Contrastes mesurés, rendu vérifié à 1440/768/360 px |
| S-07 | Faisabilité documentaire Vercel/NestJS/PostgreSQL | 0 | disponible | — | `docs/DECISIONS.md` D-012 |
| S-08 | Temps simulé : unité unique documentée | 0 | disponible | — | Tests de conversion et de bornes |

### Éditeur et persistance locale (phase 1)

| ID | Exigence | Phase | Statut | Dépend | Critère vérifiable |
|---|---|---|---|---|---|
| E-01 | Placer PC, switch, routeur (PC, S-24, R-200) avec ports explicites | 1 | disponible | S-06 | Ports issus du catalogue (eth0 ; ge1–ge24 ; ge0–ge3) |
| E-02 | Liens valides uniquement (port existant, libre, deux équipements distincts) | 1 | disponible avec limites | E-01 | Refus expliqué ; compatibilité de connectique reportée (E-13) |
| E-03 | Configuration IPv4 validée (adresse, masque, passerelle) | 1 | disponible | E-01 | Erreurs bloquantes et avertissements pédagogiques (docs/protocols/ipv4-adressage.md) |
| E-04 | Déplacer, supprimer, zoomer, annuler/rétablir d'édition | 1 | disponible | E-01 | Historique d'édition distinct, 100 étapes |
| E-05 | Sauvegarde automatique IndexedDB, états visibles, récupération | 1 | disponible | E-01 | Rechargement sans perte ; quota et stockage indisponible signalés |
| E-06 | Export/import `.nfg.json` versionné, validé, atomique, migrations | 1 | disponible | S-01 | Import invalide sans perte ; version future refusée ; aller-retour identique |
| E-07 | Édition concurrente entre onglets | 1 | disponible | E-05 | Un onglet éditeur (Web Locks) + contrôle de révision ; conflit explicite |
| E-08 | Navigation principale, onglets de projets, vues Topologie/Configuration | 1 | disponible avec limites | S-06 | État conservé entre vues ; fermeture sûre. Vue Simulation ajoutée avec le moteur (phase 2) |
| E-09 | Liste structurée des équipements/liens et alternative clavier du canevas | 1 | disponible | E-01 | Ajout, sélection, liaison, configuration, suppression et déplacement sans souris |
| E-10 | Tests Playwright des parcours front essentiels | 1 | disponible avec limites | E-05 | 8 parcours ; exécution CI après le push de fin de projet |
| E-11 | Annotations libres sur le canevas | 3 | prévu | E-01 | Texte affiché comme texte, exporté, sans effet sur le réseau |
| E-12 | Mini-carte et glisser-déposer depuis la palette | 2 | prévu | M-11 | Utile au scénario de 100 équipements |
| E-13 | Compatibilité des connectiques (cuivre/fibre, modules) | 4 | prévu | F-01 | Lien entre connectiques incompatibles refusé avec explication |

### Moteur (phase 2)

| ID | Exigence | Phase | Statut | Dépend | Critère vérifiable |
|---|---|---|---|---|---|
| M-01 | Horloge virtuelle, file d'événements stable, PRNG à graine | 2 | prévu | S-08 | Même entrée + même graine = même trace |
| M-02 | Pause, reprise, réinitialisation, prochain événement, lots | 2 | prévu | M-01 | Réinitialisation vide caches et paquets, conserve la configuration |
| M-03 | Limites d'événements/file/calcul avec diagnostic | 2 | prévu | M-01 | Interruption propre expliquée |
| M-04 | Ethernet, apprentissage et vieillissement MAC, destination inconnue | 2 | prévu | M-01 | Tables observables, expiration en temps virtuel |
| M-05 | ARP avec cache et expiration | 2 | prévu | M-04 | Réutilisation avant expiration |
| M-06 | IPv4 et ICMP écho (unions discriminées réelles) | 2 | prévu | M-05 | Ping même sous-réseau |
| M-07 | Routage statique, passerelle, TTL | 2 | prévu | M-06 | Destination distante, échec sans route, retour manquant identifiable |
| M-08 | Lien déconnecté | 2 | prévu | M-04 | Aucune transmission |
| M-09 | Adaptateur Web Worker : messages typés, validés, versionnés, par lots | 2 | prévu | M-01 | Interface fluide pendant le calcul |
| M-10 | Trace structurée avec codes de raison stables | 2 | prévu | M-01 | Chaque décision porte événement, instant, équipement, raison |
| M-11 | Scénario de performance de 100 équipements, mesures séparées | 2 | prévu | M-09 | Seuils chiffrés issus d'une première mesure |

### Observation, CLI et premier exercice (phase 3)

| ID | Exigence | Phase | Statut | Dépend | Critère vérifiable |
|---|---|---|---|---|---|
| O-01 | Pas à pas, progression continue, filtres, inspection | 3 | prévu | M-10 | Suivi d'un échange de bout en bout |
| O-02 | Animations issues des événements, arrêt en pause, mouvement réduit | 3 | prévu | O-01 | Aucune animation sans événement moteur |
| O-03 | Inspecteur limité aux champs modélisés, correspondance OSI documentée | 3 | prévu | O-01 | Aucun octet inventé |
| O-04 | Explications débutant et technique générées depuis les faits du moteur | 3 | prévu | M-10 | Échec expliqué sans IA externe |
| O-05 | CLI originale à modes, aide, historique, complétion (xterm.js) | 3 | prévu | M-07 | Même résultat par CLI et formulaire |
| O-06 | Outils PC : ping, configuration IP, table ARP | 3 | prévu | M-06 | Sorties issues du moteur |
| O-07 | Exercice local guidé (observer, hypothèse, mesure, correction) | 3 | prévu | O-04 | Exercice terminé avec explication |

### FTTH (phase 4 puis phase 9)

| ID | Exigence | Phase | Statut | Dépend | Critère vérifiable |
|---|---|---|---|---|---|
| F-01 | OLT, ONT, ODF, PBO, PTO, coupleurs à ports explicites, épissures, fibres, jarretières | 4 | prévu | E-01 | Chemins OLT–ONT identifiés |
| F-02 | Bilan par direction, longueur d'onde et profil, contributions par composant | 4 | prévu | F-01 | Chemin calculé manuellement retrouvé |
| F-03 | Règle de comptage des connexions appariées | 4 | prévu | F-02 | Aucun double comptage testé |
| F-04 | Marges, sensibilité, surcharge, réserve d'ingénierie | 4 | prévu | F-02 | Limites de réception testées |
| F-05 | Photomètre/source | 4 | prévu | F-02 | Mesure cohérente avec le bilan |
| F-06 | Pannes simples (coupure, courbure, connecteur sale, épissure) | 4 | prévu | F-02 | Symptômes visibles, cause cachée à l'élève |
| F-07 | Exercice local de dépannage FTTH | 4 | prévu | F-06 | Exercice terminé |
| F-08 | GPON/XGS-PON pédagogiques, enregistrement par numéro de série | 9 | prévu | F-04 | Chemin optique OK distinct d'un ONT enregistré |
| F-09 | VLAN de service Internet/VoIP/IPTV, partage de bande passante | 9 | prévu | F-08, P-01 | Débits partagés expliqués |
| F-10 | OTDR pédagogique (événements, pertes, limites documentées) | 9 | prévu | F-02 | Trace approximative documentée |
| F-11 | Vue arborescente colorée + alternative textuelle, implantation rue/immeuble/PBO | 9 | prévu | F-01 | Lisible sans couleur |
| F-12 | Export des bilans CSV/PDF | 9 | prévu | F-02 | Fichiers ouverts et cohérents |

### Comptes, sécurité, déploiement (phase 5)

| ID | Exigence | Phase | Statut | Dépend | Critère vérifiable |
|---|---|---|---|---|---|
| A-01 | Inscription e-mail + mot de passe, Argon2id, politique documentée | 5 | prévu | S-03 | Tests de politique et de hachage |
| A-02 | Validation d'adresse : jetons hachés, finalité, expiration, consommation atomique | 5 | prévu | A-01 | Une seule validation concurrente |
| A-03 | Protection contre l'activation par un tiers (mot de passe demandé à la confirmation) | 5 | prévu | A-02 | Cas testé |
| A-04 | Mot de passe oublié, révocation des sessions, notification | 5 | prévu | A-02 | Ancienne session et ancien mot de passe refusés |
| A-05 | Sessions opaques révocables, cookie `HttpOnly`/`Secure`/`SameSite=Lax`, `__Host-` | 5 | prévu | A-01 | Attributs vérifiés en production |
| A-06 | CSRF, XSS, CSP, en-têtes, autorisations par ressource | 5 | prévu | A-05 | Tests section 14.7 |
| A-07 | Limites anti-abus partagées en PostgreSQL, proxys de confiance | 5 | prévu | A-01 | En-tête IP falsifié sans effet |
| A-08 | Courrier : capture SMTP locale, fournisseur de production validé | 5 | prévu | A-02 | Pas de faux succès de livraison |
| A-09 | Projets privés avec révisions, import volontaire des projets locaux | 5 | prévu | A-05, E-06 | Conflit détecté ; persistance relue en base |
| A-10 | Page connexion/inscription, accès invité, mobile, clavier | 5 | prévu | A-01, S-06 | Formulaire à 360 px, erreurs annoncées |
| A-11 | Déploiement Vercel vérifié (local, prévisualisation, production distingués) | 5 | prévu | S-07 | Donnée de test relue après redéploiement |

### Exercices et notes (phase 6)

| ID | Exigence | Phase | Statut | Dépend | Critère vérifiable |
|---|---|---|---|---|---|
| X-01 | Éditeur d'exercices (énoncé, topologie, fonctions autorisées, barème, indices) | 6 | prévu | O-07 | Exercice créé et joué |
| X-02 | Critères comportementaux acceptant plusieurs solutions | 6 | prévu | X-01 | Deux configurations valides acceptées |
| X-03 | Évaluation serveur bornée et versionnée | 6 | prévu | X-02, A-05 | Score client falsifié rejeté |
| X-04 | Critères privés jamais envoyés au navigateur | 6 | prévu | X-03 | Vérifié dans les réponses API |

### Familles du produit (section 16)

| ID | Famille | Phase | Statut | Dépend | Critère vérifiable |
|---|---|---|---|---|---|
| A-EQ-01 | Équipements étendus : L3, hubs, ponts, laptops, serveurs, imprimantes, téléphones IP, mobiles, AP, contrôleur Wi-Fi, routeur domestique, nuage opérateur, modems, IoT | 7, 12, 13, 16 | prévu | E-01 | Chaque type avec profil de ports documenté |
| A-EQ-02 | Modules cuivre/SFP/série, remplacement à chaud selon profil | 12 | prévu | A-EQ-01 | Contraintes par profil testées |
| A-EQ-03 | Câbles (droit/croisé, catégories, fibre mono/multimode, série, console, coaxial, téléphone), choix automatique, voyants | 12 | prévu | E-02 | Comportement par profil, pas de panne aléatoire |
| A-EQ-04 | Vue physique ville/bâtiment/étage/baie/brassage, longueurs réelles | 12 | prévu | A-EQ-03 | Longueur indépendante de la vue logique |
| P-01 | VLAN, trunks, STP/RSTP, agrégation, LLDP, sécurité de port | 7 | prévu | M-04 | Scénarios de référence par protocole |
| P-02 | IPv6 | 7 | prévu | M-06 | Scénarios de référence |
| P-03 | DHCP serveur/relais, DNS, HTTP/HTTPS, FTP/TFTP, SMTP/POP3, Syslog, NTP, SSH, SNMP | 7 | prévu | M-07 | Niveau explicite par protocole |
| P-04 | Inter-VLAN, RIP, OSPF mono/multi-zone, BGP simplifié, redondance de passerelle | 8 | prévu | P-01 | Convergence observable |
| P-05 | ACL, NAT/PAT, IPsec, GRE, QoS, AAA RADIUS/TACACS+ | 8, 10 | prévu | P-04 | Pas de cryptographie réelle revendiquée |
| P-06 | Bureau PC étendu : traceroute, DNS, console, Wi-Fi, clients applicatifs | 7 | prévu | O-06 | Sorties issues du moteur |
| CM-01 | Cloud Manager : organisation/sites, adoption, modèles, carte, clients | 11 | prévu | P-03 | Adoption par numéro de série |
| CM-02 | SSID, WPA2/WPA3, 802.1X pédagogiques, portail captif, VLAN, limites, PoE | 11 | prévu | CM-01 | Niveau pédagogique documenté |
| CM-03 | VPN intersites, alertes, journaux, mises à jour fictives, diagnostic, rôles | 11 | prévu | CM-01 | Perte du contrôleur sans arrêt du plan de données |
| FW-01 | Zones, objets, politiques ordonnées, compteurs, règles masquées, états de connexion | 10 | prévu | P-05 | Ordre politique/routage/NAT défini et testé |
| FW-02 | NAT source/destination, publication de serveurs | 10 | prévu | FW-01 | Scénarios de référence |
| FW-03 | IPS fictif, catégories web, contrôle applicatif, antivirus de test, inspection TLS pédagogique | 10 | prévu | FW-01 | Métadonnées simulées documentées |
| FW-04 | VPN, SD-WAN, sondes, bascule, HA actif/passif, pare-feux logiques | 10 | prévu | FW-01 | Bascule observable |
| CU-01 | Cuivre Cat 5e à 7A, blindages, T568A/B, panneaux, étiquetage | 12 | prévu | A-EQ-03 | Verdicts par profil, pas de certification réelle |
| CU-02 | Défauts de paires, atténuation, NEXT, return loss pédagogiques | 12 | prévu | CU-01 | Valeurs et hypothèses affichées |
| TEL-01 | ADSL2+/VDSL2 estimés, téléphonie analogique | 13 | prévu | CU-01 | Hypothèses affichées |
| TEL-02 | SIP simplifié, extensions, VLAN voix, PoE, QoS, score de qualité simulé | 13 | prévu | P-01 | Score explicitement simulé |
| SUP-01 | État, débits, compteurs, alertes, flux, captures sur lien | 14 | prévu | M-10 | Captures limitées documentées |
| SUP-02 | Calculateurs IPv4/IPv6/VLSM, binaire/hexa, IPAM, calculateur optique | 14 | prévu | — | Références calculées indépendamment |
| SUP-03 | Export PCAP des unités correctement sérialisées (journal JSON avant) | 14 | prévu | SUP-01 | Ouverture vérifiée dans un lecteur compatible |
| DOC-01 | Exports PNG/SVG/PDF, plan d'adressage, synoptique FTTH, brassage | 15 | prévu | A-EQ-04 | Fichiers ouverts |
| DOC-02 | Nomenclature CSV/Excel, quantités, longueurs, prix modifiables, dossier technique | 15 | prévu | A-EQ-04 | Quantités issues du modèle physique |
| AUT-01 | API de configuration, scénarios de scripts déclaratifs, IoT, SDN simplifié | 16 | prévu | O-05 | Isolation et arrêt testés, aucun `eval` |
| SEC-01 | Attaques simulées (usurpation ARP, DHCP pirate, saturation MAC, scan, DoS) | 16 | prévu | P-03 | Aucun paquet réel émis |
| SEC-02 | Protections (port security, DHCP snooping, inspection ARP, IPS) et rapports | 16 | prévu | SEC-01 | Symptômes, détection, blocage expliqués |
| J-01 | Bibliothèque d'exercices (LAN, VLAN, OSPF, NAT, FTTH, Wi-Fi, DMZ, SD-WAN), quiz | 17 | prévu | X-01 | Exercices jouables |
| J-02 | Classes, attributions, scores, progression, export des notes | 17 | prévu | X-03 | Droits formateur/élève vérifiés côté API |
| J-03 | Projets partagés, galerie publique sur action explicite, révocation | 17 | prévu | A-09 | Privé par défaut |
| J-04 | Collaboration (décision dédiée : autorité, conflits, transport) | 17 | prévu | J-03 | Décision documentée avant développement |
| K-01 | PWA installable, laboratoire hors ligne, fonctions indisponibles signalées | 18 | prévu | E-05 | Aucune donnée privée en cache |
| K-02 | Accessibilité complète, documentation intégrée, tutoriel | 18 | prévu | toutes | Audit clavier et lecteur d'écran |
| K-03 | CI étendue, tests E2E, politique de données | 18 | prévu | S-02 | Pipeline complet |
| K-04 | Choix explicite d'une licence avant publication sous licence | 18 | prévu | — | Décision du propriétaire |
