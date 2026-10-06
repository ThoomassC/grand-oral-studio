"use client";

import { TextArea, TextInput } from "@/components/ui/Field";
import { Button } from "@thomascaron/opale-ui";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useId, useRef } from "react";
import { createProgram } from "@/server/actions/programs";
import { projectHomeHref } from "@/components/projects/steps";
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

/**
 * Formulaire de création d'un projet (rendu dans `CreateProgramDialog`).
 * Après succès, ouvre la page du projet.
 *
 * - `autoFocus` : focalise le nom au montage, juste après qu'une `Modal`
 *   englobante a placé le focus sur son panneau ;
 * - `onCancel` : affiche « Annuler » (fermeture de la modale) ;
 * - `onBusyChange` : prévenu au début de la soumission (`true`), puis à son
 *   échec (`false`) ; après succès, la navigation suit et l'état reste occupé.
 */
export function CreateProgramForm({
  autoFocus = false,
  onCancel,
  onBusyChange,
}: {
  autoFocus?: boolean;
  onCancel?: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const router = useRouter();
  const nameId = useId();
  const descId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Synchronisation avec le DOM : la modale focalise d'abord son panneau (effet
  // du parent, joué après celui-ci) ; le nom prend le focus juste après.
  useEffect(() => {
    if (!autoFocus) return;
    const timer = window.setTimeout(() => nameRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [autoFocus]);

  const [state, submit, pending] = useActionState<State, FormData>(async (_prev: State, formData: FormData): Promise<State> => {
    const values = {
      name: String(formData.get("name") ?? "").trim(),
      description: String(formData.get("description") ?? "").trim(),
    };
    // Même règle que ProgramMetaSchema côté serveur (2 à 120 caractères), revalidée par l'action.
    if (values.name.length < 2 || values.name.length > 120) {
      onBusyChange?.(false);
      focusFirstInvalid(formRef.current);
      return {
        status: { kind: "error", message: invalidCountMessage(1, "de créer le projet") },
        fieldErrors: { name: ["Le nom doit contenir entre 2 et 120 caractères."] },
        values,
      };
    }
    let result: Awaited<ReturnType<typeof createProgram>>;
    try {
      result = await createProgram(values);
    } catch {
      onBusyChange?.(false);
      return { status: { kind: "error", message: "La connexion a été interrompue. Réessayez." }, fieldErrors: {}, values };
    }
    if (!result.ok) {
      onBusyChange?.(false);
      const fieldErrors = result.fieldErrors ?? {};
      if (countFieldErrors(fieldErrors) > 0) focusFirstInvalid(formRef.current);
      return { status: { kind: "error", message: result.error }, fieldErrors, values };
    }
    router.push(projectHomeHref(result.data.id));
    return { status: { kind: "success", message: "Projet créé. Ouverture…" }, fieldErrors: {}, values };
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
        onBusyChange?.(true);
        startTransition(() => submit(data));
      }}
    >
      <div>
        <label htmlFor={nameId} className="opale-field__label">
          Nom du projet
        </label>
        <TextInput
          ref={nameRef}
          id={nameId}
          name="name"
          defaultValue={state.values.name}
          placeholder="Ex. Master Management — session 2027"
          maxLength={120}
          required
          {...errorProps(state.fieldErrors, "name", `${nameId}-err`)}
        />
        <FieldError id={`${nameId}-err`} message={firstError(state.fieldErrors, "name")} />
      </div>
      <div>
        <label htmlFor={descId} className="opale-field__label">
          Description <span className="font-normal text-muted">(facultatif)</span>
        </label>
        <TextArea
          id={descId}
          name="description"
          rows={3}
          maxLength={2000}
          defaultValue={state.values.description}
          {...errorProps(state.fieldErrors, "description", `${descId}-err`, `${descId}-hint`)}
        />
        <p id={`${descId}-hint`} className="opale-field__helper">
          Contexte transmis à l&apos;IA : niveau, discipline, attentes du jury.
        </p>
        <FieldError id={`${descId}-err`} message={firstError(state.fieldErrors, "description")} />
      </div>
      <FormStatus state={state.status} />
      <div className={onCancel ? "flex flex-wrap justify-end gap-2" : undefined}>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel} aria-disabled={pending || undefined}>
            Annuler
          </Button>
        ) : null}
        <Button type="submit" aria-disabled={pending || undefined}>
          <ButtonLabel idle="Créer le projet" busy="Création…" isBusy={pending} />
        </Button>
      </div>
    </form>
  );
}
