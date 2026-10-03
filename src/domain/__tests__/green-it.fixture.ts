import type { DeckSpec, PromptTemplate } from "@/domain/schemas";

/**
 * Données réelles (base de dev, test Ollama qwen2.5:14b du passage 2) : gabarit de
 * 16 sections / 31 diapos, squelette Ollama de 17 diapos et deck final de 17 diapos
 * qui recopie le squelette et répond à une autre question que la problématique tirée.
 */

export const GREEN_IT_PROBLEM =
  "Le Green IT peut-il réellement réduire l'empreinte environnementale du numérique, ou ne fait-il que compenser la croissance des usages ?";

export const GREEN_IT_TEMPLATE: PromptTemplate = {
  "tone": "Formel",
  "format": "16:9",
  "language": "fr",
  "sections": [
    {
      "id": "presentation",
      "title": "Présentation",
      "slides": 1,
      "guidance": "Qui parle. Formation / situation / pourquoi ce sujet"
    },
    {
      "id": "sommaire",
      "title": "Sommaire",
      "slides": 1,
      "guidance": "Les trois parties + l'introduction et la conclusion"
    },
    {
      "id": "le-chiffre-d-accroche",
      "title": "Le chiffre d'accroche",
      "slides": 1,
      "guidance": "UN ou DEUX chiffres en très grand (~200 px) qui créent la tension. Rien d'autre"
    },
    {
      "id": "de-quoi-parle-t-on",
      "title": "De quoi parle-t-on ?",
      "slides": 1,
      "guidance": "Les 2-3 définitions sans lesquelles la suite est ambiguë"
    },
    {
      "id": "la-rupture",
      "title": "La rupture",
      "slides": 1,
      "guidance": "Frise historique : le sujet n'est pas né hier, mais quelque chose a basculé"
    },
    {
      "id": "problematique",
      "title": "Problématique",
      "slides": 1,
      "guidance": "La question, seule au centre. C'est le pivot du plan"
    },
    {
      "id": "intercalaire-partie-i",
      "title": "Intercalaire Partie I",
      "slides": 1,
      "guidance": "Titre de partie + les diapos qu'elle contient"
    },
    {
      "id": "partie-i-l-etat-des-lieux",
      "title": "Partie I — l'état des lieux",
      "slides": 4,
      "guidance": "Le constat mesuré. Se termine par un paradoxe ou une contradiction dans les données"
    },
    {
      "id": "intercalaire-partie-ii",
      "title": "Intercalaire Partie II",
      "slides": 1,
      "guidance": ""
    },
    {
      "id": "partie-ii-le-deplacement",
      "title": "Partie II — le déplacement",
      "slides": 5,
      "guidance": "Ce que le phénomène déplace : la valeur, les compétences, les rôles, l'entrée dans le métier"
    },
    {
      "id": "intercalaire-partie-iii",
      "title": "Intercalaire Partie III",
      "slides": 1,
      "guidance": ""
    },
    {
      "id": "les-enjeux",
      "title": "Les enjeux",
      "slides": 1,
      "guidance": "Les 4 fronts nommés et définis, en colonnes numérotées 01-04"
    },
    {
      "id": "partie-iii-les-fronts",
      "title": "Partie III — les fronts",
      "slides": 8,
      "guidance": "Deux diapos par front : le problème chiffré, puis la contre-mesure"
    },
    {
      "id": "les-reponses",
      "title": "Les réponses",
      "slides": 1,
      "guidance": "Miroir exact de la diapo 20 : mêmes 4 colonnes, même ordre, la réponse en face de chaque enjeu"
    },
    {
      "id": "conclusion",
      "title": "Conclusion",
      "slides": 1,
      "guidance": "Réponse frontale à la problématique. Reprend les chiffres de la diapo 4"
    },
    {
      "id": "ouverture",
      "title": "Ouverture",
      "slides": 1,
      "guidance": "La question que ce travail laisse ouverte. Dernière diapo projetée"
    }
  ],
  "constraints": "Couverture : Titre du sujet + sous-titre problématisant\nUn chiffre par diapo, jamais trois. Si une diapo porte deux statistiques, elles doivent se répondre. Aucun paragraphe projeté. Le texte qui sert à parler va dans les notes du présentateur. Chaque affirmation chiffrée porte sa source, en pied de diapo. Ne fabrique aucun chiffre. Anticipe le jury. Dans les notes de chaque diapo chiffrée, ajoute une ligne Objection probable : et sa réponse.",
  "durationMinutes": 20
};

