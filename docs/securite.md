# Sécurité des comptes et des projets privés (phase 5)

Aucune sécurité absolue n'est revendiquée et le site n'a fait l'objet d'aucun audit externe. Ce document décrit les menaces couvertes, les preuves exécutées, les limites résiduelles et la révocation d'urgence.

## Références consultées (2026-11-11)

Fiches OWASP Cheat Sheet Series : [Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html), [Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [Cross-Site Request Forgery Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html), [Forgot Password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html), [Email Validation and Verification](https://cheatsheetseries.owasp.org/cheatsheets/Email_Validation_and_Verification_Cheat_Sheet.html).

## Comptes et mots de passe

- Parcours : adresse e-mail + mot de passe, adresse validée avant tout accès privé (règle appliquée par l'API : aucune session n'est ouverte pour une adresse non validée).
- Politique : 15 caractères au moins (pas de second facteur), 128 au plus, tous caractères (espaces, accents) ; aucune règle de composition ; refus d'un caractère répété, d'une suite de clavier ou d'alphabet, de l'adresse elle-même. Forme Unicode NFKC avant contrôle et hachage. Collage et gestionnaires autorisés (`autocomplete` adaptés).
- Hachage : Argon2id natif de Node (`crypto.argon2`, OpenSSL ≥ 3.2), m = 19 Mio, t = 2, p = 1 (configuration minimale OWASP), sel de 16 octets, empreinte au format PHC. Jamais de mot de passe en clair, chiffré ou journalisé.
- Adresses : espaces de bord retirés, NFC, comparaison sans casse (clé unique `email_key`), points et suffixes « + » conservés ; forme saisie conservée pour l'envoi.
- Nouvelle inscription avec une adresse existante : jamais de remplacement du mot de passe ; le titulaire reçoit « un compte existe déjà » (ou un nouveau lien si le compte est en attente). Réponse publique identique.
- Compte précréé par un tiers : la confirmation demande le mot de passe de l'inscription ; à défaut, la « reprise » (preuve de possession de l'adresse par le lien) fait choisir de nouveaux identifiants et invalide les anciens (version des identifiants, sessions).

## Jetons de courrier

32 octets aléatoires (base64url), empreinte SHA-256 seule en base, avec propriétaire, finalité (validation ou réinitialisation), expiration, version des identifiants et date de consommation. Consommation par `UPDATE` conditionnel dans la transaction de l'opération : une seule réussite possible. Durées configurables : validation 24 h, réinitialisation 30 min. Liens construits depuis `APP_ORIGIN` (jamais l'en-tête Host), jeton dans le fragment `#t=…` : jamais envoyé au serveur web, donc absent des journaux d'accès et du référent ; l'interface le retire de l'adresse dès sa lecture. Aucune requête GET ne consomme un jeton.

## Sessions

Secret opaque de 256 bits dans un cookie `HttpOnly`, `SameSite=Lax`, `Path=/`, sans `Domain` ; en HTTPS, préfixe `__Host-` et `Secure`. Empreinte SHA-256 en base ; chaque requête privée vérifie révocation, échéance absolue (12 h) et inactivité (60 min, activité enregistrée au plus une fois par minute). Nouvel identifiant à chaque connexion (la session précédente du navigateur est révoquée). Déconnexion et « Déconnecter tous mes appareils » révoquent côté serveur ; réinitialisation et reprise révoquent toutes les sessions. Le secret n'est jamais lisible par l'interface, ni dans une URL, ni dans le stockage du navigateur (vérifié par un parcours navigateur). Durées choisies pour un usage pédagogique à faible risque, plus longues que les exemples OWASP pour applications sensibles (2 à 30 min) : décision D-042.

**Exception de développement** : sur `http://localhost`, cookies sans `Secure` ni préfixe `__Host-` (noms `nf_session`, `nf_pre`). Dès que `APP_ORIGIN` est en HTTPS, les attributs de production s'appliquent ; `NODE_ENV=production` exige HTTPS.

## CSRF et origine

Toute requête POST, PUT, PATCH ou DELETE exige l'en-tête `X-CSRF-Token` : double soumission signée (HMAC-SHA256 avec `CSRF_SECRET`) liée à l'empreinte du cookie de session, ou à défaut d'un cookie de pré-session (connexion, inscription, récupération : protection contre la CSRF de connexion). Le jeton est renouvelé à la connexion et n'est gardé qu'en mémoire par l'interface. S'y ajoutent : refus si `Origin` diffère de `APP_ORIGIN`, refus si `Sec-Fetch-Site` n'est pas `same-origin`. Aucune route GET ne modifie l'état.

