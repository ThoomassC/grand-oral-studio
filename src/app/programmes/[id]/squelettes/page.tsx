import type { Metadata } from "next";
import { SkeletonBoard, type SkeletonThemeItem } from "@/components/skeletons/SkeletonBoard";
import { formatDateTime } from "@/components/ui/format";
import { loadProgram } from "../../_lib/load";

export async function generateMetadata({ params }: PageProps<"/programmes/[id]/squelettes">): Promise<Metadata> {
  const program = await loadProgram((await params).id);
  return { title: `Squelettes — ${program.name}` };
}

export default async function SkeletonsPage({ params }: PageProps<"/programmes/[id]/squelettes">) {
  const program = await loadProgram((await params).id);
  // DTO minimal : on n'envoie pas les specs complètes au client, seulement la couverture.
  const themes: SkeletonThemeItem[] = program.themes.map((t) => {
    const cover = t.skeleton?.spec.slides[0];
    return {
      id: t.id,
      name: t.name,
      skeleton:
        t.skeleton && cover
          ? {
              deckId: t.skeleton.id,
              slideCount: t.skeleton.spec.slides.length,
              updatedAtLabel: `mis à jour le ${formatDateTime(t.skeleton.updatedAt)}`,
              cover: { layout: cover.layout, title: cover.title, subtitle: cover.subtitle, bullets: cover.bullets },
            }
          : null,
    };
  });

  return (
    <SkeletonBoard
      programId={program.id}
      themes={themes}
      brand={{ colors: program.brand.colors, fonts: program.brand.fonts, logoDataUrl: program.brand.logoDataUrl }}
      format={program.template.format}
    />
  );
}
