"use client";

import { TextArea, TextInput } from "@/components/ui/Field";
import { Button } from "@thomascaron/opale-ui";
import { useId, useRef, useState, useTransition } from "react";
import { LIMITS, ThemeInputSchema, type ThemeInput } from "@/domain/schemas";
import type { ActionResult } from "@/server/actions/result";
import { errorProps, firstError, validateWith, type FieldErrors } from "@/components/forms/validation";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { FieldError } from "@/components/ui/FieldError";
import { countFieldErrors, focusFirstInvalid, invalidCountMessage } from "@/components/ui/focus";
import { FormStatus, IDLE, type FormStatusState } from "@/components/ui/FormStatus";
import { LiveRegion } from "@/components/ui/LiveRegion";
import { formatCount } from "@/components/ui/format";
import { useUnsavedChanges } from "@/components/layout/UnsavedChanges";
import { KeywordInput } from "./KeywordInput";

const NOTES_MAX = LIMITS.subjectNotes;
const PROBLEMS_MAX = LIMITS.subjectProblems;
/** Seuil d'avertissement des notes : 90 % de la limite. */
const NOTES_NEAR = Math.ceil(NOTES_MAX * 0.9);

/**
 * Message de la région polie sous les notes : un texte fixe par palier (approche,
 * limite atteinte), pour une seule annonce à chaque changement de palier et non à
 * chaque frappe. `maxLength` arrête la saisie à la limite : sans ce message, elle
 * s'arrêterait sans bruit.
 */
function notesLimitMessage(length: number): string | null {
  if (length >= NOTES_MAX) return `Limite de ${formatCount(NOTES_MAX)} caractères atteinte : la saisie s'arrête ici.`;
  if (length >= NOTES_NEAR) return `Vous approchez de la limite de ${formatCount(NOTES_MAX)} caractères.`;
  return null;
}

interface ThemeFormProps {
  initial?: ThemeInput;
  submitLabel: string;
  pendingLabel: string;
  /** Message affiché dans le formulaire après succès (formulaire d'ajout, qui reste ouvert). */
  successMessage?: string;
  onSubmit: (value: ThemeInput) => Promise<ActionResult<unknown>>;
  /** Appelé après un enregistrement réussi, avec le nom enregistré. */
  onSaved?: (name: string) => void;
  onCancel?: () => void;
  /** Vide le formulaire après succès (formulaire d'ajout). */
  resetOnSuccess?: boolean;
  /** Id du champ « Nom » (pour y placer le focus depuis le parent). */
  nameId?: string;
}

const EMPTY: ThemeInput = { name: "", description: "", keywords: [], notes: "", problems: [] };

