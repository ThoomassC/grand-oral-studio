/** Message d'erreur sous un champ, relié par `aria-describedby` (id). */
export function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) return null;
  return (
    <p id={id} className="opale-field__helper opale-field__helper--error">
      <span aria-hidden="true">Erreur : </span>
      {message}
    </p>
  );
}
