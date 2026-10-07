"use client";

import { SelectInput, TextInput } from "@/components/ui/Field";
import { Button } from "@thomascaron/opale-ui";
import { useId, useRef, useState, useTransition } from "react";
import { BrandSchema, type Brand, type PromptTemplate } from "@/domain/schemas";
import { updateBrand } from "@/server/actions/programs";
import { errorProps, firstError, validateWith, type FieldErrors } from "@/components/forms/validation";
import { useUnsavedChanges } from "@/components/layout/UnsavedChanges";
import { SlidePreview } from "@/components/slides/SlidePreview";
import { SAFE_FONTS } from "@/components/slides/fonts";
import { fontWarning } from "@/domain/fonts";
import { SAMPLE_SLIDES } from "@/components/slides/sample-slides";
import { ButtonLabel } from "@/components/ui/ButtonLabel";
import { FieldError } from "@/components/ui/FieldError";
import { countFieldErrors, focusFirstInvalid, invalidCountMessage } from "@/components/ui/focus";
import { FormStatus, IDLE, type FormStatusState } from "@/components/ui/FormStatus";
import { LiveRegion } from "@/components/ui/LiveRegion";
import { Notice } from "@/components/ui/Notice";
import { contrastRatio } from "./contrast";

type ColorKey = keyof Brand["colors"];

/** Rôle de chaque couleur dans le rendu .pptx (qui fait foi). */
const COLOR_FIELDS: { key: ColorKey; label: string; hint: string }[] = [
  {
    key: "primary",
    label: "Principale",
    hint: "Fond de la couverture, bandeau de la conclusion, titres des diapos, barre des intercalaires",
  },
  {
    key: "secondary",
    label: "Secondaire",
    hint: "Sous-titres, texte des intercalaires, séparateur des deux colonnes, pied de page",
  },
  { key: "accent", label: "Accent", hint: "Bande de la couverture, trait sous les titres, coches de la conclusion" },
  {
    key: "background",
    label: "Fond",
    hint: "Fond des diapos ; texte de la couverture et du bandeau de conclusion ; pastille du logo",
  },
  { key: "text", label: "Texte", hint: "Texte des puces" },
];

const LOGO_MAX_BYTES = 500 * 1024;
const LOGO_TYPES = ["image/png", "image/jpeg"];
const HEX = /^#[0-9a-fA-F]{6}$/;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("read")));
    reader.onerror = () => reject(reader.error ?? new Error("read"));
    reader.readAsDataURL(file);
  });
}

function contrastWarnings(colors: Brand["colors"]): string[] {
  const checks: [string, string, string][] = [
    [colors.text, colors.background, "Texte des puces sur le fond"],
    [colors.background, colors.primary, "Texte de la couverture et de la conclusion (fond sur principale)"],
    [colors.secondary, colors.background, "Sous-titres sur le fond (secondaire sur fond)"],
    [colors.primary, colors.background, "Titres sur le fond (principale sur fond)"],
  ];
  const out: string[] = [];
  for (const [fg, bg, label] of checks) {
    const ratio = contrastRatio(fg, bg);
    if (ratio !== null && ratio < 4.5) {
      out.push(`${label} : contraste ${ratio.toFixed(1).replace(".", ",")}:1, en dessous du minimum recommandé de 4,5:1.`);
    }
  }
  return out;
}

