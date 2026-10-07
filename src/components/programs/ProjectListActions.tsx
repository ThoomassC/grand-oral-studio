"use client";

import { Button, Dropzone, FileCard, Modal } from "@thomascaron/opale-ui";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { PROJECT_FILE_MAX_BYTES, PROJECT_FILE_TOO_LARGE_MESSAGE } from "@/domain/project-export";
import { createExampleProject, importProject } from "@/server/actions/transfer";
import { projectHomeHref } from "@/components/projects/steps";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { formatFileSize } from "@/components/ui/format";
import { LiveRegion } from "@/components/ui/LiveRegion";
import { Notice } from "@/components/ui/Notice";

const NOT_JSON = "Choisissez un fichier d'export de projet (.json), produit par « Exporter le projet (JSON) ».";
const INTERRUPTED = "La connexion a été interrompue. Réessayez.";

type ImportPhase =
  | { kind: "idle" }
  | { kind: "importing"; file: { name: string; size: number } }
  | { kind: "error"; file: { name: string; size: number } | null; message: string };

/**
 * Deux autres façons de commencer, à côté de « Nouveau projet » (et dans l'état
 * vide de la liste) : importer un fichier d'export de projet (.json) dans une
 * `Modal` d'Opale à zone de dépôt, ou partir du projet d'exemple. Chacune crée
 * un NOUVEAU projet de l'utilisateur, puis l'ouvre. Le serveur est rejouable
 * sans doublon dans la minute (double clic, nouvel essai).
 */
export function ProjectListActions() {
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<ImportPhase>({ kind: "idle" });
  const [exampleError, setExampleError] = useState<string | null>(null);
  const [importing, startImport] = useTransition();
  const [creating, startExample] = useTransition();

  function show() {
    setPhase({ kind: "idle" });
    setOpen(true);
  }

  function close() {
    if (importing) return;
    setOpen(false);
    // Après le démontage de la modale : le bouton qui l'a ouverte.
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }

  function upload(files: FileList) {
    const file = files[0];
    if (!file || importing) return;
    const info = { name: file.name, size: file.size };
    if (!file.name.toLowerCase().endsWith(".json")) {
      setPhase({ kind: "error", file: info, message: NOT_JSON });
      return;
    }
    setPhase({ kind: "importing", file: info });
    startImport(async () => {
      const formData = new FormData();
      formData.set("file", file);
      try {
        const result = await importProject(formData);
        if (!result.ok) {
          setPhase({ kind: "error", file: info, message: result.fieldErrors?.file?.[0] ?? result.error });
          return;
        }
        router.push(projectHomeHref(result.data.id));
      } catch {
        setPhase({ kind: "error", file: info, message: INTERRUPTED });
      }
    });
  }

  function startFromExample() {
    if (creating) return;
    setExampleError(null);
    startExample(async () => {
      try {
        const result = await createExampleProject();
        if (!result.ok) {
          setExampleError(result.error);
          return;
        }
        router.push(projectHomeHref(result.data.id));
      } catch {
        setExampleError(INTERRUPTED);
      }
    });
  }

  const file = phase.kind === "idle" ? null : phase.file;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button ref={triggerRef} variant="ghost" size="small" aria-haspopup="dialog" onClick={show}>
          Importer un projet (.json)
        </Button>
        <Button variant="ghost" size="small" onClick={startFromExample} aria-disabled={creating || undefined}>
          <ButtonLabel idle="Partir de l'exemple" busy="Création de l'exemple…" isBusy={creating} />
        </Button>
      </div>
      <LiveRegion role="alert" className="basis-full">
        {exampleError ? <Notice tone="error">Le projet d&apos;exemple n&apos;a pas été créé : {exampleError}</Notice> : null}
      </LiveRegion>
      <Modal
        open={open}
        title="Importer un projet"
        description="Un nouveau projet est créé à partir du fichier : apparence, trame et sujets. Vos projets existants ne changent pas."
        size="medium"
        closeOnEsc={!importing}
        closeOnOverlay={!importing}
        onOpenChange={(next) => {
          if (!next) close();
        }}
      >
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)] sm:items-start">
            {/* `Dropzone` rend deux nœuds (zone + message d'erreur) : un conteneur les garde dans la même colonne. */}
            <div>
              <Dropzone
                accept=".json,application/json"
                multiple={false}
                // Contrôle avant envoi (le serveur refait le sien) : un corps trop lourd serait
                // coupé par l'hébergeur sans message utile.
                maxSizeBytes={PROJECT_FILE_MAX_BYTES}
                className="min-h-32"
                onFiles={upload}
                onError={() => setPhase({ kind: "idle" })}
                labels={{
                  select: "ou choisissez un fichier",
                  tooManyFiles: () => "Déposez un seul fichier à la fois.",
                  fileTooLarge: () => PROJECT_FILE_TOO_LARGE_MESSAGE,
                  typeRejected: NOT_JSON,
                }}
              >
                Déposez le fichier d&apos;export ici
              </Dropzone>
            </div>
            {file ? <FileCard name={file.name} fileSize={formatFileSize(file.size)} /> : null}
          </div>
          <LiveRegion className="text-sm font-medium">
            {phase.kind === "importing" ? (
              <span className="inline-flex items-center gap-2">
                <span aria-hidden="true" className="size-3 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />
                Import du projet…
              </span>
            ) : null}
          </LiveRegion>
          <LiveRegion role="alert">
            {phase.kind === "error" ? <Notice tone="error">Import impossible : {phase.message}</Notice> : null}
          </LiveRegion>
          <div className="flex justify-end">
            <Button type="button" variant="ghost" onClick={close} aria-disabled={importing || undefined}>
              Annuler
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
