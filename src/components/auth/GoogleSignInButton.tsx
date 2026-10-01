"use client";

import { useState } from "react";
import { signIn } from "@/lib/auth-client";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { LiveRegion } from "@/components/ui/LiveRegion";

const START_ERROR = "La connexion avec Google n'a pas pu démarrer. Réessayez.";

/**
 * Bouton « Continuer avec Google » (charte Google Identity : fond blanc,
 * bordure #747775, texte #1F1F1F ; variante sombre #131314 / #8E918F / #E3E3E3,
 * logo « G » multicolore inchangé).
 *
 * `signIn.social` fait un fetch POST puis `window.location.href = url` : pas de
 * soumission de formulaire vers Google, donc rien à ouvrir dans `form-action`.
 * En cas de succès la page part : l'état « en cours » reste affiché jusqu'au départ.
 */
export function GoogleSignInButton({ next, onStart }: { next: string; onStart?: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (pending) return;
    setPending(true);
    setError(null);
    onStart?.();
    try {
      const { error: failure } = await signIn.social({
        provider: "google",
        callbackURL: next,
        newUserCallbackURL: next,
        errorCallbackURL: `/connexion?next=${encodeURIComponent(next)}`,
      });
      if (!failure) return;
    } catch {
      // Réseau coupé : même message, le détail technique n'aide pas l'utilisateur.
    }
    setError(START_ERROR);
    setPending(false);
  }

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        onClick={start}
        aria-disabled={pending || undefined}
        className="btn w-full border-[#747775] bg-white px-3 text-[#1f1f1f] hover:bg-[#f8f9fa] aria-disabled:cursor-progress aria-disabled:opacity-100 dark:border-[#8e918f] dark:bg-[#131314] dark:text-[#e3e3e3] dark:hover:bg-[#1f1f20]"
      >
        {/* En cours : seul le logo est estompé, le libellé garde son contraste. */}
        <GoogleLogo dimmed={pending} />
        <ButtonLabel idle="Continuer avec Google" busy="Redirection vers Google…" isBusy={pending} />
      </button>
      <LiveRegion className="sr-only">{pending ? "Redirection vers Google…" : null}</LiveRegion>
      <LiveRegion role="alert">
        {error ? (
          <p className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-sm font-medium text-danger">{error}</p>
        ) : null}
      </LiveRegion>
    </div>
  );
}

/** Logo « G » officiel (Google Identity Services), couleurs de marque non modifiables. */
function GoogleLogo({ dimmed }: { dimmed: boolean }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className={`h-5 w-5 shrink-0 transition-opacity ${dimmed ? "opacity-40 grayscale" : ""}`}>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
