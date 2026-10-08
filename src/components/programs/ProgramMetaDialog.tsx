"use client";

import { Button, Modal } from "@thomascaron/opale-ui";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { updateProgram } from "@/server/actions/programs";
import { errorProps, firstError, validateWith, type FieldErrors } from "@/components/forms/validation";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { TextArea, TextInput } from "@/components/ui/Field";
import { FieldError } from "@/components/ui/FieldError";
import { focusFirstInvalid } from "@/components/ui/focus";
import { FormStatus, IDLE, type FormStatusState } from "@/components/ui/FormStatus";
import { PROGRAM_DESCRIPTION_MAX, PROGRAM_NAME_MAX, ProgramMetaSchema } from "./schema";

export type ProgramMetaField = "name" | "description";

const DIALOG: Record<ProgramMetaField, { title: string; success: string }> = {
  name: { title: "Renommer le projet", success: "Projet renommé." },
  description: { title: "Modifier la description", success: "Description enregistrée." },
};

/**
 * Fenêtre à un seul champ (nom ou description du projet), ouverte depuis le
 * menu de l'en-tête du projet et depuis le menu « ⋮ » de la liste des projets.
 * L'action `updateProgram` reçoit toujours le nom ET la description (l'autre
 * valeur est celle en cours) ; elle revalide le projet et la liste.
 *
 * `onClose(message)` : message de réussite à annoncer, ou null (annulation).
 */
export function ProgramMetaDialog({
  field,
  programId,
  initial,
  onClose,
}: {
  field: ProgramMetaField;
  programId: string;
  initial: { name: string; description: string };
  onClose: (message?: string | null) => void;
}) {
  const baseId = useId();
  const inputId = `${baseId}-${field}`;
  const errorId = `${inputId}-err`;
  const hintId = `${inputId}-hint`;
  const formRef = useRef<HTMLFormElement>(null);
  const fieldRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const [value, setValue] = useState(initial[field]);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<FormStatusState>(IDLE);
  const [pending, startTransition] = useTransition();
  const { title, success } = DIALOG[field];

  // Synchronisation avec le DOM : la modale place d'abord le focus sur son
  // panneau (effet du parent, joué après celui-ci) ; le champ le prend juste après.
  useEffect(() => {
    const timer = window.setTimeout(() => fieldRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  function cancel() {
    if (!pending) onClose(null);
  }

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const checked = validateWith(ProgramMetaSchema, { ...initial, [field]: value });
    if (!checked.ok) {
      setFieldErrors(checked.fieldErrors);
      setStatus(IDLE);
      focusFirstInvalid(formRef.current);
      return;
    }
    setFieldErrors({});
    setStatus(IDLE);
    startTransition(async () => {
      try {
        const result = await updateProgram(programId, checked.data);
        if (!result.ok) {
          const errors = result.fieldErrors ?? {};
          setFieldErrors(errors);
          if (firstError(errors, field)) focusFirstInvalid(formRef.current);
          else setStatus({ kind: "error", message: result.error });
          return;
        }
        onClose(success);
      } catch {
        setStatus({ kind: "error", message: "La connexion a été interrompue. Votre saisie est conservée : réessayez." });
      }
    });
  }

  const describedBy = errorProps(fieldErrors, field, errorId, field === "description" ? hintId : undefined);

  return (
    <Modal
      open
      title={title}
      size="medium"
      closeOnEsc={!pending}
      closeOnOverlay={!pending}
      onOpenChange={(next) => {
        if (!next) cancel();
      }}
    >
      <form ref={formRef} noValidate onSubmit={save} className="flex flex-col gap-4">
        {field === "name" ? (
          <div>
            <label htmlFor={inputId} className="opale-field__label">
              Nom du projet
            </label>
            <TextInput
              ref={fieldRef}
              id={inputId}
              value={value}
              maxLength={PROGRAM_NAME_MAX}
              autoComplete="off"
              onChange={(e) => setValue(e.target.value)}
              {...describedBy}
            />
            <FieldError id={errorId} message={firstError(fieldErrors, "name")} />
          </div>
        ) : (
          <div>
            <label htmlFor={inputId} className="opale-field__label">
              Description <span className="font-normal text-muted">(facultatif)</span>
            </label>
            <TextArea
              ref={fieldRef}
              id={inputId}
              rows={4}
              maxLength={PROGRAM_DESCRIPTION_MAX}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              {...describedBy}
            />
            <p id={hintId} className="opale-field__helper">
              Contexte transmis à l&apos;IA : niveau, discipline, attentes du jury.
            </p>
            <FieldError id={errorId} message={firstError(fieldErrors, "description")} />
          </div>
        )}
        <FormStatus state={status} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={cancel} aria-disabled={pending || undefined}>
            Annuler
          </Button>
          <Button type="submit" aria-disabled={pending || undefined}>
            <ButtonLabel idle="Enregistrer" busy="Enregistrement…" isBusy={pending} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}