## Limites anti-abus

Compteurs à fenêtre fixe dans PostgreSQL (`rate_limits`, incrément atomique `INSERT … ON CONFLICT … RETURNING`), communs à toutes les instances, sans verrouillage permanent (une fenêtre expirée repart à zéro), nettoyage borné.

| Règle | Seuil |
|---|---|
| Échecs de connexion ou de mot de passe à la validation, par adresse IP | 100 / 15 min |
| … par compte | 50 / 15 min |
| … par couple compte + adresse IP | 10 / 15 min |
| Inscriptions par adresse IP | 20 / h |
| Renvois et récupérations par adresse IP | 30 / h |
| Courriers d'un même type à un compte | 1 / 60 s (`RESEND_MIN_SECONDS`) |
| Courriers par compte, tous types | 5 / h |
| Courriers, plafond global | 200 / h (à ajuster au quota du fournisseur) |
| Soumissions de jetons par adresse IP | 30 / 15 min |

Les seuils par adresse IP sont larges pour une salle de classe derrière une même adresse. L'adresse cliente n'est lue dans `X-Forwarded-For` que si `TRUST_PROXY` désigne des proxys de confiance (sinon : adresse de la connexion). Réponses publiques identiques pour l'inscription, le renvoi et la récupération ; même coût de calcul (hachage de référence) quand le compte n'existe pas. Ce dispositif ne protège pas contre un déni de service volumétrique.

## Courrier

Service indépendant du fournisseur (SMTP, `nodemailer`) ; identifiants uniquement côté serveur : `SMTP_URL`, ou `SMTP_HOST`, `SMTP_PORT` (465 en TLS direct, 587 en STARTTLS), `SMTP_USER` et `SMTP_PASSWORD`. Envoi attendu avant la réponse, délais bornés, un nouvel essai au plus ; en cas d'échec : `503 auth.mail-unavailable`, jamais de faux succès ni d'activation ; à l'inscription, le compte en attente est supprimé. L'interface précise que l'acceptation par le serveur d'envoi ne garantit pas la réception. Sans serveur d'envoi configuré, les parcours de compte sont déclarés indisponibles ; le laboratoire invité reste utilisable. En local et en test : capture (`pnpm mail:local`, boîte de test), aucun envoi réel.

En production : compte Gmail dédié à NetForge, mot de passe d'application (validation en deux étapes obligatoire) enregistré comme secret Vercel, jamais lu ni transmis ailleurs. Courriers en texte et HTML sobre, sans pièce jointe. Le premier courrier réel (2026-11-11) est arrivé dans les indésirables : expéditeur neuf et liens vers un domaine partagé `vercel.app` ; voir les limites résiduelles.

## Autres défenses

