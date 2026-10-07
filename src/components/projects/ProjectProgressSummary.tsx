import type { ProjectProgress } from "@/domain/progress";
import type { ProgramRole } from "@/server/repo/access";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { practiceHref, projectHomeHref, stepHref, stepMeta } from "./steps";

/** « Prêt pour le jour J · 4 répétitions faites ». */
function readyLabel(rehearsals: number): string {
  return `Prêt pour le jour J · ${rehearsals} ${rehearsals > 1 ? "répétitions faites" : "répétition faite"}`;
}

/**
 * Avancement d'un projet sur sa carte : « n/3 étapes » (pastilles, nommées
 * comme une image), ou « Prêt pour le jour J · N répétitions faites » une fois
 * le projet prêt (cf. `computeProjectProgress`) ; puis les accès au Jour J :
 * « S'entraîner » et « Jour J » quand apparence et trame sont faites — toujours
 * le cas, par défaut ou personnalisées —, sinon reprendre à l'étape suivante.
 *
 * La génération est réservée aux éditeurs : un lecteur n'a que « Ouvrir », et
 * pas la mention du rédacteur (« Rédaction : … », celui de l'utilisateur).
 */
export function ProjectProgressSummary({
  programId,
  programName,
  progress,
  role,
  writerLabel = null,
}: {
  programId: string;
  programName: string;
  progress: Pick<ProjectProgress, "doneCount" | "total" | "nextStep" | "rehearsalCount">;
  role: ProgramRole;
  /** Libellé du rédacteur actuel de l'utilisateur (« Mistral », « Sans IA »…) ; null : non affiché. */
  writerLabel?: string | null;
}) {
  const { doneCount, total, nextStep, rehearsalCount } = progress;
  const ready = nextStep === null;
  const toDay = ready || nextStep === "day";
  const canGenerate = role !== "viewer";
  const name = <span className="sr-only"> — {programName}</span>;
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
        {ready ? (
          <span className="num font-semibold">{readyLabel(rehearsalCount)}</span>
        ) : (
          <span aria-hidden="true" className="num font-semibold">
            {doneCount}/{total} étapes
          </span>
        )}
      </p>
      {canGenerate && writerLabel ? <p className="text-sm text-muted">Rédaction : {writerLabel}</p> : null}
      {!canGenerate ? (
        <ButtonLink href={projectHomeHref(programId)} variant="ghost" size="small">
          Ouvrir
          {name}
        </ButtonLink>
      ) : toDay ? (
        <div className="flex flex-wrap gap-2 sm:justify-end">
          <ButtonLink href={practiceHref(programId)} variant="primary" size="small">
            S&apos;entraîner
            {name}
          </ButtonLink>
          <ButtonLink href={stepHref(programId, "day")} variant="ghost" size="small">
            Jour J
            {name}
          </ButtonLink>
        </div>
      ) : (
        <ButtonLink href={stepHref(programId, nextStep)} variant="ghost" size="small">
          {`Reprendre : ${stepMeta(nextStep).label}`}
          {name}
        </ButtonLink>
      )}
    </div>
  );
}
