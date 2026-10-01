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
  const onDay = pathname.startsWith(`/programmes/${programId}/jour-j`);
  return (
    <div className={`w-full shrink-0 sm:w-56 ${onDay ? "hidden sm:block" : ""}`}>
      <p className="text-sm font-medium">
        <span className="text-muted">Préparation : </span>
        {label}
      </p>
      <Meter className="mt-1.5" value={ready} max={Math.max(total, 1)} label="Squelettes générés" valueText={label} />
    </div>
  );
}
