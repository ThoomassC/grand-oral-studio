import type { Metadata } from "next";
import { TemplateEditor } from "@/components/template/TemplateEditor";
import { loadProgram } from "../../_lib/load";

export async function generateMetadata({ params }: PageProps<"/projets/[id]/gabarit">): Promise<Metadata> {
  const program = await loadProgram((await params).id);
  return { title: `Gabarit — ${program.name}` };
}

export default async function TemplatePage({ params }: PageProps<"/projets/[id]/gabarit">) {
  const program = await loadProgram((await params).id);
  return <TemplateEditor programId={program.id} initialTemplate={program.template} />;
}
