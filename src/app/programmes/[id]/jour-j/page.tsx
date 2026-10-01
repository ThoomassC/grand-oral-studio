import type { Metadata } from "next";
import { DayJourney, type DayTheme } from "@/components/day/DayJourney";
import { loadProgram } from "../../_lib/load";

export async function generateMetadata({ params }: PageProps<"/programmes/[id]/jour-j">): Promise<Metadata> {
  const program = await loadProgram((await params).id);
  return { title: `Jour J — ${program.name}` };
}

export default async function DayPage({ params }: PageProps<"/programmes/[id]/jour-j">) {
  const program = await loadProgram((await params).id);
  const themes: DayTheme[] = program.themes.map((t) => ({ id: t.id, name: t.name, hasSkeleton: t.skeleton !== null }));
  return <DayJourney programId={program.id} themes={themes} />;
}
