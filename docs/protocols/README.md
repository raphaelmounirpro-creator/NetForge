# Protocoles et modèles physiques

Aucun protocole ni modèle physique n'est implémenté à ce jour (phase 0).

Chaque protocole ou modèle ajouté reçoit un fichier `docs/protocols/<nom>.md` selon ce gabarit :

```markdown
# <Protocole>

Niveau : absent | pédagogique simplifié | sous-ensemble détaillé

## Références
- <document public> — <lien> — <section>

## Comportement pris en charge
## Simplifications et limites
## Correspondance OSI (pédagogique)
## Tests de référence
- <fichier de test> : <scénario vérifié>
```

Règles : ne citer que des références publiques effectivement consultées ; ne jamais revendiquer une conformité normative non vérifiée ; HTTPS, IPsec et assimilés simulés ne sont jamais présentés comme une cryptographie réelle.

## Socle du moteur

| Élément | État | Référence |
|---|---|---|
| Temps simulé (nanosecondes entières) | Disponible | [DECISIONS D-008](../DECISIONS.md), `packages/engine/src/time.test.ts` |
