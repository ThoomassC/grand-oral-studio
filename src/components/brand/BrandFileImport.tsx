"use client";

import { Button, Dropzone, FileCard } from "@thomascaron/opale-ui";
import { useId, useRef, useState, useTransition } from "react";
import { fileExtension, RETIRED_EXTENSIONS, RETIRED_FORMAT_MESSAGE } from "@/domain/import/file-kind";
import type { PromptTemplate } from "@/domain/schemas";
import { analyzeBrandFile } from "@/server/actions/imports";
import { updateBrand } from "@/server/actions/programs";
import { useCurrentLogo } from "@/components/themes/current-logo";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { FocusOnMount } from "@/components/ui/FocusOnMount";
import { formatFileSize } from "@/components/ui/format";
import { LiveRegion } from "@/components/ui/LiveRegion";
import { Notice } from "@/components/ui/Notice";
import { BrandPreview, mergeImportedBrand } from "./BrandPreview";

type BrandImportData = Extract<Awaited<ReturnType<typeof analyzeBrandFile>>, { ok: true }>["data"];

type FileInfo = { name: string; size: number };

type Phase =
  | { kind: "idle" }
  | { kind: "analyzing"; file: FileInfo }
  | { kind: "error"; file: FileInfo; message: string }
  | { kind: "preview"; file: FileInfo; result: BrandImportData; saveError: string | null }
  | { kind: "applied"; file: FileInfo };

const MB = 1024 * 1024;
/**
 * Les extensions à macros et celles des formats retirés (PDF, images) sont
 * acceptées par la zone de dépôt pour être refusées ici, avec leur raison :
 * hors `accept`, la zone ne dirait qu'un « type non pris en charge ». Le
 * serveur les refuse aussi.
 */
const MACRO_EXTENSIONS = ["pptm", "potm", "ppsm", "ppam"];
const ACCEPT = ["pptx", "potx", "thmx", ...RETIRED_EXTENSIONS, ...MACRO_EXTENSIONS].map((ext) => `.${ext}`).join(",");
const MACRO_REJECTED = "Les fichiers avec macros (.pptm, .potm) sont refusés : enregistrez la présentation en .pptx.";

/** Refus connu avant tout envoi au serveur, ou null. */
function rejectedBeforeUpload(fileName: string): string | null {
  const ext = fileExtension(fileName);
  if (MACRO_EXTENSIONS.includes(ext)) return MACRO_REJECTED;
  if (RETIRED_EXTENSIONS.includes(ext)) return RETIRED_FORMAT_MESSAGE;
  return null;
}

/**
 * Mode « Depuis un fichier .pptx » de la page Apparence : une présentation
 * d'exemple (.pptx, .potx, .thmx), lue sans IA → une apparence proposée
 * (aperçu) → « Appliquer l'apparence » l'ENREGISTRE (`updateBrand`). Elle reste
 * modifiable dans l'éditeur, juste en dessous.
 *
 * Chaque analyse porte un numéro : une réponse arrivée après « Annuler » ou
 * après le choix d'un autre fichier est ignorée.
 */
