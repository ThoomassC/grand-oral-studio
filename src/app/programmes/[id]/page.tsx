import type { Metadata } from "next";
import { ThemeManager, type ThemeItem } from "@/components/themes/ThemeManager";
import { loadProgram } from "../_lib/load";

export async function generateMetadata({ params }: PageProps<"/programmes/[id]">): Promise<Metadata> {
  const program = await loadProgram((await params).id);
  return { title: `Thèmes — ${program.name}` };
}

export default async function ThemesPage({ params }: PageProps<"/programmes/[id]">) {
  const program = await loadProgram((await params).id);
  const themes: ThemeItem[] = program.themes.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    keywords: t.keywords,
    hasSkeleton: t.skeleton !== null,
  }));

  return <ThemeManager programId={program.id} themes={themes} />;
}
