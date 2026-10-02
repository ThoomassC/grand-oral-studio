"use client";

import { Button, Dropzone, FileCard } from "@thomascaron/opale-ui";
import Link from "next/link";
import { useId, useRef, useState, useTransition } from "react";
import type { PromptTemplate } from "@/domain/schemas";
import { analyzeBrandFile } from "@/server/actions/imports";
import { updateBrand } from "@/server/actions/programs";
import { BrandPreview, mergeImportedBrand } from "@/components/brand/BrandPreview";
import { useGuardedNavigation } from "@/components/layout/useGuardedNavigation";
import { pageHref } from "@/components/projects/steps";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { FocusOnMount } from "@/components/ui/FocusOnMount";
import { formatFileSize } from "@/components/ui/format";
import { LiveRegion } from "@/components/ui/LiveRegion";
import { Notice } from "@/components/ui/Notice";
import { useCurrentLogo } from "./current-logo";

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
 * Les extensions à macros sont acceptées par la zone de dépôt pour être
 * refusées ici, avec leur raison : hors `accept`, la zone ne dirait qu'un
 * « type non pris en charge ». Le serveur les refuse aussi.
 */
const MACRO_EXTENSIONS = [".pptm", ".potm", ".ppsm", ".ppam"];
const ACCEPT = [".pptx", ".potx", ".thmx", ".pdf", ".png", ".jpg", ".jpeg", ...MACRO_EXTENSIONS].join(",");
const MACRO_REJECTED = "Les fichiers avec macros (.pptm, .potm) sont refusés : enregistrez la présentation en .pptx.";

const hasMacros = (fileName: string) => MACRO_EXTENSIONS.some((ext) => fileName.trim().toLowerCase().endsWith(ext));

const SOURCE_TEXT: Record<BrandImportData["source"], string> = {
  office: "Lue dans le fichier Office, sans IA.",
  ai: "Déduite par l'IA (moteur Claude).",
};

/**
 * Mode « Depuis un fichier » : une présentation d'exemple → une charte
 * proposée (aperçu) → « Appliquer la charte » l'ENREGISTRE (`updateBrand`).
 * Elle reste modifiable ensuite dans l'onglet Charte.
 *
 * Chaque analyse porte un numéro : une réponse arrivée après « Annuler » ou
 * après le choix d'un autre fichier est ignorée.
 */
export function SubjectFileImport({
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
  const { onLinkClick } = useGuardedNavigation();
  const baseId = useId();
  const ids = {
    help: `${baseId}-help`,
    error: `${baseId}-error`,
    preview: `${baseId}-preview-title`,
    done: `${baseId}-done`,
  };
  const brandHref = pageHref(programId, "brand");

  function focusZone() {
    zoneRef.current?.querySelector<HTMLInputElement>("input[type=file]")?.focus();
  }

  function analyze(files: FileList) {
    const file = files[0];
    if (!file) return;
    const info: FileInfo = { name: file.name, size: file.size };
    const request = ++requestRef.current;
    if (hasMacros(file.name)) {
      setPhase({ kind: "error", file: info, message: MACRO_REJECTED });
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
          <strong>PowerPoint, modèle ou thème Office</strong> (.pptx, .potx, .thmx) : lecture gratuite.
        </li>
        <li>
          <strong>Export Canva en .pptx</strong> : gratuit.
        </li>
        <li>
          <strong>PDF ou image</strong> (export Canva en PDF, .png, .jpg) : moteur Claude, à choisir dans les
          Paramètres (compte comme un appel IA).
        </li>
        <li className="text-muted">20 Mo au plus (PDF 10 Mo, image 5 Mo). Les fichiers avec macros (.pptm, .potm) sont refusés.</li>
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
              typeRejected: "Type de fichier non pris en charge : utilisez un .pptx, .potx, .thmx, .pdf, .png ou .jpg.",
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
            Charte proposée
          </h3>
          <p className="mb-4 text-sm text-muted">
            {SOURCE_TEXT[phase.result.source]} Rien n&apos;est encore enregistré.
          </p>
          <BrandPreview brand={phase.result.brand} format={format} notes={phase.result.notes} />
          <LiveRegion role="alert" className="mt-4">
            {phase.saveError ? (
              <Notice tone="error">La charte n&apos;a pas été appliquée : {phase.saveError}</Notice>
            ) : null}
          </LiveRegion>
          <div className="mt-5 flex flex-wrap gap-3">
            <Button type="button" onClick={() => apply(phase)} aria-disabled={saving || undefined}>
              <ButtonLabel idle="Appliquer la charte" busy="Application…" isBusy={saving} />
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
              <p className="font-semibold text-success">Charte appliquée et enregistrée.</p>
              <p className="mt-1">
                Elle reste modifiable :{" "}
                <Link href={brandHref} className="opale-link underline" onClick={(e) => onLinkClick(e, brandHref)}>
                  l&apos;ajuster dans l&apos;onglet Charte
                </Link>
                .
              </p>
            </Notice>
          </div>
        ) : null}
      </LiveRegion>
    </div>
  );
}
