"use client";

import { useId, useRef, useState, useTransition } from "react";
import { BrandSchema, type Brand, type PromptTemplate } from "@/domain/schemas";
import { updateBrand } from "@/server/actions/programs";
import { errorProps, firstError, validateWith, type FieldErrors } from "@/components/forms/validation";
import { SlidePreview } from "@/components/slides/SlidePreview";
import { SAFE_FONTS } from "@/components/slides/fonts";
import { SAMPLE_SLIDES } from "@/components/slides/sample-slides";
import { FieldError } from "@/components/ui/FieldError";
import { FormStatus, IDLE, type FormStatusState } from "@/components/ui/FormStatus";
import { contrastRatio } from "./contrast";

type ColorKey = keyof Brand["colors"];

const COLOR_FIELDS: { key: ColorKey; label: string; hint: string }[] = [
  { key: "primary", label: "Principale", hint: "Titres, fond des diapos de couverture et de conclusion" },
  { key: "secondary", label: "Secondaire", hint: "Sous-titres et titres de section" },
  { key: "accent", label: "Accent", hint: "Puces, filets, éléments de mise en valeur" },
  { key: "background", label: "Fond", hint: "Fond des diapos de contenu" },
  { key: "text", label: "Texte", hint: "Corps du texte" },
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

export function BrandEditor({
  programId,
  initialBrand,
  format,
}: {
  programId: string;
  initialBrand: Brand;
  format: PromptTemplate["format"];
}) {
  const [saved, setSaved] = useState<Brand>(initialBrand);
  const [brand, setBrand] = useState<Brand>(initialBrand);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<FormStatusState>(IDLE);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const baseId = useId();

  const dirty = JSON.stringify(brand) !== JSON.stringify(saved);
  const textContrast = contrastRatio(brand.colors.text, brand.colors.background);
  const coverContrast = contrastRatio(brand.colors.background, brand.colors.primary);
  const contrastWarnings = [
    textContrast !== null && textContrast < 4.5
      ? `Texte sur fond : contraste ${textContrast.toFixed(1)}:1, en dessous du minimum recommandé de 4,5:1.`
      : null,
    coverContrast !== null && coverContrast < 4.5
      ? `Texte des diapos de couverture (couleur de fond sur couleur principale) : contraste ${coverContrast.toFixed(1)}:1, en dessous de 4,5:1.`
      : null,
  ].filter((w): w is string => w !== null);

  function setColor(key: ColorKey, value: string) {
    setBrand((b) => ({ ...b, colors: { ...b.colors, [key]: value } }));
    setStatus(IDLE);
  }

  function setFont(key: keyof Brand["fonts"], value: string) {
    setBrand((b) => ({ ...b, fonts: { ...b.fonts, [key]: value } }));
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
      setBrand((b) => ({ ...b, logoDataUrl: dataUrl }));
      setStatus(IDLE);
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
      setStatus({ kind: "error", message: "Corrigez les champs signalés avant d'enregistrer." });
      return;
    }
    setFieldErrors({});
    startTransition(async () => {
      const result = await updateBrand(programId, checked.data);
      if (!result.ok) {
        setFieldErrors(result.fieldErrors ?? {});
        setStatus({ kind: "error", message: result.error });
        return;
      }
      setSaved(checked.data);
      setStatus({ kind: "success", message: "Charte enregistrée." });
    });
  }

  const nameId = `${baseId}-name`;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
      <form noValidate onSubmit={save} className="flex flex-col gap-6">
        <div>
          <h2 className="text-xl font-semibold">Charte graphique</h2>
          <p className="text-sm text-muted">Appliquée à l&apos;aperçu, à l&apos;export .pptx et au prompt Canva.</p>
        </div>

        <div>
          <label htmlFor={nameId} className="field-label">
            Nom de la charte
          </label>
          <input
            id={nameId}
            className="input"
            value={brand.name}
            maxLength={80}
            onChange={(e) => {
              setBrand((b) => ({ ...b, name: e.target.value }));
              setStatus(IDLE);
            }}
            {...errorProps(fieldErrors, "name", `${nameId}-err`)}
          />
          <FieldError id={`${nameId}-err`} message={firstError(fieldErrors, "name")} />
        </div>

        <fieldset>
          <legend className="field-label">Couleurs</legend>
          <div className="flex flex-col gap-4">
            {COLOR_FIELDS.map(({ key, label, hint }) => {
              const value = brand.colors[key];
              const id = `${baseId}-${key}`;
              const errKey = `colors.${key}`;
              return (
                <div key={key}>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      aria-label={`${label} : sélecteur de couleur`}
                      className="h-10 w-12 shrink-0 cursor-pointer rounded-md border border-border-strong bg-surface p-1"
                      value={HEX.test(value) ? value.toLowerCase() : "#000000"}
                      onChange={(e) => setColor(key, e.target.value.toUpperCase())}
                    />
                    <div className="min-w-0 flex-1">
                      <label htmlFor={id} className="text-sm font-semibold">
                        {label} <span className="font-normal text-muted">(hexadécimal)</span>
                      </label>
                      <input
                        id={id}
                        className="input mt-1 font-mono uppercase"
                        value={value}
                        maxLength={7}
                        spellCheck={false}
                        autoComplete="off"
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          setColor(key, raw.startsWith("#") ? raw : `#${raw}`);
                        }}
                        {...errorProps(fieldErrors, errKey, `${id}-err`, `${id}-hint`)}
                      />
                    </div>
                  </div>
                  <p id={`${id}-hint`} className="field-hint">
                    {hint}
                  </p>
                  <FieldError id={`${id}-err`} message={firstError(fieldErrors, errKey)} />
                </div>
              );
            })}
          </div>
        </fieldset>

        {contrastWarnings.length > 0 ? (
          <div className="rounded-lg border border-warning/50 bg-warning-soft p-3 text-sm">
            <p className="font-semibold text-warning">Attention : lisibilité</p>
            <ul className="mt-1 list-disc pl-5">
              {contrastWarnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <fieldset>
          <legend className="field-label">Polices</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {(
              [
                ["heading", "Titres"],
                ["body", "Texte"],
              ] as const
            ).map(([key, label]) => {
              const id = `${baseId}-font-${key}`;
              const current = brand.fonts[key];
              const known = SAFE_FONTS.some((f) => f.name === current);
              return (
                <div key={key}>
                  <label htmlFor={id} className="text-sm font-semibold">
                    {label}
                  </label>
                  <select
                    id={id}
                    className="input mt-1"
                    value={current}
                    onChange={(e) => setFont(key, e.target.value)}
                    {...errorProps(fieldErrors, `fonts.${key}`, `${id}-err`)}
                  >
                    {!known ? <option value={current}>{current}</option> : null}
                    {SAFE_FONTS.map((f) => (
                      <option key={f.name} value={f.name}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                  <FieldError id={`${id}-err`} message={firstError(fieldErrors, `fonts.${key}`)} />
                </div>
              );
            })}
          </div>
          <p className="field-hint">
            Polices disponibles dans PowerPoint et Canva. L&apos;aperçu les affiche si elles sont installées sur votre
            appareil.
          </p>
        </fieldset>

        <fieldset>
          <legend className="field-label">Logo</legend>
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
              <label className="btn btn-secondary btn-sm focus-within:outline-2 focus-within:outline-accent">
                {brand.logoDataUrl ? "Remplacer le logo" : "Choisir un logo"}
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
                <button
                  type="button"
                  className="btn btn-danger-ghost btn-sm"
                  onClick={() => {
                    setBrand((b) => ({ ...b, logoDataUrl: null }));
                    setStatus(IDLE);
                    fileRef.current?.focus();
                  }}
                >
                  Retirer le logo
                </button>
              ) : null}
            </div>
          </div>
          <p id={`${baseId}-logo-hint`} className="field-hint">
            PNG ou JPEG, 500 Ko au plus. Un fond transparent (PNG) s&apos;intègre mieux.
          </p>
          <div role="alert">
            <FieldError id={`${baseId}-logo-err`} message={logoError ?? firstError(fieldErrors, "logoDataUrl")} />
          </div>
        </fieldset>

        <div className="sticky bottom-0 -mx-1 flex flex-col gap-2 border-t border-border bg-bg/95 px-1 py-3 backdrop-blur">
          <FormStatus state={status} />
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? "Enregistrement…" : "Enregistrer la charte"}
            </button>
            {dirty ? (
              <>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setBrand(saved);
                    setFieldErrors({});
                    setStatus(IDLE);
                  }}
                  disabled={pending}
                >
                  Annuler les modifications
                </button>
                <span className="text-sm text-muted">Modifications non enregistrées</span>
              </>
            ) : null}
          </div>
        </div>
      </form>

      <section aria-labelledby={`${baseId}-preview`} className="lg:sticky lg:top-4 lg:self-start">
        <h2 id={`${baseId}-preview`} className="text-lg font-semibold">
          Aperçu
        </h2>
        <p className="text-sm text-muted">Mis à jour en direct, avant même l&apos;enregistrement.</p>
        <ul className="mt-4 grid gap-4 sm:grid-cols-2">
          {SAMPLE_SLIDES.map(({ label, slide }, i) => (
            <li key={label}>
              <SlidePreview slide={slide} brand={brand} format={format} number={i + 1} decorative />
              <p className="mt-1.5 text-sm text-muted">Diapo {label.toLowerCase()}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