export const GREEN_IT_SKELETON: DeckSpec = {
  "title": "Green IT v2 — Ollama",
  "slides": [
    {
      "notes": "[0:00–0:30] Bonjour, aujourd'hui nous allons explorer le thème du Green IT, qui vise à réduire l'empreinte carbone du numérique.",
      "title": "Green IT v2 — Ollama",
      "layout": "title",
      "bullets": [],
      "subtitle": "Sobriété et efficacité énergétique du numérique",
      "sectionId": "cover"
    },
    {
      "notes": "[0:30–1:09] Je suis [à compléter : formation et école], et je m'intéresse au Green IT car il est crucial pour l'avenir durable de notre secteur.",
      "title": "Présentation",
      "layout": "section",
      "bullets": [],
      "subtitle": "",
      "sectionId": "presentation"
    },
    {
      "notes": "[1:09–1:48] Nous allons aborder trois parties : l'état des lieux, le déplacement et les fronts d'action. Nous conclurons sur les réponses et les perspectives ouvertes.",
      "title": "Sommaire",
      "layout": "section",
      "bullets": [],
      "subtitle": "",
      "sectionId": "sommaire"
    },
    {
      "notes": "[1:48–2:27] 50% des émissions de CO2 des entreprises sont liées au numérique. Objection probable : Ce chiffre est trop élevé. Réponse : Il inclut les fournisseurs et les consommateurs indirects.",
      "title": "Le chiffre d'accroche",
      "layout": "content",
      "bullets": [
        "50% des émissions de CO2 des entreprises sont liées au numérique",
        "[source à trouver] : la donnée à chercher"
      ],
      "subtitle": "",
      "sectionId": "le-chiffre-d-accroche"
    },
    {
      "notes": "[2:27–3:06] Le Green IT vise à réduire l'empreinte carbone du numérique. La sobriété numérique réduit la consommation énergétique. L'éco-conception crée des produits durables.",
      "title": "De quoi parle-t-on ?",
      "layout": "content",
      "bullets": [
        "Green IT : réduire l'empreinte carbone du numérique",
        "Sobriété numérique : réduire la consommation énergétique",
        "Éco-conception : concevoir des produits durables"
      ],
      "subtitle": "",
      "sectionId": "de-quoi-parle-t-on"
    },
    {
      "notes": "[3:06–3:45] Le World Wide Web a vu le jour en 1990, suivi de l'explosion d'Internet en 2000. Les data centers se sont développés en 2010, et l'urgence climatique est devenue cruciale en 2020.",
      "title": "La rupture",
      "layout": "content",
      "bullets": [
        "1990 : Naissance du World Wide Web",
        "2000 : Explosion d'Internet",
        "2010 : Développement des data centers",
        "2020 : Urgence climatique",
        "[source à trouver] : la donnée à chercher"
      ],
      "subtitle": "",
      "sectionId": "la-rupture"
    },
    {
      "notes": "[3:45–4:24] Comment réduire l'empreinte carbone du numérique sans compromettre ses avantages ?",
      "title": "Problématique",
      "layout": "content",
      "bullets": [
        "Comment réduire l'empreinte carbone du numérique sans compromettre ses avantages ?"
      ],
      "subtitle": "",
      "sectionId": "problematique"
    },
    {
      "notes": "[4:24–5:03] Passons à la première partie, qui examine l'état actuel du Green IT.",
      "title": "Partie I : l'état des lieux",
      "layout": "section",
      "bullets": [],
      "subtitle": "",
      "sectionId": "intercalaire-partie-i"
    },
    {
      "notes": "[5:03–7:39] Le numérique croît exponentiellement, consommant plus d'énergie et développant les data centers. Cela a un impact environnemental considérable. Paradoxe : plus le numérique est vert, plus il est utilisé.",
      "title": "L'état des lieux",
      "layout": "content",
      "bullets": [
        "Croissance exponentielle du numérique",
        "Augmentation des consommations énergétiques",
        "Développement des data centers",
        "Impact sur l'environnement",
        "Paradoxe : plus le numérique est vert, plus il est utilisé",
        "[source à trouver] : la donnée à chercher"
      ],
      "subtitle": "",
      "sectionId": "partie-i-l-etat-des-lieux"
    },
    {
      "notes": "[7:39–8:18] Passons à la deuxième partie, qui explore comment le Green IT déplace les valeurs, compétences et rôles.",
      "title": "Partie II : le déplacement",
      "layout": "section",
      "bullets": [],
      "subtitle": "",
      "sectionId": "intercalaire-partie-ii"
    },
    {
      "notes": "[8:18–11:33] Le Green IT déplace les compétences vers l'éco-conception, instaure de nouvelles valeurs centrées sur la durabilité, et transforme les rôles et l'entrée dans le métier.",
      "title": "Le déplacement",
      "layout": "content",
      "bullets": [
        "Déplacement des compétences vers l'éco-conception",
        "Nouvelles valeurs centrées sur la durabilité",
        "Évolution des rôles dans l'industrie",
        "Impact sur l'entrée dans le métier",
        "Transformation des industries liées au numérique",
        "[source à trouver] : la donnée à chercher"
      ],
      "subtitle": "",
      "sectionId": "partie-ii-le-deplacement"
    },
    {
      "notes": "[11:33–12:12] Passons à la troisième partie, qui examine les fronts d'action pour le Green IT.",
      "title": "Partie III : les fronts",
      "layout": "section",
      "bullets": [],
      "subtitle": "",
      "sectionId": "intercalaire-partie-iii"
    },
    {
      "notes": "[12:12–12:51] Les quatre fronts d'action pour le Green IT : réduction de la consommation énergétique, éco-conception et recyclage, gestion des data centers, et sensibilisation et éducation.",
      "title": "Les enjeux",
      "layout": "content",
      "bullets": [
        "01 - Réduction de la consommation énergétique",
        "02 - Éco-conception et recyclage",
        "03 - Gestion des data centers",
        "04 - Sensibilisation et éducation",
        "[source à trouver] : la donnée à chercher"
      ],
      "subtitle": "",
      "sectionId": "les-enjeux"
    },
    {
      "notes": "[12:51–18:03] Le premier front est la réduction de la consommation énergétique. Le deuxième front est l'éco-conception et le recyclage. Le troisième front est la gestion des data centers. Le quatrième front est la sensibilisation et l'éducation.",
      "title": "Les fronts",
      "layout": "content",
      "bullets": [
        "Front 1 : Réduction de la consommation énergétique",
        "Front 2 : Éco-conception et recyclage",
        "Front 3 : Gestion des data centers",
        "Front 4 : Sensibilisation et éducation",
        "[source à trouver] : la donnée à chercher"
      ],
      "subtitle": "",
      "sectionId": "partie-iii-les-fronts"
    },
    {
      "notes": "[18:03–18:42] Les réponses aux fronts d'action : réduction de la consommation énergétique, éco-conception et recyclage, gestion des data centers, et sensibilisation et éducation.",
      "title": "Les réponses",
      "layout": "content",
      "bullets": [
        "01 - Réduction de la consommation énergétique",
        "02 - Éco-conception et recyclage",
        "03 - Gestion des data centers",
        "04 - Sensibilisation et éducation",
        "[source à trouver] : la donnée à chercher"
      ],
      "subtitle": "",
      "sectionId": "les-reponses"
    },
    {
      "notes": "[18:42–19:21] La réduction de l'empreinte carbone du numérique est possible sans compromettre ses avantages. Réponse à la problématique.",
      "title": "Conclusion",
      "layout": "content",
      "bullets": [
        "Réponse à la problématique",
        "Réduction de l'empreinte carbone",
        "Maintien des avantages du numérique",
        "Chiffres de la diapo 4",
        "[source à trouver] : la donnée à chercher"
      ],
      "subtitle": "",
      "sectionId": "conclusion"
    },
    {
      "notes": "[19:21–20:00] Quelle est la prochaine étape pour le Green IT ? Quels défis restent à relever ?",
      "title": "Ouverture",
      "layout": "content",
      "bullets": [
        "Quelle est la prochaine étape pour le Green IT ?",
        "Quels défis restent à relever ?",
        "[source à trouver] : la donnée à chercher"
      ],
      "subtitle": "",
      "sectionId": "ouverture"
    }
  ],
  "subtitle": ""
};

