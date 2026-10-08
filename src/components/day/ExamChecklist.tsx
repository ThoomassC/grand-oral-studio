import { Notice } from "@/components/ui/Notice";
import type { ExamChecklistItem } from "@/domain/exam-checklist";

/**
 * Liste « Avant l'examen » en tête du Jour J (mode examen). Tout est fait :
 * l'encart se replie (élément natif details/summary) pour laisser la place au
 * parcours. Composant serveur : aucun état, aucune interaction scriptée.
 */
export function ExamChecklist({ items }: { items: ExamChecklistItem[] }) {
  const remaining = items.filter((i) => !i.done).length;
  const list = (
    <ul className="mt-2 flex flex-col gap-2">
      {items.map((item) => (
        <li key={item.id} className="flex gap-2">
          <span aria-hidden="true" className="w-4 shrink-0 font-bold">
            {item.done ? "✓" : "○"}
          </span>
          <span>
            <span className="sr-only">{item.done ? "Fait : " : "À faire : "}</span>
            {item.label}
            {item.hint ? <span className="block text-sm">{item.hint}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );

  if (remaining === 0) {
    return (
      <Notice tone="success" title="Avant l'examen : tout est prêt">
        <details>
          <summary className="cursor-pointer">Revoir la liste</summary>
          {list}
        </details>
      </Notice>
    );
  }
  return (
    <Notice tone="info" title={`Avant l'examen : ${remaining} point${remaining > 1 ? "s" : ""} à vérifier`}>
      {list}
    </Notice>
  );
}
