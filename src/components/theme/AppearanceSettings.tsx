"use client";

import { useId } from "react";
import type { ThemePreference } from "./theme";
import { setPreference, useThemePreference } from "./theme-store";

const OPTIONS: { value: ThemePreference; label: string; hint: string }[] = [
  { value: "light", label: "Clair", hint: "Papier blanc, encre bleu nuit." },
  { value: "dark", label: "Sombre", hint: "Fond encre, pour les salles peu éclairées." },
  { value: "system", label: "Système", hint: "Suit le réglage de votre appareil." },
];

/**
 * Choix Clair / Sombre / Système, synchronisé avec le bouton de l'en-tête
 * (même magasin : l'attribut `data-theme` de <html>). Le changement est
 * immédiat et mémorisé, sans bouton d'enregistrement.
 */
export function AppearanceSettings({ serverPreference }: { serverPreference: ThemePreference }) {
  const preference = useThemePreference(serverPreference);
  const name = useId();

  return (
    <fieldset>
      <legend className="field-label">Thème de l&apos;interface</legend>
      <div className="mt-1 grid gap-2 sm:grid-cols-3">
        {OPTIONS.map((option) => {
          const id = `${name}-${option.value}`;
          return (
            <label
              key={option.value}
              htmlFor={id}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-border-strong p-3 transition-colors hover:bg-surface-2 has-[:checked]:border-text has-[:checked]:bg-accent-soft has-[:checked]:ring-1 has-[:checked]:ring-text has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring"
            >
              <input
                id={id}
                type="radio"
                name={name}
                value={option.value}
                checked={preference === option.value}
                onChange={() => setPreference(option.value)}
                aria-describedby={`${id}-hint`}
                className="mt-1 h-4 w-4 shrink-0 accent-[var(--text)] focus-visible:outline-none"
              />
              <span>
                <span className="block font-bold">{option.label}</span>
                <span id={`${id}-hint`} className="block text-sm text-muted">
                  {option.hint}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
