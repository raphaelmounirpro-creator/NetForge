# PON : technologies GPON et XGS-PON, enregistrement des ONT

Niveau : pédagogique simplifié (phase 9, tranche 1). C'est un calcul statique, comme le bilan optique : aucun message PLOAM n'est simulé dans le moteur à événements. Les étapes de l'activation sont déduites, pas chronométrées.

## Références

Consultées le 2026-11-13 (textes publics de l'UIT-T, téléchargés depuis itu.int) :

- UIT-T G.9807.1 (02/2023), *10-Gigabit-capable symmetric passive optical network (XGS-PON)* :
  - tableau B.6.1 : classes d'affaiblissement N1 (14 à 29 dB), N2, E1, E2 ;
  - tableau B.9.3 (sens descendant) : 9,95328 Gbit/s, 1 575–1 580 nm ; OLT N1 de +2,0 à +5,0 dBm ; récepteur de l'ONU à −28,0 dBm de sensibilité et −9,0 dBm de surcharge ; pénalité de trajet de 1,0 dB (DD20) ou 2,0 dB (DD40, au-delà de 20 km de fibre d'après la note 9) ;
  - tableau B.9.4 (sens montant) : 1 260–1 280 nm ; ONU N1 de +4,0 à +9,0 dBm ; récepteur de l'OLT N1 à −26,0 dBm de sensibilité et −5,0 dBm de surcharge ; pénalité de 1,0 dB ;
  - §C.11.2.1 : ONU-ID de 0 à 1 020 ;
  - §C.11.2.6 : numéro de série = Vendor_ID (quatre caractères, codes 65 à 90) + VSSN (entier de quatre octets) ;
  - §C.12 : activation en trois phases (synchronisation descendante, acquisition du numéro de série, mesure de distance) ; états O1 (Off-Sync, Profile Learning), O2-3, O4, O5, O6, O7.
- UIT-T G.984.3 (01/2014), *G-PON : Transmission convergence layer specification* :
  - §9.1.1 : ONU-ID de 0 à 253 ;
  - §9.2.4.1 : Serial_Number_ONU (Vendor_ID sur quatre octets puis numéro propre au fabricant) ;
  - §10.1 et §10.2 : activation et états O1 (Initial), O2 (Standby), O3 (Serial_Number), O4 (Ranging), O5 (Operation), O6 (POPUP), O7 (Emergency Stop).
- UIT-T G.652 (08/2024), tableau 2, note 2 : la plage d'affaiblissement s'étend jusqu'à 1 260 nm en ajoutant 0,07 dB/km à la valeur de 1 310 nm.
- UIT-T G.671 (11/2025), §6.6, §6.7 et §6.14 : coupleurs, connecteurs et épissures spécifiés de 1 260 à 1 360 nm et de 1 480 à 1 580 nm (1 625 nm pour les coupleurs). Les mêmes maximums couvrent donc GPON et XGS-PON.

Aucune conformité normative n'est revendiquée.

## Comportement pris en charge

