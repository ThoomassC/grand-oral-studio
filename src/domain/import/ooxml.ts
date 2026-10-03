/**
 * Petits utilitaires de lecture XML Office (OOXML) par expressions ciblées :
 * aucun parseur, aucune résolution d'entité externe. Les appelants ont déjà
 * refusé toute DTD et borné la taille du XML.
 */

/** Préfixe d'espace de noms quelconque (a:, p:, ou aucun). */
export const NS = "(?:[A-Za-z][\\w.-]*:)?";

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|amp|lt|gt|quot|apos);/g, (_, e: string) => {
    if (e === "amp") return "&";
    if (e === "lt") return "<";
    if (e === "gt") return ">";
    if (e === "quot") return '"';
    if (e === "apos") return "'";
    const code = e.startsWith("#x") ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
}

export function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? decodeEntities(m[1] ?? "") : null;
}

/** « 4472c4 » → « #4472C4 » ; null si ce n'est pas un hexadécimal à 6 chiffres. */
export function hexOf(value: string | null): string | null {
  return value && /^[0-9a-fA-F]{6}$/.test(value) ? `#${value.toUpperCase()}` : null;
}

export interface XmlElement {
  /** Attributs bruts de la balise ouvrante. */
  attrs: string;
  /** Contenu entre les balises ; null pour un élément auto-fermant. */
  inner: string | null;
  /** Position de « < » et position juste après la balise fermante. */
  start: number;
  end: number;
}

/**
 * Éléments `name` (préfixe quelconque) d'un fragment, en UN passage linéaire :
 * chaque balise fermante est cherchée par indexOf à partir de l'ouvrante, et
 * le parcours reprend après elle. Une ouvrante jamais fermée arrête le
 * parcours (au lieu de rebalayer la fin du texte à chaque occurrence, ce que
 * ferait une expression `[\s\S]*?</x>` globale : coût quadratique sur un XML
 * piégé). Ne gère pas l'imbrication d'un élément dans lui-même, absente des
 * éléments OOXML lus ici.
 */
export function* elements(xml: string, name: string): Generator<XmlElement> {
  const open = new RegExp(`<(${NS})${name}\\b([^<>]*?)(/?)>`, "g");
  for (let m = open.exec(xml); m; m = open.exec(xml)) {
    const [tag, prefix = "", attrs = "", selfClosing] = m;
    if (selfClosing) {
      yield { attrs, inner: null, start: m.index, end: m.index + tag.length };
      continue;
    }
    const close = `</${prefix}${name}>`;
    const at = xml.indexOf(close, open.lastIndex);
    if (at < 0) return;
    yield { attrs, inner: xml.slice(open.lastIndex, at), start: m.index, end: at + close.length };
    open.lastIndex = at + close.length;
  }
}

/** Premier élément `name` non auto-fermant : son contenu, ou null. */
export function firstInner(xml: string, name: string): string | null {
  for (const el of elements(xml, name)) if (el.inner !== null) return el.inner;
  return null;
}

/** Le fragment privé des éléments `name` (auto-fermants compris). */
export function withoutElements(xml: string, name: string): string {
  let out = "";
  let from = 0;
  for (const el of elements(xml, name)) {
    out += xml.slice(from, el.start);
    from = el.end;
  }
  return out + xml.slice(from);
}
