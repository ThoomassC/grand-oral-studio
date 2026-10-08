import type { ExportedProject } from "./project-export";
import type { Brand, PromptTemplate } from "./schemas";

/**
 * Projet d'exemple « Grand oral MAALSI (exemple) » : trois sujets prêts à l'emploi
 * pour découvrir l'application sans partir d'une page blanche, avec l'apparence
 * CESI et une trame générique de grand oral. Aucun diaporama.
 *
 * Les chiffres et sources des notes sont PLAUSIBLES mais donnés à titre d'exemple :
 * chaque note le rappelle, l'utilisateur doit les vérifier avant son oral.
 * Chaque appel renvoie un objet neuf.
 */

export const EXAMPLE_PROJECT_NAME = "Grand oral MAALSI (exemple)";

const EXAMPLE_WARNING = "Exemple : chiffres et sources à vérifier (et à dater) avant l'oral.";

/**
 * Apparence CESI, relevée sur un support de grand oral MAALSI : fonds blancs,
 * titres et couverture noirs (#111111), texte #222222, sous-titres #333333,
 * jaune CESI (#FBE216) en accent, Arial partout. Pas de logo : le support n'en
 * embarquait pas, chacun ajoute le sien dans l'Apparence.
 */
export function cesiBrand(): Brand {
  return {
    name: "CESI",
    colors: {
      primary: "#111111",
      secondary: "#333333",
      accent: "#FBE216",
      background: "#FFFFFF",
      text: "#222222",
    },
    fonts: { heading: "Arial", body: "Arial" },
    logoDataUrl: null,
  };
}

/**
 * Trame générique d'un grand oral, sur la structure de ce même support :
 * problématique, cas et enjeux, trois axes (solution, mise en œuvre, garde-fous),
 * conclusion. 12 diapos couverture comprise pour 20 minutes (la diapo finale
 * « Questions ? » du support, sans contenu, n'est pas reprise).
 *
 * Les titres évitent « question » et « plan » : sectionKind (domain/free/outline)
 * les lirait comme une problématique ou une annonce du plan.
 */
export function exampleTemplate(): PromptTemplate {
  return {
    format: "16:9",
    language: "fr",
    durationMinutes: 20,
    sections: [
      {
        id: "problem",
        title: "Problématique",
        guidance: "La problématique tirée, recopiée mot pour mot, et pourquoi elle se pose aujourd'hui.",
        slides: 1,
      },
      {
        id: "intro",
        title: "Introduction : contexte et enjeux",
        guidance:
          "Le cas concret qui sert de fil rouge (entreprise, projet, mission), son contexte, l'objectif visé et les critères qui permettront de juger la réponse.",
        slides: 1,
      },
      {
        id: "part1",
        title: "Premier axe : la solution proposée",
        guidance:
          "Ce qui est mis en place : sources et outils, architecture cible, et pourquoi ce choix plutôt qu'un autre.",
        slides: 2,
      },
      {
        id: "part2",
        title: "Deuxième axe : mise en œuvre et résultats",
        guidance:
          "Comment la solution fonctionne sur le cas : organisation des données ou des traitements, indicateurs suivis, restitution, et ce qu'elle change concrètement pour la décision.",
        slides: 4,
      },
      {
        id: "part3",
        title: "Troisième axe : garde-fous, limites et déploiement",
        guidance:
          "Qualité, sécurité, éthique et RGPD ; limites de la solution ; conditions de réussite et étapes du déploiement.",
        slides: 2,
      },
      {
        id: "conclusion",
        title: "Conclusion",
        guidance:
          "Réponse explicite et nuancée à la problématique, apport du cas, étape suivante, puis ouverture vers les échanges avec le jury.",
        slides: 1,
      },
    ],
    tone: "Clair, structuré et argumenté, niveau master",
    constraints:
      "Au plus six puces courtes par diapo. Une idée par diapo, annoncée par un titre qui l'affirme. Chaque axe s'appuie sur le cas concret.",
  };
}

