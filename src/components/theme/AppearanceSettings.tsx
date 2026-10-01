"use client";

import { RadioGroup } from "@thomascaron/opale-ui";
import type { ThemePreference } from "./theme";
import { useTheme } from "./ThemeProvider";

const OPTIONS: { value: ThemePreference; label: string; description: string }[] = [
  { value: "light", label: "Clair", description: "Fond papier, encre sombre." },
  { value: "dark", label: "Sombre", description: "Fond sombre, pour les salles peu éclairées." },
  { value: "system", label: "Système", description: "Suit le réglage de votre appareil." },
];

function isPreference(value: string): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

/**
 * Choix Clair / Sombre / Système, synchronisé avec le bouton de l'en-tête
 * (même préférence, tenue par `ThemeProvider`). Le changement est immédiat et
 * mémorisé, sans bouton d'enregistrement.
 */
export function AppearanceSettings() {
  const { theme, setTheme } = useTheme();
  return (
    <RadioGroup
      label="Thème de l'interface"
      name="theme"
      options={OPTIONS}
      value={theme}
      onValueChange={(value) => {
        if (isPreference(value)) setTheme(value);
      }}
    />
  );
}
