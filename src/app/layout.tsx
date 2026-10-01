import type { Metadata } from "next";
import { Atkinson_Hyperlegible_Next, Bricolage_Grotesque } from "next/font/google";
import { SiteHeader } from "@/components/layout/SiteHeader";
import "./globals.css";

// Titres : Bricolage Grotesque (caractère, sans excentricité).
// Texte : Atkinson Hyperlegible Next, conçue pour la lisibilité — utile le jour J.
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

export const metadata: Metadata = {
  title: {
    default: "Grand Oral Studio",
    template: "%s · Grand Oral Studio",
  },
  description:
    "Préparez votre grand oral : thèmes, charte, diaporamas squelettes et deck final généré le jour J.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${heading.variable} ${body.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <a
          href="#contenu"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-4 focus:py-2 focus:shadow"
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
