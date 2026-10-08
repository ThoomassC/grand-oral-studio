import type { Metadata } from "next";
import { SubjectImport } from "@/components/themes/SubjectImport";
import { ThemeManager, type ThemeItem } from "@/components/themes/ThemeManager";
import { loadProgram } from "../../../_lib/load";

export async function generateMetadata({ params }: PageProps<"/projets/[id]/trame/sujets">): Promise<Metadata> {
  const program = await loadProgram((await params).id);
  return { title: `Sujets — ${program.name}` };
}

/** Étape 2 · Trame, onglet Sujets (facultatif) : import depuis un texte, puis la liste. Sans IA. */
export default async function SubjectsPage({ params }: PageProps<"/projets/[id]/trame/sujets">) {
  const program = await loadProgram((await params).id);
  const readOnly = program.role === "viewer";
  // DTO explicite : l'ancien squelette (version 1.0) et la position ne traversent pas la frontière.
  const subjects: ThemeItem[] = program.themes.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    keywords: t.keywords,
    notes: t.notes,
    problems: t.problems,
    finalDeckCount: t.finalDeckCount,
    updatedAt: t.updatedAt,
  }));

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-2xl">Sujets</h2>
        <p className="max-w-3xl text-sm text-muted">
          Facultatif. Les sujets possibles de l&apos;oral et vos notes (chiffres, exemples, sources) : le jour J, le
          sujet de la problématique est reconnu et le diaporama s&apos;appuie sur ses notes.
        </p>
      </div>
      {/* Lecteur : ni import ni édition (le serveur les refuse de toute façon). */}
      {readOnly ? null : <SubjectImport programId={program.id} format={program.template.format} />}
      <ThemeManager programId={program.id} themes={subjects} readOnly={readOnly} />
    </div>
  );
}
