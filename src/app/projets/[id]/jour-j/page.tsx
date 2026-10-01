import type { Metadata } from "next";
import { DayJourney, type DayTheme, type RecentDeck } from "@/components/day/DayJourney";
import { Duration, PREP_MINUTES, PrepDial } from "@/components/day/PrepClock";
import { getAiSettings, listFinalDecks, NotFoundError, type AiSettingsView, type FinalDeckSummary } from "@/server/queries";
import { requireUser } from "@/server/session";
import { loadProgram } from "../../_lib/load";

const RECENT_MS = 15 * 60 * 1000;

export async function generateMetadata({ params }: PageProps<"/projets/[id]/jour-j">): Promise<Metadata> {
  const program = await loadProgram((await params).id);
  return { title: `Jour J — ${program.name}` };
}

/** Deck final créé il y a moins de 15 min (reprise après rechargement ou fermeture). */
function mostRecent(decks: FinalDeckSummary[], now: number): RecentDeck | null {
  const latest = [...decks].sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0];
  if (!latest) return null;
  const age = now - +new Date(latest.createdAt);
  if (age < 0 || age > RECENT_MS) return null;
  return { id: latest.id, title: latest.title, minutesAgo: Math.floor(age / 60000) };
}

/** Moteur qui rédigera le deck, tel qu'annoncé avant l'étape 3. */
function writerLabel(engine: AiSettingsView["engine"]): string {
  switch (engine.effective) {
    case "free":
      return "Gratuit (trame à compléter)";
    case "claude":
      return "Claude";
    case "ollama":
      return engine.available.ollama.selectedModel ? `Ollama · ${engine.available.ollama.selectedModel}` : "Ollama";
    case "mock":
      return "Démo (contenus factices)";
  }
}

export default async function DayPage({ params }: PageProps<"/projets/[id]/jour-j">) {
  const { id } = await params;
  // Lectures indépendantes en parallèle ; loadProgram vérifie la propriété (404 sinon).
  const user = await requireUser();
  const [program, decks, settings] = await Promise.all([
    loadProgram(id),
    listFinalDecks(user.id, id).catch((error: unknown) => {
      // L'absence du projet est traitée par loadProgram (404).
      if (error instanceof NotFoundError) return [];
      throw error;
    }),
    getAiSettings(user.id),
  ]);
  const themes: DayTheme[] = program.themes.map((t) => ({ id: t.id, name: t.name, hasSkeleton: t.skeleton !== null }));
  const requestTime = new Date().getTime();
  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-3">
        <p className="text-muted">Problématique, thème, diaporama : trois étapes, puis place à la répétition.</p>
        {/* Repère du temps de préparation : rappel visuel, ne décompte rien. */}
        <p className="flex items-center gap-3 rounded-lg border border-border bg-surface py-2 pr-4 pl-2 shadow-card">
          <PrepDial usedMinutes={0} className="h-10 w-10 shrink-0" />
          <span className="leading-tight">
            <span className="block text-lg font-bold">
              <Duration minutes={PREP_MINUTES} className="num" />
            </span>
            <span className="text-sm text-muted">de préparation</span>
          </span>
        </p>
      </div>
      <DayJourney programId={program.id} themes={themes} recentDeck={mostRecent(decks, requestTime)}
        writer={{ label: writerLabel(settings.engine), outlineOnly: settings.engine.effective === "free" }}
      />
    </div>
  );
}
