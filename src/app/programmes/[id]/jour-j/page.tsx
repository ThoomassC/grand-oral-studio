import type { Metadata } from "next";
import { DayJourney, type DayTheme, type RecentDeck } from "@/components/day/DayJourney";
import { listFinalDecks, NotFoundError, type FinalDeckSummary } from "@/server/queries";
import { requireUser } from "@/server/session";
import { loadProgram } from "../../_lib/load";

const RECENT_MS = 15 * 60 * 1000;

export async function generateMetadata({ params }: PageProps<"/programmes/[id]/jour-j">): Promise<Metadata> {
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

export default async function DayPage({ params }: PageProps<"/programmes/[id]/jour-j">) {
  const { id } = await params;
  // Lectures indépendantes en parallèle ; loadProgram vérifie la propriété (404 sinon).
  const [program, decks] = await Promise.all([
    loadProgram(id),
    requireUser()
      .then((user) => listFinalDecks(user.id, id))
      .catch((error: unknown) => {
        // L'absence du programme est traitée par loadProgram (404).
        if (error instanceof NotFoundError) return [];
        throw error;
      }),
  ]);
  const themes: DayTheme[] = program.themes.map((t) => ({ id: t.id, name: t.name, hasSkeleton: t.skeleton !== null }));
  const requestTime = new Date().getTime();
  return <DayJourney programId={program.id} themes={themes} recentDeck={mostRecent(decks, requestTime)} />;
}
