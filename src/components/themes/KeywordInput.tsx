"use client";

import { useId, useRef, useState } from "react";

interface KeywordInputProps {
  id: string;
  value: string[];
  onChange: (next: string[]) => void;
  max?: number;
  maxLength?: number;
  describedBy?: string;
  invalid?: boolean;
}

/**
 * Saisie de mots-clés en « chips ». Entrée ou virgule ajoute le mot ; chaque
 * chip a son propre bouton de retrait (nom accessible explicite). Retour
 * arrière dans un champ vide retire le dernier mot.
 */
export function KeywordInput({
  id,
  value,
  onChange,
  max = 30,
  maxLength = 60,
  describedBy,
  invalid = false,
}: KeywordInputProps) {
  const [draft, setDraft] = useState("");
  const [announce, setAnnounce] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const full = value.length >= max;

  function add(raw: string) {
    if (full) {
      setDraft("");
      return;
    }
    const parts = raw
      .split(/[,;]/)
      .map((p) => p.trim().slice(0, maxLength))
      .filter(Boolean);
    if (parts.length === 0) return;
    const seen = new Set(value.map((v) => v.toLocaleLowerCase("fr")));
    const added: string[] = [];
    for (const p of parts) {
      const key = p.toLocaleLowerCase("fr");
      if (seen.has(key) || value.length + added.length >= max) continue;
      seen.add(key);
      added.push(p);
    }
    if (added.length > 0) {
      onChange([...value, ...added]);
      setAnnounce(`Ajouté : ${added.join(", ")}.`);
    }
    setDraft("");
  }

  function remove(index: number) {
    const removed = value[index];
    onChange(value.filter((_, i) => i !== index));
    setAnnounce(`Retiré : ${removed}.`);
    inputRef.current?.focus();
  }

  return (
    <div>
      <div
        className={`input flex min-h-11 flex-wrap items-center gap-1.5 py-1.5 focus-within:outline-2 focus-within:outline-offset-0 focus-within:outline-accent ${
          invalid ? "border-danger" : ""
        }`}
      >
        {value.length > 0 ? (
          <ul className="contents" aria-label="Mots-clés">
            {value.map((kw, i) => (
              <li
                key={`${kw}-${i}`}
                className="inline-flex items-center gap-1 rounded-md bg-accent-soft py-0.5 pl-2 pr-0.5 text-sm text-accent-strong"
              >
                <span>{kw}</span>
                <button
                  type="button"
                  className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-surface"
                  onClick={() => remove(i)}
                  aria-label={`Retirer le mot-clé ${kw}`}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3.5 w-3.5">
                    <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <input
          ref={inputRef}
          id={id}
          value={draft}
          onChange={(e) => {
            const v = e.target.value;
            if (/[,;]/.test(v)) add(v);
            else setDraft(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
            } else if (e.key === "Backspace" && draft === "" && value.length > 0) {
              remove(value.length - 1);
            }
          }}
          onBlur={() => add(draft)}
          className="min-w-[8rem] flex-1 bg-transparent py-1 outline-none"
          aria-describedby={[hintId, describedBy].filter(Boolean).join(" ")}
          aria-invalid={invalid}
          readOnly={full}
          maxLength={maxLength}
        />
      </div>
      <p id={hintId} className={`field-hint ${full ? "font-semibold text-warning" : ""}`}>
        {full
          ? `Limite de ${max} mots-clés atteinte : retirez-en un pour en ajouter un autre.`
          : `Validez chaque mot-clé avec Entrée ou une virgule (${value.length}/${max}).`}
      </p>
      <p role="status" className="sr-only">
        {announce}
      </p>
    </div>
  );
}
