"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Icon,
} from "@thomascaron/opale-ui";
import { useRef, useState, useTransition } from "react";
import type { ProgramRole } from "@/server/repo/access";
import { useGuardedNavigation } from "@/components/layout/useGuardedNavigation";
import { downloadJson } from "@/components/projects/download";
import { shareHref } from "@/components/projects/steps";
import { LiveRegion } from "@/components/ui/LiveRegion";
import { ProgramMetaDialog, type ProgramMetaField as Field } from "./ProgramMetaDialog";

/**
 * Engrenage à côté du nom du projet (en-tête) : un `DropdownMenu` d'Opale
 * (« Renommer », « Modifier la description ») dont chaque entrée ouvre
 * `ProgramMetaDialog` (une `Modal` d'Opale à un seul champ).
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
