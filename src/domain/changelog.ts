import { RELEASE_SECTION_LABELS, RELEASE_SECTION_ORDER, type Release } from "./releases";

/**
 * Rendu des notes de version : date lisible (page et CHANGELOG.md) et
 * Markdown de CHANGELOG.md. Pur et déterministe : pas d'Intl, dont la sortie
 * varie selon l'environnement (ICU, fuseau).
 */

const MONTHS = [
  "janvier",
  "février",
  "mars",
  "avril",
  "mai",
  "juin",
  "juillet",
  "août",
  "septembre",
  "octobre",
  "novembre",
  "décembre",
] as const;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** « 4 octobre 2026 », « 1er août 2026 » ; null → « à venir ». Lève sur une date mal formée. */
export function formatReleaseDate(date: string | null): string {
  if (date === null) return "à venir";
  const match = ISO_DATE.exec(date);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  const day = match ? Number(match[3]) : 0;
  if (!match || !month || day < 1 || day > 31) throw new Error(`Date de version invalide : « ${date} » (AAAA-MM-JJ attendu).`);
  return `${day === 1 ? "1er" : day} ${month} ${match[1]}`;
}

const HEADER = [
  "# Notes de version",
  "",
  "<!-- Généré par `npm run changelog` depuis src/domain/releases.ts : ne pas modifier à la main. -->",
];

/** Markdown déterministe de CHANGELOG.md : blocs séparés d'une ligne vide, groupes vides omis, fin par "\n". */
export function renderChangelog(releases: readonly Release[]): string {
  const blocks: string[][] = [HEADER];
  for (const release of releases) {
    blocks.push([`## ${release.version} — ${formatReleaseDate(release.date)}`], [release.summary.trim()]);
    for (const section of RELEASE_SECTION_ORDER) {
      const items = release.changes[section];
      if (!items || items.length === 0) continue;
      blocks.push([`### ${RELEASE_SECTION_LABELS[section]}`], items.map((item) => `- ${item.trim()}`));
    }
  }
  return `${blocks.map((lines) => lines.join("\n")).join("\n\n")}\n`;
}
