"use client";

import { useRouter } from "next/navigation";
import { startTransition, useActionState, useId } from "react";
import { createProgram } from "@/server/actions/programs";
import { FieldError } from "@/components/ui/FieldError";
import { FormStatus, IDLE, type FormStatusState } from "@/components/ui/FormStatus";
import { errorProps, firstError, type FieldErrors } from "@/components/forms/validation";

interface State {
  status: FormStatusState;
  fieldErrors: FieldErrors;
  values: { name: string; description: string };
}

const INITIAL: State = { status: IDLE, fieldErrors: {}, values: { name: "", description: "" } };

export function CreateProgramForm({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const nameId = useId();
  const descId = useId();

  const [state, submit, pending] = useActionState<State, FormData>(async (_prev: State, formData: FormData): Promise<State> => {
    const values = {
      name: String(formData.get("name") ?? "").trim(),
      description: String(formData.get("description") ?? "").trim(),
    };
    // Même règle que ProgramMetaSchema côté serveur (2 à 120 caractères), revalidée par l'action.
    if (values.name.length < 2 || values.name.length > 120) {
      return { status: IDLE, fieldErrors: { name: ["Le nom doit contenir entre 2 et 120 caractères."] }, values };
    }
    const result = await createProgram(values);
    if (!result.ok) {
      return { status: { kind: "error", message: result.error }, fieldErrors: result.fieldErrors ?? {}, values };
    }
    router.push(`/programmes/${result.data.id}`);
    return { status: { kind: "success", message: "Programme créé. Ouverture…" }, fieldErrors: {}, values };
  }, INITIAL);

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => submit(data));
      }}
    >
      <div>
        <label htmlFor={nameId} className="field-label">
          Nom du programme
        </label>
        <input
          id={nameId}
          name="name"
          className="input"
          defaultValue={state.values.name}
          placeholder="Ex. Master Management — session 2027"
          maxLength={120}
          required
          autoFocus={autoFocus}
          {...errorProps(state.fieldErrors, "name", `${nameId}-err`)}
        />
        <FieldError id={`${nameId}-err`} message={firstError(state.fieldErrors, "name")} />
      </div>
      <div>
        <label htmlFor={descId} className="field-label">
          Description <span className="font-normal text-muted">(facultatif)</span>
        </label>
        <textarea
          id={descId}
          name="description"
          className="input"
          rows={3}
          maxLength={2000}
          defaultValue={state.values.description}
          {...errorProps(state.fieldErrors, "description", `${descId}-err`, `${descId}-hint`)}
        />
        <p id={`${descId}-hint`} className="field-hint">
          Contexte transmis à l&apos;IA : niveau, discipline, attentes du jury.
        </p>
        <FieldError id={`${descId}-err`} message={firstError(state.fieldErrors, "description")} />
      </div>
      <FormStatus state={state.status} />
      <div>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Création…" : "Créer le programme"}
        </button>
      </div>
    </form>
  );
}
