import { type User } from '@prisma/client';
import { useCallback, useMemo } from 'react';

import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { cn } from '~/lib/utils';
import { useAddExpenseStore } from '~/store/addStore';

import { SegmentedControl } from '../dashboard/SegmentedControl';
import { EntityAvatar } from '../ui/avatar';
import { Button } from '../ui/button';
import { PayerSelectionForm } from './SplitTypeSection';

/** Avatar + nombre, el contenido de cada opción del control segmentado. */
const PayerOptionLabel: React.FC<{ user: User; currentUserId?: number }> = ({
  user,
  currentUserId,
}) => {
  const { displayName } = useTranslationWithUtils();

  return (
    <span className="flex min-w-0 items-center justify-center gap-1.5">
      <EntityAvatar entity={user} size={20} />
      <span className="truncate">{displayName(user, currentUserId)}</span>
    </span>
  );
};

/**
 * Quién pagó el gasto, siempre a la vista y a un toque.
 *
 * Con dos participantes (el caso de todos los días) muestra un control segmentado con los dos:
 * tocar el otro cambia el pagador sin abrir nada. Con tres o más no entra en un renglón, así que
 * muestra quién pagó y abre el selector de siempre. En los dos casos el estado es el mismo
 * `paidBy` del store, así que editar un gasto ya muestra a quien pagó de verdad.
 */
export const PayerSelector: React.FC<{ className?: string; label?: string }> = ({
  className,
  label: labelOverride,
}) => {
  const { t } = useTranslationWithUtils();
  const participants = useAddExpenseStore((s) => s.participants);
  const paidBy = useAddExpenseStore((s) => s.paidBy);
  const currentUser = useAddExpenseStore((s) => s.currentUser);
  const isNegative = useAddExpenseStore((s) => s.isNegative);
  const { setPaidBy } = useAddExpenseStore((s) => s.actions);

  const label = labelOverride ?? t(isNegative ? 'payer.received' : 'payer.paid');

  const options = useMemo(
    () =>
      participants.map((p) => ({
        value: String(p.id),
        label: <PayerOptionLabel user={p} currentUserId={currentUser?.id} />,
        title: p.name ?? p.email ?? undefined,
      })),
    [participants, currentUser?.id],
  );

  const onChange = useCallback(
    (value: string) => {
      const picked = participants.find((p) => String(p.id) === value);
      if (picked) {
        setPaidBy(picked);
      }
    },
    [participants, setPaidBy],
  );

  if (2 > participants.length || !paidBy) {
    return null;
  }

  if (2 === participants.length) {
    return (
      <div className={cn('flex flex-col gap-1', className)}>
        <span className="section-label">{label}</span>
        <SegmentedControl
          options={options}
          value={String(paidBy.id)}
          onChange={onChange}
          label={label}
          size="sm"
        />
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <span className="section-label">{label}</span>
      <PayerSelectionForm>
        <Button
          variant="outline"
          className="h-9 w-full justify-start gap-2 rounded-full px-2 text-sm"
          aria-label={t('payer.change')}
        >
          <PayerOptionLabel user={paidBy} currentUserId={currentUser?.id} />
        </Button>
      </PayerSelectionForm>
    </div>
  );
};
