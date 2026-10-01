"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import { flushSync } from "react-dom";
import { Button, Icon } from "@thomascaron/opale-ui";

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
    <div className="opale-input-shell pr-1">
      <input
        {...inputProps}
        ref={inputRef}
        id={id}
        type={visible ? "text" : "password"}
        // Mot de passe affiché : pas de correcteur (certains l'envoient à un service en ligne).
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="none"
        className={`opale-input ${className}`}
      />
      <Button
        variant="text"
        size="small"
        className="opale-icon-action-button shrink-0"
        aria-label="Afficher le mot de passe"
        title="Afficher le mot de passe"
        aria-pressed={visible}
        aria-controls={id}
        onClick={(e) => toggle(e.currentTarget)}
      >
        <Icon name={visible ? "eye-off" : "eye"} />
      </Button>
    </div>
  );
}
