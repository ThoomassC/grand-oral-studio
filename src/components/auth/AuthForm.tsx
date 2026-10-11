"use client";

import { Notice } from "@/components/ui/Notice";
import { TextInput } from "@/components/ui/Field";
import { Button } from "@thomascaron/opale-ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useRef, useState, useSyncExternalStore, startTransition } from "react";
import { signIn, signUp } from "@/lib/auth-client";
import { FieldError } from "@/components/ui/FieldError";
import { focusFirstInvalid, invalidCountMessage } from "@/components/ui/focus";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { LiveRegion } from "@/components/ui/LiveRegion";
import type { GoogleButtonState } from "@/lib/auth-options";
import { GoogleSignInButton } from "./GoogleSignInButton";
import { postLoginPath, verificationCallbackPath } from "./next-path";
import { EMAIL_DOMAIN_NOT_ALLOWED_MESSAGE } from "./oauth-error";
import { PasswordInput } from "./PasswordInput";
import { LoginSubmitButton } from "./LoginSubmitButton";
import { AUTH_BUTTON_PENDING_MS, AUTH_BUTTON_SUCCESS_MS, waitForAuthMotion } from "./auth-motion";
import styles from "./LoginExperience.module.css";

type Mode = "signin" | "signup";

interface AuthState {
  error: string | null;
  fieldErrors: Partial<Record<"name" | "email" | "password", string>>;
  values: { name: string; email: string };
  /** Inscription faite, adresse à confirmer : l'adresse à laquelle le lien est parti. */
  verificationSentTo?: string;
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
    case "EMAIL_NOT_VERIFIED":
      // Renvoyé seulement après un mot de passe correct (sendOnSignIn) : rien n'est révélé.
      return "Confirmez d'abord votre adresse e-mail : nous venons de vous renvoyer un lien de confirmation. Ouvrez-le pour vous connecter (pensez aux indésirables).";
    case "EMAIL_DOMAIN_NOT_ALLOWED":
      return EMAIL_DOMAIN_NOT_ALLOWED_MESSAGE;
    default:
      return mode === "signin"
        ? "La connexion a échoué. Réessayez dans un instant."
        : "L'inscription a échoué. Réessayez dans un instant.";
  }
}

interface AuthFormProps {
  mode: Mode;
  appearance?: "default" | "studio";
  next: string;
  /** Connexion Google configurée côté serveur (booléen seul, aucun identifiant). */
  google: GoogleButtonState;
  /** Message d'erreur à afficher dès l'arrivée (retour d'échec OAuth). */
  initialError?: string | null;
  /** Vérification de l'adresse exigée (e-mails configurés côté serveur). */
  verifyEmail?: boolean;
}

