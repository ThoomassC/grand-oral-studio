import Link from "next/link";
import { ProgramTabs } from "@/components/layout/ProgramTabs";
import { Meter } from "@/components/ui/Meter";
import { loadProgram, skeletonCount } from "../_lib/load";

export default async function ProgramLayout({ children, params }: LayoutProps<"/programmes/[id]">) {
  const { id } = await params;
  const program = await loadProgram(id);
  const total = program.themes.length;
  const ready = skeletonCount(program);
  const readiness =
    total === 0 ? "Aucun thème" : `${ready}/${total} squelette${ready > 1 ? "s" : ""} généré${ready > 1 ? "s" : ""}`;

  return (
    <div className="flex flex-1 flex-col">
      <div className="border-b border-border bg-surface">
        <div className="mx-auto w-full max-w-6xl px-4 pt-5 sm:px-6">
          <p className="text-sm">
            <Link href="/programmes" className="link text-muted">
              Mes programmes
            </Link>
          </p>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <h1 className="min-w-0 text-2xl font-bold sm:text-3xl">
              <span className="break-words">{program.name}</span>
            </h1>
            <div className="w-full shrink-0 sm:w-56">
              <p className="text-sm font-medium">
                <span className="text-muted">Préparation : </span>
                {readiness}
              </p>
              <Meter
                className="mt-1.5"
                value={ready}
                max={Math.max(total, 1)}
                label="Squelettes générés"
                valueText={readiness}
              />
            </div>
          </div>
          <div className="mt-4">
            <ProgramTabs programId={program.id} />
          </div>
        </div>
      </div>
      <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">{children}</div>
    </div>
  );
}
