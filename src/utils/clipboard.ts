/**
 * Copia texto al portapapeles. Usa la API moderna y, si no está o falla (iOS viejo, contexto no
 * seguro), cae al truco del textarea oculto + `execCommand('copy')`. Devuelve si pudo copiar.
 */
export const copyText = async (text: string): Promise<boolean> => {
  try {
    if ('undefined' !== typeof navigator && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Sigue con el respaldo.
  }

  return copyWithTextarea(text);
};

export const copyWithTextarea = (text: string): boolean => {
  if ('undefined' === typeof document) {
    return false;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  // Fuera de pantalla, sin mover el scroll ni hacer zoom en iOS (font-size >= 16px).
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';
  textarea.style.fontSize = '16px';
  document.body.appendChild(textarea);

  const selection = document.getSelection();
  const previousRange = selection && 0 < selection.rangeCount ? selection.getRangeAt(0) : null;

  try {
    textarea.focus();
    textarea.select();
    // IOS necesita un rango explícito.
    textarea.setSelectionRange(0, text.length);
    // oxlint-disable-next-line typescript/no-deprecated -- respaldo para navegadores viejos
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
    if (previousRange && selection) {
      selection.removeAllRanges();
      selection.addRange(previousRange);
    }
  }
};