| Élément | Comportement |
|---|---|
| Modèles (catalogue 3) | OLT-16 et ONT-1G (GPON, classe B+) ; OLT-XGS-8 (8 ports PON) et ONT-10G (XGS-PON, classe N1) |
| Longueurs d'onde | GPON : 1 490 nm descendant, 1 310 nm montant ; XGS-PON : 1 577 nm descendant, 1 270 nm montant (valeurs nominales utilisées pour l'affaiblissement de la fibre) |
| Fibre | 0,40 dB/km de 1 310 à 1 625 nm, 0,47 dB/km sous 1 310 nm (note 2 de G.652) ; câbles courts : 1,00 et 1,07 dB/km (même majoration par analogie, choix NetForge) |
| Technologies différentes | OLT XGS-PON et ONT GPON (ou l'inverse) : état « technologies PON incompatibles » dès le bilan de conception ; l'ONT ne quitte pas O1 |
| Numéro de série | Chaque ONT neuf reçoit le plus petit numéro NetForge libre (NFGE00000001…), modifiable : c'est l'étiquette d'un ONT changé. Le code fabricant « NFGE » est fictif, il ne vient pas du registre ATIS-0300220 |
| Autorisations | Par port d'OLT : numéro de série et identifiant d'ONU (0 à 253 en GPON, 0 à 1 020 en XGS-PON ; par défaut, le plus petit libre) ; 128 au plus par port (borne NetForge) |
| Activation | Voir le tableau suivant |

L'activation de chaque ONT est déduite du chemin optique qui le relie à un OLT (premier port dans l'ordre des identifiants s'il y en a plusieurs) et de la configuration de cet OLT.

| Condition | État | Cause affichée |
|---|---|---|
| Aucun OLT n'atteint l'ONT | O1 | aucun chemin |
| OLT et ONT de technologies différentes | O1 | technologies incompatibles |
| Signal descendant inexploitable (coupure, raccordement incompatible, sensibilité, surcharge) | O1 | état optique descendant |
| ONT sans numéro de série | O3 (GPON) ou O2-3 (XGS-PON) | aucun numéro de série |
| Salve montante non reçue par l'OLT | O3 ou O2-3 | état optique montant |
| Deux ONT du même port annoncent le même numéro | O3 ou O2-3 | numéro en double, aucun identifiant attribué (choix NetForge) |
| Numéro non autorisé sur ce port | O3 ou O2-3 | découvert, non autorisé |
| Numéro autorisé | O5 | identifiant d'ONU attribué |

Les étapes sont nommées selon chaque recommandation :

- GPON : synchronisation (O1 → O2), Upstream_Overhead (O2 → O3), Serial_Number_ONU, Assign_ONU-ID (O3 → O4), Ranging_Time (O4 → O5) ;
- XGS-PON : synchronisation (Off-Sync → Profile Learning), profils de salve (→ O2-3), Serial_Number_ONU, Assign_ONU-ID (O2-3 → O4), Registration et Ranging_Time (O4 → O5).

La marge faible n'empêche pas l'enregistrement. Le bilan reste un pire cas : une marge négative est traitée comme un signal inexploitable.

Configuration équivalente par le formulaire et par la console :

- formulaire : onglet PON d'un OLT ; numéro de série dans l'onglet Général d'un ONT ;
- console :

```
OLT1> configure
OLT1(config)> ont add pon1 NFGE00000002 onu-id 1
OLT1(config)> ont delete pon1 NFGE00000002
OLT1(config)> end
OLT1> show pon
ONT2> configure
ONT2(config)> serial-number ABCD0000002A
ONT2(config)> end
ONT2> show pon
```

## Observation

- **Vue Optique, liste des chemins** : technologie du chemin (ou « OLT XGS-PON, ONT GPON »).
- **Canevas** : sous chaque ONT, l'état optique puis l'état d'activation (« ✓ Conforme · O5 », « ✓ Conforme · ◌ O2-3 »).
- **Onglet PON** : pour chaque port, les ONT autorisés (avec l'ONT et son état), les ONT découverts mais non enregistrés, puis chaque ONT avec ses étapes franchies, bloquées ou non atteintes.
- **Bilan** : profils de l'émetteur et du récepteur, classe d'affaiblissement (B+ ou N1).
- **Pendant un exercice** : l'état optique est donné comme symptôme. L'état d'activation est un symptôme lui aussi : un OLT réel liste ses ONT découverts.

## Simplifications et limites

- Aucune trame PON n'est simulée : ni GEM/XGEM, ni PLOAM, ni allocation dynamique de bande, ni chiffrement. Les délais (TO1, TO2) et la mesure de distance ne sont pas chronométrés.
- Classes N2, E1 et E2 de XGS-PON non modélisées. Pas de coexistence GPON/XGS-PON sur le même arbre par filtre WDM : un ONT branché sur l'arbre d'une autre technologie est déclaré incompatible.
- Portée et distance différentielle non vérifiées (au-delà de 40 km en XGS-PON, la pénalité DD40 reste appliquée).
- Le calcul utilise la longueur d'onde nominale de l'émetteur : un émetteur GPON en bas de sa bande (1 260 nm) subirait jusqu'à 0,07 dB/km de plus.
- Pas d'authentification par mot de passe ou par Registration_ID, pas d'état d'arrêt d'urgence (O7), pas de découverte automatique avec autorisation automatique.
- L'ONT n'est pas relié au réseau IP simulé.

## Tests de référence

- `packages/project/src/pon.test.ts` :
  - numéros de série (forme, ordre d'attribution) ;
  - autorisations (identifiant le plus petit ou choisi, plages GPON et XGS-PON, refus) ;
  - console équivalente aux formulaires ; configuration rejouable.
- `packages/project/src/migration.test.ts` : migration v12 → v13 (numéros NetForge dans l'ordre des équipements, aucune autorisation).
- `packages/engine/src/pon.test.ts` :
  - chemin XGS-PON calculé à la main (25,204 dB et marge 3,796 dB à 1 577 nm ; 25,36528 dB et marge 3,63472 dB à 1 270 nm) ;
  - majoration sous 1 310 nm ; pénalité DD40 ;
  - technologies incompatibles ; photomètre par technologie ;
  - activation O5, O2-3 non autorisé, O1 incompatible ;
  - salve montante perdue (courbure de 3,7 dB), coupure, états GPON ;
  - numéro en double, ONT changé, ONT isolé.
- `packages/engine/src/evaluation.test.ts` : fonction protégée « pon » (un ONT ajouté n'est pas une modification PON) ; critère « ONT en fonctionnement ».
- `apps/web/e2e/pon.spec.ts` :
  - bilan XGS-PON et classe N1 ; onglet PON (autorisés, découvert, étapes) ;
  - autorisation et `show pon` à la console ;
  - formulaire de l'OLT et numéro de série de l'ONT.
