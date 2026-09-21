import { z } from 'zod';

/** Contactos de emergencia de la familia: límites y helpers compartidos entre UI y servidor. */
export const MAX_EMERGENCY_NAME_LENGTH = 60;
export const MAX_EMERGENCY_PHONE_LENGTH = 30;
export const MAX_EMERGENCY_NOTE_LENGTH = 120;

/** Sólo dígitos, espacios, "+", "-" y paréntesis (lo que la gente escribe en un teléfono). */
export const EMERGENCY_PHONE_PATTERN = /^[\d\s+()-]*$/;

const collapseSpaces = (value: string) => value.replace(/\s+/g, ' ').trim();

export const emergencyNameSchema = z
  .string()
  .transform(collapseSpaces)
  .pipe(z.string().min(1).max(MAX_EMERGENCY_NAME_LENGTH));

/** Teléfono: puede quedar vacío ("todavía sin número"). */
export const emergencyPhoneSchema = z
  .string()
  .transform(collapseSpaces)
  .pipe(z.string().max(MAX_EMERGENCY_PHONE_LENGTH).regex(EMERGENCY_PHONE_PATTERN));

/** WhatsApp opcional: vacío se guarda como null. */
export const emergencyWhatsappSchema = z
  .string()
  .nullish()
  .transform((value) => collapseSpaces(value ?? ''))
  .pipe(z.string().max(MAX_EMERGENCY_PHONE_LENGTH).regex(EMERGENCY_PHONE_PATTERN))
  .transform((value) => value || null);

/** Nota opcional: vacío se guarda como null. */
export const emergencyNoteSchema = z
  .string()
  .nullish()
  .transform((value) => collapseSpaces(value ?? ''))
  .pipe(z.string().max(MAX_EMERGENCY_NOTE_LENGTH))
  .transform((value) => value || null);

export const emergencyContactFieldsSchema = z.object({
  name: emergencyNameSchema,
  phone: emergencyPhoneSchema,
  whatsapp: emergencyWhatsappSchema,
  note: emergencyNoteSchema,
});

/** Número marcable para un enlace `tel:` ("0810 888-7788" → "08108887788"; conserva el "+"). */
export const dialableNumber = (phone: string) => {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');

  if (!digits) {
    return '';
  }

  return trimmed.startsWith('+') ? `+${digits}` : digits;
};

export const telHref = (phone: string) => {
  const number = dialableNumber(phone);
  return number ? `tel:${number}` : null;
};

/**
 * Enlace de WhatsApp. wa.me pide el número internacional sin "+" ni ceros. Si ya viene con "+",
 * se respeta; si no, se asume un celular de Argentina: "11 5555-1234" / "011 15 5555-1234"
 * → 5491155551234 (se sacan el 0 y el 15 y se agrega el 9 de celular).
 */
export const whatsappHref = (whatsapp: string | null | undefined) => {
  if (!whatsapp) {
    return null;
  }

  const trimmed = whatsapp.trim();
  let digits = trimmed.replace(/\D/g, '');

  if (!digits) {
    return null;
  }

  if (!trimmed.startsWith('+') && !digits.startsWith('54')) {
    digits = digits.replace(/^0/, '');
    // "11 15 5555 1234": el 15 va después del código de área (2 a 4 dígitos).
    if (12 === digits.length) {
      digits = digits.replace(/^(\d{2,4}?)15(\d{6,8})$/, '$1$2');
    }
    digits = `549${digits}`;
  }

  return `https://wa.me/${digits}`;
};