/** Une problématique par ligne non vide, espaces de bord retirés. */
function parseProblems(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Erreur de la liste (`problems`) ou d'une problématique précise (`problems.3`), avec son rang. */
function problemsError(errors: FieldErrors): string | undefined {
  const list = firstError(errors, "problems");
  if (list) return list;
  const entry = Object.entries(errors).find(([k]) => /^problems\.\d+$/.test(k));
  if (!entry) return undefined;
  const index = Number(entry[0].split(".")[1]);
  return `Problématique ${index + 1} : ${entry[1][0] ?? "valeur invalide"}`;
}

/** Première erreur portant sur un mot-clé précis (`keywords.3`), avec son rang. */
function keywordItemError(errors: FieldErrors): string | undefined {
  const entry = Object.entries(errors).find(([k]) => /^keywords\.\d+$/.test(k));
  if (!entry) return undefined;
  const index = Number(entry[0].split(".")[1]);
  return `Mot-clé ${index + 1} : ${entry[1][0] ?? "valeur invalide"}`;
}

export function ThemeForm({
  initial = EMPTY,
  submitLabel,
  pendingLabel,
  successMessage,
  onSubmit,
  onSaved,
  onCancel,
  resetOnSuccess = false,
  nameId,
}: ThemeFormProps) {
  const generatedId = useId();
  const ids = {
    name: nameId ?? `${generatedId}-name`,
    description: `${generatedId}-description`,
    keywords: `${generatedId}-keywords`,
    notes: `${generatedId}-notes`,
    notesHint: `${generatedId}-notes-hint`,
    notesCount: `${generatedId}-notes-count`,
    problems: `${generatedId}-problems`,
    problemsHint: `${generatedId}-problems-hint`,
    problemsCount: `${generatedId}-problems-count`,
  };
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [keywords, setKeywords] = useState<string[]>(initial.keywords);
  const [notes, setNotes] = useState(initial.notes);
  /** Saisie brute (une problématique par ligne), découpée à l'envoi seulement. */
  const [problemsText, setProblemsText] = useState((initial.problems ?? []).join("\n"));
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<FormStatusState>(IDLE);
  const [pending, startTransition] = useTransition();
  /** Dernière saisie enregistrée (ou l'état initial) : la référence des modifications non enregistrées. */
  const [baseline, setBaseline] = useState<ThemeInput>(initial);
  const problems = parseProblems(problemsText);
  const dirty =
    name !== baseline.name ||
    description !== baseline.description ||
    notes !== baseline.notes ||
    JSON.stringify(keywords) !== JSON.stringify(baseline.keywords) ||
    JSON.stringify(problems) !== JSON.stringify(baseline.problems ?? []);
  useUnsavedChanges(dirty);

  const keywordError = firstError(fieldErrors, "keywords") ?? keywordItemError(fieldErrors);
  const problemError = problemsError(fieldErrors);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setStatus(IDLE);
    // Toujours envoyées, même vides : une liste vidée efface les problématiques enregistrées.
    const checked = validateWith(ThemeInputSchema, { name, description, keywords, notes, problems });
    if (!checked.ok) {
      setFieldErrors(checked.fieldErrors);
      setStatus({ kind: "error", message: invalidCountMessage(countFieldErrors(checked.fieldErrors)) });
      focusFirstInvalid(formRef.current);
      return;
    }
    setFieldErrors({});
    const submitted: ThemeInput = { name, description, keywords, notes, problems };
    startTransition(async () => {
      let result: ActionResult<unknown>;
      try {
        result = await onSubmit(checked.data);
      } catch {
        setStatus({ kind: "error", message: "La connexion a été interrompue. Votre saisie est conservée : réessayez." });
        return;
      }
      if (!result.ok) {
        const errors = result.fieldErrors ?? {};
        setFieldErrors(errors);
        setStatus({ kind: "error", message: result.error });
        if (countFieldErrors(errors) > 0) focusFirstInvalid(formRef.current);
        return;
      }
      if (successMessage) setStatus({ kind: "success", message: successMessage });
      if (!resetOnSuccess) setBaseline(submitted);
      if (resetOnSuccess) {
        setName("");
        setDescription("");
        setKeywords([]);
        setNotes("");
        setProblemsText("");
        nameRef.current?.focus();
      }
      onSaved?.(checked.data.name);
    });
  }

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={handleSubmit}
      className="flex flex-col gap-4"
      onKeyDown={(e) => {
        if (e.key === "Escape" && onCancel && !pending) {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <div>
        <label htmlFor={ids.name} className="opale-field__label">
          Nom du sujet
        </label>
        <TextInput
          ref={nameRef}
          id={ids.name}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          required
          {...errorProps(fieldErrors, "name", `${ids.name}-err`)}
        />
        <FieldError id={`${ids.name}-err`} message={firstError(fieldErrors, "name")} />
      </div>
      <div>
        <label htmlFor={ids.description} className="opale-field__label">
          Description <span className="font-normal text-muted">(facultatif)</span>
        </label>
        <TextArea
          id={ids.description}
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          {...errorProps(fieldErrors, "description", `${ids.description}-err`)}
        />
        <FieldError id={`${ids.description}-err`} message={firstError(fieldErrors, "description")} />
      </div>
      <div>
        <label htmlFor={ids.keywords} className="opale-field__label">
          Mots-clés <span className="font-normal text-muted">(facultatif, aident à reconnaître le sujet)</span>
        </label>
        <KeywordInput
          id={ids.keywords}
          value={keywords}
          onChange={setKeywords}
          invalid={Boolean(keywordError)}
          describedBy={keywordError ? `${ids.keywords}-err` : undefined}
        />
        <FieldError id={`${ids.keywords}-err`} message={keywordError} />
      </div>
      <div>
        <label htmlFor={ids.notes} className="opale-field__label">
          Notes <span className="font-normal text-muted">(facultatif)</span>
        </label>
        <TextArea
          id={ids.notes}
          rows={5}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={NOTES_MAX}
          {...errorProps(fieldErrors, "notes", `${ids.notes}-err`, `${ids.notesHint} ${ids.notesCount}`)}
        />
        <p id={ids.notesHint} className="opale-field__helper">
          Chiffres, exemples, sources : le jour J, le diaporama s&apos;appuie dessus.
        </p>
        <p id={ids.notesCount} className="opale-field__helper num">
          {`${formatCount(notes.length)} / ${formatCount(NOTES_MAX)} caractères`}
        </p>
        <LiveRegion className="opale-field__helper font-semibold">{notesLimitMessage(notes.length)}</LiveRegion>
        <FieldError id={`${ids.notes}-err`} message={firstError(fieldErrors, "notes")} />
      </div>
      <div>
        <label htmlFor={ids.problems} className="opale-field__label">
          Problématiques possibles <span className="font-normal text-muted">(facultatif)</span>
        </label>
        <TextArea
          id={ids.problems}
          rows={4}
          value={problemsText}
          onChange={(e) => setProblemsText(e.target.value)}
          aria-invalid={Boolean(problemError)}
          aria-describedby={[ids.problemsHint, ids.problemsCount, problemError ? `${ids.problems}-err` : null]
            .filter(Boolean)
            .join(" ")}
        />
        <p id={ids.problemsHint} className="opale-field__helper">
          Une par ligne : {PROBLEMS_MAX} au plus, de {formatCount(LIMITS.subjectProblemMin)} à{" "}
          {formatCount(LIMITS.subjectProblemMax)} caractères chacune. Elles servent à vous entraîner sur ce sujet.
        </p>
        <p id={ids.problemsCount} className="opale-field__helper num">
          {`${problems.length} / ${PROBLEMS_MAX} problématiques`}
        </p>
        <FieldError id={`${ids.problems}-err`} message={problemError} />
      </div>
      <FormStatus state={status} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" aria-disabled={pending || undefined}>
          <ButtonLabel idle={submitLabel} busy={pendingLabel} isBusy={pending} />
        </Button>
        {onCancel ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              if (!pending) onCancel();
            }}
            aria-disabled={pending || undefined}
          >
            Annuler
          </Button>
        ) : null}
      </div>
    </form>
  );
}
