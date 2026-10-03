# Générer un deck d'oral dans Canva

## Entrées (à remplir)

- **THÈME** : …
- **PROBLÉMATIQUE** : … (une question fermée, qui admet une tension réelle)
- **DURÉE** : … minutes de présentation + … minutes de questions
- **CONTEXTE** : … (école, jury, épreuve, niveau attendu)
- **ORATEUR** : nom, formation (diplôme — école), poste et entreprise si alternance, raison personnelle du choix du sujet

---

## Ta mission

Construire dans Canva un deck de soutenance de ~20 diapos, format présentation 1920×1080,
qui répond à la PROBLÉMATIQUE sur le THÈME. Tu produis **le deck ET les notes du présentateur**.

Tu travailles avec les outils `mcp__claude_ai_Canva__read-design` et `edit-design`.
Si le design n'existe pas encore, crée-le avec `generate-design` puis reprends la main dessus.

---

## 1. Architecture narrative imposée

L'ossature ci-dessous n'est pas une suggestion : c'est la structure à respecter.
Elle tient en trois mouvements — *ce qui a changé* → *ce que ça déplace* → *ce qu'il faut en faire*.

| # | Diapo | Rôle |
|---|---|---|
| 1 | **Couverture** | Titre du sujet + sous-titre problématisant |
| 2 | **Présentation** | Qui parle. Formation / situation / pourquoi ce sujet |
| 3 | **Sommaire** | Les trois parties + l'introduction et la conclusion |
| 4 | **Le chiffre d'accroche** | UN ou DEUX chiffres en très grand (~200 px) qui créent la tension. Rien d'autre |
| 5 | **De quoi parle-t-on ?** | Les 2-3 définitions sans lesquelles la suite est ambiguë |
| 6 | **La rupture** | Frise historique : le sujet n'est pas né hier, mais quelque chose a basculé |
| 7 | **Problématique** | La question, seule au centre. C'est le pivot du plan |
| 8 | *Intercalaire Partie I* | Titre de partie + les diapos qu'elle contient |
| 9-12 | **Partie I — l'état des lieux** | Le constat mesuré. Se termine par un **paradoxe** ou une contradiction dans les données |
| 13 | *Intercalaire Partie II* | |
| 14-18 | **Partie II — le déplacement** | Ce que le phénomène déplace : la valeur, les compétences, les rôles, l'entrée dans le métier |
| 19 | *Intercalaire Partie III* | |
| 20 | **Les enjeux** | Les 4 fronts nommés et **définis**, en colonnes numérotées 01-04 |
| 21-28 | **Partie III — les fronts** | Deux diapos par front : le problème chiffré, puis la contre-mesure |
| 29 | **Les réponses** | **Miroir exact de la diapo 20** : mêmes 4 colonnes, même ordre, la réponse en face de chaque enjeu |
| 30 | **Conclusion** | Réponse frontale à la problématique. Reprend les chiffres de la diapo 4 |
| 31 | **Ouverture** | La question que ce travail laisse ouverte. **Dernière diapo projetée** |

**La paire enjeux / réponses (20 et 29) est le cœur du dispositif.** Elle encadre la partie III
et donne au jury une grille qu'il retrouve à la fin. Les deux diapos doivent être
visuellement jumelles : mêmes positions, mêmes largeurs de colonnes, seul le contenu change.
Sur la 29, rappelle le nom de l'enjeu en **gris** et écris la réponse en navy — l'œil comprend
immédiatement que c'est la même liste vue de l'autre côté.

