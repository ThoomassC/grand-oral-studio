"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useId, useState, startTransition } from "react";
import { signIn, signUp } from "@/lib/auth-client";
import { FieldError } from "@/components/ui/FieldError";

type Mode = "signin" | "signup";

interface AuthState {
  error: string | null;
  fieldErrors: Partial<Record<"name" | "email" | "password", string>>;
  values: { name: string; email: string };
}

const MIN_PASSWORD = 10;

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

export function AuthForm({ mode, next }: { mode: Mode; next: string }) {
  const router = useRouter();
  const ids = { name: useId(), email: useId(), password: useId(), hint: useId() };
  const [showPassword, setShowPassword] = useState(false);

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
      if (Object.keys(fieldErrors).length > 0) return { error: null, fieldErrors, values };

      const { error } =
        mode === "signin"
          ? await signIn.email({ email, password })
          : await signUp.email({ email, password, name });
      if (error) {
        return { error: authErrorMessage(error.code, error.status, mode), fieldErrors: {}, values };
      }
      router.replace(next);
      router.refresh();
      return { error: null, fieldErrors: {}, values };
    },
    { error: null, fieldErrors: {}, values: { name: "", email: "" } },
  );

  const isSignup = mode === "signup";
  const otherHref = `${isSignup ? "/connexion" : "/inscription"}${next !== "/programmes" ? `?next=${encodeURIComponent(next)}` : ""}`;

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        // Soumission manuelle : évite la réinitialisation automatique du formulaire
        // par React après l'action (on garde la saisie en cas d'erreur).
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => submit(data));
      }}
    >
      <div role="alert" aria-atomic="true">
        {state.error ? (
          <p className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
            {state.error}
          </p>
        ) : null}
      </div>

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
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={ids.password} className="field-label">
            Mot de passe
          </label>
          <button
            type="button"
            className="text-sm font-medium text-accent-strong underline underline-offset-2"
            aria-pressed={showPassword}
            onClick={() => setShowPassword((v) => !v)}
          >
            {showPassword ? "Masquer" : "Afficher"}
            <span className="sr-only"> le mot de passe</span>
          </button>
        </div>
        <input
          id={ids.password}
          name="password"
          type={showPassword ? "text" : "password"}
          className="input"
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

      <button type="submit" className="btn btn-primary w-full" disabled={pending}>
        {pending ? (isSignup ? "Création du compte…" : "Connexion…") : isSignup ? "Créer mon compte" : "Se connecter"}
      </button>

      <p className="text-center text-sm text-muted">
        {isSignup ? "Déjà un compte ? " : "Pas encore de compte ? "}
        <Link href={otherHref} className="link font-medium">
          {isSignup ? "Se connecter" : "Créer un compte"}
        </Link>
      </p>
    </form>
  );
}
