"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useId, useRef, useState, useSyncExternalStore, startTransition } from "react";
import { signIn, signUp } from "@/lib/auth-client";
import { FieldError } from "@/components/ui/FieldError";
import { focusFirstInvalid, invalidCountMessage } from "@/components/ui/focus";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { LiveRegion } from "@/components/ui/LiveRegion";
import { GoogleSignInButton } from "./GoogleSignInButton";
import { PasswordInput } from "./PasswordInput";

type Mode = "signin" | "signup";

interface AuthState {
  error: string | null;
  fieldErrors: Partial<Record<"name" | "email" | "password", string>>;
  values: { name: string; email: string };
}

const MIN_PASSWORD = 10;

const noopSubscribe = () => () => {};

/** Traduction des codes d'erreur Better Auth (messages anglais côté serveur). */
function authErrorMessage(code: string | undefined, status: number, mode: Mode): string {
  if (status === 429) return "Trop de tentatives. Patientez une minute avant de réessayer.";
  switch (code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return "Adresse e-mail ou mot de passe incorrect.";
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "Un compte existe déjà avec cette adresse. Connectez-vous ou utilisez une autre adresse.";
    case "PASSWORD_TOO_SHORT":
      return `Le mot de passe doit contenir au moins ${MIN_PASSWORD} caractères.`;
    case "PASSWORD_TOO_LONG":
      return "Le mot de passe est trop long (128 caractères au plus).";
    case "INVALID_EMAIL":
      return "Adresse e-mail invalide.";
    default:
      return mode === "signin"
        ? "La connexion a échoué. Réessayez dans un instant."
        : "L'inscription a échoué. Réessayez dans un instant.";
  }
}

interface AuthFormProps {
  mode: Mode;
  next: string;
  /** Connexion Google configurée côté serveur (booléen seul, aucun identifiant). */
  googleEnabled: boolean;
  /** Message d'erreur à afficher dès l'arrivée (retour d'échec OAuth). */
  initialError?: string | null;
}

