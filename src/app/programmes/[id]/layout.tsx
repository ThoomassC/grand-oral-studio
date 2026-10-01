import Link from "next/link";
import { ProgramTabs } from "@/components/layout/ProgramTabs";
import { ReadinessMeter } from "@/components/layout/ReadinessMeter";
import { UnsavedChangesProvider } from "@/components/layout/UnsavedChanges";
import { loadProgram, skeletonCount } from "../_lib/load";

export default async function ProgramLayout({ children, params }: LayoutProps<"/programmes/[id]">) {
  const { id } = await params;
  const program = await loadProgram(id);
  const total = program.themes.length;
  const ready = skeletonCount(program);
  const readiness =
    total === 0 ? "Aucun thème" : `${ready}/${total} squelette${ready > 1 ? "s" : ""} généré${ready > 1 ? "s" : ""}`;

  return (
    <UnsavedChangesProvider>
      <div className="flex flex-1 flex-col">
        <div className="border-b border-border bg-surface">
          <div className="mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6 sm:pt-6">
            <p className="text-sm">
              <Link href="/programmes" className="opale-link">
                Projets
              </Link>
            </p>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <h1 className="line-clamp-2 min-w-0 text-2xl break-words sm:text-3xl" title={program.name}>
                {program.name}
              </h1>
              <ReadinessMeter ready={ready} total={total} label={readiness} programId={program.id} />
            </div>
            <div className="mt-4">
              <ProgramTabs programId={program.id} />
            </div>
          </div>
        </div>
        <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">{children}</div>
      </div>
    </UnsavedChangesProvider>
  );
}