Termine chacune de ces deux diapos par une phrase de bascule en 34 px gras, centrée :
une définition sur la 20 (*qu'est-ce qu'un enjeu, au fond ?*), un engagement sur la 29
(*ce qui ne s'automatise pas*), posée dans un bandeau navy pleine largeur.

---

## 2. Règles de contenu — non négociables

**Un chiffre par diapo, jamais trois.** Si une diapo porte deux statistiques, elles doivent
se répondre (l'une contredit l'autre), sinon coupe-en une.

**Aucun paragraphe projeté.** Le texte qui sert à parler va dans les **notes du présentateur**,
pas sur la diapo. Règle de coupe : si une phrase dépasse 12 mots, elle est destinée aux notes.
Sur la diapo, il reste un titre, un chiffre, et 3 à 6 mots par colonne.

**Le débit :** compte ~40 secondes par diapo de contenu, ~10 secondes par intercalaire.
Vérifie que le total colle à la DURÉE et dis-le si ça déborde.

**Chaque affirmation chiffrée porte sa source, en pied de diapo**, en 24 px gris italique.
Pas de diapo bibliographique en fin de deck : le jury doit voir la source au moment où
il entend le chiffre. Si une source est utilisée sur trois diapos, elle est répétée trois fois.

**Ne fabrique aucun chiffre.** Si tu n'as pas de source vérifiable pour une statistique,
tu ne l'écris pas — tu proposes la diapo sans chiffre et tu signales ce qui manque.
Cherche les sources sur le web ; privilégie les rapports primaires (institutions, laboratoires,
enquêtes annuelles) aux articles qui les commentent. Cite auteur, titre, année.

**Anticipe le jury.** Dans les notes de chaque diapo chiffrée, ajoute une ligne
« *Objection probable :* … » et sa réponse. C'est ce qui fait la différence à l'oral.

---

## 3. Les schémas : une figure différente à chaque fois

Quand une diapo a trop de texte, remplace-le par un schéma. **Mais n'utilise jamais deux fois
de suite la même figure** — trois diapos consécutives bâties sur trois colonnes endorment le jury.
Choisis la figure d'après la logique du propos :

| Logique du propos | Figure |
|---|---|
| A recule / B monte | **Opposition** : deux cartes (une gris clair, une navy pleine) + une flèche entre les deux |
| avant → pendant → après | **Séquence** : carte / bloc central / carte, deux flèches, bandeau de synthèse dessous |
| plusieurs choses convergent | **Convergence** : 3 colonnes sous un filet, 3 flèches descendantes, une pilule contour en bas |
| deux variables corrélées | **Corrélation** : deux axes, une courbe, deux points annotés |
| étapes dans le temps | **Frise** : un trait horizontal, des jalons, des dates dessous |

Palette de flèches (chemins SVG valides — l'API n'accepte que M/L/H/V/C/S/A/Z, **pas de Q ni T**) :
- flèche droite : `M0 40H60V20L100 50L60 80V60H0z` (viewBox 100×100)
- flèche bas : `M40 0H60V60H80L50 100L20 60H40z` (viewBox 100×100)
- rectangle / carte : `M0 0H100V100H0z` avec `corner_rounding: 24`

---

## 4. Système graphique

Reprends d'abord les couleurs et polices réellement présentes dans le design en lisant une
diapo existante. À défaut, applique ce système :

```
fond de page      #f5f7fa
texte principal   #0b2545  (navy)
texte secondaire  #7d8ca3  (gris)
tuile / carte     #e8ecf2
carte pleine      #0b2545 avec texte #ffffff
```

**Gabarit d'une diapo de contenu :**
- titre serif ~117 px — top 70, left 70, width 1478
- sous-titre gras 40 px — top 238
- trois colonnes — left 70 / 674 / 1278, width 572, top 540
- source — top 1006, 24 px, italique, gris, aligné sur la marge gauche de la diapo
- filet de séparation — hauteur 2 px, navy, `opacity: 0.18`

**Fil d'Ariane** (en haut de chaque diapo de contenu) : les noms des parties alignés
en 20 px — top 14, width 240, left 156 / 416 / 676 / 936 / 1196.
La partie en cours en navy gras, les autres en gris.
⚠️ Si la diapo porte un ornement graphique en haut à gauche, **décale tout le rail vers la droite**
(base 396 au lieu de 156) : sinon le premier libellé disparaît sous l'ornement.

---

## 5. Mécanique de l'API Canva — les pièges

- **Toutes les opérations d'un même appel `edit-design` doivent viser la même page.**
- Ouvre une transaction : `read-design` avec `open_transaction: true` → `transaction_id`.
  Enchaîne les appels avec `finalize: "keep_open"`. Termine par `finalize: "commit"`
  (irréversible) ou `"cancel"`, **sans aucune opération dans cet appel-là**.
- **Carte des pages à moindre coût** : `read-design` avec
  `filter: {fields:["design_content"], element_ids:["__aucun__"]}` → renvoie l'id et le
  `locator_id` de chaque page avec des `elements` vides.
- **Texte complet du deck** : `read-design` simple avec `fields:["design_content"]`.
  Le contenu se parcourt via `children` (groupes) et `textRegions[].characters` — pas `spans`.
- **Ne construis jamais un `locator_id` à la main.** Relis-le dans la réponse de l'`add_*`.
- `add_text` **n'accepte aucun formatage** : tout texte ajouté sort en 16 px noir.
  Chaque `add_text` doit être suivi d'un `format_text`.
- `format_text` **ne peut pas changer la police** (`fontRef`), et `font_weight` n'accepte
  que `normal` ou `bold`. Un `format_text` partiel **préserve** les propriétés non citées.
- `replace_shape` **recalcule la hauteur** d'après le ratio du nouveau viewBox.
  Corrige derrière avec `resize_element` et `preserve_aspect_ratio: false`.
- `position_element` sur un élément **pivoté** vise la boîte englobante visuelle,
  pas le rectangle non pivoté. Calcule la bbox avant de positionner.
- `page_metadata` **ignore la transaction ouverte** et lit le design persisté.
  Ne t'en sers jamais pour vérifier un `reorder_page` en cours — utilise `design_content`.
- **`delete_page` n'existe pas.** Une page en trop devra être supprimée à la main.
- Les vignettes renvoyées sont parfois périmées : fie-toi au contenu structuré, pas à l'image.

---

## 6. Méthode de travail

1. **Lis le deck existant avant d'écrire quoi que ce soit** et travaille sur les **id de page**,
   jamais sur les numéros — l'utilisateur réorganise ses diapos pendant que tu travailles.
2. **Tu ajoutes, tu n'effaces pas.** Avant de retirer un paragraphe d'une diapo, recopie-le
   d'abord dans les notes du présentateur. Demande avant toute suppression de contenu.
3. Une transaction par lot cohérent, commitée et vérifiée avant de passer au suivant.
4. **N'invente jamais les informations personnelles** (diplôme, école, poste). Pose des
   marqueurs explicites entre crochets et dis lesquels tu attends.
5. En fin de travail, **rends compte de ce qui n'a pas pu être fait** : la police des textes
   ajoutés par l'API (à corriger à la main en une sélection multiple dans Canva), les pages
   à supprimer, les marqueurs restants. Ne dis jamais « c'est fait » sur une vérification
   que tu n'as pas exécutée.
