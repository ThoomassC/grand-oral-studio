"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import { flushSync } from "react-dom";

type PasswordInputProps = Omit<ComponentProps<"input">, "type" | "ref"> & { id: string };

/**
 * Champ mot de passe avec bouton œil intégré à droite.
 *
 * - Libellé constant « Afficher le mot de passe » + `aria-pressed` : c'est
 *   l'état pressé qui dit si le mot de passe est visible (motif bouton bascule
 *   de l'APG ; changer aussi le libellé ferait annoncer « Masquer…, enfoncé »).
 * - Le focus reste sur le bouton et la sélection du champ est restaurée après
 *   le changement de `type` (certains navigateurs la réinitialisent).
 * - Remasqué à la soumission : le gestionnaire de mots de passe du navigateur
 *   doit voir un champ `type="password"` pour proposer l'enregistrement.
 */
export function PasswordInput({ id, className = "", ...inputProps }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    // Écouteur natif sur le <form> : il passe avant le onSubmit délégué de React.
    const hide = () => flushSync(() => setVisible(false));
    form.addEventListener("submit", hide);
    return () => form.removeEventListener("submit", hide);
  }, []);

  function toggle(button: HTMLButtonElement) {
    const input = inputRef.current;
    const start = input?.selectionStart ?? null;
    const end = input?.selectionEnd ?? null;
    flushSync(() => setVisible((v) => !v));
    if (input && start !== null && end !== null) {
      input.setSelectionRange(start, end);
      // Certains moteurs (WebKit) déplacent le focus vers le champ : on le rend au bouton.
      if (document.activeElement !== button) button.focus();
    }
  }

  return (
    <div className="relative">
      <input
        {...inputProps}
        ref={inputRef}
        id={id}
        type={visible ? "text" : "password"}
        // Mot de passe affiché : pas de correcteur (certains l'envoient à un service en ligne).
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="none"
        className={`input pr-12 ${className}`}
      />
      <button
        type="button"
        className="absolute inset-y-0 right-0 my-auto mr-0.5 inline-flex h-10 w-10 items-center justify-center rounded-md text-muted transition-colors hover:text-text aria-pressed:bg-surface-2 aria-pressed:text-text"
        aria-label="Afficher le mot de passe"
        title="Afficher le mot de passe"
        aria-pressed={visible}
        aria-controls={id}
        onClick={(e) => toggle(e.currentTarget)}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.6 5.1A9.7 9.7 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-2.6 3.5M6.6 6.6C3.9 8.4 2.5 12 2.5 12S6 19 12 19a9.4 9.4 0 0 0 5.4-1.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m3 3 18 18" />
    </svg>
  );
}
