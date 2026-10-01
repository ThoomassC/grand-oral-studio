import type { ProgramContext, ThemeRef } from "@/domain/contracts";
import { defaultTemplate } from "@/domain/defaults";

/**
 * Programme fictif et générique d'un master informatique / management : neuf
 * thèmes, chacun avec une description et des mots-clés tels qu'un responsable
 * pédagogique les saisirait. Aucune école ni marque réelle.
 */
export function makeMasterThemes(): ThemeRef[] {
  return [
    {
      id: "cyber",
      name: "Cybersécurité et gestion des risques",
      description:
        "Protection des systèmes d'information face aux menaces : attaques, vulnérabilités, continuité d'activité et gouvernance de la sécurité.",
      keywords: ["cyberattaque", "rançongiciel", "vulnérabilité", "gestion des risques", "phishing", "sécurité informatique", "piratage"],
    },
    {
      id: "transfo",
      name: "Transformation numérique des organisations",
      description:
        "Comment les technologies numériques modifient les processus, les métiers, les modèles d'affaires et la relation client des entreprises et des administrations.",
      keywords: ["digitalisation", "dématérialisation", "processus", "outils collaboratifs", "relation client", "télétravail", "numérisation"],
    },
    {
      id: "ia",
      name: "Intelligence artificielle et éthique",
      description:
        "Apports et risques des systèmes d'intelligence artificielle : apprentissage automatique, biais des algorithmes, responsabilité, transparence et régulation.",
      keywords: ["algorithme", "biais", "apprentissage automatique", "IA générative", "explicabilité", "automatisation", "régulation"],
    },
    {
      id: "agile",
      name: "Management de projet agile",
      description:
        "Méthodes et pratiques de pilotage de projet itératif : organisation des équipes, livraisons fréquentes, rôle du client et comparaison avec le cycle en V.",
      keywords: ["Scrum", "sprint", "méthode agile", "équipe", "cycle en V", "chef de projet", "itération", "planning"],
    },
    {
      id: "cloud",
      name: "Cloud et infrastructures",
      description:
        "Hébergement et exploitation des systèmes : informatique en nuage, centres de données, serveurs, virtualisation, souveraineté et coûts d'infrastructure.",
      keywords: ["cloud", "hébergement", "serveur", "datacenter", "virtualisation", "souveraineté", "SaaS", "migration"],
    },
    {
      id: "rgpd",
      name: "Données et RGPD",
      description:
        "Collecte, exploitation et protection des données personnelles : cadre du règlement européen, consentement, droits des personnes, valorisation des données.",
      keywords: ["données personnelles", "RGPD", "vie privée", "consentement", "CNIL", "big data", "conformité"],
    },
    {
      id: "green",
      name: "Développement durable et numérique responsable",
      description:
        "Impact environnemental du numérique et leviers de sobriété : consommation d'énergie, empreinte carbone, fabrication et recyclage des équipements, écoconception.",
      keywords: ["sobriété", "empreinte carbone", "écoconception", "énergie", "recyclage", "Green IT", "environnement", "RSE"],
    },
    {
      id: "innov",
      name: "Innovation et entrepreneuriat",
      description:
        "Création et croissance d'entreprises innovantes : start-up, financement, levée de fonds, modèle économique, propriété intellectuelle et écosystèmes d'innovation.",
      keywords: ["start-up", "levée de fonds", "business model", "créer une entreprise", "incubateur", "brevet", "innovation", "investisseur"],
    },
    {
      id: "change",
      name: "Conduite du changement",
      description:
        "Accompagner les collaborateurs lors d'une réorganisation ou d'un nouveau projet : résistance au changement, communication, formation, adhésion et culture d'entreprise.",
      keywords: ["résistance", "accompagnement", "adhésion", "formation", "communication interne", "culture d'entreprise", "collaborateurs"],
    },
  ];
}

export function makeMasterProgram(themes: ThemeRef[] = makeMasterThemes()): ProgramContext {
  return {
    name: "Master fictif Informatique et Management",
    description: "Programme de grand oral de fin de master, thèmes transverses informatique et management.",
    themes,
    template: defaultTemplate(),
  };
}

/** Problématiques étiquetées, rédigées comme le feraient des étudiants. */
export const LABELED_PROBLEMS: ReadonlyArray<{ problem: string; expected: string }> = [
  { problem: "Comment une PME peut-elle se protéger efficacement contre les rançongiciels ?", expected: "cyber" },
  { problem: "Le facteur humain est-il le maillon faible face au phishing en entreprise ?", expected: "cyber" },
  { problem: "Faut-il payer la rançon après une attaque informatique paralysant un hôpital ?", expected: "cyber" },
  { problem: "En quoi le télétravail transforme-t-il le fonctionnement des entreprises ?", expected: "transfo" },
  { problem: "La dématérialisation des services publics exclut-elle une partie des usagers ?", expected: "transfo" },
  { problem: "Dans quelle mesure les outils numériques modifient-ils les métiers du commerce ?", expected: "transfo" },
  { problem: "Peut-on faire confiance à un algorithme pour recruter des candidats sans discrimination ?", expected: "ia" },
  { problem: "Les IA génératives menacent-elles les métiers créatifs ?", expected: "ia" },
  { problem: "Qui est responsable quand une voiture autonome provoque un accident ?", expected: "ia" },
  { problem: "La méthode Scrum est-elle adaptée aux grands projets industriels ?", expected: "agile" },
  { problem: "Pourquoi tant de projets informatiques dépassent-ils leur budget et leurs délais ?", expected: "agile" },
  { problem: "Quel rôle pour le chef de projet dans une équipe auto-organisée ?", expected: "agile" },
  { problem: "Les entreprises européennes doivent-elles quitter les hébergeurs américains pour garantir leur souveraineté ?", expected: "cloud" },
  { problem: "Migrer son système d'information vers le cloud permet-il vraiment de réduire les coûts ?", expected: "cloud" },
  { problem: "Le consentement des utilisateurs aux cookies est-il vraiment libre et éclairé ?", expected: "rgpd" },
  { problem: "Comment concilier exploitation commerciale des données clients et respect de la vie privée ?", expected: "rgpd" },
  { problem: "Le numérique peut-il réduire son empreinte carbone sans renoncer à la croissance des usages ?", expected: "green" },
  { problem: "Faut-il limiter le renouvellement des smartphones pour préserver les ressources de la planète ?", expected: "green" },
  { problem: "Comment une jeune start-up peut-elle convaincre des investisseurs sans chiffre d'affaires ?", expected: "innov" },
  { problem: "Les incubateurs augmentent-ils réellement les chances de survie des jeunes entreprises ?", expected: "innov" },
  { problem: "Comment surmonter la résistance des salariés lors du déploiement d'un nouvel ERP ?", expected: "change" },
  { problem: "Pourquoi tant de réorganisations échouent-elles malgré un plan de communication soigné ?", expected: "change" },
  { problem: "Former les collaborateurs suffit-il à faire accepter un nouvel outil de travail ?", expected: "change" },
  { problem: "L'intelligence artificielle va-t-elle remplacer les analystes en sécurité des réseaux ?", expected: "ia" },
];
