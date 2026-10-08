"use client";

import { useSyncExternalStore } from "react";
import { Notice } from "@/components/ui/Notice";
import { deckNoticeKey, parseDeckNotice, type DeckNoticeData } from "./deck-notice";

/**
 * Lecture unique par diaporama et par chargement de page : la clé est effacée à
 * la première lecture, la valeur gardée en mémoire pour les rendus suivants
 * (un instantané stable, exigé par useSyncExternalStore). Un rechargement de la
 * page ne la montre donc plus.
 */
const taken = new Map<string, DeckNoticeData | null>();

function takeDeckNotice(deckId: string): DeckNoticeData | null {
  if (taken.has(deckId)) return taken.get(deckId) ?? null;
  let data: DeckNoticeData | null = null;
  try {
    const key = deckNoticeKey(deckId);
    data = parseDeckNotice(window.sessionStorage.getItem(key));
    window.sessionStorage.removeItem(key);
  } catch {
    data = null;
  }
  taken.set(deckId, data);
  return data;
}

const noopSubscribe = () => () => {};

/**
 * Avertissements de la génération qui vient de produire ce diaporama (qualité,
 * écarts à la trame, nouvelle tentative impossible), affichés une fois en haut
 * de la page du diaporama. Rien côté serveur ni à l'hydratation : l'encart
 * apparaît ensuite, s'il y a quelque chose à dire.
 */
export function DeckNotice({ deckId, className = "" }: { deckId: string; className?: string }) {
  const notice = useSyncExternalStore(noopSubscribe, () => takeDeckNotice(deckId), () => null);
  if (!notice) return null;
  return (
    <Notice tone="warning" title="À relire avant de présenter" className={className}>
      <ul className="mt-1 list-disc pl-5">
        {notice.warnings.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </Notice>
  );
}
