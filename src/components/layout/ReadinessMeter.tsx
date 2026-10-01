"use client";

import { usePathname } from "next/navigation";
import { Meter } from "@/components/ui/Meter";

/** Indicateur de préparation ; replié sur mobile au Jour J (place à la saisie). */
export function ReadinessMeter({
  ready,
  total,
  label,
  programId,
}: {
  ready: number;
  total: number;
  label: string;
  programId: string;
}) {
  const pathname = usePathname();
  const onDay = pathname.startsWith(`/projets/${programId}/jour-j`);
  // « 2/5 squelettes générés » : le compteur en chiffres mono, le reste en texte.
  const count = /^(\d+\/\d+)(.*)$/.exec(label);
  return (
    <div className={`w-full shrink-0 sm:w-72 ${onDay ? "hidden sm:block" : ""}`}>
      <p className="text-sm font-semibold">
        <span className="font-normal text-muted">Préparation : </span>
        {count ? (
          <>
            <span className="num">{count[1]}</span>
            {count[2]}
          </>
        ) : (
          label
        )}
      </p>
      <Meter className="mt-1.5" value={ready} max={Math.max(total, 1)} label="Squelettes générés" valueText={label} />
    </div>
  );
}
