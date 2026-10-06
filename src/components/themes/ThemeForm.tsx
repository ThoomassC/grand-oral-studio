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

const EMPTY: ThemeInput = { name: "", description: "", keywords: [], notes: "" };

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
  };
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [keywords, setKeywords] = useState<string[]>(initial.keywords);
  const [notes, setNotes] = useState(initial.notes);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<FormStatusState>(IDLE);
  const [pending, startTransition] = useTransition();
  /** Dernière saisie enregistrée (ou l'état initial) : la référence des modifications non enregistrées. */
  const [baseline, setBaseline] = useState<ThemeInput>(initial);
  const dirty =
    name !== baseline.name ||
    description !== baseline.description ||
    notes !== baseline.notes ||
    JSON.stringify(keywords) !== JSON.stringify(baseline.keywords);
  useUnsavedChanges(dirty);

  const keywordError = firstError(fieldErrors, "keywords") ?? keywordItemError(fieldErrors);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setStatus(IDLE);
    const checked = validateWith(ThemeInputSchema, { name, description, keywords, notes });
    if (!checked.ok) {
      setFieldErrors(checked.fieldErrors);
      setStatus({ kind: "error", message: invalidCountMessage(countFieldErrors(checked.fieldErrors)) });
      focusFirstInvalid(formRef.current);
      return;
    }
    setFieldErrors({});
    const submitted: ThemeInput = { name, description, keywords, notes };
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
          Mots-clés <span className="font-normal text-muted">(aident la reconnaissance du sujet)</span>
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
