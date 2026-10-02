"use client";

import { Button, Dropzone, FileCard } from "@thomascaron/opale-ui";
import { useId, useRef, useState, useTransition } from "react";
import type { Brand, PromptTemplate } from "@/domain/schemas";
import { analyzeBrandFile } from "@/server/actions/imports";
import { IMPORT_ANCHORS } from "@/components/projects/steps";
import { SlidePreview } from "@/components/slides/SlidePreview";
import { SAMPLE_SLIDES } from "@/components/slides/sample-slides";
import { FocusOnMount } from "@/components/ui/FocusOnMount";
import { formatFileSize } from "@/components/ui/format";
import { LiveRegion } from "@/components/ui/LiveRegion";
import { Notice } from "@/components/ui/Notice";

type BrandImportData = Extract<Awaited<ReturnType<typeof analyzeBrandFile>>, { ok: true }>["data"];

type FileInfo = { name: string; size: number };

type Phase =
  | { kind: "idle" }
  | { kind: "analyzing"; file: FileInfo }
  | { kind: "error"; file: FileInfo; message: string }
  | { kind: "preview"; file: FileInfo; result: BrandImportData };

const MB = 1024 * 1024;
const ACCEPT = ".pptx,.potx,.thmx,.pdf,.png,.jpg,.jpeg";

const COLOR_LABELS: { key: keyof Brand["colors"]; label: string }[] = [
  { key: "primary", label: "Principale" },
  { key: "secondary", label: "Secondaire" },
  { key: "accent", label: "Accent" },
  { key: "background", label: "Fond" },
  { key: "text", label: "Texte" },
];

/** Miniatures de l'aperçu : couverture, contenu, conclusion (le .pptx fait foi). */
const PREVIEW_SLIDES = SAMPLE_SLIDES.filter(({ slide }) => ["title", "content", "conclusion"].includes(slide.layout));

const SOURCE_TEXT: Record<BrandImportData["source"], string> = {
  office: "Lue dans le fichier Office, sans IA.",
  ai: "Déduite par l'IA (moteur Claude).",
};

/**
 * « Importer depuis une présentation » : un fichier d'exemple → une charte
 * proposée (aperçu), que l'utilisateur applique au formulaire ou abandonne.
 * Rien n'est enregistré ici ; l'éditeur enregistre comme d'habitude.
 */
export function BrandImport({
  programId,
  format,
  onApply,
}: {
  programId: string;
  format: PromptTemplate["format"];
  onApply: (brand: Brand) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [, startTransition] = useTransition();
  const zoneRef = useRef<HTMLLabelElement>(null);
  /**
   * Chaque analyse porte un numéro : une réponse arrivée après « Annuler » ou
   * après le choix d'un autre fichier est ignorée. La zone reste active pendant
   * l'analyse (le focus clavier n'y est pas perdu) : un nouveau fichier remplace le précédent.
   */
  const requestRef = useRef(0);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const helpId = `${baseId}-help`;
  const errorId = `${baseId}-error`;
  const previewTitleId = `${baseId}-preview-title`;

  function focusZone() {
    zoneRef.current?.querySelector<HTMLInputElement>("input[type=file]")?.focus();
  }

  function analyze(files: FileList) {
    const file = files[0];
    if (!file) return;
    const info: FileInfo = { name: file.name, size: file.size };
    const request = ++requestRef.current;
    setPhase({ kind: "analyzing", file: info });
    startTransition(async () => {
      const formData = new FormData();
      formData.set("file", file);
      let next: Phase;
      try {
        const result = await analyzeBrandFile(programId, formData);
        next = result.ok
          ? { kind: "preview", file: info, result: result.data }
          : { kind: "error", file: info, message: result.fieldErrors?.file?.[0] ?? result.error };
      } catch {
        next = { kind: "error", file: info, message: "La connexion a été interrompue. Réessayez avec le même fichier." };
      }
      if (request === requestRef.current) setPhase(next);
    });
  }

  function cancel() {
    requestRef.current += 1;
    setPhase({ kind: "idle" });
    focusZone();
  }

  function apply(brand: Brand) {
    requestRef.current += 1;
    setPhase({ kind: "idle" });
    onApply(brand);
  }

  const file = phase.kind === "idle" ? null : phase.file;

  return (
    <section
      id={IMPORT_ANCHORS.brand}
      aria-labelledby={titleId}
      className="opale-card opale-card--e1 block scroll-mt-4 p-4 sm:p-5"
    >
      <h2 id={titleId} className="text-lg font-semibold">
        Importer depuis une présentation
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-muted">
        Facultatif. Déposez une présentation d&apos;exemple : ses couleurs, ses polices et son logo sont proposés dans un
        aperçu, que vous appliquez au formulaire avant d&apos;enregistrer.
      </p>
      <ul id={helpId} className="mt-2 list-disc space-y-0.5 pl-5 text-sm">
        <li>
          <strong>PowerPoint (.pptx), modèle (.potx) ou thème Office (.thmx)</strong> : lecture gratuite, sans IA.
        </li>
        <li>
          <strong>PDF ou image (.png, .jpg)</strong> : analyse par le moteur Claude, à choisir dans les Paramètres
          (compte comme un appel IA).
        </li>
        <li className="text-muted">20 Mo au plus (PDF 10 Mo, image 5 Mo). Les fichiers à macros (.pptm) sont refusés.</li>
      </ul>

      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] sm:items-start">
        {/* `Dropzone` rend deux nœuds (zone + message d'erreur) : un conteneur les garde dans la même colonne. */}
        <div>
          <Dropzone
            ref={zoneRef}
            accept={ACCEPT}
            multiple={false}
            maxSizeBytes={20 * MB}
            className="min-h-28"
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

      <LiveRegion className="mt-3 text-sm font-medium">
        {phase.kind === "analyzing" ? (
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="size-3 animate-pulse rounded-full bg-accent motion-reduce:animate-none" />
            Analyse de la présentation…
          </span>
        ) : null}
      </LiveRegion>
      <LiveRegion role="alert" className="mt-3">
        {phase.kind === "error" ? (
          <Notice tone="error" id={errorId}>
            <p>Import impossible : {phase.message}</p>
            <p className="mt-1">Choisissez un autre fichier, ou réglez la charte à la main ci-dessous.</p>
          </Notice>
        ) : null}
      </LiveRegion>

      {phase.kind === "preview" ? (
        <BrandImportPreview
          titleId={previewTitleId}
          result={phase.result}
          format={format}
          onApply={() => apply(phase.result.brand)}
          onCancel={cancel}
        />
      ) : null}
    </section>
  );
}

