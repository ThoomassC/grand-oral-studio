import type { DeckEngine, DeckKind } from "./repo/types";

/**
 * Noms de fichier pour Content-Disposition. Fonctions pures.
 *
 * - `safeFilename` : forme ASCII (repli `filename=`), sans séparateur de chemin,
 *   guillemet, retour ligne ni caractère de contrôle (pas d'injection d'en-tête).
 * - `unicodeFilename` : forme lisible, accents conservés (annoncée en
 *   `filename*=UTF-8''…`, RFC 5987 / 6266), mêmes exclusions.
 */
export function safeFilename(raw: string, extension: string, fallback = "deck"): string {
  const base = raw
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^A-Za-z0-9_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-_ ]+|[-_ ]+$/g, "")
    .slice(0, 80)
    .trim();
  return `${base || fallback}.${cleanExtension(extension)}`;
}

function cleanExtension(extension: string): string {
  return extension.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

/** Lettres (accents compris), chiffres, espaces, ponctuation de titre sûre ; tout le reste devient une espace. */
const UNSAFE_FILENAME_CHARS = /[^\p{L}\p{N}\p{M} _\-'’«»()&,+]+/gu;

export function unicodeFilename(raw: string, extension: string, fallback = "deck"): string {
  const base = Array.from(
    raw
      .normalize("NFC")
      .replace(UNSAFE_FILENAME_CHARS, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[-_ '’]+|[-_ ]+$/g, ""),
  )
    .slice(0, 80)
    .join("")
    .trim();
  return `${base || fallback}.${cleanExtension(extension)}`;
}

/** RFC 5987 : encodeURIComponent laisse passer ' ( ) * qui doivent être encodés. */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * En-tête Content-Disposition d'une seule ligne : `filename` ASCII (déjà
 * assaini) et, si le nom lisible diffère, `filename*` encodé UTF-8.
 */
export function attachmentHeader(filename: string, unicodeName?: string): string {
  const plain = `attachment; filename="${filename}"`;
  return unicodeName && unicodeName !== filename ? `${plain}; filename*=UTF-8''${encodeRfc5987(unicodeName)}` : plain;
}

const ENGINE_LABEL: Record<DeckEngine, string> = {
  free: "Gratuit",
  ollama: "Ollama",
  claude: "Claude",
  mistral: "Mistral",
  gemini: "Gemini",
  openai: "OpenAI",
  mock: "Démo",
};

export interface DeckFileInfo {
  /** null : deck final sans sujet (la partie est alors omise). */
  themeName: string | null;
  kind: DeckKind;
  engine: DeckEngine | null;
  createdAt: Date;
}

/**
 * Titre de fichier d'un deck, identique quel que soit le moteur (le titre du
 * deck, lui, dépend du moteur : problématique tronquée, nom du sujet…) :
 * « Sujet - deck final - Moteur - AAAA-MM-JJ » (« deck final - Moteur - … » sans
 * sujet) ou « Sujet - squelette - Moteur » (anciens squelettes v1.0).
 */
export function deckFileTitle(info: DeckFileInfo): string {
  const parts = [info.themeName?.trim() ?? "", info.kind === "SKELETON" ? "squelette" : "deck final"];
  if (info.engine) parts.push(ENGINE_LABEL[info.engine]);
  if (info.kind === "FINAL") parts.push(parisDate(info.createdAt));
  return parts.filter(Boolean).join(" - ");
}

/** Les utilisateurs sont en France : le jour du nom de fichier est celui de Paris, pas d'UTC. */
const PARIS_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });

/** « AAAA-MM-JJ » dans le fuseau Europe/Paris (heure d'été comprise). */
function parisDate(date: Date): string {
  const parts = PARIS_DAY.formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
