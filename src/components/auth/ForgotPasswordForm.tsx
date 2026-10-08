"use client";

import { Button } from "@thomascaron/opale-ui";
import Link from "next/link";
import { startTransition, useActionState, useId, useRef } from "react";
import { authClient } from "@/lib/auth-client";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { TextInput } from "@/components/ui/Field";
import { FieldError } from "@/components/ui/FieldError";
import { focusFirstInvalid } from "@/components/ui/focus";
import { LiveRegion } from "@/components/ui/LiveRegion";
import { Notice } from "@/components/ui/Notice";

/** Page vers laquelle pointe le lien de l'e-mail (Better Auth y ajoute ?token= ou ?error=). */
export const RESET_PASSWORD_PATH = "/reinitialiser-mot-de-passe";

interface State {
  error: string | null;
  fieldError: string | null;
  /** Adresse pour laquelle la demande est partie (message de confirmation). */
  sentTo: string | null;
  email: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Demande d'un lien de réinitialisation. La réponse est la même que l'adresse
 * ait un compte ou non (Better Auth répond toujours `status: true`) : le message
 * de confirmation reste conditionnel pour ne rien révéler.
 */
export function ForgotPasswordForm() {
  const id = useId();
  const formRef = useRef<HTMLFormElement>(null);

  const [state, submit, pending] = useActionState<State, FormData>(
    async (_prev, formData) => {
      const email = String(formData.get("email") ?? "").trim();
      if (!EMAIL.test(email)) {
        focusFirstInvalid(formRef.current);
        return { error: null, fieldError: "Adresse e-mail invalide.", sentTo: null, email };
      }
      let error: { status: number } | null;
      try {
        ({ error } = await authClient.requestPasswordReset({ email, redirectTo: RESET_PASSWORD_PATH }));
      } catch {
        return { error: "La connexion au serveur a été interrompue. Réessayez.", fieldError: null, sentTo: null, email };
      }
      if (error) {
        const message =
          error.status === 429
            ? "Trop de demandes. Patientez quelques minutes avant de réessayer."
            : "La demande n'a pas abouti. Réessayez dans un instant.";
        return { error: message, fieldError: null, sentTo: null, email };
      }
      return { error: null, fieldError: null, sentTo: email, email };
    },
    { error: null, fieldError: null, sentTo: null, email: "" },
  );

  return (
    <div className="flex flex-col gap-5">
      <form
        ref={formRef}
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          // Soumission manuelle : garde la saisie après l'action (pas de réinitialisation).
          e.preventDefault();
          if (pending) return;
          const data = new FormData(e.currentTarget);
          startTransition(() => submit(data));
        }}
      >
        <LiveRegion role="alert">{state.error ? <Notice tone="error">{state.error}</Notice> : null}</LiveRegion>
        <LiveRegion>
          {state.sentTo ? (
            <Notice tone="info" title="Demande envoyée">
              Si un compte existe avec l&apos;adresse {state.sentTo}, vous allez recevoir un e-mail avec un lien pour
              choisir un nouveau mot de passe. Il est valable une heure. Pensez à regarder dans les indésirables.
            </Notice>
          ) : null}
        </LiveRegion>

        <div>
          <label htmlFor={id} className="opale-field__label">
            Adresse e-mail
          </label>
          <TextInput
            id={id}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            spellCheck={false}
            defaultValue={state.email}
            aria-invalid={Boolean(state.fieldError)}
            aria-describedby={state.fieldError ? `${id}-err` : undefined}
            required
          />
          <FieldError id={`${id}-err`} message={state.fieldError ?? undefined} />
        </div>

        <Button type="submit" fullWidth aria-disabled={pending || undefined}>
          <ButtonLabel idle="Recevoir le lien" busy="Envoi de la demande…" isBusy={pending} />
        </Button>
      </form>

      <p className="text-center text-sm text-muted">
        <Link href="/connexion" className="opale-link font-medium">
          Retour à la connexion
        </Link>
      </p>
    </div>
  );
}
