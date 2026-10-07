import { z } from "zod";
import type { ThemeRef } from "./contracts";
import { COVER_SECTION_ID } from "./deck";
import { sectionKind } from "./free/outline";
import { truncateText } from "./normalize";
import {
  baseTitle,
  figureSentences,
  findFigure,
  findSources,
  flatKey,
  sectionGroups,
  sentences,
  spokenNotes,
  uniqueCaseless,
} from "./revision-sheet";
import { stripControlChars, type DeckSpec, type Slide } from "./schemas";

/**
 * Questions probables du jury : contrat de la réponse IA et repli déterministe
 * sans IA, construit à partir du diaporama et du sujet (rien n'est inventé).
 */

export const JURY_LIMITS = { minQuestions: 1, maxQuestions: 12, question: 1000, answer: 4000 } as const;

const text = () => z.string().overwrite(stripControlChars).trim();

export const JuryQuestionSchema = z.object({
  question: text()
    .min(1, "La question ne peut pas être vide.")
    .max(JURY_LIMITS.question, `Une question ne doit pas dépasser ${JURY_LIMITS.question} caractères.`),
  answer: text()
    .min(1, "Les éléments de réponse ne peuvent pas être vides.")
    .max(JURY_LIMITS.answer, `Les éléments de réponse ne doivent pas dépasser ${JURY_LIMITS.answer} caractères.`),
});
export type JuryQuestion = z.infer<typeof JuryQuestionSchema>;

/** Racine objet (et non tableau) : exigée par les sorties structurées json_schema des fournisseurs. */
export const JuryQuestionsSchema = z.object({
  questions: z
    .array(JuryQuestionSchema)
    .min(JURY_LIMITS.minQuestions, "Au moins une question est attendue.")
    .max(JURY_LIMITS.maxQuestions, `${JURY_LIMITS.maxQuestions} questions au plus.`),
});
export type JuryQuestions = z.infer<typeof JuryQuestionsSchema>;

// ---------------------------------------------------------------------------
// Repli sans IA
// ---------------------------------------------------------------------------

/** Le repli produit au plus 10 questions ; les 8 questions génériques garantissent le minimum de 8. */
const FALLBACK_MAX = 10;
const MAX_OBJECTIONS = 3;
const MAX_FIGURES = 2;
const MAX_KEYWORDS = 2;
const MAX_AXES = 2;
const EXCERPT_MAX = 600;

const OBJECTION_LINE = /^\s*objection probable\s*:\s*(.+)$/i;
/** Séparateur objection / réponse : « — Réponse : », « Réponse : », « → », tiret long. */
const ANSWER_SPLIT = /\s*(?:[—–]\s*)?(?:réponse\s*:|→)\s*|\s+[—–]\s+/i;

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function upperFirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function withoutFinalStop(value: string): string {
  return value.trim().replace(/[\s.!?…;:]+$/, "");
}

