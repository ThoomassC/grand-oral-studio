"use client";

import { Button, Modal } from "@thomascaron/opale-ui";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { applyModel, deleteModel, listSharedModels, publishModel } from "@/server/actions/shared-models";
import type { SharedModelKind, SharedModelSummary } from "@/server/repo/shared-models";
import { errorProps, firstError, validateWith, type FieldErrors } from "@/components/forms/validation";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { ConfirmAction } from "@/components/ui/ConfirmAction";
import { TextInput } from "@/components/ui/Field";
import { FieldError } from "@/components/ui/FieldError";
import { focusLater } from "@/components/ui/focus";
import { formatDate, plural } from "@/components/ui/format";
import { FormStatus, IDLE, type FormStatusState } from "@/components/ui/FormStatus";
import { LiveRegion } from "@/components/ui/LiveRegion";
import { Notice } from "@/components/ui/Notice";
import { MODEL_NAME_MAX, ModelNameSchema } from "./model-schema";

const INTERRUPTED = "La connexion a été interrompue. Réessayez.";

const WORDING: Record<SharedModelKind, { thing: string; the: string; publishHint: string }> = {
  brand: {
    thing: "apparence",
    the: "l'apparence",
    publishHint: "L'apparence enregistrée du projet est publiée (pas les modifications en cours), visible de toute l'équipe.",
  },
  template: {
    thing: "trame",
    the: "la trame",
    publishHint: "La trame enregistrée du projet est publiée (pas les modifications en cours), visible de toute l'équipe.",
  },
};

type Library =
  | { kind: "closed" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; models: SharedModelSummary[] };

/** Résumé d'un modèle en une ligne : couleurs et polices, ou durée et lignes de la trame. */
function previewText(model: SharedModelSummary): string {
  const p = model.preview;
  if (p.kind === "brand") {
    const colors = [p.colors.primary, p.colors.secondary, p.colors.accent].join(", ");
    return `Couleurs ${colors} · Polices ${p.fonts.heading} / ${p.fonts.body}${p.hasLogo ? " · avec logo" : ""}`;
  }
  return `${p.durationMinutes} min · ${plural(p.sections.length, "ligne")} · ${p.format}`;
}

/**
 * Bibliothèque de modèles de l'équipe (apparences ou trames), sous l'éditeur des
 * pages Apparence et Trame (éditeurs et propriétaire : le serveur vérifie les droits) :
 *
 *  - « Publier dans la bibliothèque » (propriétaire seul, `canPublish` ; le serveur
 *    refuse un éditeur en 403) : `Modal` d'Opale qui demande un nom, puis publie la
 *    version ENREGISTRÉE du projet ;
 *  - « Bibliothèque de l'équipe » : panneau dépliable, chargé à l'ouverture (états
 *    chargement, vide, erreur avec « Réessayer ») ; chaque modèle s'applique au
 *    projet après confirmation (il REMPLACE l'apparence ou la trame), et son auteur
 *    peut le retirer.
 *
 * Après « Appliquer », la page est rechargée (`router.refresh`) : le jeton de
 * version de l'éditeur (brandSavedAt / templateSavedAt) change ; `onApplied`
 * prévient l'appelant.
 */
