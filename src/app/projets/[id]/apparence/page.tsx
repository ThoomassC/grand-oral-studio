import type { Metadata } from "next";
import { BrandImport } from "@/components/brand/BrandImport";
import { BrandWorkspace } from "@/components/brand/BrandWorkspace";
import { loadProgram } from "../../_lib/load";

export async function generateMetadata({ params }: PageProps<"/projets/[id]/apparence">): Promise<Metadata> {
  const program = await loadProgram((await params).id);
  return { title: `Apparence — ${program.name}` };
}

/** Étape 1 · Apparence : partir d'un exemple (facultatif), puis l'éditeur. Sans IA. */
export default async function AppearancePage({ params }: PageProps<"/projets/[id]/apparence">) {
  const program = await loadProgram((await params).id);
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-2xl">Apparence</h2>
        <p className="max-w-3xl text-sm text-muted">
          Les couleurs, les polices et le logo de vos diaporamas. L&apos;apparence par défaut convient : vous pouvez
          passer directement à la suite.
        </p>
      </div>
      <BrandImport
        programId={program.id}
        currentBrand={{ logoDataUrl: program.brand.logoDataUrl }}
        format={program.template.format}
      />
      {/* Un import appliqué est repris par l'éditeur sans le remonter (voir BrandEditor). */}
      <BrandWorkspace
        programId={program.id}
        initialBrand={program.brand}
        savedAt={program.brandSavedAt}
        format={program.template.format}
      />
    </div>
  );
}
