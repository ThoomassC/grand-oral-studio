import type { Metadata } from "next";
import { BrandEditor } from "@/components/brand/BrandEditor";
import { loadProgram } from "../../_lib/load";

export async function generateMetadata({ params }: PageProps<"/programmes/[id]/charte">): Promise<Metadata> {
  const program = await loadProgram((await params).id);
  return { title: `Charte — ${program.name}` };
}

export default async function BrandPage({ params }: PageProps<"/programmes/[id]/charte">) {
  const program = await loadProgram((await params).id);
  return <BrandEditor programId={program.id} initialBrand={program.brand} format={program.template.format} />;
}
