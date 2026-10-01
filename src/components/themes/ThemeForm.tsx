"use client";

import { useId, useRef, useState, useTransition } from "react";
import { ThemeInputSchema, type ThemeInput } from "@/domain/schemas";
import type { ActionResult } from "@/server/actions/result";
import { errorProps, firstError, validateWith, type FieldErrors } from "@/components/forms/validation";
import { FieldError } from "@/components/ui/FieldError";
import { FormStatus, IDLE, type FormStatusState } from "@/components/ui/FormStatus";
import { KeywordInput } from "./KeywordInput";

interface ThemeFormProps {
  initial?: ThemeInput;
  submitLabel: string;
  pendingLabel: string;
  successMessage: string;
  onSubmit: (value: ThemeInput) => Promise<ActionResult<unknown>>;
  /** Appelé après un enregistrement réussi. */
  onSaved?: () => void;
  onCancel?: () => void;
  /** Vide le formulaire après succès (formulaire d'ajout). */
  resetOnSuccess?: boolean;
}

const EMPTY: ThemeInput = { name: "", description: "", keywords: [] };

export function ThemeForm({
  initial = EMPTY,
  submitLabel,
  pendingLabel,
  successMessage,
  onSubmit,
  onSaved,
  onCancel,
  resetOnSuccess = false,
}: ThemeFormProps) {
  const ids = { name: useId(), description: useId(), keywords: useId() };
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [keywords, setKeywords] = useState<string[]>(initial.keywords);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<FormStatusState>(IDLE);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setStatus(IDLE);
    const checked = validateWith(ThemeInputSchema, { name, description, keywords });
    if (!checked.ok) {
      setFieldErrors(checked.fieldErrors);
      nameRef.current?.focus();
      return;
    }
    setFieldErrors({});
    startTransition(async () => {
      const result = await onSubmit(checked.data);
      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        setStatus({ kind: "error", message: result.error });
        return;
      }
      setStatus({ kind: "success", message: successMessage });
      if (resetOnSuccess) {
        setName("");
        setDescription("");
        setKeywords([]);
        nameRef.current?.focus();
      }
      onSaved?.();
    });
  }

  return (
    <form noValidate onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <label htmlFor={ids.name} className="field-label">
          Nom du thème
        </label>
        <input
          ref={nameRef}
          id={ids.name}
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          required
          {...errorProps(fieldErrors, "name", `${ids.name}-err`)}
        />
        <FieldError id={`${ids.name}-err`} message={firstError(fieldErrors, "name")} />
      </div>
      <div>
        <label htmlFor={ids.description} className="field-label">
          Description <span className="font-normal text-muted">(facultatif)</span>
        </label>
        <textarea
          id={ids.description}
          className="input"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
          {...errorProps(fieldErrors, "description", `${ids.description}-err`)}
        />
        <FieldError id={`${ids.description}-err`} message={firstError(fieldErrors, "description")} />
      </div>
      <div>
        <label htmlFor={ids.keywords} className="field-label">
          Mots-clés <span className="font-normal text-muted">(aident la reconnaissance du thème)</span>
        </label>
        <KeywordInput
          id={ids.keywords}
          value={keywords}
          onChange={setKeywords}
          invalid={Boolean(firstError(fieldErrors, "keywords"))}
          describedBy={firstError(fieldErrors, "keywords") ? `${ids.keywords}-err` : undefined}
        />
        <FieldError
          id={`${ids.keywords}-err`}
          message={
            firstError(fieldErrors, "keywords") ??
            Object.entries(fieldErrors).find(([k]) => k.startsWith("keywords."))?.[1][0]
          }
        />
      </div>
      <FormStatus state={status} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </button>
        {onCancel ? (
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={pending}>
            Annuler
          </button>
        ) : null}
      </div>
    </form>
  );
}