export function AuthForm({ mode, next, googleEnabled, initialError = null }: AuthFormProps) {
  const router = useRouter();
  const isSignup = mode === "signup";
  const ids = { name: useId(), email: useId(), password: useId(), hint: useId() };
  const formRef = useRef<HTMLFormElement>(null);

  const [state, submit, pending] = useActionState<AuthState, FormData>(
    async (_prev, formData) => {
      const name = String(formData.get("name") ?? "").trim();
      const email = String(formData.get("email") ?? "").trim();
      const password = String(formData.get("password") ?? "");
      const values = { name, email };

      const fieldErrors: AuthState["fieldErrors"] = {};
      if (mode === "signup" && name.length < 2) fieldErrors.name = "Indiquez votre nom (2 caractères au moins).";
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fieldErrors.email = "Adresse e-mail invalide.";
      if (mode === "signup" && password.length < MIN_PASSWORD)
        fieldErrors.password = `Le mot de passe doit contenir au moins ${MIN_PASSWORD} caractères.`;
      if (mode === "signin" && password.length === 0) fieldErrors.password = "Saisissez votre mot de passe.";
      const invalid = Object.keys(fieldErrors).length;
      if (invalid > 0) {
        focusFirstInvalid(formRef.current);
        return { error: invalidCountMessage(invalid, isSignup ? "de créer le compte" : "de vous connecter"), fieldErrors, values };
      }

      let error: { code?: string; status: number } | null;
      try {
        ({ error } =
          mode === "signin"
            ? await signIn.email({ email, password })
            : await signUp.email({ email, password, name }));
      } catch {
        return { error: "La connexion au serveur a été interrompue. Réessayez.", fieldErrors: {}, values };
      }
      if (error) {
        return { error: authErrorMessage(error.code, error.status, mode), fieldErrors: {}, values };
      }
      router.replace(next);
      router.refresh();
      return { error: null, fieldErrors: {}, values };
    },
    { error: null, fieldErrors: {}, values: { name: "", email: "" } },
  );

  // Erreur de retour OAuth : absente du HTML serveur et de l'hydratation, ajoutée
  // au rendu client qui suit, pour que la région `alert` la reçoive comme un
  // changement et l'annonce (un contenu présent dès le chargement n'est pas lu).
  // Effacée dès un nouvel essai (formulaire ou Google).
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [oauthErrorDismissed, setOauthErrorDismissed] = useState(false);
  const oauthError = hydrated && !oauthErrorDismissed ? initialError : null;
  const shownError = oauthError ?? state.error;

  const otherHref = `${isSignup ? "/connexion" : "/inscription"}${next !== "/programmes" ? `?next=${encodeURIComponent(next)}` : ""}`;

  return (
    <div className="flex flex-col gap-5">
      <form
        ref={formRef}
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          // Soumission manuelle : évite la réinitialisation automatique du formulaire
          // par React après l'action (on garde la saisie en cas d'erreur).
          e.preventDefault();
          if (pending) return;
          const data = new FormData(e.currentTarget);
          startTransition(() => submit(data));
        }}
      >
        <LiveRegion role="alert">
          {shownError ? (
            <p className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
              {shownError}
            </p>
          ) : null}
        </LiveRegion>
        <LiveRegion className="sr-only">
          {pending ? (isSignup ? "Création du compte…" : "Connexion en cours…") : null}
        </LiveRegion>

        {isSignup ? (
          <div>
            <label htmlFor={ids.name} className="field-label">
              Nom
            </label>
            <input
              id={ids.name}
              name="name"
              className="input"
              autoComplete="name"
              defaultValue={state.values.name}
              aria-invalid={Boolean(state.fieldErrors.name)}
              aria-describedby={state.fieldErrors.name ? `${ids.name}-err` : undefined}
              required
            />
            <FieldError id={`${ids.name}-err`} message={state.fieldErrors.name} />
          </div>
        ) : null}

        <div>
          <label htmlFor={ids.email} className="field-label">
            Adresse e-mail
          </label>
          <input
            id={ids.email}
            name="email"
            type="email"
            inputMode="email"
            className="input"
            autoComplete="email"
            spellCheck={false}
            defaultValue={state.values.email}
            aria-invalid={Boolean(state.fieldErrors.email)}
            aria-describedby={state.fieldErrors.email ? `${ids.email}-err` : undefined}
            required
          />
          <FieldError id={`${ids.email}-err`} message={state.fieldErrors.email} />
        </div>

        <div>
          <label htmlFor={ids.password} className="field-label">
            Mot de passe
          </label>
          <PasswordInput
            id={ids.password}
            name="password"
            autoComplete={isSignup ? "new-password" : "current-password"}
            aria-invalid={Boolean(state.fieldErrors.password)}
            aria-describedby={
              [isSignup ? ids.hint : null, state.fieldErrors.password ? `${ids.password}-err` : null]
                .filter(Boolean)
                .join(" ") || undefined
            }
            required
            minLength={isSignup ? MIN_PASSWORD : undefined}
          />
          {isSignup ? (
            <p id={ids.hint} className="field-hint">
              {MIN_PASSWORD} caractères au moins.
            </p>
          ) : null}
          <FieldError id={`${ids.password}-err`} message={state.fieldErrors.password} />
        </div>

        <button type="submit" className="btn btn-primary w-full" aria-disabled={pending || undefined}>
          <ButtonLabel
            idle={isSignup ? "Créer mon compte" : "Se connecter"}
            busy={isSignup ? "Création du compte…" : "Connexion…"}
            isBusy={pending}
          />
        </button>
      </form>

      {googleEnabled ? (
        <>
          <div className="flex items-center gap-3 text-sm text-muted">
            <span aria-hidden="true" className="h-px flex-1 bg-border" />
            ou
            <span aria-hidden="true" className="h-px flex-1 bg-border" />
          </div>
          <GoogleSignInButton next={next} onStart={() => setOauthErrorDismissed(true)} />
        </>
      ) : null}

      <p className="text-center text-sm text-muted">
        {isSignup ? "Déjà un compte ? " : "Pas encore de compte ? "}
        <Link href={otherHref} className="link font-medium">
          {isSignup ? "Se connecter" : "Créer un compte"}
        </Link>
      </p>
    </div>
  );
}
