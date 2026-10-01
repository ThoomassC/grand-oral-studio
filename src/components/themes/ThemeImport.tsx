"use client";

import { useId, useState, useTransition } from "react";
import { importThemes } from "@/server/actions/themes";

type ImportOutcome =
  | { kind: "idle" }
  | { kind: "done"; created: number; skipped: string[] }
  | { kind: "error"; message: string; lines: string[] };

const EXAMPLE = `Transition énergétique | Enjeux et leviers de la décarbonation | énergie, climat, sobriété
Économie circulaire | Réemploi, recyclage, écoconception | déchets, ressources
Intelligence artificielle`;

/**
 * Import en masse. L'action est « tout ou rien » : une seule ligne invalide
 * rejette l'import et renvoie le détail par ligne ; les noms déjà présents
 * sont ignorés (import rejouable).
 */
export function ThemeImport({ programId }: { programId: string }) {
  const textId = useId();
  const formatId = useId();
  const [text, setText] = useState("");
  const [outcome, setOutcome] = useState<ImportOutcome>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    startTransition(async () => {
      const result = await importThemes(programId, text);
      if (!result.ok) {
        setOutcome({ kind: "error", message: result.error, lines: result.fieldErrors?.text ?? [] });
        return;
      }
      setOutcome({ kind: "done", created: result.data.created, skipped: result.data.skipped });
      setText("");
    });
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="mt-3 flex flex-col gap-4">
      <div id={formatId} className="rounded-lg bg-surface-2 p-3 text-sm">
        <p className="font-semibold">Format : une ligne par thème</p>
        <p className="mt-1">
          <code className="font-mono">Nom | description | mot-clé 1, mot-clé 2</code>
        </p>
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-muted">
          <li>La description et les mots-clés sont facultatifs.</li>
          <li>Les lignes vides et celles qui commencent par # sont ignorées.</li>
          <li>Les thèmes déjà présents (même nom) sont ignorés ; 30 thèmes au plus par import.</li>
        </ul>
      </div>
      <div>
        <label htmlFor={textId} className="field-label">
          Liste des thèmes
        </label>
        <textarea
          id={textId}
          className="input font-mono text-sm"
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={EXAMPLE}
          aria-describedby={`${formatId}${outcome.kind === "error" ? ` ${textId}-err` : ""}`}
          aria-invalid={outcome.kind === "error"}
          spellCheck={false}
        />
      </div>

      <div role="alert" aria-atomic="true">
        {outcome.kind === "error" ? (
          <div
            id={`${textId}-err`}
            className="rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger"
          >
            <p className="font-semibold">{outcome.message} Aucun thème n&apos;a été importé.</p>
            {outcome.lines.length > 0 ? (
              <ul className="mt-1 list-disc pl-5">
                {outcome.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
      <div role="status" aria-atomic="true">
        {outcome.kind === "done" ? (
          <div className="rounded-lg border border-success/40 bg-success-soft px-3 py-2 text-sm">
            <p className="font-semibold text-success">
              {outcome.created === 0
                ? "Aucun nouveau thème créé."
                : `${outcome.created} thème${outcome.created > 1 ? "s" : ""} créé${outcome.created > 1 ? "s" : ""}.`}
            </p>
            {outcome.skipped.length > 0 ? (
              <p className="mt-1">
                Ignoré{outcome.skipped.length > 1 ? "s" : ""} (déjà présent{outcome.skipped.length > 1 ? "s" : ""}) :{" "}
                {outcome.skipped.join(", ")}.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary" disabled={pending || text.trim() === ""}>
          {pending ? "Import…" : "Importer"}
        </button>
        {text === "" ? (
          <button type="button" className="btn btn-ghost" onClick={() => setText(EXAMPLE)}>
            Insérer un exemple
          </button>
        ) : null}
      </div>
    </form>
  );
}
