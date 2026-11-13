# VRRP version 3 (IPv4)

Niveau : pédagogique simplifié (phase 8, tranche 3) — routeurs R-200, un groupe par interface, IPv4.

## Références

Consultée le 2026-11-13 : [RFC 5798](https://www.rfc-editor.org/rfc/rfc5798) (VRRP version 3 pour IPv4 et IPv6) :

- §5.1 et §5.1.1 : format de l'annonce ; adresse source = adresse principale de l'interface, destination 224.0.0.18, TTL 255 obligatoire (tout paquet reçu avec un autre TTL est écarté), protocole IP 112.
- §5.2.1 à §5.2.8 : version 3, type 1 (annonce), VRID, priorité (255 pour le propriétaire de l'adresse, 1 à 254 pour les secours, 100 par défaut, 0 = maître qui s'arrête), nombre d'adresses, intervalle maximal en centisecondes, somme de contrôle.
- §6.1 : Advertisement_Interval 100 cs (1 s) ; Skew_Time = ((256 − priorité) × Master_Adver_Interval) / 256 ; Master_Down_Interval = 3 × Master_Adver_Interval + Skew_Time ; Preempt_Mode vrai par défaut ; Accept_Mode faux par défaut.
- §6.4.1 à §6.4.3 : automate Initialize / Backup / Master ; le secours ne répond pas à l'ARP de l'adresse virtuelle et écarte les trames destinées à la MAC virtuelle ; à l'échéance du Master_Down_Timer : annonce, ARP gratuit, passage en maître ; un secours accepte une annonce si la préemption est désactivée ou si sa priorité est au moins égale, l'écarte sinon ; le maître répond à l'ARP de l'adresse virtuelle, transmet les trames destinées à la MAC virtuelle, annonce périodiquement, cède à une priorité plus haute (ou égale avec une adresse plus grande) ; un non-propriétaire n'accepte pas les paquets adressés à l'adresse virtuelle si Accept_Mode est faux.
- §7.2 et §7.3 : annonces émises avec la MAC virtuelle comme source ; MAC virtuelle IPv4 00-00-5E-00-01-{VRID}.

La MAC de groupe de 224.0.0.18 (01:00:5e:00:00:12) suit RFC 1112 §6.4, déjà utilisée par RIP ([rip.md](rip.md)).

## Comportement pris en charge

| Élément | Comportement | Code de trace |
|---|---|---|
| Configuration | Un groupe par interface adressée d'un routeur (sous-interface comprise) : VRID 1 à 255, adresse virtuelle (hôte du réseau de l'interface), priorité 1 à 254 (100 par défaut), préemption (activée par défaut) | — |
| Propriétaire | Si l'adresse virtuelle est celle de l'interface : priorité 255, maître dès le démarrage | `vrrp.state` |
| Élection | Au démarrage, les autres passent en secours et attendent Master_Down_Interval (3,57 s pour 110, 3,61 s pour 100) : le plus prioritaire se proclame maître le premier, les autres acceptent ses annonces | `vrrp.state`, `vrrp.advert-sent`, `vrrp.advert-received` |
| Maître | Annonce toutes les secondes vers 224.0.0.18 (TTL 255, protocole 112, MAC source virtuelle) ; ARP gratuit en devenant maître ; répond à l'ARP de l'adresse virtuelle avec la MAC virtuelle ; reçoit et route les trames destinées à la MAC virtuelle | `vrrp.advert-sent`, `vrrp.gratuitous-arp`, `vrrp.arp-reply` |
| Secours | Ignore l'ARP de l'adresse virtuelle et les trames destinées à la MAC virtuelle ; bascule en maître si aucune annonce acceptée pendant Master_Down_Interval | `arp.not-target`, `nic.filtered`, `vrrp.state` |
| Préemption | Un secours plus prioritaire écarte les annonces d'un maître moins prioritaire et prend la main à son échéance ; sans préemption, il accepte ces annonces et reste en secours | `vrrp.advert-discarded` |
| Maître concurrent | Un maître cède à une annonce plus prioritaire (ou de même priorité venant d'une adresse plus grande), l'écarte sinon | `vrrp.state`, `vrrp.advert-discarded` |
| Accept_Mode | Faux (valeur par défaut de la RFC, non configurable) : un routeur non propriétaire refuse les paquets adressés à l'adresse virtuelle (un ping vers la passerelle virtuelle n'obtient pas de réponse) ; le propriétaire y répond | `vrrp.not-accepted` |
| Interface | Coupée : le groupe revient à l'initialisation ; rétablie : nouveau démarrage (secours, puis préemption éventuelle) | `vrrp.state` |