export const GREEN_IT_FINAL: DeckSpec = {
  "title": "Green IT v2 — Ollama",
  "slides": [
    {
      "notes": "[0:00–0:30] Bonjour, aujourd'hui nous allons explorer le thème du Green IT et voir s'il peut réellement réduire l'empreinte environnementale du numérique, ou s'il ne fait que compenser la croissance des usages.",
      "title": "Green IT v2 — Ollama",
      "layout": "title",
      "bullets": [],
      "subtitle": "Le Green IT peut-il réellement réduire l'empreinte environnementale du numérique, ou ne fait-il que compenser la croissance des usages ?",
      "sectionId": "cover"
    },
    {
      "notes": "[0:30–1:09] Je suis [à compléter : formation et école], et je m'intéresse au Green IT car il est crucial pour l'avenir durable de notre secteur.",
      "title": "Présentation",
      "layout": "section",
      "bullets": [],
      "subtitle": "",
      "sectionId": "presentation"
    },
    {
      "notes": "[1:09–1:48] Nous allons aborder trois parties : l'état des lieux, le déplacement et les fronts d'action. Nous conclurons sur les réponses et les perspectives ouvertes.",
      "title": "Sommaire",
      "layout": "section",
      "bullets": [],
      "subtitle": "",
      "sectionId": "sommaire"
    },
    {
      "notes": "[1:48–2:27] 50% des émissions de CO2 des entreprises sont liées au numérique. Objection probable : Ce chiffre est trop élevé. Réponse : Il inclut les fournisseurs et les consommateurs indirects.",
      "title": "Le chiffre d'accroche",
      "layout": "content",
      "bullets": [
        "50% des émissions de CO2 des entreprises sont liées au numérique"
      ],
      "subtitle": "",
      "sectionId": "le-chiffre-d-accroche"
    },
    {
      "notes": "[2:27–3:06] Le Green IT vise à réduire l'empreinte carbone du numérique. La sobriété numérique réduit la consommation énergétique. L'éco-conception crée des produits durables.",
      "title": "De quoi parle-t-on ?",
      "layout": "content",
      "bullets": [
        "Green IT : réduire l'empreinte carbone du numérique",
        "Sobriété numérique : réduire la consommation énergétique",
        "Éco-conception : concevoir des produits durables"
      ],
      "subtitle": "",
      "sectionId": "de-quoi-parle-t-on"
    },
    {
      "notes": "[3:06–3:45] Le World Wide Web a vu le jour en 1990, suivi de l'explosion d'Internet en 2000. Les data centers se sont développés en 2010, et l'urgence climatique est devenue cruciale en 2020.",
      "title": "La rupture",
      "layout": "content",
      "bullets": [
        "1990 : Naissance du World Wide Web",
        "2000 : Explosion d'Internet",
        "2010 : Développement des data centers",
        "2020 : Urgence climatique"
      ],
      "subtitle": "",
      "sectionId": "la-rupture"
    },
    {
      "notes": "[3:45–4:24] Comment réduire l'empreinte carbone du numérique sans compromettre ses avantages ?",
      "title": "Problématique",
      "layout": "content",
      "bullets": [
        "Comment réduire l'empreinte carbone du numérique sans compromettre ses avantages ?"
      ],
      "subtitle": "",
      "sectionId": "problematique"
    },
    {
      "notes": "[4:24–5:03] Passons à la première partie, qui examine l'état actuel du Green IT.",
      "title": "Partie I : l'état des lieux",
      "layout": "section",
      "bullets": [],
      "subtitle": "",
      "sectionId": "intercalaire-partie-i"
    },
    {
      "notes": "[5:03–7:39] Le numérique croît exponentiellement, consommant plus d'énergie et développant les data centers. Cela a un impact environnemental considérable. Paradoxe : plus le numérique est vert, plus il est utilisé.",
      "title": "L'état des lieux",
      "layout": "content",
      "bullets": [
        "Croissance exponentielle du numérique",
        "Augmentation des consommations énergétiques",
        "Développement des data centers",
        "Impact sur l'environnement",
        "Paradoxe : plus le numérique est vert, plus il est utilisé"
      ],
      "subtitle": "",
      "sectionId": "partie-i-l-etat-des-lieux"
    },
    {
      "notes": "[7:39–8:18] Passons à la deuxième partie, qui explore comment le Green IT déplace les valeurs, compétences et rôles.",
      "title": "Partie II : le déplacement",
      "layout": "section",
      "bullets": [],
      "subtitle": "",
      "sectionId": "intercalaire-partie-ii"
    },
    {
      "notes": "[8:18–11:33] Le Green IT déplace les compétences vers l'éco-conception, instaure de nouvelles valeurs centrées sur la durabilité, et transforme les rôles et l'entrée dans le métier.",
      "title": "Le déplacement",
      "layout": "content",
      "bullets": [
        "Déplacement des compétences vers l'éco-conception",
        "Nouvelles valeurs centrées sur la durabilité",
        "Évolution des rôles dans l'industrie",
        "Impact sur l'entrée dans le métier",
        "Transformation des industries liées au numérique"
      ],
      "subtitle": "",
      "sectionId": "partie-ii-le-deplacement"
    },
    {
      "notes": "[11:33–12:12] Passons à la troisième partie, qui examine les fronts d'action pour le Green IT.",
      "title": "Partie III : les fronts",
      "layout": "section",
      "bullets": [],
      "subtitle": "",
      "sectionId": "intercalaire-partie-iii"
    },
    {
      "notes": "[12:12–12:51] Les quatre fronts d'action pour le Green IT : réduction de la consommation énergétique, éco-conception et recyclage, gestion des data centers, et sensibilisation et éducation.",
      "title": "Les enjeux",
      "layout": "content",
      "bullets": [
        "01 - Réduction de la consommation énergétique",
        "02 - Éco-conception et recyclage",
        "03 - Gestion des data centers",
        "04 - Sensibilisation et éducation"
      ],
      "subtitle": "",
      "sectionId": "les-enjeux"
    },
    {
      "notes": "[12:51–18:03] Le premier front est la réduction de la consommation énergétique. Le deuxième front est l'éco-conception et le recyclage. Le troisième front est la gestion des data centers. Le quatrième front est la sensibilisation et l'éducation.",
      "title": "Les fronts",
      "layout": "content",
      "bullets": [
        "Front 1 : Réduction de la consommation énergétique",
        "Front 2 : Éco-conception et recyclage",
        "Front 3 : Gestion des data centers",
        "Front 4 : Sensibilisation et éducation"
      ],
      "subtitle": "",
      "sectionId": "partie-iii-les-fronts"
    },
    {
      "notes": "[18:03–18:42] Les réponses aux fronts d'action : réduction de la consommation énergétique, éco-conception et recyclage, gestion des data centers, et sensibilisation et éducation.",
      "title": "Les réponses",
      "layout": "content",
      "bullets": [
        "01 - Réduction de la consommation énergétique",
        "02 - Éco-conception et recyclage",
        "03 - Gestion des data centers",
        "04 - Sensibilisation et éducation"
      ],
      "subtitle": "",
      "sectionId": "les-reponses"
    },
    {
      "notes": "[18:42–19:21] La réduction de l'empreinte carbone du numérique est possible sans compromettre ses avantages. Réponse à la problématique.",
      "title": "Conclusion",
      "layout": "content",
      "bullets": [
        "Réponse à la problématique",
        "Réduction de l'empreinte carbone",
        "Maintien des avantages du numérique",
        "50% des émissions de CO2 des entreprises sont liées au numérique"
      ],
      "subtitle": "",
      "sectionId": "conclusion"
    },
    {
      "notes": "[19:21–20:00] Quelle est la prochaine étape pour le Green IT ? Quels défis restent à relever ?",
      "title": "Ouverture",
      "layout": "content",
      "bullets": [
        "Quelle est la prochaine étape pour le Green IT ?",
        "Quels défis restent à relever ?"
      ],
      "subtitle": "",
      "sectionId": "ouverture"
    }
  ],
  "subtitle": ""
};