export function BrandFileImport({
  programId,
  format,
}: {
  programId: string;
  format: PromptTemplate["format"];
}) {
  const currentLogo = useCurrentLogo();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [, startTransition] = useTransition();
  const [saving, startSaving] = useTransition();
  const zoneRef = useRef<HTMLLabelElement>(null);
  const requestRef = useRef(0);
  const baseId = useId();
  const ids = {
    help: `${baseId}-help`,
    error: `${baseId}-error`,
    preview: `${baseId}-preview-title`,
    done: `${baseId}-done`,
  };

  function focusZone() {
    zoneRef.current?.querySelector<HTMLInputElement>("input[type=file]")?.focus();
  }

  function analyze(files: FileList) {
    const file = files[0];
    if (!file) return;
    const info: FileInfo = { name: file.name, size: file.size };
    const request = ++requestRef.current;
    const rejected = rejectedBeforeUpload(file.name);
    if (rejected) {
      setPhase({ kind: "error", file: info, message: rejected });
      return;
    }
    setPhase({ kind: "analyzing", file: info });
    startTransition(async () => {
      const formData = new FormData();
      formData.set("file", file);
      let next: Phase;
      try {
        const result = await analyzeBrandFile(programId, formData);
        next = result.ok
          ? { kind: "preview", file: info, result: result.data, saveError: null }
          : { kind: "error", file: info, message: result.fieldErrors?.file?.[0] ?? result.error };
      } catch {
        next = { kind: "error", file: info, message: "La connexion a été interrompue. Réessayez avec le même fichier." };
      }
      if (request === requestRef.current) setPhase(next);
    });
  }

  function cancel() {
    if (saving) return;
    requestRef.current += 1;
    setPhase({ kind: "idle" });
    focusZone();
  }

  function apply(current: Extract<Phase, { kind: "preview" }>) {
    if (saving) return;
    const request = requestRef.current;
    startSaving(async () => {
      let error: string | null;
      try {
        const result = await updateBrand(programId, mergeImportedBrand(current.result.brand, currentLogo));
        error = result.ok ? null : result.error;
      } catch {
        error = "La connexion a été interrompue. Réessayez.";
      }
      if (request !== requestRef.current) return;
      setPhase(error ? { ...current, saveError: error } : { kind: "applied", file: current.file });
    });
  }

  const file = phase.kind === "idle" || phase.kind === "applied" ? null : phase.file;

  return (
    <div className="flex flex-col gap-4">
      <ul id={ids.help} className="list-disc space-y-0.5 pl-5 text-sm">
        <li>
          <strong>Présentation ou modèle PowerPoint</strong> (.pptx, .potx, y compris un export Canva en .pptx) ou fichier
          .thmx d&apos;Office : couleurs, polices et logo sont lus dans le fichier.
        </li>
        <li className="text-muted">
          20 Mo au plus. Les fichiers avec macros (.pptm, .potm), les PDF et les images ne sont pas acceptés.
        </li>
      </ul>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] sm:items-start">
        {/* `Dropzone` rend deux nœuds (zone + message d'erreur) : un conteneur les garde dans la même colonne. */}
        <div>
          <Dropzone
            ref={zoneRef}
            accept={ACCEPT}
            multiple={false}
            maxSizeBytes={20 * MB}
            className="min-h-32"
            onFiles={analyze}
            onError={() => {
              requestRef.current += 1;
              setPhase({ kind: "idle" });
            }}
            labels={{
              select: "ou choisissez un fichier",
              tooManyFiles: () => "Déposez un seul fichier à la fois.",
              fileTooLarge: () => "Le fichier dépasse 20 Mo.",
              typeRejected: "Type de fichier non pris en charge : utilisez un .pptx, .potx ou .thmx.",
            }}
          >
            Déposez votre présentation ici
          </Dropzone>
        </div>
        {file ? <FileCard name={file.name} fileSize={formatFileSize(file.size)} /> : null}
      </div>

      <LiveRegion className="text-sm font-medium">
        {phase.kind === "analyzing" ? (
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="size-3 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />
            Analyse de la présentation…
          </span>
        ) : null}
      </LiveRegion>
      <LiveRegion role="alert">
        {phase.kind === "error" ? (
          <Notice tone="error" id={ids.error}>
            <p>Import impossible : {phase.message}</p>
            <p className="mt-1">Choisissez un autre fichier, ou essayez le mode « Depuis un prompt ».</p>
          </Notice>
        ) : null}
      </LiveRegion>

      {phase.kind === "preview" ? (
        <section aria-labelledby={ids.preview} className="border-t border-border pt-5">
          <FocusOnMount targetId={ids.preview} />
          <h3 id={ids.preview} tabIndex={-1} className="text-lg font-semibold focus:outline-none">
            Apparence proposée
          </h3>
          <p className="mb-4 text-sm text-muted">Lue dans le fichier, sans IA. Rien n&apos;est encore enregistré.</p>
          <BrandPreview brand={phase.result.brand} format={format} notes={phase.result.notes} />
          <LiveRegion role="alert" className="mt-4">
            {phase.saveError ? (
              <Notice tone="error">L&apos;apparence n&apos;a pas été appliquée : {phase.saveError}</Notice>
            ) : null}
          </LiveRegion>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button type="button" onClick={() => apply(phase)} aria-disabled={saving || undefined}>
              <ButtonLabel idle="Appliquer l'apparence" busy="Application…" isBusy={saving} />
            </Button>
            <Button type="button" variant="text" onClick={cancel} aria-disabled={saving || undefined}>
              Annuler
            </Button>
          </div>
        </section>
      ) : null}

      <LiveRegion>
        {phase.kind === "applied" ? (
          <div id={ids.done} tabIndex={-1} className="focus:outline-none">
            <FocusOnMount targetId={ids.done} />
            <Notice tone="success">
              <p className="font-semibold text-success">Apparence appliquée et enregistrée.</p>
              <p className="mt-1">Elle reste modifiable dans l&apos;éditeur ci-dessous.</p>
            </Notice>
          </div>
        ) : null}
      </LiveRegion>
    </div>
  );
}
