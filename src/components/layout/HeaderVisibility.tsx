"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** L’accueil et la connexion ont leur propre en-tête ; la transition est immersive. */
export function HeaderVisibility({ children, homeHeader }: { children: ReactNode; homeHeader: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/") return homeHeader;
  if (pathname === "/connexion" || pathname === "/connexion/chargement") return null;
  return children;
}
