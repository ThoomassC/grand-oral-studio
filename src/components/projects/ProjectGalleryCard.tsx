import { Icon } from "@thomascaron/opale-ui";
import Link from "next/link";
import { ProgramActions } from "@/components/programs/ProgramActions";
import { SlidePreview } from "@/components/slides/SlidePreview";
import { formatDate } from "@/components/ui/format";
import type { ProgramSummary } from "@/server/queries";
import { ProjectProgressSummary } from "./ProjectProgressSummary";
import { projectHomeHref } from "./steps";
import styles from "./project-gallery.module.css";

export function ProjectGalleryCard({ program: p, focusAfterDelete }: { program: ProgramSummary; focusAfterDelete: string[] }) {
  const ready = p.progress.nextStep === null;
  return (
    <li className={styles.card}>
      <Link href={projectHomeHref(p.id)} className={styles.cover} aria-label={`Ouvrir le projet ${p.name}`}>
        <div className={`${styles.slide} ${p.preview.format === "4:3" ? styles.standardSlide : ""}`}>
          <SlidePreview slide={p.preview.slide} brand={p.preview.brand} format={p.preview.format} clamp decorative />
        </div>
      </Link>
      <div className={styles.body}>
        <div className={styles.cardTop}>
          <span className={styles.status} data-ready={ready}>
            {ready ? <Icon name="check-circle" /> : <span className={styles.statusDot} />}
            {ready ? "Prêt pour le jour J" : "En préparation"}
          </span>
          <ProgramActions programId={p.id} programName={p.name} programDescription={p.description} role={p.role} focusAfterDelete={focusAfterDelete} />
        </div>
        <h3 className={styles.title}>
          <Link id={`programme-${p.id}`} href={projectHomeHref(p.id)}>{p.name}</Link>
        </h3>
        {p.description ? <p className={styles.description}>{p.description}</p> : null}
        <dl className={styles.metadata}>
          <div><dt>Sujets :</dt><dd className="num">{p.themeCount}</dd></div>
          <div><dt>Modifié le</dt><dd><time dateTime={p.updatedAt.toISOString()}>{formatDate(p.updatedAt)}</time></dd></div>
        </dl>
      </div>
      <div className={styles.footer}>
        <ProjectProgressSummary programId={p.id} programName={p.name} progress={p.progress} role={p.role} compact />
      </div>
    </li>
  );
}