function BrandImportPreview({
  titleId,
  result,
  format,
  onApply,
  onCancel,
}: {
  titleId: string;
  result: BrandImportData;
  format: PromptTemplate["format"];
  onApply: () => void;
  onCancel: () => void;
}) {
  const { brand, notes, source } = result;
  return (
    <section aria-labelledby={titleId} className="mt-5 border-t border-border pt-5">
      <FocusOnMount targetId={titleId} />
      <h3 id={titleId} tabIndex={-1} className="text-lg font-semibold focus:outline-none">
        Charte proposée
      </h3>
      <p className="text-sm text-muted">
        {SOURCE_TEXT[source]} Rien n&apos;est encore appliqué ni enregistré.
      </p>

      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <div>
            <h4 className="opale-field__label">Couleurs</h4>
            <ul className="flex flex-col gap-1.5">
              {COLOR_LABELS.map(({ key, label }) => (
                <li key={key} className="flex items-center gap-3 text-sm">
                  <span
                    aria-hidden="true"
                    className="size-6 shrink-0 rounded-sm border border-border-strong"
                    style={{ backgroundColor: brand.colors[key] }}
                  />
                  <span>
                    {label} : <span className="font-mono uppercase">{brand.colors[key]}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="opale-field__label">Polices</h4>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted">Titres</dt>
              <dd>{brand.fonts.heading}</dd>
              <dt className="text-muted">Texte</dt>
              <dd>{brand.fonts.body}</dd>
            </dl>
          </div>
          <div>
            <h4 className="opale-field__label">Logo</h4>
            {brand.logoDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- data URL locale
              <img
                src={brand.logoDataUrl}
                alt="Logo trouvé dans la présentation"
                className="h-14 max-w-[10rem] rounded-md border border-border bg-surface-2 object-contain p-1"
              />
            ) : (
              <p className="text-sm text-muted">Aucun logo trouvé : votre logo actuel, s&apos;il y en a un, est conservé.</p>
            )}
          </div>
        </div>

        <div>
          <h4 className="opale-field__label">Rendu</h4>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {PREVIEW_SLIDES.map(({ label, slide }, i) => (
              <li key={label} className={i === 2 ? "hidden sm:block" : ""}>
                <SlidePreview
                  slide={slide}
                  brand={brand}
                  format={format}
                  number={i === 0 ? undefined : i + 1}
                  deckTitle="Titre du diaporama"
                  decorative
                />
                <p className="mt-1.5 text-sm text-muted">Diapo {label.toLowerCase()}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {notes.length > 0 ? (
        <div className="mt-4 rounded-lg bg-surface-2 p-3 text-sm">
          <h4 className="font-semibold">À savoir</h4>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap gap-3">
        <Button type="button" onClick={onApply}>
          Appliquer à la charte
        </Button>
        <Button type="button" variant="text" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </section>
  );
}
