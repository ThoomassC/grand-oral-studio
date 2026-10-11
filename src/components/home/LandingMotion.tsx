"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePreferences } from "@/components/preferences/store";

/** Le contenu reste visible sans JavaScript ; seules les sections encore hors écran sont animées. */
export function LandingMotion({ children, className }: { children: ReactNode; className: string }) {
  const root = useRef<HTMLDivElement>(null);
  const { motion } = usePreferences();

  useEffect(() => {
    const sections = Array.from(root.current?.querySelectorAll<HTMLElement>("[data-reveal]") ?? []);
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let observer: IntersectionObserver | undefined;

    const showAll = () => {
      observer?.disconnect();
      sections.forEach((section) => section.removeAttribute("data-reveal-state"));
    };

    const observe = () => {
      showAll();
      if (motion === "reduced" || media.matches || !window.IntersectionObserver) return;

      observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          (entry.target as HTMLElement).dataset.revealState = "visible";
          observer?.unobserve(entry.target);
        });
      }, { threshold: 0.08 });

      sections.forEach((section) => {
        if (section.getBoundingClientRect().top < window.innerHeight) return;
        section.dataset.revealState = "waiting";
        observer!.observe(section);
      });
    };

    observe();
    media.addEventListener("change", observe);
    return () => {
      media.removeEventListener("change", observe);
      showAll();
    };
  }, [motion]);

  return <div ref={root} className={className}>{children}</div>;
}
