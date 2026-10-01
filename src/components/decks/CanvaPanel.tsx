"use client";

import { useId, useRef, useState } from "react";

type CopyState = { kind: "idle" } | { kind: "copied" } | { kind: "manual" };

/** Panneau « Ouvrir dans Canva » : marche à suivre et prompt à copier. */
export function CanvaPanel({ prompt, id }: { prompt: string; id: string }) {
  const textareaId = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [copy, setCopy] = useState<CopyState>({ kind: "idle" });

  async function copyPrompt() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard indisponible");
      await navigator.clipboard.writeText(prompt);
      setCopy({ kind: "copied" });
    } catch {
      // Repli : on sélectionne le texte pour une copie au clavier.
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.select();
      }
      setCopy({ kind: "manual" });
    }
  }

  return (
    <section id={id} aria-labelledby={`${id}-title`} className="card p-5 sm:p-6">
      <h2 id={`${id}-title`} className="text-lg font-semibold">
        Importer dans Canva
      </h2>
      <ol className="mt-3 list-decimal space-y-1.5 pl-5">
        <li>
          Téléchargez le fichier .pptx de ce deck (bouton « Télécharger le .pptx » ci-dessus).
        </li>
        <li>
          Ouvrez{" "}
          <a href="https://www.canva.com" target="_blank" rel="noopener noreferrer" className="link">
            canva.com<span className="sr-only"> (nouvel onglet)</span>
          </a>{" "}
          et connectez-vous.
        </li>
        <li>
          Cliquez sur <strong>Créer un design</strong>, puis <strong>Importer un fichier</strong>.
        </li>
        <li>Choisissez le fichier .pptx téléchargé : Canva le convertit en design modifiable.</li>
        <li>
          Pour aller plus loin, copiez le prompt ci-dessous et collez-le dans l&apos;assistant IA de Canva : il
          rappelle la charte et le contenu diapo par diapo.
        </li>
      </ol>

      <div className="mt-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <label htmlFor={textareaId} className="field-label mb-0">
            Prompt Canva
          </label>
          <button type="button" className="btn btn-secondary btn-sm" onClick={copyPrompt}>
            Copier le prompt Canva
          </button>
        </div>
        <textarea
          ref={textareaRef}
          id={textareaId}
          readOnly
          value={prompt}
          rows={12}
          className="input mt-2 max-h-80 font-mono text-sm"
          aria-describedby={`${textareaId}-status`}
        />
        <p id={`${textareaId}-status`} role="status" className="mt-2 text-sm font-medium">
          {copy.kind === "copied" ? (
            <span className="text-success">Prompt copié dans le presse-papiers.</span>
          ) : copy.kind === "manual" ? (
            <span className="text-warning">
              La copie automatique n&apos;est pas disponible. Le texte est sélectionné : appuyez sur Ctrl+C (ou Cmd+C
              sur Mac).
            </span>
          ) : null}
        </p>
      </div>
    </section>
  );
}