/** Notes d'orateur à dire : sans repère de minutage ni ligne d'objection. */
function talkingPoints(slide: Slide): string {
  return spokenNotes(slide.notes)
    .split(/\r\n?|\n/)
    .filter((line) => !OBJECTION_LINE.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Puces puis notes d'une ou plusieurs diapos, bornées ; "" si rien. */
function excerpt(slides: readonly Slide[]): string {
  const bullets = slides.flatMap((s) => s.bullets).join(" ; ");
  const notes = slides.map(talkingPoints).filter(Boolean).join(" ");
  const parts = [bullets && `${bullets}.`, notes].filter(Boolean).join(" ");
  return truncateText(parts.trim(), EXCERPT_MAX);
}

interface Objection {
  objection: string;
  answer: string | null;
  slide: Slide;
}

function objectionsOf(spec: DeckSpec): Objection[] {
  const out: Objection[] = [];
  for (const slide of spec.slides) {
    for (const line of slide.notes.split(/\r\n?|\n/)) {
      const match = line.match(OBJECTION_LINE);
      if (!match) continue;
      const [objection = "", ...rest] = match[1]!.split(ANSWER_SPLIT);
      const answer = upperFirst(rest.join(" ").trim());
      if (withoutFinalStop(objection)) out.push({ objection: withoutFinalStop(objection), answer: answer || null, slide });
    }
  }
  return out;
}

/** Axes du développement : lignes « partie » du diaporama (ni couverture, ni intro, problématique, plan, conclusion). */
function axesOf(spec: DeckSpec): { title: string; slides: Slide[] }[] {
  return sectionGroups(spec)
    .filter((g) => g.sectionId !== COVER_SECTION_ID)
    .map((g) => ({ title: baseTitle(g.slides[0]!.title), slides: g.slides }))
    .filter((g) => g.slides.every((s) => s.layout !== "conclusion") && sectionKind({ id: g.slides[0]!.sectionId, title: g.title }) === "part");
}

function conclusionSlides(spec: DeckSpec): Slide[] {
  const explicit = spec.slides.filter((s) => s.layout === "conclusion");
  if (explicit.length > 0) return explicit;
  const last = spec.slides[spec.slides.length - 1];
  return last && last.sectionId !== COVER_SECTION_ID ? [last] : [];
}

function objectionQuestions(spec: DeckSpec): JuryQuestion[] {
  return objectionsOf(spec)
    .slice(0, MAX_OBJECTIONS)
    .map(({ objection, answer, slide }) => ({
      question: `On pourrait vous objecter que ${lowerFirst(objection)}. Que répondez-vous ?`,
      answer:
        answer ??
        `Préparez une réponse appuyée sur la diapo « ${slide.title} » : ${excerpt([slide]) || "reprenez son argument principal et un exemple précis."}`,
    }));
}

function synthesisQuestion(spec: DeckSpec): JuryQuestion {
  const conclusion = excerpt(conclusionSlides(spec));
  return {
    question: `En une phrase, quelle est votre réponse à la question « ${withoutFinalStop(spec.title)} » ?`,
    answer: conclusion
      ? `Reprenez votre conclusion : ${conclusion}`
      : "Énoncez votre réponse d'abord, puis les deux arguments qui la justifient, sans relire vos diapos.",
  };
}

function orderQuestion(axes: readonly { title: string; slides: Slide[] }[]): JuryQuestion[] {
  const [first, second] = axes;
  if (!first || !second || flatKey(first.title) === flatKey(second.title)) return [];
  const firstPoints = excerpt(first.slides);
  return [
    {
      question: `Pourquoi avoir commencé par « ${first.title} » plutôt que par « ${second.title} » ?`,
      answer:
        `Justifiez l'ordre du plan : dites ce que « ${first.title} » établit et pourquoi « ${second.title} » en a besoin ensuite.` +
        (firstPoints ? ` Appuyez-vous sur : ${firstPoints}` : ""),
    },
  ];
}

function figureQuestions(spec: DeckSpec): JuryQuestion[] {
  const out: JuryQuestion[] = [];
  const seen = new Set<string>();
  for (const slide of spec.slides) {
    const text = [...slide.bullets, talkingPoints(slide)].join("\n");
    for (const sentence of figureSentences(text)) {
      const figure = findFigure(sentence);
      if (!figure || seen.has(flatKey(figure))) continue;
      seen.add(flatKey(figure));
      // Seules les sources de la diapo valent pour son chiffre : celles du sujet peuvent porter sur autre chose.
      const sources = uniqueCaseless([...findSources(slide.notes), ...slide.bullets.flatMap(findSources)]).map(withoutFinalStop);
      out.push({
        question: `D'où vient le chiffre « ${figure} » cité sur la diapo « ${slide.title} », et que mesure-t-il exactement ?`,
        answer:
          `${sentence} ` +
          (sources.length > 0 ? `Source : ${sources.slice(0, 2).join(" ; ")}.` : "Source à préciser avant l'oral : auteur, titre, année."),
      });
      if (out.length === MAX_FIGURES) return out;
    }
  }
  return out;
}

function keywordQuestions(subject: ThemeRef | null): JuryQuestion[] {
  if (!subject) return [];
  const figures = figureSentences(subject.notes);
  const all = sentences(subject.notes);
  const mentioning = (pool: readonly string[], keyword: string) => pool.find((s) => flatKey(s).includes(flatKey(keyword)));
  const keywords = uniqueCaseless(subject.keywords);
  // Les mots-clés chiffrés par les notes d'abord (tri stable : l'ordre de saisie départage).
  const ranked = [...keywords].sort((a, b) => Number(!mentioning(figures, a)) - Number(!mentioning(figures, b)));
  return ranked.slice(0, MAX_KEYWORDS).map((keyword) => {
    const figure = mentioning(figures, keyword);
    if (figure) return { question: `Quel chiffre retenez-vous pour « ${keyword} » ?`, answer: figure };
    const mention = mentioning(all, keyword);
    return {
      question: `Comment définiriez-vous « ${keyword} » en une phrase ?`,
      answer: mention
        ? `Partez de vos notes : ${mention}`
        : `Donnez une définition courte de « ${keyword} », puis montrez en une phrase son lien avec votre question.`,
    };
  });
}

function axisQuestions(axes: readonly { title: string; slides: Slide[] }[]): JuryQuestion[] {
  return axes.slice(0, MAX_AXES).map((axis) => {
    const points = excerpt(axis.slides);
    return {
      question: `Pouvez-vous développer « ${axis.title} » avec un exemple concret ?`,
      answer: points ? `Repartez de vos éléments : ${points}` : "Choisissez un exemple daté et chiffré, puis dites ce qu'il prouve.",
    };
  });
}

function genericQuestions(spec: DeckSpec, subject: ThemeRef | null): JuryQuestion[] {
  const limits = spec.slides.filter((s) => /\b(limites?|nuances?|risques?|freins?)\b/i.test(s.title));
  const limitPoints = excerpt(limits);
  const sources = uniqueCaseless([...findSources(subject?.notes ?? ""), ...spec.slides.flatMap((s) => [...findSources(s.notes), ...s.bullets.flatMap(findSources)])]);
  return [
    {
      question: "Quelle est la principale limite de votre raisonnement ?",
      answer: limitPoints
        ? `Reprenez vos limites : ${limitPoints} Dites ensuite pourquoi elles ne renversent pas votre conclusion.`
        : "Nommez une limite précise (donnée manquante, cas particulier, coût) et dites pourquoi elle ne renverse pas votre conclusion.",
    },
    {
      question: "Quel contre-exemple pourrait fragiliser votre conclusion ?",
      answer: "Citez un cas réel qui va dans l'autre sens, puis montrez ce qu'il change ou non à votre réponse.",
    },
    {
      question: "Pourquoi avez-vous choisi cette question ?",
      answer: "Reliez-la à une expérience, un cours ou une lecture ; restez concret et bref (deux ou trois phrases).",
    },
    {
      question: "Quelle source vous paraît la plus solide, et pourquoi ?",
      answer:
        sources.length > 0
          ? `Choisissez parmi vos sources : ${sources.slice(0, 3).join(" ; ")}. Dites qui l'a produite, quand, et avec quelle méthode.`
          : "Choisissez une source identifiable (auteur, organisme, année) et dites pourquoi elle est fiable.",
    },
    {
      question: "Si vous deviez approfondir un point, lequel choisiriez-vous ?",
      answer: "Désignez le point le moins étayé de votre exposé et dites quelle donnée ou quelle lecture le renforcerait.",
    },
    {
      question: "Quel lien faites-vous entre cette question et votre projet d'études ou professionnel ?",
      answer: "Montrez ce que ce travail vous a appris et comment il éclaire votre projet ; un exemple vaut mieux qu'une déclaration.",
    },
    {
      question: "Comment expliqueriez-vous votre sujet à quelqu'un qui ne le connaît pas ?",
      answer: "Une phrase de contexte, la question posée, votre réponse : sans jargon, avec un exemple du quotidien.",
    },
    {
      question: "Qu'est-ce qui vous a le plus surpris en préparant cet oral ?",
      answer: "Citez un fait ou un chiffre précis qui a changé votre regard, et dites en quoi.",
    },
  ];
}

function bound(q: JuryQuestion): JuryQuestion {
  return { question: truncateText(q.question, JURY_LIMITS.question), answer: truncateText(q.answer, JURY_LIMITS.answer) };
}

/**
 * Questions du jury sans IA, déterministes, 8 à 10 (en pratique 10). Par priorité :
 * objections probables des notes (avec leur réponse), synthèse de la réponse,
 * ordre des axes (« Pourquoi … plutôt que … ? »), sources des chiffres cités,
 * chiffre ou définition des mots-clés du sujet, approfondissement des axes, puis
 * questions génériques du grand oral pour compléter. Sans doublon.
 */
export function fallbackJuryQuestions(spec: DeckSpec, subject: ThemeRef | null): JuryQuestion[] {
  const axes = axesOf(spec);
  const candidates = [
    ...objectionQuestions(spec),
    synthesisQuestion(spec),
    ...orderQuestion(axes),
    ...figureQuestions(spec),
    ...keywordQuestions(subject),
    ...axisQuestions(axes),
    ...genericQuestions(spec, subject),
  ].map(bound);
  const seen = new Set<string>();
  const out: JuryQuestion[] = [];
  for (const q of candidates) {
    const key = flatKey(q.question);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length === FALLBACK_MAX) break;
  }
  return out;
}
