"use client";

import { Icon, Sidebar, SidebarItem, SidebarItems, SidebarToggle, type OpaleIconName } from "@thomascaron/opale-ui";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/** Les parties de la page Paramètres : `id` = celui du titre (h2) de la section. */
export const TOC_SECTIONS: readonly { id: string; label: string; icon: OpaleIconName }[] = [
  { id: "moteur", label: "Moteur de rédaction", icon: "sparkle" },
  { id: "cle-api", label: "Clé API Anthropic", icon: "key" },
  { id: "apparence", label: "Apparence", icon: "palette" },
];

const LABELS = { items: "Sommaire des paramètres", expand: "Déplier le sommaire", collapse: "Replier le sommaire" };
const STORAGE_KEY = "grand-oral-studio:sommaire-replie";
const CHANGE_EVENT = "grand-oral-studio:sommaire-change";

/* État plié mémorisé : localStorage (try/catch), lu comme un magasin externe. */
function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
function writeCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    // Stockage indisponible : l'état vit le temps de la page.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
function subscribeCollapsed(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

function atBottom(): boolean {
  const root = document.documentElement;
  return root.scrollHeight > root.clientHeight && window.scrollY + window.innerHeight >= root.scrollHeight - 2;
}

function sectionOf(id: string): HTMLElement | null {
  return document.getElementById(id)?.closest("section") ?? null;
}

/**
 * Sommaire de la page Paramètres : le `Sidebar` d'Opale, pliable
 * (`SidebarToggle` : `aria-expanded` + `aria-controls`), entrées-liens vers
 * les sections. L'entrée active (`aria-current`, posé par Opale) suit la
 * section visible ; un clic fait défiler jusqu'à la section (sans animation
 * si l'utilisateur limite les mouvements), place le focus sur son titre et
 * inscrit le fragment dans l'URL.
 */
export function SettingsToc() {
  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
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
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    lockUntil.current = Date.now() + 800;
    setActive(id);
    section.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    heading.focus({ preventScroll: true });
    window.history.replaceState(null, "", `#${id}`);
  }

  return (
    <Sidebar
      collapsible
      collapsed={collapsed}
      onCollapsedChange={writeCollapsed}
      value={active}
      onNavigate={(item) => goTo(item.id)}
      labels={LABELS}
      className="settings-toc"
      data-collapsed={collapsed || undefined}
    >
      <div className="flex items-center justify-between gap-2 px-1">
        {collapsed ? null : <p className="eyebrow">Sommaire</p>}
        <SidebarToggle />
      </div>
      <SidebarItems>
        {TOC_SECTIONS.map((s) => (
          <SidebarItem key={s.id} itemId={s.id} href={`#${s.id}`} icon={<Icon name={s.icon} />}>
            {s.label}
          </SidebarItem>
        ))}
      </SidebarItems>
    </Sidebar>
  );
}
