import type { CloudProvider, EngineId, KeySource } from "@/domain/ai-providers";
import type { ThemeRef } from "@/domain/contracts";
import type { Brand, DeckSpec, PromptTemplate } from "@/domain/schemas";
import type { ProjectProgress, ProjectProgressSummary } from "@/domain/progress";
import type { DeckKind } from "../db/generated/prisma/enums";
import type { ProgramRole } from "./access";

/**
 * Vues renvoyées par la couche d'accès aux données. Les champs JSON sont
 * toujours typés par les schémas zod du domaine (validés à la lecture).
 */

export type { DeckKind, ProgramRole };

export interface ProgramSummary {
  id: string;
  name: string;
  description: string;
  /** Nombre de sujets (les « thèmes » du code). */
  themeCount: number;
  createdAt: Date;
  updatedAt: Date;
  /** Avancement du parcours en 3 étapes : Apparence, Trame, Jour J (résumé, sans le détail des étapes). */
  progress: ProjectProgressSummary;
  /** Rôle de l'utilisateur sur ce projet. */
  role: ProgramRole;
  /** Nom du propriétaire d'un projet partagé ; null quand l'utilisateur est le propriétaire. */
  ownerName: string | null;
}

/** Moteur qui a produit un deck ("free" : généré sans IA, à compléter ; "mock" : démo). */
export type DeckEngine = EngineId | "mock";

export interface DeckView {
  id: string;
  programId: string;
  /** null : deck final produit sans sujet (jamais pour un squelette, garanti par la base). */
  themeId: string | null;
  kind: DeckKind;
  problem: string | null;
  /** null : deck antérieur au suivi du moteur. */
  engine: DeckEngine | null;
  /** Deck d'entraînement (true) ou du jour J (false). Toujours false pour un squelette. */
  practice: boolean;
  spec: DeckSpec;
  createdAt: Date;
  updatedAt: Date;
}

export interface ThemeView extends ThemeRef {
  programId: string;
  position: number;
  /** Problématiques candidates du sujet (30 au plus). */
  problems: string[];
  /** Version du sujet (ISO) : base de la concurrence optimiste. */
  updatedAt: string;
}

export interface ThemeWithSkeleton extends ThemeView {
  skeleton: DeckView | null;
  /** Nombre de decks finaux (jour J) du thème. */
  finalDeckCount: number;
}

export interface ProgramDetail {
  id: string;
  name: string;
  description: string;
  brand: Brand;
  template: PromptTemplate;
  /** Dernier enregistrement de la charte (ISO) ; null = charte par défaut jamais enregistrée. */
  brandSavedAt: string | null;
  templateSavedAt: string | null;
  createdAt: Date;
  updatedAt: Date;
  themes: ThemeWithSkeleton[];
  /** Tous les decks finaux du projet, sujet ou non (le compteur par sujet ne voit pas les decks sans sujet). */
  finalDeckCount: number;
  /** Parcours du projet en 3 étapes, avec les onglets de la Trame (cf. src/domain/progress.ts). */
  progress: ProjectProgress;
  /** Rôle de l'utilisateur sur ce projet. */
  role: ProgramRole;
}

/**
 * Deck accompagné de ce qu'il faut pour l'exporter (apparence et trame du
 * programme). `updatedAt` en ISO : c'est la version à renvoyer à updateDeckSlide.
 */
export interface DeckWithProgram extends Omit<DeckView, "updatedAt"> {
  updatedAt: string;
  /** null : deck final sans sujet. */
  themeName: string | null;
  program: { id: string; name: string; brand: Brand; template: PromptTemplate };
}

export interface FinalDeckSummary {
  id: string;
  engine: DeckEngine | null;
  /** null : deck produit sans sujet. */
  themeId: string | null;
  themeName: string | null;
  problem: string;
  title: string;
  /** Deck d'entraînement (true) ou du jour J (false). */
  practice: boolean;
  createdAt: Date;
}

