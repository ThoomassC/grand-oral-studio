export type FormStatusState =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "success"; message: string };

export const IDLE: FormStatusState = { kind: "idle" };

/**
 * Message global d'un formulaire. Les deux régions live existent en permanence
 * (elles doivent être dans le DOM avant que le texte n'y apparaisse pour être
 * annoncées par les lecteurs d'écran).
 */
export function FormStatus({ state, className = "" }: { state: FormStatusState; className?: string }) {
  return (
    <div className={className}>
      <div role="alert" aria-atomic="true">
        {state.kind === "error" ? (
          <p className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
            {state.message}
          </p>
        ) : null}
      </div>
      <div role="status" aria-atomic="true">
        {state.kind === "success" ? (
          <p className="text-sm font-medium text-success">
            <span aria-hidden="true">✓ </span>
            {state.message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
