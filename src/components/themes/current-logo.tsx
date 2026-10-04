"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Le logo de la charte enregistrée, partagé par les deux modes d'import :
 * conservé quand l'import n'en trouve pas. Une data URL peut peser 500 Ko :
 * posée une fois ici, elle ne traverse la frontière serveur/client qu'une fois.
 */
const CurrentLogoContext = createContext<string | null>(null);

export function CurrentLogoProvider({ logo, children }: { logo: string | null; children: ReactNode }) {
  return <CurrentLogoContext.Provider value={logo}>{children}</CurrentLogoContext.Provider>;
}

export function useCurrentLogo(): string | null {
  return useContext(CurrentLogoContext);
}
