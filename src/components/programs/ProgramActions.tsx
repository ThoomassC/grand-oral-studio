"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Icon,
} from "@thomascaron/opale-ui";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { deleteProgram, duplicateProgram, restoreProgram } from "@/server/actions/programs";
import type { ProgramRole } from "@/server/queries";
import { useUndoToast } from "@/components/decks/undo-toast";
import { ConfirmActionDialog } from "@/components/ui/ConfirmAction";
import { focusLater } from "@/components/ui/focus";
import { LiveRegion } from "@/components/ui/LiveRegion";
import { ProgramMetaDialog } from "./ProgramMetaDialog";

/**
 * Bouton « ⋮ » en fin de ligne d'un projet : un `DropdownMenu` d'Opale
 * (« Renommer », « Dupliquer », « Supprimer »). « Renommer » ouvre la même
 * fenêtre que le menu de l'en-tête du projet (`ProgramMetaDialog`) ; il est
 * réservé aux éditeurs et au propriétaire. « Supprimer » ouvre la confirmation
 * avec recopie du nom (`ConfirmActionDialog`) ; il est réservé au propriétaire.
 * Après suppression, une notification propose « Annuler » pendant 10 s.
 *
 * Focus : Échap ou une entrée du menu le rendent au bouton (Opale) ; en
 * annulant la confirmation, on le rend au bouton nous-mêmes (l'entrée de menu
 * qui l'a ouverte n'existe plus) ; après suppression, `focusAfterDelete`.
 *
 * Rend un fragment : le bouton, puis la région d'annonce de la duplication,
 * qui prend toute la largeur de la ligne (`basis-full`, parent en
 * `flex-wrap`) ; vide, elle sort du flux (voir LiveRegion).
 */
export function ProgramActions({
  programId,
  programName,
  programDescription,
  role = "owner",
  focusAfterDelete,
}: {
  programId: string;
  programName: string;
  /** Description en cours : « Renommer » renvoie le nom ET la description. */
  programDescription: string;
  /** Rôle de l'utilisateur ; seul le propriétaire peut supprimer. Défaut : propriétaire. */
  role?: ProgramRole;
  /** Ids à focaliser après suppression, par ordre de préférence. */
  focusAfterDelete: string[];
}) {
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const showUndo = useUndoToast();
  const label = `Actions du projet ${programName}`;
  const canDelete = role === "owner";
  const canRename = role !== "viewer";

  function duplicate() {
    if (pending) return;
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await duplicateProgram(programId);
        if (!result.ok) {
          setMessage({ kind: "error", text: result.error });
          return;
        }
        setMessage({ kind: "success", text: `Copie de « ${programName} » créée en tête de liste.` });
        router.refresh();
      } catch {
        setMessage({ kind: "error", text: "La connexion a été interrompue. Réessayez." });
      }
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          ref={triggerRef}
          aria-label={label}
          aria-busy={pending || undefined}
          className="project-row-trigger shrink-0"
        >
          <span aria-hidden="true" className="inline-flex">
            <Icon name="more-vertical" />
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          aria-label={label}
          placement="bottom"
          align="end"
          className="header-menu min-w-[11rem] max-w-[min(20rem,calc(100vw-2rem))]"
        >
          {canRename ? (
            <DropdownMenuItem
              className="header-menu__item"
              value="renommer"
              disabled={pending}
              onSelect={() => {
                setMessage(null);
                setRenaming(true);
              }}
            >
              Renommer
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem className="header-menu__item" value="dupliquer" disabled={pending} onSelect={duplicate}>
            {pending ? "Duplication…" : "Dupliquer"}
          </DropdownMenuItem>
          {canDelete ? (
            <DropdownMenuItem
              className="header-menu__item"
              value="supprimer"
              disabled={pending}
              onSelect={() => setConfirming(true)}
            >
              Supprimer
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <LiveRegion className={`basis-full text-sm ${message?.kind === "error" ? "text-danger" : "text-success"}`}>
        {message?.text}
      </LiveRegion>
      {renaming && canRename ? (
        <ProgramMetaDialog
          field="name"
          programId={programId}
          initial={{ name: programName, description: programDescription }}
          onClose={(done) => {
            setRenaming(false);
            if (done) {
              setMessage({ kind: "success", text: done });
              router.refresh();
            }
            // Après le démontage de la modale (l'entrée de menu qui l'a ouverte n'existe plus) : le bouton « ⋮ ».
            window.setTimeout(() => triggerRef.current?.focus(), 0);
          }}
        />
      ) : null}
      <ConfirmActionDialog
        open={confirming}
        title="Supprimer le projet ?"
        question={`Supprimer « ${programName} », ses sujets et ses diaporamas ? Vous pourrez annuler pendant quelques secondes.`}
        confirmLabel="Supprimer définitivement"
        requireText={programName}
        onConfirm={async () => {
          const result = await deleteProgram(programId);
          if (!result.ok) return result.error;
          showUndo({
            id: `annuler-projet-${programId}`,
            message: "Projet supprimé.",
            undoAccessibleLabel: `Annuler la suppression du projet ${programName}`,
            restoredMessage: "Projet restauré.",
            onUndo: async () => {
              const restored = await restoreProgram(programId);
              if (!restored.ok) return restored.error;
              router.refresh();
              return null;
            },
          });
          return null;
        }}
        onCancel={() => {
          setConfirming(false);
          // Après le démontage de la modale (qui rend le focus à l'élément actif
          // à son ouverture, parfois l'entrée de menu disparue) : le bouton « ⋮ ».
          window.setTimeout(() => triggerRef.current?.focus(), 0);
        }}
        onDone={() => {
          setConfirming(false);
          focusLater(focusAfterDelete);
        }}
      />
    </>
  );
}
