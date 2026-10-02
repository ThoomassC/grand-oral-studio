"use client";

import { Button, SegmentedControl, SidePanel, Toggle } from "@thomascaron/opale-ui";
import { useId, useState, useSyncExternalStore } from "react";
import { useTheme } from "@/components/theme/ThemeProvider";
import type { ThemePreference } from "@/components/theme/theme";
import { LiveRegion } from "@/components/ui/LiveRegion";
import { DEFAULT_PREFERENCES, isTextSize, type TextSize } from "./preferences";
import { setPreferences, updatePreferences, usePreferences } from "./store";

const THEME_OPTIONS: readonly { value: ThemePreference; label: string }[] = [
  { value: "light", label: "Clair" },
  { value: "dark", label: "Sombre" },
  { value: "system", label: "Système" },
];

const TEXT_SIZE_OPTIONS: readonly { value: TextSize; label: string }[] = [
  { value: "standard", label: "Standard" },
  { value: "large", label: "Grand" },
  { value: "xlarge", label: "Très grand" },
];

function isThemePreference(value: string): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

/** L'annonce d'un réglage : ce qui a changé, puis s'il est mémorisé (lecteur d'écran). */
function saved(change: string, persisted = true): string {
  return persisted
    ? `${change}. Enregistré.`
    : `${change}, pour cette visite seulement : ce navigateur ne permet pas de le mémoriser.`;
}

/* L'appareil demande-t-il déjà moins d'animations ? (lu comme un magasin externe) */
const DEVICE_REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
function readDeviceReducedMotion(): boolean {
  return window.matchMedia?.(DEVICE_REDUCED_MOTION).matches ?? false;
}
function subscribeDeviceReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia?.(DEVICE_REDUCED_MOTION);
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

/**
 * Panneau « Réglages » (le `SidePanel` d'Opale : dialogue modal, Échap, voile
 * et croix ferment, le focus revient au bouton qui l'a ouvert). Les réglages
 * de l'application, propres à cet appareil, segmentés en blocs titrés.
 * Chaque choix s'applique et se mémorise tout de suite — pas de bouton
 * Enregistrer — et la région polie annonce ce qui a changé.
 *
 * Le thème reste tenu par `ThemeProvider` (même préférence que le bouton
 * soleil / lune) ; taille du texte et animations par le magasin `store.ts`.
 */
export function SiteSettingsPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { theme, setTheme } = useTheme();
  const preferences = usePreferences();
  const deviceReducesMotion = useSyncExternalStore(subscribeDeviceReducedMotion, readDeviceReducedMotion, () => false);
  // `n` change à chaque annonce : un même message répété est relu.
  const [announcement, setAnnouncement] = useState<{ text: string; n: number } | null>(null);
  const ids = {
    intro: useId(),
    appearance: useId(),
    theme: useId(),
    themeHelp: useId(),
    legibility: useId(),
    size: useId(),
    sizeHelp: useId(),
    preview: useId(),
    motion: useId(),
    motionHelp: useId(),
  };

  function announce(text: string) {
    setAnnouncement((previous) => ({ text, n: (previous?.n ?? 0) + 1 }));
  }

  function changeTheme(value: string) {
    if (!isThemePreference(value)) return;
    setTheme(value);
    announce(saved(`Thème : ${THEME_OPTIONS.find((o) => o.value === value)!.label}`));
  }

  function changeTextSize(value: string) {
    if (!isTextSize(value)) return;
    const label = TEXT_SIZE_OPTIONS.find((o) => o.value === value)!.label;
    announce(saved(`Taille du texte : ${label}`, updatePreferences({ textSize: value })));
  }

  function changeMotion(reduced: boolean) {
    const persisted = updatePreferences({ motion: reduced ? "reduced" : "system" });
    announce(saved(reduced ? "Animations réduites" : "Animations selon votre appareil", persisted));
  }

  function reset() {
    setTheme("system");
    const saved = setPreferences(DEFAULT_PREFERENCES);
    announce(saved ? "Réglages par défaut rétablis." : "Réglages par défaut rétablis pour cette visite seulement.");
  }

  return (
    <SidePanel
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setAnnouncement(null);
      }}
      title="Réglages"
      className="site-settings"
      aria-describedby={ids.intro}
    >
      <p id={ids.intro} className="text-sm text-muted">
        Propres à cet appareil, appliqués tout de suite.
      </p>

      <div className="mt-2 flex flex-col">
        <section aria-labelledby={ids.appearance} className="site-settings__block">
          <h3 id={ids.appearance} className="text-lg">
            Apparence
          </h3>
          <p id={ids.theme} className="mt-3 text-sm font-semibold">
            Thème
          </p>
          <SegmentedControl
            className="mt-2"
            aria-labelledby={ids.theme}
            aria-describedby={ids.themeHelp}
            options={THEME_OPTIONS}
            value={theme}
            onValueChange={changeTheme}
          />
          <p id={ids.themeHelp} className="mt-2 text-sm text-muted">
            « Système » suit le réglage de votre appareil. Le bouton soleil / lune de l&apos;en-tête bascule entre clair
            et sombre.
          </p>
        </section>

        <section aria-labelledby={ids.legibility} className="site-settings__block">
          <h3 id={ids.legibility} className="text-lg">
            Lisibilité
          </h3>
          <p id={ids.size} className="mt-3 text-sm font-semibold">
            Taille du texte
          </p>
          <SegmentedControl
            className="mt-2"
            aria-labelledby={ids.size}
            aria-describedby={ids.sizeHelp}
            options={TEXT_SIZE_OPTIONS}
            value={preferences.textSize}
            onValueChange={changeTextSize}
          />
          <p id={ids.sizeHelp} className="mt-2 text-sm text-muted">
            Agrandit tout le texte de l&apos;application, et les marges avec lui.
          </p>
          <figure aria-labelledby={ids.preview} className="mt-3 rounded-lg bg-surface-2 p-3">
            <figcaption id={ids.preview} className="eyebrow">Aperçu</figcaption>
            <p className="mt-1">Comment l&apos;intelligence artificielle transforme-t-elle le travail des organisations ?</p>
          </figure>
        </section>

        <section aria-labelledby={ids.motion} className="site-settings__block">
          <h3 id={ids.motion} className="text-lg">
            Mouvements
          </h3>
          <Toggle
            className="mt-3"
            role="switch"
            label="Réduire les animations"
            aria-describedby={ids.motionHelp}
            checked={preferences.motion === "reduced"}
            onChange={(event) => changeMotion(event.currentTarget.checked)}
          />
          <p id={ids.motionHelp} className="mt-2 text-sm text-muted">
            Coupe transitions, animations et défilements doux. Désactivé, l&apos;application suit le réglage de votre
            appareil.
            {deviceReducesMotion && preferences.motion !== "reduced" ? " Votre appareil réduit déjà les animations." : null}
          </p>
        </section>

        <div className="site-settings__block">
          <Button variant="secondary" onClick={reset}>
            Rétablir les réglages par défaut
          </Button>
          <p className="mt-2 text-sm text-muted">Thème Système, texte standard, animations selon l&apos;appareil.</p>
        </div>
      </div>

      <LiveRegion className="sr-only">
        {announcement ? <span key={announcement.n}>{announcement.text}</span> : null}
      </LiveRegion>
    </SidePanel>
  );
}
