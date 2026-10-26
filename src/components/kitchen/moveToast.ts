import { toast } from 'sonner';

/** Los avisos de "fue a tal lado" duran más que el resto: dan tiempo a leer y a deshacer. */
export const MOVE_TOAST_DURATION_MS = 3_500;

/** Aviso de un movimiento entre Compras y Stock, con el botón para volverlo atrás. */
export const toastMove = (message: string, undoLabel: string, onUndo: () => void) =>
  toast(message, {
    duration: MOVE_TOAST_DURATION_MS,
    action: { label: undoLabel, onClick: onUndo },
  });
