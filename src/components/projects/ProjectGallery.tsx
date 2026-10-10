"use client";

import { Button, Icon } from "@thomascaron/opale-ui";
import { useId, useState, type ReactNode } from "react";
import { SelectInput, TextInput } from "@/components/ui/Field";
import { plural } from "@/components/ui/format";
import styles from "./project-gallery.module.css";

const FILTERS = [
  { value: "all", label: "Tous" },
  { value: "preparing", label: "En préparation" },
  { value: "ready", label: "Prêts" },
  { value: "shared", label: "Partagés" },
] as const;
type Filter = typeof FILTERS[number]["value"];

export interface GalleryItem {
  id: string;
  name: string;
  searchText: string;
  updatedAt: number;
  ready: boolean;
  shared: boolean;
  /** Aperçu et actions rendus par le serveur ; seules les métadonnées sont filtrées côté client. */
  card: ReactNode;
}

function searchable(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("fr").trim();
}

export function ProjectGallery({ items, writerLabel }: { items: GalleryItem[]; writerLabel: string | null }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState("recent");
  const id = useId();
  const terms = searchable(query).split(/\s+/).filter(Boolean);
  const visible = items.filter((item) => {
    const matchesFilter = filter === "all" || (filter === "ready" && item.ready)
      || (filter === "preparing" && !item.ready) || (filter === "shared" && item.shared);
    const text = searchable(item.searchText);
    return matchesFilter && terms.every((term) => text.includes(term));
  }).sort((a, b) => {
    const order = sort === "name"
      ? a.name.localeCompare(b.name, "fr", { sensitivity: "base", numeric: true })
      : b.updatedAt - a.updatedAt;
    return order || a.id.localeCompare(b.id);
  });

  return (
    <div className={styles.gallery}>
      <div className={styles.toolbar}>
        <div role="group" aria-label="Filtrer les projets" className={styles.filters}>
          {FILTERS.map(({ value, label }) => (
            <button key={value} type="button" className={styles.filter} aria-pressed={filter === value} onClick={() => setFilter(value)}>
              {label}
            </button>
          ))}
        </div>
        <div className={styles.controls}>
          <div className={styles.search}>
            <label className="sr-only" htmlFor={`${id}-search`}>Rechercher un projet</label>
            <Icon name="search" className={styles.searchIcon} />
            <TextInput id={`${id}-search`} type="search" placeholder="Rechercher un projet…" value={query} onChange={(event) => setQuery(event.target.value)} shellClassName={styles.searchShell} className={styles.searchInput} autoComplete="off" />
          </div>
          <label className="sr-only" htmlFor={`${id}-sort`}>Trier les projets</label>
          <div className={styles.sort}>
            <SelectInput id={`${id}-sort`} value={sort} onChange={(event) => setSort(event.target.value)} shellClassName={styles.sortShell}>
              <option value="recent">Dernière modification</option>
              <option value="name">Nom du projet</option>
            </SelectInput>
            <Icon name="chevron-down" className={styles.sortArrow} aria-hidden="true" />
          </div>
        </div>
      </div>
      <div className={styles.context}>
        <p role="status" aria-label="Nombre de projets" aria-live="polite" aria-atomic="true" className="num">
          {terms.length || filter !== "all" ? `${plural(visible.length, "projet")} sur ${items.length}` : plural(items.length, "projet")}
        </p>
        {writerLabel ? <p>Rédaction : {writerLabel}</p> : null}
      </div>
      {visible.length ? (
        <ul className={styles.grid} aria-label="Galerie des projets">{visible.map((item) => item.card)}</ul>
      ) : (
        <div className={styles.noResults}>
          <Icon name="search" />
          <h3>Aucun projet trouvé</h3>
          <p>Essayez un autre nom ou modifiez les filtres.</p>
          <Button variant="ghost" size="small" onClick={() => { setQuery(""); setFilter("all"); }}>Réinitialiser les filtres</Button>
        </div>
      )}
    </div>
  );
}
