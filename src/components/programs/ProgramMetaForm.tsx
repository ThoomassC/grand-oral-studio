"use client";

import { TextArea, TextInput } from "@/components/ui/Field";
import { Button } from "@thomascaron/opale-ui";
import { useId, useRef, useState, useTransition } from "react";
import { updateProgram } from "@/server/actions/programs";
import { errorProps, firstError, type FieldErrors } from "@/components/forms/validation";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { FieldError } from "@/components/ui/FieldError";
import { countFieldErrors, focusFirstInvalid, focusLater, invalidCountMessage } from "@/components/ui/focus";
import { FormStatus, IDLE, type FormStatusState } from "@/components/ui/FormStatus";

/** Renommer / décrire un projet, dans un panneau repliable. */
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
        setStatus({ kind: "success", message: "Projet enregistré." });
      } catch {
        setStatus({ kind: "error", message: "La connexion a été interrompue. Votre saisie est conservée : réessayez." });
      }
    });
  }

  return (
    <div>
      <Button
        id={ids.toggle}
        type="button"
        variant="text" size="small"
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
        Renommer ou décrire le projet
      </Button>
      {open ? (
        <form
          ref={formRef}
          id={ids.panel}
          noValidate
          onSubmit={save}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !pending) close();
          }}
          className="opale-card opale-card--e1 mt-2 flex flex-col gap-4 p-5"
        >
          <div>
            <label htmlFor={ids.name} className="opale-field__label">
              Nom du projet
            </label>
            <TextInput
              id={ids.name}
              value={name}
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
              {...errorProps(fieldErrors, "name", `${ids.name}-err`)}
            />
            <FieldError id={`${ids.name}-err`} message={firstError(fieldErrors, "name")} />
          </div>
          <div>
            <label htmlFor={ids.desc} className="opale-field__label">
              Description <span className="font-normal text-muted">(facultatif)</span>
            </label>
            <TextArea
              id={ids.desc}
              rows={3}
              maxLength={2000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              {...errorProps(fieldErrors, "description", `${ids.desc}-err`, `${ids.desc}-hint`)}
            />
            <p id={`${ids.desc}-hint`} className="opale-field__helper">
              Contexte transmis à l&apos;IA : niveau, discipline, attentes du jury.
            </p>
            <FieldError id={`${ids.desc}-err`} message={firstError(fieldErrors, "description")} />
          </div>
          <FormStatus state={status} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" aria-disabled={pending || undefined}>
              <ButtonLabel idle="Enregistrer" busy="Enregistrement…" isBusy={pending} />
            </Button>
            <Button type="button" variant="ghost" onClick={close} aria-disabled={pending || undefined}>
              Fermer
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
