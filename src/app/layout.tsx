import type { Metadata } from "next";
import { opaleThemeScript } from "@thomascaron/opale-ui";
import { cookies } from "next/headers";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { UnsavedChangesBanner, UnsavedChangesProvider } from "@/components/layout/UnsavedChanges";
import { preferencesScript } from "@/components/preferences/preferences";
import { parseExplicitTheme, THEME_COOKIE, THEME_STORAGE_KEY } from "@/components/theme/theme";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { InlineScript } from "@/components/ui/InlineScript";
import "./globals.css";

// Polices : celles d'Opale (Chivo, Bricolage Grotesque), reliées par sa feuille.

export const metadata: Metadata = {
  title: {
    default: "Grand Oral Studio",
    template: "%s · Grand Oral Studio",
  },
  description:
    "Préparez votre grand oral : l'apparence et la trame de vos diaporamas, puis le deck rédigé le jour J.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Choix explicite recopié dans le cookie : le serveur rend directement le bon
  // `data-theme`. Sans cookie (« Système »), le script d'Opale résout le thème
  // avant la première peinture. L'app est déjà rendue dynamiquement (session
  // lue dans l'en-tête).
  const cookieTheme = parseExplicitTheme((await cookies()).get(THEME_COOKIE)?.value);
  const defaultTheme = cookieTheme ?? "system";

  return (
    // suppressHydrationWarning : le script d'Opale pose `data-theme` sur <html>
    // avant l'hydratation (thème système, ou choix mémorisé différent du
    // cookie), le nôtre `data-text-size` et `data-motion` (réglages du site).
    // React garde les attributs du DOM au lieu de signaler un écart ; l'option
    // ne porte que sur cet élément, pas sur ses enfants.
    <html lang="fr" data-theme={cookieTheme ?? undefined} suppressHydrationWarning className="h-full antialiased">
      <head>
        {/* Mêmes options que useOpaleTheme (ThemeProvider), sans quoi script et React divergent. */}
        <InlineScript html={opaleThemeScript({ storageKey: THEME_STORAGE_KEY, defaultTheme })} />
        {/* Taille du texte et animations (panneau Réglages), posées avant la première peinture. */}
        <InlineScript html={preferencesScript()} />
      </head>
      <body className="opale-root flex min-h-full flex-col">
        <ThemeProvider defaultTheme={defaultTheme}>
          <a
            href="#contenu"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:shadow-raised"
          >
            Aller au contenu
          </a>
          {/* La garde « modifications non enregistrées » englobe l'en-tête : logo, onglets et menu du compte. */}
          <UnsavedChangesProvider>
            <SiteHeader />
            <main id="contenu" tabIndex={-1} className="flex flex-1 flex-col focus:outline-none">
              {children}
            </main>
            <UnsavedChangesBanner />
          </UnsavedChangesProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
