import type { Brand, PromptTemplate } from "@/domain/schemas";
import { SlidePreview } from "@/components/slides/SlidePreview";
import { SAMPLE_SLIDES } from "@/components/slides/sample-slides";

const COLOR_LABELS: { key: keyof Brand["colors"]; label: string }[] = [
  { key: "primary", label: "Principale" },
  { key: "secondary", label: "Secondaire" },
  { key: "accent", label: "Accent" },
  { key: "background", label: "Fond" },
  { key: "text", label: "Texte" },
];

/** Miniatures de l'aperçu : couverture, contenu, conclusion (le .pptx fait foi). */
const PREVIEW_SLIDES = SAMPLE_SLIDES.filter(({ slide }) => ["title", "content", "conclusion"].includes(slide.layout));

/**
 * Une charte proposée par un import, en lecture : couleurs (valeur écrite à
 * côté de chaque pastille, jamais la couleur seule), polices, logo, rendu sur
 * trois diapos types et remarques de l'analyse. Sans état : l'appelant porte
 * le titre et les actions.
 */
export function BrandPreview({
  brand,
  format,
  notes,
  headingLevel = 4,
}: {
  brand: Brand;
  format: PromptTemplate["format"];
  notes: string[];
  /** Niveau des intertitres (Couleurs, Polices…), sous le titre de l'appelant. */
  headingLevel?: 4 | 5;
}) {
  const H = headingLevel === 4 ? "h4" : "h5";
  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <div>
            <H className="opale-field__label">Couleurs</H>
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
            <H className="opale-field__label">Polices</H>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
              <dt className="text-muted">Titres</dt>
              <dd>{brand.fonts.heading}</dd>
              <dt className="text-muted">Texte</dt>
              <dd>{brand.fonts.body}</dd>
            </dl>
          </div>
          <div>
            <H className="opale-field__label">Logo</H>
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
          <H className="opale-field__label">Rendu</H>
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
          <H className="font-semibold">À savoir</H>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

/** La charte à enregistrer : sans logo importé, le logo en cours est conservé. */
export function mergeImportedBrand(imported: Brand, currentLogo: string | null): Brand {
  return { ...imported, logoDataUrl: imported.logoDataUrl ?? currentLogo };
}
