import { Feedback } from "@thomascaron/opale-ui";
import type { Metadata } from "next";
import { DayJourney, type DayTheme, type DayWriter, type RecentDeck } from "@/components/day/DayJourney";
import { ExamChecklist } from "@/components/day/ExamChecklist";
import { engineChoices } from "@/components/day/journey";
import { PrepCountdown } from "@/components/day/PrepCountdown";
import { prepStorageKey } from "@/components/day/prep-timer";
import { generationWaitHint } from "@/components/day/wait-hint";
import { decksHref } from "@/components/projects/steps";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { examChecklist } from "@/domain/exam-checklist";
import { prepMinutesOf } from "@/domain/prep-clock";
import {
  getAiSettings,
  getExamReadiness,
  getWriter,
  listFinalDecks,
  NotFoundError,
  type FinalDeckSummary,
} from "@/server/queries";
import { requireUser } from "@/server/session";
import { loadProgram } from "../../_lib/load";

/**
 * Les Server Actions de cette page (reconnaissance, génération du diaporama)
 * héritent de cette durée maximale : l'échéance de la génération
 * (AI_GENERATION_DEADLINE_MS, 280 s par défaut) tient dedans.
 */
export const maxDuration = 300;

const RECENT_MS = 15 * 60 * 1000;

type SearchParams = Awaited<PageProps<"/projets/[id]/jour-j">["searchParams"]>;

/** `?mode=entrainement` : même parcours, diaporama marqué « entraînement ». */
function isPractice(query: SearchParams): boolean {
  return query.mode === "entrainement";
}

export async function generateMetadata({ params, searchParams }: PageProps<"/projets/[id]/jour-j">): Promise<Metadata> {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const program = await loadProgram(id);
  return { title: `${isPractice(query) ? "Entraînement" : "Jour J"} — ${program.name}` };
}

/** Diaporama du même mode créé il y a moins de 15 min (reprise après rechargement ou fermeture). */
function mostRecent(decks: FinalDeckSummary[], practice: boolean, now: number): RecentDeck | null {
  const latest = decks
    .filter((d) => d.practice === practice)
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0];
  if (!latest) return null;
  const age = now - +new Date(latest.createdAt);
  if (age < 0 || age > RECENT_MS) return null;
  return { id: latest.id, title: latest.title, minutesAgo: Math.floor(age / 60000) };
}

export default async function DayPage({ params, searchParams }: PageProps<"/projets/[id]/jour-j">) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const practice = isPractice(query);
  // loadProgram vérifie l'accès (404 sinon) ; déjà lu par le layout (cache de la requête).
  const [user, program] = await Promise.all([requireUser(), loadProgram(id)]);
  // Lecteur : ni formulaire ni chrono ; le serveur refuse de toute façon la génération.
  if (program.role === "viewer") return <ReadOnlyDay programId={program.id} practice={practice} />;
  // Lectures indépendantes en parallèle.
  const [decks, writer, settings, readiness] = await Promise.all([
    listFinalDecks(user.id, id).catch((error: unknown) => {
      // L'absence du projet est traitée par loadProgram (404).
      if (error instanceof NotFoundError) return [];
      throw error;
    }),
    getWriter(user.id),
    getAiSettings(user.id),
    practice ? null : getExamReadiness(user.id, id),
  ]);
  // DTO explicites : ni notes ni ancien squelette ne traversent vers le client (inutiles au parcours).
  const themes: DayTheme[] = program.themes.map((t) => ({
    id: t.id,
    name: t.name,
    ...(practice && t.problems.length > 0 ? { problems: t.problems } : {}),
  }));
  const dayWriter: DayWriter = {
    label: writer.label,
    outlineOnly: writer.engine === "free",
    waitHint: generationWaitHint(writer.engine),
    engine: writer.engine,
    keySource: writer.keySource,
    ready: writer.ready,
    problem: writer.problem,
  };
  // Repli en un clic : fournisseurs proposés seulement (engineChoices écarte Claude et OpenAI, plus proposés).
  const choices = engineChoices(
    settings.connections.map((c) => c.provider),
    settings.team,
  );
  const prepMinutes = prepMinutesOf(program.template);
  const prepKey = prepStorageKey(program.id, practice);
  const checklist = readiness
    ? examChecklist({
        writerReady: writer.ready,
        writerLabel: writer.label,
        templateSaved: program.templateSavedAt !== null,
        exportTried: readiness.exportTried,
        decks: readiness.decks,
        rehearsals: readiness.rehearsals,
      })
    : null;
  const requestTime = new Date().getTime();
  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-3">
        {/* Un h2 par page, comme Apparence et Trame : les étapes du parcours sont ses h3. */}
        <div className="min-w-0">
          <h2 className="text-2xl">{practice ? "Entraînement" : "Jour J"}</h2>
          <p className="text-muted">
            {practice
              ? "Tirez ou recopiez une problématique, puis générez un diaporama d'entraînement, chronomètre en marche."
              : themes.length === 0
                ? "Recopiez la problématique, puis générez le diaporama."
                : "Recopiez la problématique, vérifiez le sujet, générez le diaporama."}
          </p>
        </div>
        {/* Décompte réel : démarre à la première saisie de la problématique. */}
        <PrepCountdown storageKey={prepKey} minutes={prepMinutes} />
      </div>
      {checklist ? (
        <div className="mx-auto w-full max-w-3xl">
          <ExamChecklist items={checklist} />
        </div>
      ) : null}
      <DayJourney
        programId={program.id}
        themes={themes}
        recentDeck={mostRecent(decks, practice, requestTime)}
        writer={dayWriter}
        engineChoices={choices}
        practice={practice}
        prepKey={prepKey}
      />
    </div>
  );
}

/** Jour J (ou entraînement) d'un lecteur : rien à générer, renvoi vers les diaporamas existants. */
function ReadOnlyDay({ programId, practice }: { programId: string; practice: boolean }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <div className="min-w-0">
        <h2 className="text-2xl">{practice ? "Entraînement" : "Jour J"}</h2>
      </div>
      <Feedback tone="neutral" title={`${practice ? "Entraînement" : "Jour J"} en lecture seule`}>
        Générer un diaporama est réservé au propriétaire et aux éditeurs du projet. Vous pouvez relire, exporter et
        répéter les diaporamas déjà créés.
      </Feedback>
      <div>
        <ButtonLink href={decksHref(programId)} variant="ghost">
          Voir les diaporamas
        </ButtonLink>
      </div>
    </div>
  );
}
