"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { usePreferences } from "@/components/preferences/store";

const IMMERSIVE_ROUTES = new Set(["/", "/connexion", "/connexion/chargement"]);

/** Une arrivée discrète, sans remontage du contenu ni attente ajoutée à la navigation. */
export function ContentMotion({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const previousPath = useRef<string | null>(null);
  const pathname = usePathname();
  const { motion } = usePreferences();

  useEffect(() => {
    const navigated = previousPath.current !== pathname;
    previousPath.current = pathname;
    const element = root.current;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (!navigated || !element?.animate || media.matches || motion === "reduced" || document.documentElement.dataset.motion === "reduced" || IMMERSIVE_ROUTES.has(pathname)) return;

    const animation = element.animate([
      { opacity: 0.65, transform: "translateY(8px)" },
      { opacity: 1, transform: "translateY(0)" },
    ], { duration: 440, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
    const finish = () => animation.cancel();
    const onPreferenceChange = () => { if (media.matches) finish(); };
    animation.onfinish = finish;
    // Un utilisateur au clavier doit trouver un contrôle stable dès son premier focus.
    element.addEventListener("focusin", finish);
    media.addEventListener("change", onPreferenceChange);
    return () => {
      finish();
      element.removeEventListener("focusin", finish);
      media.removeEventListener("change", onPreferenceChange);
    };
  }, [pathname, motion]);

  return <div ref={root} className="studio-content">{children}</div>;
}
