"use client";

import { useRouter } from "next/navigation";
import { startTransition, useActionState, useId, useRef } from "react";
import { createProgram } from "@/server/actions/programs";
import { FieldError } from "@/components/ui/FieldError";
import { FormStatus, IDLE, type FormStatusState } from "@/components/ui/FormStatus";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { countFieldErrors, focusFirstInvalid, invalidCountMessage } from "@/components/ui/focus";
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
  const formRef = useRef<HTMLFormElement>(null);

  const [state, submit, pending] = useActionState<State, FormData>(async (_prev: State, formData: FormData): Promise<State> => {
    const values = {
      name: String(formData.get("name") ?? "").trim(),
      description: String(formData.get("description") ?? "").trim(),
    };
    // Même règle que ProgramMetaSchema côté serveur (2 à 120 caractères), revalidée par l'action.
    if (values.name.length < 2 || values.name.length > 120) {
      focusFirstInvalid(formRef.current);
      return {
        status: { kind: "error", message: invalidCountMessage(1, "de créer le programme") },
        fieldErrors: { name: ["Le nom doit contenir entre 2 et 120 caractères."] },
        values,
      };
    }
    let result: Awaited<ReturnType<typeof createProgram>>;
    try {
      result = await createProgram(values);
    } catch {
      return { status: { kind: "error", message: "La connexion a été interrompue. Réessayez." }, fieldErrors: {}, values };
    }
    if (!result.ok) {
      const fieldErrors = result.fieldErrors ?? {};
      if (countFieldErrors(fieldErrors) > 0) focusFirstInvalid(formRef.current);
      return { status: { kind: "error", message: result.error }, fieldErrors, values };
    }
    router.push(`/programmes/${result.data.id}`);
    return { status: { kind: "success", message: "Programme créé. Ouverture…" }, fieldErrors: {}, values };
  }, INITIAL);

  return (
    <form
      ref={formRef}
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
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
        <button type="submit" className="btn btn-primary" aria-disabled={pending || undefined}>
          <ButtonLabel idle="Créer le programme" busy="Création…" isBusy={pending} />
        </button>
      </div>
    </form>
  );
}
