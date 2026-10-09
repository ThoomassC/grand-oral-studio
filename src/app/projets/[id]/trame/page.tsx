import type { Metadata } from "next";
import { TemplateWorkspace } from "@/components/template/TemplateWorkspace";
import { PageHeading } from "@/components/layout/PageHeading";
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
      <PageHeading title="Trame" kicker="02 · Votre fil conducteur" level={2}>
          La suite des diapos et ce que chacune contient. Le jour J, ce contenu type est développé pour la
          problématique tirée au sort.
      </PageHeading>
      {/* Lecteur : la trame en lecture seule (le serveur refuse de toute façon ses modifications). */}
      <TemplateWorkspace
        programId={program.id}
        initialTemplate={program.template}
        savedAt={program.templateSavedAt}
        readOnly={program.role === "viewer"}
        // Publier dans la bibliothèque : propriétaire seul (le serveur refuse un éditeur).
        canPublish={program.role === "owner"}
      />
    </div>
  );
}
