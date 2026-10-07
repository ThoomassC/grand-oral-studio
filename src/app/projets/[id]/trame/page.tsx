import type { Metadata } from "next";
import { TemplateWorkspace } from "@/components/template/TemplateWorkspace";
import { loadProgram } from "../../_lib/load";

export async function generateMetadata({ params }: PageProps<"/projets/[id]/trame">): Promise<Metadata> {
  const program = await loadProgram((await params).id);
  return { title: `Trame — ${program.name}` };
}

/** Étape 2 · Trame, onglet Diapos : la suite des diapos et leur contenu type. Sans IA. */
export default async function TemplatePage({ params }: PageProps<"/projets/[id]/trame">) {
  const program = await loadProgram((await params).id);
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-2xl">Trame</h2>
        <p className="max-w-3xl text-sm text-muted">
          La suite des diapos et ce que chacune contient. Le jour J, ce contenu type est développé pour la
          problématique tirée au sort.
        </p>
      </div>
      <TemplateWorkspace programId={program.id} initialTemplate={program.template} savedAt={program.templateSavedAt} />
    </div>
  );
}
