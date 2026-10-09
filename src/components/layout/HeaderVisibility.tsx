"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** La connexion et sa transition possèdent leur propre en-tête. */
export function HeaderVisibility({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/connexion" || pathname === "/connexion/chargement") return null;
  return children;
}
