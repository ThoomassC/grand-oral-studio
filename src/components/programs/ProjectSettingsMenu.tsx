"use client";

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Icon,
  Modal,
} from "@thomascaron/opale-ui";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { updateProgram } from "@/server/actions/programs";
import type { ProgramRole } from "@/server/repo/access";
import { useGuardedNavigation } from "@/components/layout/useGuardedNavigation";
import { downloadJson } from "@/components/projects/download";
import { shareHref } from "@/components/projects/steps";
import { errorProps, firstError, validateWith, type FieldErrors } from "@/components/forms/validation";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { TextArea, TextInput } from "@/components/ui/Field";
import { FieldError } from "@/components/ui/FieldError";
import { focusFirstInvalid } from "@/components/ui/focus";
import { FormStatus, IDLE, type FormStatusState } from "@/components/ui/FormStatus";
import { LiveRegion } from "@/components/ui/LiveRegion";
import { PROGRAM_DESCRIPTION_MAX, PROGRAM_NAME_MAX, ProgramMetaSchema } from "./schema";

type Field = "name" | "description";

const DIALOG: Record<Field, { title: string; success: string }> = {
  name: { title: "Renommer le projet", success: "Projet renommé." },
  description: { title: "Modifier la description", success: "Description enregistrée." },
};

/**
 * Engrenage à côté du nom du projet (en-tête) : un `DropdownMenu` d'Opale
 * (« Renommer », « Modifier la description ») dont chaque entrée ouvre une
 * `Modal` d'Opale à un seul champ. L'action `updateProgram` reçoit toujours
 * le nom ET la description (l'autre valeur est celle en cours) ; elle
 * revalide le layout du projet, si bien que le titre se met à jour seul.
 *
 * Focus : sur le champ à l'ouverture, rendu à l'engrenage à la fermeture
 * (l'entrée de menu qui a ouvert la modale n'existe plus à ce moment-là).
 *
 * « Partager » (propriétaire) ou « Membres du projet » (éditeur, lecteur) mène à
 * la page Partage, par la garde « modifications non enregistrées ».
 * « Exporter le projet (JSON) » (tout membre) télécharge le fichier d'export.
 * Un lecteur n'a ni « Renommer » ni « Modifier la description » (le serveur
 * refuse de toute façon).
 */
export function ProjectSettingsMenu({
  programId,
  name,
  description,
  role,
}: {
  programId: string;
  name: string;
  description: string;
  /** Rôle de l'utilisateur : la gestion des membres est réservée au propriétaire. */
  role: ProgramRole;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { go } = useGuardedNavigation();
  const [editing, setEditing] = useState<Field | null>(null);
  /** Change à chaque ouverture : le formulaire repart des valeurs en cours. */
  const [session, setSession] = useState(0);
  const [done, setDone] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [exporting, startExport] = useTransition();
  const canEdit = role !== "viewer";

  function exportProject() {
    if (exporting) return;
    setDone(null);
    setFailure(null);
    startExport(async () => {
      const result = await downloadJson(`/api/projets/${programId}/export`, "projet.json");
      if (result.ok) setDone("Export du projet téléchargé.");
      else setFailure(`L'export a échoué : ${result.message}`);
    });
  }

  function open(field: Field) {
    setDone(null);
    setFailure(null);
    setSession((n) => n + 1);
    setEditing(field);
  }

  function close(message: string | null = null) {
    setEditing(null);
    setDone(message);
    // Après le démontage de la modale (qui rend le focus à l'élément actif à
    // son ouverture, parfois l'entrée de menu disparue) : l'engrenage, toujours.
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }

  return (
    <div className="flex shrink-0 items-center gap-2 pt-1 sm:pt-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger ref={triggerRef} aria-label="Paramètres du projet" className="project-settings-trigger">
          <span aria-hidden="true" className="inline-flex">
            <Icon name="settings" />
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          aria-label="Paramètres du projet"
          placement="bottom"
          align="start"
          className="header-menu min-w-[14rem] max-w-[min(20rem,calc(100vw-2rem))]"
        >
          {canEdit ? (
            <>
              <DropdownMenuItem className="header-menu__item" value="renommer" onSelect={() => open("name")}>
                Renommer
              </DropdownMenuItem>
              <DropdownMenuItem className="header-menu__item" value="description" onSelect={() => open("description")}>
                Modifier la description
              </DropdownMenuItem>
            </>
          ) : null}
          <DropdownMenuItem
            className="header-menu__item"
            value="partage"
            onSelect={() => go(shareHref(programId), triggerRef.current)}
          >
            {role === "owner" ? "Partager" : "Membres du projet"}
          </DropdownMenuItem>
          <DropdownMenuItem className="header-menu__item" value="exporter" onSelect={exportProject}>
            Exporter le projet (JSON)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <LiveRegion className="text-sm font-medium text-success">
        {done ? (
          <>
            <span aria-hidden="true">✓ </span>
            {done}
          </>
        ) : null}
      </LiveRegion>
      <LiveRegion className="text-sm font-medium">{exporting ? "Préparation de l'export…" : null}</LiveRegion>
      <LiveRegion role="alert" className="text-sm font-medium text-danger">
        {failure}
      </LiveRegion>
      {editing && canEdit ? (
        <ProgramMetaDialog
          key={session}
          field={editing}
          programId={programId}
          initial={{ name, description }}
          onClose={close}
        />
      ) : null}
    </div>
  );
}

function ProgramMetaDialog({
  field,
  programId,
  initial,
  onClose,
}: {
  field: Field;
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
