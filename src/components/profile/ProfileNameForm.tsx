"use client";

import { Button } from "@thomascaron/opale-ui";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useId, useRef, useState } from "react";
import type { ActionResult } from "@/server/actions/result";
import { errorProps, firstError, validateWith, type FieldErrors } from "@/components/forms/validation";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { FieldError } from "@/components/ui/FieldError";
import { TextInput } from "@/components/ui/Field";
import { focusFirstInvalid } from "@/components/ui/focus";
import { FormStatus, IDLE, type FormStatusState } from "@/components/ui/FormStatus";
import { useUnsavedChanges } from "@/components/layout/UnsavedChanges";
import { ProfileNameSchema, type ProfileNameInput } from "./schema";

interface State {
  status: FormStatusState;
  fieldErrors: FieldErrors;
  value: string;
}

/** Modifier le nom du compte. L'action est passée par la page (Server Action). */
export function ProfileNameForm({
  initialName,
  action,
}: {
  initialName: string;
  action: (input: ProfileNameInput) => Promise<ActionResult<{ name: string }>>;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const id = useId();
  // Champ non contrôlé : la saisie et le nom enregistré ne sont suivis que pour la garde
  // « modifications non enregistrées » (`state.value` garde aussi une saisie refusée).
  const [typed, setTyped] = useState(initialName);
  const [savedName, setSavedName] = useState(initialName);
  useUnsavedChanges(typed.trim() !== savedName.trim());

  const [state, submit, pending] = useActionState<State, FormData>(
    async (_prev, formData) => {
      const value = String(formData.get("name") ?? "");
      const checked = validateWith(ProfileNameSchema, { name: value });
      if (!checked.ok) {
        focusFirstInvalid(formRef.current);
        return { status: { kind: "error", message: "Le nom saisi n'est pas valide." }, fieldErrors: checked.fieldErrors, value };
      }
      let result: Awaited<ReturnType<typeof action>>;
      try {
        result = await action(checked.data);
      } catch {
        return { status: { kind: "error", message: "La connexion a été interrompue. Réessayez." }, fieldErrors: {}, value };
      }
      if (!result.ok) {
        const fieldErrors = result.fieldErrors ?? {};
        if (firstError(fieldErrors, "name")) focusFirstInvalid(formRef.current);
        return { status: { kind: "error", message: result.error }, fieldErrors, value };
      }
      setSavedName(result.data.name);
      router.refresh();
      return { status: { kind: "success", message: "Nom enregistré." }, fieldErrors: {}, value: result.data.name };
    },
    { status: IDLE, fieldErrors: {}, value: initialName },
  );

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
        <label htmlFor={id} className="opale-field__label">
          Nom
        </label>
        <TextInput
          id={id}
          name="name"
          autoComplete="name"
          maxLength={80}
          defaultValue={state.value}
          onChange={(e) => setTyped(e.target.value)}
          {...errorProps(state.fieldErrors, "name", `${id}-err`)}
        />
        <FieldError id={`${id}-err`} message={firstError(state.fieldErrors, "name")} />
      </div>
      <FormStatus state={state.status} />
      <div>
        <Button type="submit" aria-disabled={pending || undefined}>
          <ButtonLabel idle="Enregistrer le nom" busy="Enregistrement…" isBusy={pending} />
        </Button>
      </div>
    </form>
  );
}