export function ModelLibrary({
  programId,
  kind,
  defaultName = "",
  canPublish,
  onApplied,
}: {
  programId: string;
  kind: SharedModelKind;
  /** Vrai pour le propriétaire du projet, seul autorisé à publier. */
  canPublish: boolean;
  /** Nom proposé à la publication (ex. le nom de l'apparence). */
  defaultName?: string;
  onApplied?: () => void;
}) {
  const router = useRouter();
  const baseId = useId();
  const panelId = `${baseId}-panel`;
  const titleId = `${baseId}-title`;
  const toggleId = `${baseId}-toggle`;
  const wording = WORDING[kind];
  const [library, setLibrary] = useState<Library>({ kind: "closed" });
  const [publishing, setPublishing] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [, startLoading] = useTransition();
  const publishRef = useRef<HTMLButtonElement>(null);
  const open = library.kind !== "closed";

  function load() {
    setLibrary({ kind: "loading" });
    startLoading(async () => {
      try {
        const result = await listSharedModels(kind);
        setLibrary(result.ok ? { kind: "ready", models: result.data } : { kind: "error", message: result.error });
      } catch {
        setLibrary({ kind: "error", message: INTERRUPTED });
      }
    });
  }

  function toggle() {
    if (open) setLibrary({ kind: "closed" });
    else load();
  }

  function closePublish(message: string | null) {
    setPublishing(false);
    if (message) {
      setAnnounce(message);
      if (open) load();
    }
    // Après le démontage de la modale : le bouton qui l'a ouverte.
    window.setTimeout(() => publishRef.current?.focus(), 0);
  }

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 id={titleId} className="text-2xl">
            Bibliothèque de l&apos;équipe
          </h3>
          <p className="max-w-3xl text-sm text-muted">
            {canPublish
              ? `Partagez ${wording.the} de ce projet avec l'équipe, ou reprenez celle d'un autre projet.`
              : `Reprenez ${wording.the} d'un autre projet de l'équipe.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canPublish ? (
            <Button ref={publishRef} type="button" variant="secondary" aria-haspopup="dialog" onClick={() => setPublishing(true)}>
              Publier dans la bibliothèque
            </Button>
          ) : null}
          <Button id={toggleId} type="button" variant="ghost" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={toggle}>
            {open ? "Masquer la bibliothèque" : "Voir la bibliothèque"}
          </Button>
        </div>
      </div>

      <LiveRegion className="text-sm font-medium text-success">
        {announce ? (
          <>
            <span aria-hidden="true">✓ </span>
            {announce}
          </>
        ) : null}
      </LiveRegion>

      {open ? (
        <div id={panelId} className="opale-card opale-card--e1 block p-5">
          {library.kind === "loading" ? (
            <p role="status" className="text-sm text-muted">
              Chargement de la bibliothèque…
            </p>
          ) : library.kind === "error" ? (
            <div className="flex flex-col items-start gap-3">
              <Notice tone="error">La bibliothèque n&apos;a pas pu être chargée : {library.message}</Notice>
              <Button type="button" variant="ghost" size="small" onClick={load}>
                Réessayer
              </Button>
            </div>
          ) : library.kind === "ready" && library.models.length === 0 ? (
            <div>
              <p className="font-display text-lg font-semibold">Aucun modèle publié</p>
              <p className="mt-1 text-muted">
                {canPublish
                  ? `Publiez ${wording.the} de ce projet (« Publier dans la bibliothèque ») pour que l'équipe puisse la reprendre.`
                  : `Le propriétaire d'un projet peut y publier ${wording.the} de son projet.`}
              </p>
            </div>
          ) : library.kind === "ready" ? (
            <ul className="flex flex-col gap-4" aria-labelledby={titleId}>
              {library.models.map((model, index) => {
                const neighbour = library.models[index + 1] ?? library.models[index - 1];
                return (
                  <li key={model.id} className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <h4 className="text-lg break-words">{model.name}</h4>
                      <p className="text-sm text-muted">
                        {model.isMine ? "Publié par vous" : `Publié par ${model.authorName}`} le{" "}
                        {formatDate(new Date(model.createdAt))}
                      </p>
                      <p className="num mt-1 text-sm break-words">{previewText(model)}</p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <ConfirmAction
                        triggerId={`${baseId}-apply-${model.id}`}
                        triggerLabel="Appliquer à ce projet"
                        triggerAccessibleLabel={`Appliquer « ${model.name} » à ce projet`}
                        triggerVariant="secondary"
                        title={`Remplacer ${wording.the} ?`}
                        question={`${wording.the.charAt(0).toUpperCase()}${wording.the.slice(1)} du projet sera remplacée par « ${model.name} » et enregistrée. Les modifications non enregistrées seront perdues.`}
                        confirmLabel={`Remplacer ${wording.the}`}
                        pendingLabel="Application…"
                        onConfirm={async () => {
                          const result = await applyModel(programId, model.id);
                          if (!result.ok) return result.error;
                          setAnnounce(`« ${model.name} » appliqué : ${wording.the} du projet est remplacée.`);
                          onApplied?.();
                          router.refresh();
                          return null;
                        }}
                        onDone={() => focusLater([`${baseId}-apply-${model.id}`, toggleId])}
                      />
                      {model.isMine ? (
                        <ConfirmAction
                          triggerLabel="Retirer"
                          triggerAccessibleLabel={`Retirer « ${model.name} » de la bibliothèque`}
                          title="Retirer de la bibliothèque ?"
                          question={`« ${model.name} » ne sera plus proposé à l'équipe. Les projets qui l'ont appliqué gardent leur ${wording.thing}.`}
                          confirmLabel="Retirer le modèle"
                          pendingLabel="Retrait…"
                          onConfirm={async () => {
                            const result = await deleteModel(model.id);
                            if (!result.ok) return result.error;
                            setAnnounce(`« ${model.name} » retiré de la bibliothèque.`);
                            setLibrary({ kind: "ready", models: library.models.filter((m) => m.id !== model.id) });
                            return null;
                          }}
                          onDone={() => focusLater([neighbour ? `${baseId}-apply-${neighbour.id}` : null, toggleId])}
                        />
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}

      {canPublish && publishing ? (
        <PublishDialog programId={programId} kind={kind} defaultName={defaultName} hint={wording.publishHint} onClose={closePublish} />
      ) : null}
    </section>
  );
}

function PublishDialog({
  programId,
  kind,
  defaultName,
  hint,
  onClose,
}: {
  programId: string;
  kind: SharedModelKind;
  defaultName: string;
  hint: string;
  onClose: (message: string | null) => void;
}) {
  const baseId = useId();
  const inputId = `${baseId}-name`;
  const errorId = `${inputId}-err`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(defaultName.slice(0, MODEL_NAME_MAX));
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<FormStatusState>(IDLE);
  const [pending, startTransition] = useTransition();

  // Synchronisation avec le DOM : la modale place d'abord le focus sur son
  // panneau (effet du parent, joué après celui-ci) ; le champ le prend juste après.
  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  function cancel() {
    if (!pending) onClose(null);
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const checked = validateWith(ModelNameSchema, name);
    if (!checked.ok) {
      setFieldErrors({ name: checked.fieldErrors._form ?? ["Nom invalide."] });
      setStatus(IDLE);
      inputRef.current?.focus();
      return;
    }
    setFieldErrors({});
    setStatus(IDLE);
    startTransition(async () => {
      try {
        const result = await publishModel(programId, { kind, name: checked.data });
        if (!result.ok) {
          const message = result.fieldErrors?.name?.[0];
          if (message) {
            setFieldErrors({ name: [message] });
            inputRef.current?.focus();
          } else {
            setStatus({ kind: "error", message: result.error });
          }
          return;
        }
        onClose(`« ${checked.data} » publié dans la bibliothèque de l'équipe.`);
      } catch {
        setStatus({ kind: "error", message: "La connexion a été interrompue. Votre saisie est conservée : réessayez." });
      }
    });
  }

  return (
    <Modal
      open
      title="Publier dans la bibliothèque"
      description={hint}
      size="medium"
      closeOnEsc={!pending}
      closeOnOverlay={!pending}
      onOpenChange={(next) => {
        if (!next) cancel();
      }}
    >
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label htmlFor={inputId} className="opale-field__label">
            Nom du modèle
          </label>
          <TextInput
            ref={inputRef}
            id={inputId}
            value={name}
            maxLength={MODEL_NAME_MAX}
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
            {...errorProps(fieldErrors, "name", errorId)}
          />
          <FieldError id={errorId} message={firstError(fieldErrors, "name")} />
        </div>
        <FormStatus state={status} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={cancel} aria-disabled={pending || undefined}>
            Annuler
          </Button>
          <Button type="submit" aria-disabled={pending || undefined}>
            <ButtonLabel idle="Publier" busy="Publication…" isBusy={pending} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}
