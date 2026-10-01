"use client";

import { TextArea, TextInput } from "@/components/ui/Field";
import { Button } from "@thomascaron/opale-ui";
import { useId, useRef, useState, useTransition } from "react";
import { ThemeInputSchema, type ThemeInput } from "@/domain/schemas";
import type { ActionResult } from "@/server/actions/result";
import { errorProps, firstError, validateWith, type FieldErrors } from "@/components/forms/validation";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { FieldError } from "@/components/ui/FieldError";
import { countFieldErrors, focusFirstInvalid, invalidCountMessage } from "@/components/ui/focus";
import { FormStatus, IDLE, type FormStatusState } from "@/components/ui/FormStatus";
import { KeywordInput } from "./KeywordInput";

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

const EMPTY: ThemeInput = { name: "", description: "", keywords: [] };

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
  const ids = { name: nameId ?? `${generatedId}-name`, description: useId(), keywords: useId() };
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [keywords, setKeywords] = useState<string[]>(initial.keywords);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<FormStatusState>(IDLE);
  const [pending, startTransition] = useTransition();

  const keywordError = firstError(fieldErrors, "keywords") ?? keywordItemError(fieldErrors);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setStatus(IDLE);
    const checked = validateWith(ThemeInputSchema, { name, description, keywords });
    if (!checked.ok) {
      setFieldErrors(checked.fieldErrors);
      setStatus({ kind: "error", message: invalidCountMessage(countFieldErrors(checked.fieldErrors)) });
      focusFirstInvalid(formRef.current);
      return;
    }
    setFieldErrors({});
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
      if (resetOnSuccess) {
        setName("");
        setDescription("");
        setKeywords([]);
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
          Nom du thème
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
          Mots-clés <span className="font-normal text-muted">(aident la reconnaissance du thème)</span>
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