export function BrandEditor({
  programId,
  initialBrand,
  savedAt,
  format,
}: {
  programId: string;
  initialBrand: Brand;
  /**
   * Version enregistrée reçue du serveur (brandSavedAt, ISO ; null = jamais enregistrée),
   * renvoyée à chaque enregistrement pour détecter une apparence modifiée entre-temps
   * (autre onglet, autre membre). Absente : pas de contrôle.
   */
  savedAt?: string | null;
  format: PromptTemplate["format"];
}) {
  const [saved, setSaved] = useState<Brand>(initialBrand);
  const [brand, setBrand] = useState<Brand>(initialBrand);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<FormStatusState>(IDLE);
  const [logoError, setLogoError] = useState<string | null>(null);
  // Apparence enregistrée reçue du serveur. Si elle diffère de ce que l'éditeur a lui-même
  // enregistré (import appliqué au-dessus), on la reprend ; après notre propre enregistrement,
  // le rafraîchissement renvoie la même apparence : rien ne bouge et le message reste affiché.
  const [serverBrand, setServerBrand] = useState<Brand>(initialBrand);
  // Jeton de concurrence optimiste : la version reçue au chargement, puis celle que renvoie
  // chaque enregistrement. Une version venue du serveur est reprise avec son apparence
  // (reprise ci-dessous, ou identique à celle tenue pour enregistrée) : jamais à l'aveugle.
  const [version, setVersion] = useState(savedAt);
  if (initialBrand !== serverBrand) {
    setServerBrand(initialBrand);
    setVersion(savedAt);
    if (JSON.stringify(initialBrand) !== JSON.stringify(saved)) {
      setSaved(initialBrand);
      setBrand(initialBrand);
      setFieldErrors({});
      setStatus(IDLE);
      setLogoError(null);
    }
  }
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const baseId = useId();

  const dirty = JSON.stringify(brand) !== JSON.stringify(saved);
  const logoUnsaved = brand.logoDataUrl !== saved.logoDataUrl;
  const warnings = contrastWarnings(brand.colors);
  useUnsavedChanges(dirty);

  function patch(next: (b: Brand) => Brand) {
    setBrand(next);
    setStatus(IDLE);
  }


  async function handleLogo(e: React.ChangeEvent<HTMLInputElement>) {
    setLogoError(null);
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) {
      setLogoError(
        `Format non pris en charge (${file.type || "inconnu"}). Utilisez un PNG ou un JPEG : le SVG ne peut pas être intégré à l'export PowerPoint.`,
      );
      return;
    }
    if (file.size > LOGO_MAX_BYTES) {
      setLogoError(`Fichier trop lourd (${Math.round(file.size / 1024)} Ko). La limite est de 500 Ko.`);
      return;
    }
    try {
      const dataUrl = await readAsDataUrl(file);
      patch((b) => ({ ...b, logoDataUrl: dataUrl }));
    } catch {
      setLogoError("Le fichier n'a pas pu être lu. Réessayez avec un autre fichier.");
    }
  }

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const checked = validateWith(BrandSchema, brand);
    if (!checked.ok) {
      setFieldErrors(checked.fieldErrors);
      setStatus({ kind: "error", message: invalidCountMessage(countFieldErrors(checked.fieldErrors)) });
      focusFirstInvalid(formRef.current);
      return;
    }
    setFieldErrors({});
    startTransition(async () => {
      try {
        const result = await updateBrand(programId, checked.data, version);
        if (!result.ok) {
          const errors = result.fieldErrors ?? {};
          setFieldErrors(errors);
          setStatus({ kind: "error", message: result.error });
          if (countFieldErrors(errors) > 0) focusFirstInvalid(formRef.current);
          return;
        }
        setVersion(result.data.brandSavedAt);
        setSaved(checked.data);
        setBrand(checked.data);
        setStatus({ kind: "success", message: "Apparence enregistrée." });
      } catch {
        setStatus({ kind: "error", message: "La connexion a été interrompue. Vos réglages sont conservés : réessayez." });
      }
    });
  }

  const nameId = `${baseId}-name`;
  const previewId = `${baseId}-preview`;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <section aria-labelledby={previewId} className="lg:sticky lg:top-4 lg:order-2 lg:self-start">
        <h2 id={previewId} className="text-lg font-semibold">
          Aperçu
        </h2>
        <p className="text-sm text-muted">Mis à jour en direct, avant même l&apos;enregistrement. Rendu identique au .pptx.</p>
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:gap-4">
          {SAMPLE_SLIDES.map(({ label, slide }, i) => (
            <li key={label} className={i === 1 || i === 3 ? "hidden sm:block" : i === 4 ? "hidden sm:block" : ""}>
              <SlidePreview slide={slide} brand={brand} format={format} number={i + 1} deckTitle="Titre du diaporama" decorative />
              <p className="mt-1.5 text-sm text-muted">Diapo {label.toLowerCase()}</p>
            </li>
          ))}
        </ul>
      </section>

      <form ref={formRef} noValidate onSubmit={save} className="flex flex-col gap-6 lg:order-1">
        <div>
          <h2 tabIndex={-1} className="text-2xl focus:outline-none">
            Couleurs, polices et logo
          </h2>
          <p className="text-sm text-muted">Appliquée à l&apos;aperçu, à l&apos;export .pptx et au prompt Canva.</p>
        </div>

        <div>
          <label htmlFor={nameId} className="opale-field__label">
            Nom de l&apos;apparence
          </label>
          <TextInput
            id={nameId}
            value={brand.name}
            maxLength={80}
            onChange={(e) => {
              const name = e.target.value;
              patch((b) => ({ ...b, name }));
            }}
            {...errorProps(fieldErrors, "name", `${nameId}-err`)}
          />
          <FieldError id={`${nameId}-err`} message={firstError(fieldErrors, "name")} />
        </div>

        <fieldset>
          <legend className="opale-field__label">Couleurs</legend>
          <div className="flex flex-col gap-4">
            {COLOR_FIELDS.map(({ key, label, hint }) => {
              const value = brand.colors[key];
              const id = `${baseId}-${key}`;
              const errKey = `colors.${key}`;
              return (
                <div key={key}>
                  <label htmlFor={id} className="opale-field__label">
                    {label} <span className="font-normal text-muted">(hexadécimal)</span>
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      aria-label={`${label} : sélecteur de couleur`}
                      className="h-10 w-12 shrink-0 cursor-pointer rounded-md border border-border-strong bg-surface p-1"
                      value={HEX.test(value) ? value.toLowerCase() : "#000000"}
                      onChange={(e) => {
                        const v = e.target.value.toUpperCase();
                        patch((b) => ({ ...b, colors: { ...b.colors, [key]: v } }));
                      }}
                    />
                    <TextInput
                      id={id}
                      className="font-mono uppercase" shellClassName="min-w-0 flex-1"
                      value={value}
                      maxLength={7}
                      spellCheck={false}
                      autoComplete="off"
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        const v = raw.startsWith("#") ? raw : `#${raw}`;
                        patch((b) => ({ ...b, colors: { ...b.colors, [key]: v } }));
                      }}
                      {...errorProps(fieldErrors, errKey, `${id}-err`, `${id}-hint`)}
                    />
                  </div>
                  <p id={`${id}-hint`} className="opale-field__helper">
                    {hint}
                  </p>
                  <FieldError id={`${id}-err`} message={firstError(fieldErrors, errKey)} />
                </div>
              );
            })}
          </div>
        </fieldset>

        <LiveRegion className="rounded-lg border border-warning/50 bg-warning-soft p-3 text-sm">
          {warnings.length > 0 ? (
            <>
              <p className="font-semibold text-warning">Attention : lisibilité</p>
              <ul className="mt-1 list-disc pl-5">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </>
          ) : null}
        </LiveRegion>

        <fieldset>
          <legend className="opale-field__label">Polices</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {(
              [
                ["heading", "Titres"],
                ["body", "Texte"],
              ] as const
            ).map(([key, label]) => {
              const id = `${baseId}-font-${key}`;
              const current = brand.fonts[key];
              const known = SAFE_FONTS.includes(current);
              const warning = fontWarning(current);
              return (
                <div key={key}>
                  <label htmlFor={id} className="opale-field__label">
                    {label}
                  </label>
                  <SelectInput
                    id={id}
                    value={current}
                    onChange={(e) => {
                      const v = e.target.value;
                      patch((b) => ({ ...b, fonts: { ...b.fonts, [key]: v } }));
                    }}
                    {...errorProps(fieldErrors, `fonts.${key}`, `${id}-err`)}
                  >
                    {!known ? <option value={current}>{current} (non prise en charge)</option> : null}
                    {SAFE_FONTS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </SelectInput>
                  <FieldError id={`${id}-err`} message={firstError(fieldErrors, `fonts.${key}`)} />
                  {/* Polices hors système : absentes du .pptx, remplacées ailleurs. */}
                  <LiveRegion className="mt-2 text-sm">
                    {warning ? <Notice tone="warning">{warning}</Notice> : null}
                  </LiveRegion>
                </div>
              );
            })}
          </div>
          <p className="opale-field__helper">
            Polices disponibles dans PowerPoint et Canva. L&apos;aperçu les affiche si elles sont installées sur votre
            appareil.
          </p>
        </fieldset>

        <fieldset>
          <legend className="opale-field__label">Logo</legend>
          <div className="flex flex-wrap items-center gap-3">
            {brand.logoDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- data URL locale
              <img
                src={brand.logoDataUrl}
                alt="Logo actuel"
                className="h-14 max-w-[10rem] rounded-md border border-border bg-surface-2 object-contain p-1"
              />
            ) : (
              <p className="text-sm text-muted">Aucun logo.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <label className="opale-button opale-button--ghost opale-button--small has-[:focus-visible]:outline-[length:var(--opale-focus-ring-width)] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring has-[:focus-visible]:outline-solid">
                <span>{brand.logoDataUrl ? "Remplacer le logo" : "Choisir un logo"}</span>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg"
                  className="sr-only"
                  onChange={handleLogo}
                  aria-describedby={`${baseId}-logo-hint${logoError ? ` ${baseId}-logo-err` : ""}`}
                />
              </label>
              {brand.logoDataUrl ? (
                <Button
                  type="button"
                  variant="ghost" size="small" className="danger-outline"
                  onClick={() => {
                    patch((b) => ({ ...b, logoDataUrl: null }));
                    fileRef.current?.focus();
                  }}
                >
                  Retirer le logo
                </Button>
              ) : null}
            </div>
          </div>
          <p id={`${baseId}-logo-hint`} className="opale-field__helper">
            PNG ou JPEG, 500 Ko au plus. Un fond transparent (PNG) s&apos;intègre mieux.
          </p>
          <LiveRegion className="mt-1 text-sm font-medium text-warning">
            {logoUnsaved && !logoError
              ? brand.logoDataUrl
                ? "Logo chargé, non enregistré."
                : "Logo retiré, non enregistré."
              : null}
          </LiveRegion>
          <LiveRegion role="alert">
            {logoError || firstError(fieldErrors, "logoDataUrl") ? (
              <FieldError id={`${baseId}-logo-err`} message={logoError ?? firstError(fieldErrors, "logoDataUrl")} />
            ) : null}
          </LiveRegion>
        </fieldset>

        <div className="sticky bottom-0 -mx-1 flex flex-col gap-2 border-t border-border bg-bg/95 px-1 py-3 backdrop-blur">
          <FormStatus state={status} />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" aria-disabled={pending || undefined}>
              <ButtonLabel idle="Enregistrer l'apparence" busy="Enregistrement…" isBusy={pending} />
            </Button>
            {dirty ? (
              <>
                <Button
                  type="button"
                  variant="text"
                  onClick={() => {
                    if (pending) return;
                    setBrand(saved);
                    setFieldErrors({});
                    setStatus(IDLE);
                    setLogoError(null);
                  }}
                  aria-disabled={pending || undefined}
                >
                  Annuler les modifications
                </Button>
                <span className="text-sm text-muted">Modifications non enregistrées</span>
              </>
            ) : null}
          </div>
        </div>
      </form>
    </div>
  );
}
