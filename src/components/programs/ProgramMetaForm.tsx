"use client";

import { useId, useRef, useState, useTransition } from "react";
import { updateProgram } from "@/server/actions/programs";
import { errorProps, firstError, type FieldErrors } from "@/components/forms/validation";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { FieldError } from "@/components/ui/FieldError";
import { countFieldErrors, focusFirstInvalid, focusLater, invalidCountMessage } from "@/components/ui/focus";
import { FormStatus, IDLE, type FormStatusState } from "@/components/ui/FormStatus";

/** Renommer / décrire un programme, dans un panneau repliable. */
export function ProgramMetaForm({
  programId,
  name: initialName,
  description: initialDescription,
}: {
  programId: string;
  name: string;
  description: string;
}) {
  const baseId = useId();
  const ids = { toggle: `${baseId}-toggle`, panel: `${baseId}-panel`, name: `${baseId}-name`, desc: `${baseId}-desc` };
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<FormStatusState>(IDLE);
  const [pending, startTransition] = useTransition();

  function close() {
    setOpen(false);
    focusLater([ids.toggle]);
  }

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const trimmed = { name: name.trim(), description: description.trim() };
    // Même règle que ProgramMetaSchema côté serveur, qui revalide.
    if (trimmed.name.length < 2 || trimmed.name.length > 120) {
      setFieldErrors({ name: ["Le nom doit contenir entre 2 et 120 caractères."] });
      setStatus({ kind: "error", message: invalidCountMessage(1) });
      focusFirstInvalid(formRef.current);
      return;
    }
    setFieldErrors({});
    startTransition(async () => {
      try {
        const result = await updateProgram(programId, trimmed);
        if (!result.ok) {
          const errors = result.fieldErrors ?? {};
          setFieldErrors(errors);
          setStatus({ kind: "error", message: result.error });
          if (countFieldErrors(errors) > 0) focusFirstInvalid(formRef.current);
          return;
        }
        setStatus({ kind: "success", message: "Programme enregistré." });
      } catch {
        setStatus({ kind: "error", message: "La connexion a été interrompue. Votre saisie est conservée : réessayez." });
      }
    });
  }

  return (
    <div>
      <button
        id={ids.toggle}
        type="button"
        className="btn btn-ghost btn-sm"
        aria-expanded={open}
        aria-controls={open ? ids.panel : undefined}
        onClick={() => {
          if (open) close();
          else {
            setOpen(true);
            setStatus(IDLE);
            focusLater([ids.name]);
          }
        }}
      >
        Renommer ou décrire le programme
      </button>
      {open ? (
        <form
          ref={formRef}
          id={ids.panel}
          noValidate
          onSubmit={save}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !pending) close();
          }}
          className="card mt-2 flex flex-col gap-4 p-5"
        >
          <div>
            <label htmlFor={ids.name} className="field-label">
              Nom du programme
            </label>
            <input
              id={ids.name}
              className="input"
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              {...errorProps(fieldErrors, "name", `${ids.name}-err`)}
            />
            <FieldError id={`${ids.name}-err`} message={firstError(fieldErrors, "name")} />
          </div>
          <div>
            <label htmlFor={ids.desc} className="field-label">
              Description <span className="font-normal text-muted">(facultatif)</span>
            </label>
            <textarea
              id={ids.desc}
              className="input"
              rows={3}
              maxLength={2000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              {...errorProps(fieldErrors, "description", `${ids.desc}-err`, `${ids.desc}-hint`)}
            />
            <p id={`${ids.desc}-hint`} className="field-hint">
              Contexte transmis à l&apos;IA : niveau, discipline, attentes du jury.
            </p>
            <FieldError id={`${ids.desc}-err`} message={firstError(fieldErrors, "description")} />
          </div>
          <FormStatus state={status} />
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn btn-primary" aria-disabled={pending || undefined}>
              <ButtonLabel idle="Enregistrer" busy="Enregistrement…" isBusy={pending} />
            </button>
            <button type="button" className="btn btn-secondary" onClick={close} aria-disabled={pending || undefined}>
              Fermer
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