export function AuthForm({ mode, next, google, initialError = null, verifyEmail = false, appearance = "default" }: AuthFormProps) {
  const router = useRouter();
  const isSignup = mode === "signup";
  const studio = appearance === "studio";
  const ids = { name: useId(), email: useId(), password: useId(), hint: useId() };
  const formRef = useRef<HTMLFormElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const [navigating, setNavigating] = useState(false);
  const [googlePending, setGooglePending] = useState(false);

  useEffect(() => () => requestRef.current?.abort(), []);

  const [state, submit, pending] = useActionState<AuthState, FormData>(
    async (_prev, formData) => {
      const operation = requestRef.current ?? new AbortController();
      try {
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

        // Destination du lien de confirmation d'adresse (envoyé à l'inscription, et à
        // la connexion tant que l'adresse n'est pas confirmée).
        const callback = verifyEmail ? { callbackURL: verificationCallbackPath(next) } : {};
        let error: { code?: string; status: number } | null;
        let pendingVerification = false;
        const started = performance.now();
        try {
          if (mode === "signin") {
            ({ error } = await signIn.email({ email, password, ...callback }));
          } else {
            const result = await signUp.email({ email, password, name, ...callback });
            error = result.error;
            // Pas de session : adresse à confirmer (ou adresse déjà inscrite, même réponse).
            pendingVerification = !error && verifyEmail && !result.data?.token;
          }
        } catch {
          return { error: "La connexion au serveur a été interrompue. Réessayez.", fieldErrors: {}, values };
        }
        if (operation.signal.aborted) return _prev;
        if (error) {
          return { error: authErrorMessage(error.code, error.status, mode), fieldErrors: {}, values };
        }
        if (pendingVerification) {
          return { error: null, fieldErrors: {}, values, verificationSentTo: email };
        }

        const destination = postLoginPath(next);
        if (!isSignup) {
          // Le serveur a confirmé la session : précharger pendant le retour visuel.
          router.prefetch(destination);
          await waitForAuthMotion(AUTH_BUTTON_PENDING_MS - (performance.now() - started), operation.signal);
          if (operation.signal.aborted) return _prev;
        }
        setNavigating(true);
        if (!isSignup) {
          await waitForAuthMotion(AUTH_BUTTON_SUCCESS_MS, operation.signal);
          if (operation.signal.aborted) return _prev;
        }
        router.replace(destination);
        router.refresh();
        return { error: null, fieldErrors: {}, values };
      } finally {
        if (requestRef.current === operation) requestRef.current = null;
      }
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
  const shownError = oauthError ?? (pending ? null : state.error);
  const busy = pending || navigating || googlePending;

  const otherHref = `${isSignup ? "/connexion" : "/inscription"}${next !== "/projets" ? `?next=${encodeURIComponent(next)}` : ""}`;

  const googleSection = google !== "hidden" ? (
    <>
      {!studio ? (
        <div className="auth-divider flex items-center gap-3 text-sm text-muted">
          <span aria-hidden="true" className="h-px flex-1 bg-border" />
          ou
          <span aria-hidden="true" className="h-px flex-1 bg-border" />
        </div>
      ) : null}
      <GoogleSignInButton
        next={next}
        configured={google === "enabled"}
        blocked={pending || navigating}
        onStart={() => setOauthErrorDismissed(true)}
        onPendingChange={setGooglePending}
      />
      {studio ? (
        <div className="auth-divider flex items-center gap-3">
          <span aria-hidden="true" className="h-px flex-1 bg-border" />
          ou avec votre adresse e-mail
          <span aria-hidden="true" className="h-px flex-1 bg-border" />
        </div>
      ) : null}
    </>
  ) : null;

  return (
    <div className={`flex flex-col gap-5 ${studio ? styles.form : ""}`}>
      {studio ? googleSection : null}
      <form
        ref={formRef}
        noValidate
        aria-busy={busy || undefined}
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          // Soumission manuelle : évite la réinitialisation automatique du formulaire
          // par React après l'action (on garde la saisie en cas d'erreur).
          e.preventDefault();
          if (busy || requestRef.current) return;
          setOauthErrorDismissed(true);
          requestRef.current = new AbortController();
          const data = new FormData(e.currentTarget);
          startTransition(() => submit(data));
        }}
      >
        <LiveRegion role="alert">
          {shownError ? (
            <Notice tone="error">
              {shownError}
            </Notice>
          ) : null}
        </LiveRegion>
        <LiveRegion>
          {state.verificationSentTo ? (
            <Notice tone="success" title="Presque terminé">
              Ouvrez le lien de confirmation envoyé à {state.verificationSentTo} pour activer votre compte (pensez aux
              indésirables). Si vous aviez déjà un compte avec cette adresse, connectez-vous simplement.
            </Notice>
          ) : null}
        </LiveRegion>

        {isSignup ? (
          <div>
            <label htmlFor={ids.name} className="opale-field__label">
              Nom
            </label>
            <TextInput
              id={ids.name}
              name="name"
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
          <label htmlFor={ids.email} className="opale-field__label">
            Adresse e-mail
          </label>
          <TextInput
            id={ids.email}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            spellCheck={false}
            placeholder={studio ? "vous@exemple.fr" : undefined}
            defaultValue={state.values.email}
            aria-invalid={Boolean(state.fieldErrors.email)}
            aria-describedby={state.fieldErrors.email ? `${ids.email}-err` : undefined}
            required
          />
          <FieldError id={`${ids.email}-err`} message={state.fieldErrors.email} />
        </div>

        <div>
          <div className={studio ? "auth-password-label" : undefined}>
            <label htmlFor={ids.password} className="opale-field__label">
              Mot de passe
            </label>
            {studio && !isSignup ? (
              <Link href="/mot-de-passe-oublie" className="opale-link">Mot de passe oublié ?</Link>
            ) : null}
          </div>
          <PasswordInput
            id={ids.password}
            name="password"
            autoComplete={isSignup ? "new-password" : "current-password"}
            placeholder={studio ? "Votre mot de passe" : undefined}
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
            <p id={ids.hint} className="opale-field__helper">
              {MIN_PASSWORD} caractères au moins.
            </p>
          ) : null}
          <FieldError id={`${ids.password}-err`} message={state.fieldErrors.password} />
          {isSignup || studio ? null : (
            <p className="mt-2 text-sm">
              <Link href="/mot-de-passe-oublie" className="opale-link">
                Mot de passe oublié ?
              </Link>
            </p>
          )}
        </div>

        {!isSignup ? (
          <LoginSubmitButton phase={navigating ? "success" : pending ? "loading" : "idle"} blocked={busy} studio={studio} />
        ) : (
          <Button type="submit" fullWidth className={studio ? "auth-submit" : undefined} aria-disabled={busy || undefined}>
            <ButtonLabel
              idle="Créer mon compte"
              busy="Création du compte…"
              isBusy={pending || navigating}
            />
            {studio ? (
              <svg className="auth-submit-arrow" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M4 10h12m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : null}
          </Button>
        )}
      </form>

      <LiveRegion className="sr-only">
        {!isSignup && navigating ? "Connexion réussie." : pending ? (isSignup ? "Création du compte…" : "Connexion en cours…") : null}
      </LiveRegion>

      {!studio ? googleSection : null}

      <p className="auth-other-account text-center text-sm text-muted">
        {isSignup ? "Déjà un compte ? " : "Pas encore de compte ? "}
        <Link href={otherHref} className="opale-link font-medium">
          {isSignup ? "Se connecter" : "Créer un compte"}
        </Link>
      </p>
    </div>
  );
}