export function exampleProject(): ExportedProject {
  return {
    name: EXAMPLE_PROJECT_NAME,
    description:
      "Projet d'exemple : trois sujets de grand oral du titre MAALSI (manager en architecture et applications logicielles des systèmes d'information), avec notes et problématiques. Modifiez-le librement ou supprimez-le.",
    brand: cesiBrand(),
    template: exampleTemplate(),
    themes: [
      {
        name: "Sobriété numérique et éco-conception",
        description:
          "Réduire l'empreinte environnementale des services numériques : terminaux, réseaux, centres de données et logiciels, de la conception à la fin de vie.",
        keywords: ["Green IT", "éco-conception", "RGESN", "loi REEN", "empreinte carbone", "durée de vie des terminaux"],
        notes: [
          EXAMPLE_WARNING,
          "- Le numérique pèserait environ 2,5 % de l'empreinte carbone de la France (étude ADEME-Arcep, 2022).",
          "- La fabrication des terminaux concentrerait près de 80 % de cet impact : allonger leur durée de vie est le premier levier.",
          "- Cadre légal : loi REEN (2021) ; référentiel général d'écoconception de services numériques (RGESN, 2024).",
          "- Exemple d'entreprise : alléger une application métier (images, requêtes, données conservées) pour qu'elle reste utilisable sur des postes de plus de 6 ans.",
          "- Limite : effet rebond, les gains d'efficacité peuvent être absorbés par la hausse des usages.",
        ].join("\n"),
        problems: [
          "Comment concilier la transformation numérique d'une entreprise avec ses engagements de réduction d'empreinte environnementale ?",
          "L'éco-conception des logiciels est-elle un levier réel de sobriété ou un simple argument d'image ?",
          "Quel rôle l'architecte des systèmes d'information doit-il jouer dans la sobriété numérique de son organisation ?",
        ],
      },
      {
        name: "Cybersécurité et résilience des SI",
        description:
          "Protéger les systèmes d'information face aux rançongiciels et aux attaques de la chaîne d'approvisionnement, et garantir la continuité d'activité.",
        keywords: ["cybersécurité", "NIS 2", "rançongiciel", "zero trust", "PCA/PRA", "ANSSI"],
        notes: [
          EXAMPLE_WARNING,
          "- Coût moyen mondial d'une violation de données : environ 4,5 M$ (IBM, Cost of a Data Breach, 2023).",
          "- L'ANSSI publie chaque année un panorama de la cybermenace : les rançongiciels y visent de plus en plus les PME et les collectivités.",
          "- Directive européenne NIS 2 : élargit fortement le nombre d'entités soumises à des obligations de sécurité et de notification d'incidents.",
          "- Bonnes pratiques : sauvegardes hors ligne testées, authentification multifacteur, segmentation du réseau, exercices de crise.",
          "- Exemple : une attaque par un prestataire compromis montre que la sécurité dépend aussi de la chaîne d'approvisionnement.",
        ].join("\n"),
        problems: [
          "Comment une organisation peut-elle rester opérationnelle face à une cyberattaque majeure ?",
          "Le modèle « zero trust » est-il adapté aux moyens d'une PME ?",
        ],
      },
      {
        name: "IA générative en entreprise",
        description:
          "Intégrer l'intelligence artificielle générative dans les processus et les applications de l'entreprise : gains attendus, risques, gouvernance et conformité.",
        keywords: ["IA générative", "AI Act", "RGPD", "gouvernance des données", "productivité", "souveraineté"],
        notes: [
          EXAMPLE_WARNING,
          "- Règlement européen sur l'IA (AI Act) : entré en vigueur en août 2024, obligations graduées selon le niveau de risque du système.",
          "- RGPD : les données personnelles envoyées à un modèle hébergé hors de l'UE posent la question du transfert et de la finalité.",
          "- Gains souvent cités : rédaction, synthèse, assistance au développement ; à mesurer sur des cas d'usage précis plutôt qu'en moyenne.",
          "- Risques : réponses inexactes (« hallucinations »), fuite d'informations confidentielles, dépendance à un fournisseur.",
          "- Exemple : un assistant interne branché sur la documentation de l'entreprise, avec contrôle des accès et relecture humaine.",
        ].join("\n"),
        problems: [
          "Comment déployer l'IA générative en entreprise sans perdre la maîtrise de ses données ?",
          "L'IA générative transforme-t-elle le métier de développeur ou seulement ses outils ?",
          "Quelle gouvernance mettre en place pour encadrer les usages de l'IA générative dans une organisation ?",
        ],
      },
    ],
    decks: [],
  };
}
