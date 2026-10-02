import type { ThemeRef } from "@/domain/contracts";
import type { Brand, DeckSpec, PromptTemplate } from "@/domain/schemas";
import type { ProjectProgress, ProjectProgressSummary } from "@/domain/progress";
import type { DeckKind } from "../db/generated/prisma/enums";

/**
 * Vues renvoyées par la couche d'accès aux données. Les champs JSON sont
 * toujours typés par les schémas zod du domaine (validés à la lecture).
 */

export type { DeckKind };

export interface ProgramSummary {
  id: string;
  name: string;
  description: string;
  themeCount: number;
  /** Thèmes disposant d'un squelette. */
  skeletonCount: number;
  createdAt: Date;
  updatedAt: Date;
  /** Avancement du parcours en 5 étapes (résumé, sans le détail des étapes). */
  progress: ProjectProgressSummary;
}

/** Moteur qui a produit un deck ("free" : généré sans IA, à compléter). */
export type DeckEngine = "claude" | "ollama" | "free" | "mock";

export interface DeckView {
  id: string;
  programId: string;
  themeId: string;
  kind: DeckKind;
  problem: string | null;
  /** null : deck antérieur au suivi du moteur. */
  engine: DeckEngine | null;
  spec: DeckSpec;
  createdAt: Date;
  updatedAt: Date;
}

export interface ThemeView extends ThemeRef {
  programId: string;
  position: number;
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
  /** Parcours en 5 étapes : thèmes, charte, gabarit, squelettes, jour J. */
  progress: ProjectProgress;
}

/**
 * Deck accompagné de ce qu'il faut pour l'exporter (charte et gabarit du
 * programme). `updatedAt` en ISO : c'est la version à renvoyer à updateDeckSlide.
 */
export interface DeckWithProgram extends Omit<DeckView, "updatedAt"> {
  updatedAt: string;
  themeName: string;
  program: { id: string; name: string; brand: Brand; template: PromptTemplate };
}

export interface FinalDeckSummary {
  id: string;
  engine: DeckEngine | null;
  themeId: string;
  themeName: string;
  problem: string;
  title: string;
  createdAt: Date;
}

/**
 * Réglages IA d'un utilisateur, tels que montrés dans Paramètres. Ne contient
 * JAMAIS la clé (ni chiffrée ni en clair) : seulement ses 4 derniers caractères.
 * `model` vaut "mock" quand les générations sont simulées.
 */
export interface AiSettingsView {
  userKey: { configured: boolean; last4: string | null; updatedAt: string | null };
  /** Clé que le moteur Claude utiliserait ("none" : aucune). */
  effectiveSource: "user" | "server" | "mock" | "none";
  /** Modèle Claude configuré ("mock" quand AI_PROVIDER=mock remplace la clé serveur). */
  model: string;
  engine: {
    /** Préférence enregistrée ; null = choix par défaut (Claude si une clé existe, sinon gratuit). */
    selected: "claude" | "ollama" | "free" | null;
    /**
     * Moteur qui sera tenté à la prochaine génération. S'il n'est pas disponible
     * (cf. `available`), la génération échoue avec un message qui renvoie vers Paramètres.
     */
    effective: "claude" | "ollama" | "free" | "mock";
    available: {
      claude: boolean;
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