Démarrage et retour d'une interface : la première attente de Master_Down_Interval est un échange actif, donc « Terminer les échanges » calcule l'élection et la préemption. Les annonces périodiques et la surveillance du maître (Master_Down_Timer réarmé à chaque annonce acceptée) sont des temporisations de fond : la perte du maître se voit en lecture (environ 3,6 s simulées), comme la perte d'un voisin OSPF.

Les switches apprennent la MAC virtuelle sur le port du maître (annonces et ARP gratuit) ; quand le maître change, l'ARP gratuit déplace l'entrée. Le cache ARP des postes garde l'adresse virtuelle associée à la même MAC virtuelle : la passerelle ne change pas pour eux.

Configuration équivalente par le formulaire (onglet Routes d'un routeur, section « Passerelle redondante VRRP ») et par la console :

```
configure
interface ge0
vrrp 1 192.168.1.1 priority 110
vrrp 1 192.168.1.1 priority 110 preempt off
vrrp clear
end
show vrrp
```

## Simplifications et limites

- Un groupe par interface, une adresse virtuelle par groupe ; IPv4 seulement (pas de VRRP pour IPv6).
- Intervalle d'annonce fixe (1 s) et Accept_Mode non configurables.
- Pas d'annonce de priorité 0 : aucun arrêt volontaire n'est simulé (un changement de configuration réinitialise la simulation) ; un maître disparaît par coupure de son interface.
- Pas de suivi d'interface ou d'objet (« tracking ») : un maître dont la liaison montante tombe reste maître.
- Somme de contrôle non modélisée ; aucune authentification (supprimée par la version 3).
- Le trafic routé par le maître part avec la MAC réelle de son interface ; seuls les annonces, l'ARP gratuit et les réponses ARP de l'adresse virtuelle utilisent la MAC virtuelle.
- Un paquet VRRP ne déclenche jamais d'erreur ICMP.

## Correspondance OSI (pédagogique)

Ethernet (2, MAC source virtuelle) → IPv4 (3, protocole 112, TTL 255 vers 224.0.0.18) → VRRP (3, redondance de passerelle). L'inspecteur affiche version, type, VRID, priorité (« propriétaire de l'adresse » pour 255), intervalle maximal et adresses virtuelles. Le journal range VRRP dans la catégorie « Routage dynamique ».

Le panneau d'exécution d'un routeur montre chaque groupe : état, priorité effective, MAC virtuelle, maître connu, prochaine annonce (maître) ou instant de bascule faute d'annonce (secours) ; `show vrrp` affiche les mêmes données dans la console.

## Tests de référence

- `packages/project/src/vrrp.test.ts` : bornes du VRID et de la priorité, groupe enregistré, modifié et retiré (sous-interface comprise), refus (équipement, port, interface sans adresse, adresse hors du réseau, valeurs hors bornes), avertissements (adresses différentes pour un même VRID, interface sans adresse), console équivalente aux formulaires, configuration rejouable.
- `packages/project/src/migration.test.ts` : migration v9 → v10 sans VRRP, OSPF conservé.
- `packages/engine/src/vrrp.test.ts` : élection à 3,5703125 s, annonce conforme (TTL 255, 224.0.0.18, MAC virtuelle, champs, taille), ARP gratuit, MAC virtuelle apprise par le switch ; seul le maître répond à l'ARP de l'adresse virtuelle ; propriétaire maître dès l'instant 0 ; Accept_Mode (ping de l'adresse virtuelle refusé, sauf propriétaire) ; bascule exactement Master_Down_Interval après la dernière annonce reçue, ARP gratuit, poste qui garde sa passerelle ; retour par préemption et maintien sans préemption ; déterminisme.
- `packages/engine/src/evaluation.test.ts` : VRRP protégé par la fonction « routes » ; ping noté après l'élection.
- `apps/web/src/i18n/simulation.test.ts` : chaque décision VRRP expliquée aux deux niveaux sur des traces réelles (bascule, retour, ping refusé, propriétaire), phrases attendues, inspecteur.
- `apps/web/e2e/vrrp.spec.ts` : maître et secours dans le panneau d'exécution, ping par la passerelle virtuelle, bascule en lecture accélérée, cache ARP inchangé du poste, retour par préemption, `show vrrp` ; formulaire de l'onglet Routes et console équivalents.
