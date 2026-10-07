"use client";

import { Button } from "@thomascaron/opale-ui";
import { useRouter } from "next/navigation";
import { startTransition, useActionState, useId, useRef } from "react";
import { authClient } from "@/lib/auth-client";
import { PasswordInput } from "@/components/auth/PasswordInput";
import { errorProps, firstError, validateWith, type FieldErrors } from "@/components/forms/validation";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { FieldError } from "@/components/ui/FieldError";
import { countFieldErrors, focusFirstInvalid, invalidCountMessage } from "@/components/ui/focus";
import { FormStatus, IDLE, type FormStatusState } from "@/components/ui/FormStatus";
import { ChangePasswordSchema, MIN_PASSWORD_LENGTH } from "./schema";

interface State {
  status: FormStatusState;
  fieldErrors: FieldErrors;
}

const NOT_CHANGED = "Le mot de passe n'a pas été modifié.";

/** Traduction des codes d'erreur Better Auth de /change-password. */
function failure(code: string | undefined, status: number): State {
  if (status === 429) {
    return { status: { kind: "error", message: "Trop de tentatives. Patientez quelques minutes avant de réessayer." }, fieldErrors: {} };
  }
  switch (code) {
    case "INVALID_PASSWORD":
      return {
        status: { kind: "error", message: NOT_CHANGED },
        fieldErrors: { currentPassword: ["Le mot de passe actuel est incorrect."] },
      };
    case "PASSWORD_TOO_SHORT":
      return {
        status: { kind: "error", message: NOT_CHANGED },
        fieldErrors: { newPassword: [`Le nouveau mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`] },
      };
    case "PASSWORD_TOO_LONG":
      return { status: { kind: "error", message: NOT_CHANGED }, fieldErrors: { newPassword: ["Le mot de passe est trop long (128 caractères au plus)."] } };
    case "CREDENTIAL_ACCOUNT_NOT_FOUND":
      return {
        status: {
          kind: "error",
          message: "Votre compte se connecte avec Google : il n'a pas de mot de passe à changer ici.",
        },
        fieldErrors: {},
      };
    default:
      if (status === 401) {
        return { status: { kind: "error", message: "Votre session a expiré. Reconnectez-vous, puis recommencez." }, fieldErrors: {} };
      }
      return { status: { kind: "error", message: "Le mot de passe n'a pas pu être modifié. Réessayez dans un instant." }, fieldErrors: {} };
  }
}

/**
 * Changer de mot de passe (compte e-mail/mot de passe). Appel direct au point
 * d'entrée Better Auth `/change-password`, limité en débit par IP : il vérifie
 * le mot de passe actuel et ferme les autres sessions.
 */
export function ChangePasswordForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const ids = { current: useId(), next: useId(), hint: useId() };

  const [state, submit, pending] = useActionState<State, FormData>(
    async (_prev, formData) => {
      const checked = validateWith(ChangePasswordSchema, {
        currentPassword: String(formData.get("currentPassword") ?? ""),
        newPassword: String(formData.get("newPassword") ?? ""),
      });
      if (!checked.ok) {
        focusFirstInvalid(formRef.current);
        const count = countFieldErrors(checked.fieldErrors);
        return {
          status: { kind: "error", message: invalidCountMessage(count, "de changer le mot de passe") },
          fieldErrors: checked.fieldErrors,
        };
      }
      let error: { code?: string; status: number } | null;
      try {
        ({ error } = await authClient.changePassword({ ...checked.data, revokeOtherSessions: true }));
      } catch {
        return { status: { kind: "error", message: "La connexion a été interrompue. Réessayez." }, fieldErrors: {} };
      }
      if (error) {
        const result = failure(error.code, error.status);
        if (Object.keys(result.fieldErrors).length > 0) focusFirstInvalid(formRef.current);
        return result;
      }
      formRef.current?.reset();
      router.refresh();
      return {
        status: { kind: "success", message: "Mot de passe modifié. Vos autres sessions ont été déconnectées." },
        fieldErrors: {},
      };
    },
    { status: IDLE, fieldErrors: {} },
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
        <label htmlFor={ids.current} className="opale-field__label">
          Mot de passe actuel
        </label>
        <PasswordInput
          id={ids.current}
          name="currentPassword"
          autoComplete="current-password"
          maxLength={128}
          {...errorProps(state.fieldErrors, "currentPassword", `${ids.current}-err`)}
        />
        <FieldError id={`${ids.current}-err`} message={firstError(state.fieldErrors, "currentPassword")} />
      </div>
      <div>
        <label htmlFor={ids.next} className="opale-field__label">
          Nouveau mot de passe
        </label>
        <PasswordInput
          id={ids.next}
          name="newPassword"
          autoComplete="new-password"
          maxLength={128}
          {...errorProps(state.fieldErrors, "newPassword", `${ids.next}-err`, ids.hint)}
        />
        <p id={ids.hint} className="opale-field__helper">
          {MIN_PASSWORD_LENGTH} caractères au moins.
        </p>
        <FieldError id={`${ids.next}-err`} message={firstError(state.fieldErrors, "newPassword")} />
      </div>
      <FormStatus state={state.status} />
      <div>
        <Button type="submit" aria-disabled={pending || undefined}>
          <ButtonLabel idle="Changer le mot de passe" busy="Modification…" isBusy={pending} />
        </Button>
      </div>
    </form>
  );
}
