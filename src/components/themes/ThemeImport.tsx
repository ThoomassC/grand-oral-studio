"use client";

import { Notice } from "@/components/ui/Notice";
import { TextArea } from "@/components/ui/Field";
import { Button } from "@thomascaron/opale-ui";
import { useId, useState, useTransition } from "react";
import { importThemes } from "@/server/actions/themes";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { LiveRegion } from "@/components/ui/LiveRegion";

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
export function ThemeImport({
  programId,
  textareaId,
  onClose,
}: {
  programId: string;
  textareaId?: string;
  onClose?: () => void;
}) {
  const generatedId = useId();
  const textId = textareaId ?? generatedId;
  const formatId = useId();
  const [text, setText] = useState("");
  const [outcome, setOutcome] = useState<ImportOutcome>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || text.trim() === "") return;
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof importThemes>>;
      try {
        result = await importThemes(programId, text);
      } catch {
        setOutcome({ kind: "error", message: "La connexion a été interrompue. Votre liste est conservée : réessayez.", lines: [] });
        return;
      }
      if (!result.ok) {
        setOutcome({ kind: "error", message: result.error, lines: result.fieldErrors?.text ?? [] });
        document.getElementById(textId)?.focus();
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
        <label htmlFor={textId} className="opale-field__label">
          Liste des thèmes
        </label>
        <TextArea
          id={textId}
          className="font-mono text-sm"
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={EXAMPLE}
          aria-describedby={`${formatId}${outcome.kind === "error" ? ` ${textId}-err` : ""}`}
          aria-invalid={outcome.kind === "error"}
          spellCheck={false}
        />
      </div>

      <LiveRegion role="alert">
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
      </LiveRegion>
      <LiveRegion>
        {outcome.kind === "done" ? (
          <Notice tone="success">
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
          </Notice>
        ) : null}
      </LiveRegion>

      <div className="flex flex-wrap gap-2">
        <Button type="submit" aria-disabled={pending || text.trim() === "" || undefined}>
          <ButtonLabel idle="Importer les thèmes" busy="Import…" isBusy={pending} />
        </Button>
        <Button
          type="button"
          variant="text"
          aria-disabled={text !== "" || undefined}
          aria-describedby={text !== "" ? `${textId}-example-hint` : undefined}
          onClick={() => {
            if (text === "") setText(EXAMPLE);
          }}
        >
          Insérer un exemple
        </Button>
        {text !== "" ? (
          <span id={`${textId}-example-hint`} className="sr-only">
            Disponible quand la liste est vide.
          </span>
        ) : null}
        {onClose ? (
          <Button type="button" variant="text" onClick={onClose}>
            Fermer
          </Button>
        ) : null}
      </div>
    </form>
  );
}
