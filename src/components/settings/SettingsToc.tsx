"use client";

import { Icon, Sidebar, SidebarGroup, SidebarItem, SidebarItems, type OpaleIconName } from "@thomascaron/opale-ui";
import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "@/components/preferences/store";

/** Les parties de la page Configuration IA : `id` = celui du titre (h2) de la section. */
export const TOC_SECTIONS: readonly { id: string; label: string; icon: OpaleIconName; group: string }[] = [
  { id: "moteur", label: "Moteur de rédaction", icon: "sparkle", group: "Rédaction" },
  { id: "cle-api", label: "Clé API Anthropic", icon: "key", group: "Accès" },
];

/** Les parties du sommaire (`Sidebar.Group`), dans l'ordre des sections. */
const TOC_GROUPS = [...new Set(TOC_SECTIONS.map((s) => s.group))].map((title) => ({
  title,
  sections: TOC_SECTIONS.filter((s) => s.group === title),
}));

const LABELS = {
  items: "Sommaire de la configuration IA",
  scroll: "Défilement du sommaire",
  scrollStart: "Début du sommaire",
  resize: "Largeur du sommaire",
  menu: "Sommaire",
  shortcuts: "Parties de la configuration IA",
};

function atBottom(): boolean {
  const root = document.documentElement;
  return root.scrollHeight > root.clientHeight && window.scrollY + window.innerHeight >= root.scrollHeight - 2;
}

function sectionOf(id: string): HTMLElement | null {
  return document.getElementById(id)?.closest("section") ?? null;
}

/**
 * Sommaire de la page Configuration IA : le `Sidebar` d'Opale, comme le
 * sommaire de sa documentation (parties repliables, barre de défilement
 * d'Opale, poignée de largeur, format mobile sous 30 rem), sans titre ni
 * bouton de pli (la poignée suffit à régler la place), entrées-liens vers les
 * sections. L'entrée active (`aria-current`, posé par Opale) suit la
 * section visible ; un clic fait défiler jusqu'à la section (sans animation si
 * l'utilisateur limite les mouvements, sur son appareil ou dans Réglages),
 * place le focus sur son titre et inscrit le fragment dans l'URL.
 */
export function SettingsToc() {
  const [active, setActive] = useState<string>(TOC_SECTIONS[0]!.id);
  // Pendant un défilement lancé par un clic, l'observateur ne doit pas reprendre la main.
  const lockUntil = useRef(0);

  // Synchronisation avec le DOM : l'observateur des sections visibles.
  useEffect(() => {
    const ids = new Map<Element, string>();
    for (const s of TOC_SECTIONS) {
      const section = sectionOf(s.id);
      if (section) ids.set(section, s.id);
    }
    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target && ids.get(entry.target);
          if (!id) continue;
          if (entry.isIntersecting) visible.set(id, entry.boundingClientRect?.top ?? 0);
          else visible.delete(id);
        }
        if (Date.now() < lockUntil.current || atBottom()) return;
        if (visible.size === 0) return;
        const top = [...visible.entries()].sort((a, b) => a[1] - b[1])[0]![0];
        setActive(top);
      },
      { rootMargin: "-15% 0px -55% 0px" },
    );
    for (const section of ids.keys()) observer.observe(section);
    // En bas de page, la dernière partie ne peut pas atteindre la bande observée : on la retient.
    const onScroll = () => {
      if (Date.now() >= lockUntil.current && atBottom()) setActive(TOC_SECTIONS[TOC_SECTIONS.length - 1]!.id);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  function goTo(id: string) {
    const section = sectionOf(id);
    const heading = document.getElementById(id);
    if (!section || !heading) return;
    const reduced = prefersReducedMotion();
    lockUntil.current = Date.now() + 800;
    setActive(id);
    section.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    heading.focus({ preventScroll: true });
    window.history.replaceState(null, "", `#${id}`);
  }

  return (
    <Sidebar
      value={active}
      onNavigate={(item) => goTo(item.id)}
      labels={LABELS}
      customScrollbar
      resizable
      mobile="auto"
      className="settings-toc"
      rootClassName="settings-toc__root"
    >
      <SidebarItems>
        {TOC_GROUPS.map((g) => (
          <SidebarGroup key={g.title} title={g.title}>
            {g.sections.map((s) => (
              <SidebarItem key={s.id} itemId={s.id} href={`#${s.id}`} icon={<Icon name={s.icon} />}>
                {s.label}
              </SidebarItem>
            ))}
          </SidebarGroup>
        ))}
      </SidebarItems>
    </Sidebar>
  );
}
