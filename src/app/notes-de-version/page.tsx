import { Badge } from "@thomascaron/opale-ui";
import type { Metadata } from "next";
import { formatReleaseDate } from "@/domain/changelog";
import { RELEASES, RELEASE_SECTION_LABELS, RELEASE_SECTION_ORDER, type ReleaseSection } from "@/domain/releases";

export const metadata: Metadata = {
  title: "Notes de version",
  description: "Ce qui change dans Grand Oral Studio, version après version.",
};

/** Teinte du titre de chaque groupe : un repère en plus du libellé, jamais le seul. */
const SECTION_TONE: Record<ReleaseSection, string> = {
  added: "text-success",
  changed: "text-accent-strong",
  removed: "text-warning",
  fixed: "text-muted",
};

/**
 * Notes de version : page publique (hors `matcher` de src/proxy.ts), sans
 * donnée utilisateur ni lecture de session. Même source que CHANGELOG.md
 * (src/domain/releases.ts).
 */
export default function ReleaseNotesPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <p className="eyebrow">Grand Oral Studio</p>
      <h1 className="mt-2 text-3xl sm:text-4xl">Notes de version</h1>
      <p className="mt-2 text-muted">Ce qui change à chaque version, de la plus récente à la plus ancienne.</p>

      <ol className="mt-8 flex flex-col">
        {RELEASES.map((release, index) => {
          const headingId = `version-${release.version.replaceAll(".", "-")}`;
          const sections = RELEASE_SECTION_ORDER.flatMap((section) => {
            const items = release.changes[section];
            return items && items.length > 0 ? [{ section, items }] : [];
          });
          return (
            <li key={release.version} className={index > 0 ? "border-t border-border py-6" : "pb-6"}>
              <article aria-labelledby={headingId} className="grid gap-x-6 gap-y-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
                <header className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:flex-col sm:items-start">
                  <h2 id={headingId} className="num text-2xl">
                    {release.version}
                  </h2>
                  {release.date === null ? (
                    <Badge tone="warning">À venir</Badge>
                  ) : (
                    <p className="text-sm text-muted">
                      <time dateTime={release.date}>{formatReleaseDate(release.date)}</time>
                    </p>
                  )}
                </header>
                <div className="flex min-w-0 flex-col gap-4">
                  <p className={sections.length > 0 ? "font-semibold" : undefined}>{release.summary}</p>
                  {sections.map(({ section, items }) => (
                    <section key={section} aria-labelledby={`${headingId}-${section}`}>
                      <h3
                        id={`${headingId}-${section}`}
                        className={`text-xs font-bold uppercase tracking-wider ${SECTION_TONE[section]}`}
                      >
                        {RELEASE_SECTION_LABELS[section]}
                      </h3>
                      <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5">
                        {items.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </section>
                  ))}
                </div>
              </article>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
