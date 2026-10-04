import type { ProjectProgress } from "@/domain/progress";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { stepHref, stepMeta } from "./steps";

/**
 * Avancement d'un projet sur sa carte : « n/3 étapes » (pastilles, nommées
 * comme une image) et le bouton pour reprendre à l'étape suivante, ou
 * commencer le Jour J quand la préparation est faite.
 */
export function ProjectProgressSummary({
  programId,
  programName,
  progress,
}: {
  programId: string;
  programName: string;
  progress: Pick<ProjectProgress, "doneCount" | "total" | "nextStep">;
}) {
  const { doneCount, total, nextStep } = progress;
  const toDay = nextStep === null || nextStep === "day";
  const target = toDay ? "day" : nextStep;
  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <p className="flex items-center gap-2 text-sm">
        <span role="img" aria-label={`${doneCount} ${doneCount > 1 ? "étapes faites" : "étape faite"} sur ${total}`} className="flex gap-1">
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className={`h-2.5 w-2.5 rounded-full ${i < doneCount ? "bg-success" : "border border-border-strong bg-transparent"}`}
            />
          ))}
        </span>
        <span aria-hidden="true" className="num font-semibold">
          {doneCount}/{total} étapes
        </span>
      </p>
      <ButtonLink href={stepHref(programId, target)} variant={toDay ? "primary" : "ghost"} size="small">
        {toDay ? "Commencer le Jour J" : `Reprendre : ${stepMeta(target).label}`}
        <span className="sr-only"> — {programName}</span>
      </ButtonLink>
    </div>
  );
}
