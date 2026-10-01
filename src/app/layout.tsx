import type { Metadata } from "next";
import { Atkinson_Hyperlegible_Next, Bricolage_Grotesque, JetBrains_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { parseExplicitTheme, THEME_COOKIE } from "@/components/theme/theme";
import { ThemeScript } from "@/components/theme/ThemeScript";
import "./globals.css";

// Titres : Bricolage Grotesque (caractère, sans excentricité).
// Texte : Atkinson Hyperlegible Next, conçue pour la lisibilité — utile le jour J.
// Compteurs, durées, numéros d'étape : JetBrains Mono, chiffres tabulaires.
const heading = Bricolage_Grotesque({
  variable: "--font-heading",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

const body = Atkinson_Hyperlegible_Next({
  variable: "--font-body",
  subsets: ["latin", "latin-ext"],
  display: "swap",
  // next/font n'a pas les métriques de cette police : repli explicite, sans ajustement automatique.
  adjustFontFallback: false,
  fallback: ["ui-sans-serif", "system-ui", "Arial", "sans-serif"],
});

const code = JetBrains_Mono({
  variable: "--font-code",
  subsets: ["latin", "latin-ext"],
  display: "swap",
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: {
    default: "Grand Oral Studio",
    template: "%s · Grand Oral Studio",
  },
  description:
    "Préparez votre grand oral : thèmes, charte, diaporamas squelettes et deck final généré le jour J.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Choix explicite mémorisé dans le cookie : le serveur rend directement le bon
  // thème. Absent = « Système » (pas d'attribut, le CSS suit prefers-color-scheme).
  // L'app est déjà rendue dynamiquement (session lue dans l'en-tête).
  const theme = parseExplicitTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    // suppressHydrationWarning : le script inline du <head> peut corriger
    // `data-theme` avant l'hydratation (choix présent dans localStorage mais
    // cookie absent ou périmé). React garde alors l'attribut du DOM au lieu de
    // signaler un écart ; l'avertissement ne porte que sur cet élément, pas
    // sur ses enfants.
    <html
      lang="fr"
      data-theme={theme ?? undefined}
      suppressHydrationWarning
      className={`${heading.variable} ${body.variable} ${code.variable} h-full antialiased`}
    >
      <head>
        <ThemeScript />
      </head>
      <body className="flex min-h-full flex-col">
        <a
          href="#contenu"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:shadow-raised"
        >
          Aller au contenu
        </a>
        <SiteHeader />
        <main id="contenu" tabIndex={-1} className="flex flex-1 flex-col focus:outline-none">
          {children}
        </main>
      </body>
    </html>
  );
}
