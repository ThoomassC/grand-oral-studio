import { LiveRegion } from "./LiveRegion";

export type FormStatusState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "success"; message: string };

export const IDLE: FormStatusState = { kind: "idle" };

/**
 * Message global d'un formulaire : une région `alert` pour les erreurs, une
 * région `status` pour les confirmations, toutes deux toujours dans le DOM.
 */
export function FormStatus({ state, className = "" }: { state: FormStatusState; className?: string }) {
  return (
    <>
      <LiveRegion role="alert" className={className}>
        {state.kind === "error" ? (
          <p className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
            {state.message}
          </p>
        ) : null}
      </LiveRegion>
      <LiveRegion className={className}>
        {state.kind === "success" ? (
          <p className="text-sm font-medium text-success">
            <span aria-hidden="true">✓ </span>
            {state.message}
          </p>
        ) : null}
      </LiveRegion>
    </>
  );
}
