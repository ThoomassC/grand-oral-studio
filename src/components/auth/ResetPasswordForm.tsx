"use client";

import { Button } from "@thomascaron/opale-ui";
import Link from "next/link";
import { startTransition, useActionState, useId, useRef } from "react";
import { authClient } from "@/lib/auth-client";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/components/profile/schema";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { ButtonLink } from "@/components/ui/ButtonLink";
import { FieldError } from "@/components/ui/FieldError";
import { focusFirstInvalid } from "@/components/ui/focus";
import { LiveRegion } from "@/components/ui/LiveRegion";
import { Notice } from "@/components/ui/Notice";
import { PasswordInput } from "./PasswordInput";

interface State {
  error: string | null;
  fieldError: string | null;
  /** Jeton refusé : il faut un nouveau lien. */
  expired: boolean;
  done: boolean;
}

const INITIAL: State = { error: null, fieldError: null, expired: false, done: false };

/**
 * Choix du nouveau mot de passe depuis le lien reçu par e-mail. Le jeton (à
 * usage unique, une heure) est consommé par Better Auth ; les autres sessions
 * du compte sont fermées (revokeSessionsOnPasswordReset).
 */
export function ResetPasswordForm({ token }: { token: string }) {
  const ids = { password: useId(), hint: useId() };
  const formRef = useRef<HTMLFormElement>(null);

  const [state, submit, pending] = useActionState<State, FormData>(async (_prev, formData) => {
    const newPassword = String(formData.get("password") ?? "");
    if (newPassword.length < MIN_PASSWORD_LENGTH || newPassword.length > MAX_PASSWORD_LENGTH) {
      focusFirstInvalid(formRef.current);
      return {
        ...INITIAL,
        fieldError:
          newPassword.length < MIN_PASSWORD_LENGTH
            ? `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères.`
            : `Le mot de passe est trop long (${MAX_PASSWORD_LENGTH} caractères au plus).`,
      };
    }
    let error: { code?: string; status: number } | null;
    try {
      ({ error } = await authClient.resetPassword({ newPassword, token }));
    } catch {
      return { ...INITIAL, error: "La connexion au serveur a été interrompue. Réessayez." };
    }
    if (!error) return { ...INITIAL, done: true };
    if (error.code === "INVALID_TOKEN") {
      return { ...INITIAL, expired: true, error: "Ce lien n'est plus valide : il a expiré ou a déjà servi." };
    }
    if (error.status === 429) return { ...INITIAL, error: "Trop de tentatives. Patientez quelques minutes avant de réessayer." };
    if (error.code === "PASSWORD_TOO_SHORT" || error.code === "PASSWORD_TOO_LONG") {
      focusFirstInvalid(formRef.current);
      return { ...INITIAL, fieldError: `Le mot de passe doit contenir de ${MIN_PASSWORD_LENGTH} à ${MAX_PASSWORD_LENGTH} caractères.` };
    }
    return { ...INITIAL, error: "Le mot de passe n'a pas pu être enregistré. Réessayez dans un instant." };
  }, INITIAL);

  if (state.done) {
    return (
      <div className="flex flex-col gap-5">
        <LiveRegion>
          <Notice tone="success">Mot de passe enregistré. Connectez-vous avec votre nouveau mot de passe.</Notice>
        </LiveRegion>
        <ButtonLink href="/connexion" fullWidth>
          Se connecter
        </ButtonLink>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <form
        ref={formRef}
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (pending) return;
          const data = new FormData(e.currentTarget);
          startTransition(() => submit(data));
        }}
      >
        <LiveRegion role="alert">{state.error ? <Notice tone="error">{state.error}</Notice> : null}</LiveRegion>

        <div>
          <label htmlFor={ids.password} className="opale-field__label">
            Nouveau mot de passe
          </label>
          <PasswordInput
            id={ids.password}
            name="password"
            autoComplete="new-password"
            maxLength={MAX_PASSWORD_LENGTH}
            aria-invalid={Boolean(state.fieldError)}
            aria-describedby={[ids.hint, state.fieldError ? `${ids.password}-err` : null].filter(Boolean).join(" ")}
            required
            minLength={MIN_PASSWORD_LENGTH}
          />
          <p id={ids.hint} className="opale-field__helper">
            {MIN_PASSWORD_LENGTH} caractères au moins.
          </p>
          <FieldError id={`${ids.password}-err`} message={state.fieldError ?? undefined} />
        </div>

        {state.expired ? (
          <ButtonLink href="/mot-de-passe-oublie" fullWidth>
            Demander un nouveau lien
          </ButtonLink>
        ) : (
          <Button type="submit" fullWidth aria-disabled={pending || undefined}>
            <ButtonLabel idle="Enregistrer le mot de passe" busy="Enregistrement…" isBusy={pending} />
          </Button>
        )}
      </form>

      <p className="text-center text-sm text-muted">
        <Link href="/connexion" className="opale-link font-medium">
          Retour à la connexion
        </Link>
      </p>
    </div>
  );
}