- **En-têtes de l'API** : `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-origin`, `Cache-Control: no-store` sur toutes les réponses. Interface : `<meta name="referrer" content="no-referrer">`.
- **En-têtes de l'interface** (`apps/web/security-headers.json`, appliqués à l'identique par `vercel.json` et par l'aperçu local, synchronisation testée) : `Content-Security-Policy` limitée à l'origine du site (`script-src 'self'` sans script en ligne ni `eval`, `connect-src 'self'`, `worker-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'` ; seul `style-src` admet `'unsafe-inline'` pour les styles calculés de l'éditeur), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` (caméra, micro, géolocalisation, paiement refusés), `Cross-Origin-Opener-Policy: same-origin`. HSTS ajouté par Vercel. Vérifié sur la production le 2026-11-11 : aucune violation dans Edge (simulation, export, vue Optique, connexion).
- **XSS** : échappement de React, aucun `dangerouslySetInnerHTML` ; noms de projets, notes, console et imports traités comme du texte ; gabarits de courrier échappés.
- **Autorisations** : chaque lecture, modification, suppression et export d'un projet du compte vérifie le propriétaire ; le projet d'un autre compte reçoit la même réponse 404 qu'un projet absent ; un identifiant déjà pris est refusé sans révéler la révision d'autrui.
- **Entrées** : contrats Zod stricts, corps limité (taille maximale d'un projet + 64 Kio), contenu de projet validé et migré comme un import, requêtes paramétrées (Prisma), erreurs internes masquées (`server.unavailable`).
- **Données** : un compte ne contient que l'adresse, l'empreinte du mot de passe et des dates ; projets privés par défaut ; suppression en cascade des sessions, jetons et projets avec le compte.

## Critères vérifiables (spécification §14.7)

| Cas | Résultat | Preuve |
|---|---|---|
| Inscription puis connexion avant vérification | refus, invité préservé | `auth.e2e.test.ts` ; parcours `accounts.spec.ts` |
| Validation valide, expirée, altérée ou rejouée | une seule validation, erreurs contrôlées | `auth.e2e.test.ts` (horloge contrôlée) |
| Deux consommations concurrentes | une seule réussit | `auth.e2e.test.ts` (trois requêtes simultanées) |
| Renvoi répété, échecs de connexion, récupération abusive | limites actives, pas d'envoi massif, pas de verrouillage permanent | `auth.e2e.test.ts` |
| Autre instance, IP transférée falsifiée | limites persistantes | `auth.e2e.test.ts` (deuxième application sur la même base, `X-Forwarded-For` ignoré) |
| Jeton de validation présenté à la récupération | refus par finalité | `auth.e2e.test.ts` |
| Réinitialisation puis ancienne session | session refusée, ancien mot de passe inutilisable | `auth.e2e.test.ts` ; `accounts.spec.ts` |
| Déconnexion, expiration, révocation globale | anciennes sessions refusées | `auth.e2e.test.ts` (cookie rejoué, 60 min, 12 h) |
| Session dans une URL ou le stockage | absente ou refusée | `auth.e2e.test.ts` ; `accounts.spec.ts` (stockage inspecté) |
| Cookie de production | `__Host-`, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, sans `Domain` | `auth.e2e.test.ts` (origine HTTPS) ; sur https://netforge-amber.vercel.app le 2026-11-11 : cookie de présession `__Host-nf_pre` (même fonction d'émission que la session) avec ces attributs, connexion réelle réussie |
| Modification depuis une origine étrangère ou sans CSRF | refus | `auth.e2e.test.ts` |
| HTML/script dans un nom | conservé comme texte (JSON, `nosniff`) | `projects.e2e.test.ts` ; échappement React |
| Accès aux projets d'un autre compte | refus côté API | `projects.e2e.test.ts` |
| Consultation après déconnexion | projets du compte fermés, aucune donnée privée en cache (aucun service worker) | `accounts.spec.ts` |
| Panne ou absence du courrier | aucun faux succès, aucun compte créé | `auth.e2e.test.ts` |

Classes, notes et rôles formateur (phases 6 et 17) n'existent pas encore : leurs contrôles d'accès seront ajoutés avec eux.

## Limites résiduelles

- Pas de second facteur ; pas de comparaison avec des listes de mots de passe divulgués (service externe non retenu).
- Pendant une panne du courrier, renvoi et récupération répondent `503` pour un compte existant et `202` pour une adresse inconnue : énumération possible pendant la panne seulement.
- Pas encore de suppression de compte ni de changement d'adresse depuis l'interface (suppression en cascade prête en base).
- Pas de journal d'audit des abus au-delà des journaux de l'API (sans adresse complète ni jeton).
- Délivrabilité : courriers envoyés par une adresse Gmail neuve, sans domaine propre (achat écarté par les contraintes du projet) ; ils peuvent être classés en indésirables.
- Les déploiements de prévisualisation sont protégés par l'authentification Vercel mais utilisent la base de production (D-049).

## Révocation d'urgence

1. **Une session ou un compte compromis** : `UPDATE sessions SET revoked_at = now() WHERE user_id = '<id>' AND revoked_at IS NULL;` (ou « Déconnecter tous mes appareils »).
2. **Toutes les sessions** : `UPDATE sessions SET revoked_at = now() WHERE revoked_at IS NULL;`
3. **Jetons CSRF** : changer `CSRF_SECRET` sur toutes les instances, puis redéployer. Sur Vercel, pour chaque environnement, sans afficher la valeur : `node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('base64url'))" | vercel env add CSRF_SECRET --environment production --sensitive --force`.
4. **Liens de courrier en circulation** : `UPDATE email_tokens SET consumed_at = now() WHERE consumed_at IS NULL;`
5. **Secrets d'infrastructure** : renouveler l'identifiant SMTP et le mot de passe PostgreSQL chez le fournisseur, puis mettre à jour les variables d'environnement. Production : supprimer puis recréer le mot de passe d'application du compte Gmail dédié et remplacer le secret `SMTP_PASSWORD` dans Vercel ; les requêtes SQL ci-dessus s'exécutent dans l'éditeur SQL de Neon (Vercel → Storage → base → « Open in Neon »).