/** Une clé personnelle enregistrée (jamais la clé : ses 4 derniers caractères). */
export interface AiConnectionView {
  provider: CloudProvider;
  last4: string;
  /** Modèle effectivement utilisé avec cette clé (celui choisi, sinon le défaut du catalogue). */
  model: string;
  /** Le modèle n'a pas été choisi : défaut du catalogue (AI_MODEL pour Claude). */
  defaultModel: boolean;
  /** ISO ; null = jamais vérifiée depuis la 1.2 (clé reprise de la 1.1). */
  verifiedAt: string | null;
  /** ISO. */
  updatedAt: string;
}

/** Rédacteur qui sera tenté à la prochaine génération (calculé sans réseau ni déchiffrement). */
export interface AiWriterState {
  engine: EngineId | "mock";
  /** Origine de la clé d'un fournisseur cloud ; null hors cloud (et pour un choix inutilisable sans origine). */
  keySource: KeySource | null;
  /** Modèle (cloud ou Ollama) ; "mock" en démo ; null pour Sans IA ou un choix inutilisable. */
  model: string | null;
  /** false : la génération échouera avec `problem` (jamais de bascule silencieuse). */
  ready: boolean;
  problem: string | null;
}

/** Vue légère pour les bandeaux (« Rédaction : X ») : sans sonde Ollama. */
export interface WriterView extends AiWriterState {
  /** Libellé prêt à afficher : « Mistral (votre clé) », « Claude (clé d'équipe) », « Ollama · qwen2.5 », « Sans IA ». */
  label: string;
}

/**
 * Réglages IA d'un utilisateur, tels que montrés dans la Configuration IA. Ne contient
 * JAMAIS une clé (ni chiffrée ni en clair) : seulement ses 4 derniers caractères.
 */
export interface AiSettingsView {
  /** Clés personnelles enregistrées, triées par fournisseur. */
  connections: AiConnectionView[];
  /** Fournisseurs pour lesquels le serveur fournit une clé d'équipe. */
  team: CloudProvider[];
  /** Choix enregistré ; engine null = choix par défaut (règle 1.1). */
  selection: { engine: EngineId | null; keySource: KeySource | null };
  effective: AiWriterState;
  /** AI_PROVIDER=mock : la clé d'équipe Claude est remplacée par le mode démo. */
  mock: boolean;
  ollama: {
    /** OLLAMA_BASE_URL renseignée côté serveur. */
    configured: boolean;
    /** Sonde GET /api/tags réussie (délai ~1,5 s). */
    reachable: boolean;
    /** Modèles installés, triés. */
    models: string[];
    /** Modèle enregistré par l'utilisateur (peut ne plus être installé). */
    selectedModel: string | null;
  };

  // --- Vue 1.1, conservée pour l'écran actuel jusqu'au lot UI -----------------

  /** @deprecated Connexion Claude ; utiliser `connections`. */
  userKey: { configured: boolean; last4: string | null; updatedAt: string | null };
  /** @deprecated Clé que Claude utiliserait ("none" : aucune). */
  effectiveSource: "user" | "server" | "mock" | "none";
  /** @deprecated Modèle Claude ("mock" quand AI_PROVIDER=mock remplace la clé serveur). */
  model: string;
  /**
   * @deprecated Utiliser `selection` et `effective`. Moteurs de la 1.1 seulement :
   * un fournisseur ajouté en 1.2 y apparaît comme `selected: null`,
   * `effective: "claude"` (moteur cloud).
   */
  engine: {
    selected: "claude" | "ollama" | "free" | null;
    effective: "claude" | "ollama" | "free" | "mock";
    available: {
      claude: boolean;
      ollama: { configured: boolean; reachable: boolean; models: string[]; selectedModel: string | null };
      free: true;
    };
  };
}

/** Méthode de connexion d'un compte : e-mail et mot de passe, ou Google. */
export type SignInMethod = "password" | "google";

/** Profil de l'utilisateur (page /profil). Aucun secret ni identifiant de compte. */
export interface ProfileView {
  name: string;
  email: string;
  /** ISO 8601. */
  createdAt: string;
  signInMethods: SignInMethod[];
  projectCount: number;
}
