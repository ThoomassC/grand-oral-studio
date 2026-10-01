import type { Metadata } from "next";
import { ProgramMetaForm } from "@/components/programs/ProgramMetaForm";
import { ThemeManager, type ThemeItem } from "@/components/themes/ThemeManager";
import { loadProgram } from "../_lib/load";

export async function generateMetadata({ params }: PageProps<"/projets/[id]">): Promise<Metadata> {
  const program = await loadProgram((await params).id);
  return { title: `Thèmes — ${program.name}` };
}

export default async function ThemesPage({ params }: PageProps<"/projets/[id]">) {
  const program = await loadProgram((await params).id);
  const themes: ThemeItem[] = program.themes.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    keywords: t.keywords,
    hasSkeleton: t.skeleton !== null,
    finalDeckCount: t.finalDeckCount,
  }));

  return (
    <div className="flex flex-col gap-3">
      <ProgramMetaForm programId={program.id} name={program.name} description={program.description} />
      <ThemeManager programId={program.id} themes={themes} />
    </div>
  );
}
