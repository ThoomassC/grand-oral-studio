import type { Metadata } from "next";
import { BrandWorkspace } from "@/components/brand/BrandWorkspace";
import { loadProgram } from "../../_lib/load";

export async function generateMetadata({ params }: PageProps<"/projets/[id]/charte">): Promise<Metadata> {
  const program = await loadProgram((await params).id);
  return { title: `Charte — ${program.name}` };
}

export default async function BrandPage({ params }: PageProps<"/projets/[id]/charte">) {
  const program = await loadProgram((await params).id);
  return <BrandWorkspace programId={program.id} initialBrand={program.brand} format={program.template.format} />;
}
