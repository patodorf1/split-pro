import { ArrowRightIcon, ArrowRightLeft, Check } from 'lucide-react';
import { type PropsWithChildren, useCallback, useMemo } from 'react';

import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { resolveTransferReceiver } from '~/lib/settlement';
import { cn } from '~/lib/utils';
import { type EntryMode, type Participant, useAddExpenseStore } from '~/store/addStore';

import { SegmentedControl } from '../dashboard/SegmentedControl';
import { EntityAvatar } from '../ui/avatar';
import { Button } from '../ui/button';
import { AppDrawer, AppDrawerClose } from '../ui/drawer';
import { PayerSelector } from './PayerSelector';

/**
 * Gasto o Transferencia. La transferencia es el mismo movimiento que "Saldar cuentas": baja el
 * saldo pero no suma a los totales del mes.
 */
export const EntryModeToggle: React.FC<{ className?: string }> = ({ className }) => {
  const { t } = useTranslationWithUtils();
  const entryMode = useAddExpenseStore((s) => s.entryMode);
  const { setEntryMode } = useAddExpenseStore((s) => s.actions);

  const options = useMemo(
    () => [
      { value: 'EXPENSE' as const, label: t('transfer.mode_expense') },
      { value: 'TRANSFER' as const, label: t('transfer.mode_transfer') },
    ],
    [t],
  );

  const onChange = useCallback((value: EntryMode) => setEntryMode(value), [setEntryMode]);

  return (
    <SegmentedControl
      options={options}
      value={entryMode}
      onChange={onChange}
      label={t('transfer.mode_label')}
      size="sm"
      className={className}
    />
  );
};

const ReceiverRow = ({ p, isReceiving }: { p: Participant; isReceiving: boolean }) => {
  const { displayName } = useTranslationWithUtils();
  const currentUser = useAddExpenseStore((s) => s.currentUser);
  const { setTransferTo } = useAddExpenseStore((s) => s.actions);

  const onClick = useCallback(() => setTransferTo(p.id), [p.id, setTransferTo]);

  return (
    <AppDrawerClose className="flex items-center justify-between px-2" onClick={onClick}>
      <div className="flex min-w-0 items-center gap-1">
        <EntityAvatar entity={p} size={30} />
        <p className="ml-4 truncate">{displayName(p, currentUser?.id)}</p>
      </div>
      {isReceiving ? <Check className="text-primary h-6 w-6" /> : null}
    </AppDrawerClose>
  );
};

/** Selector de destinatario, solo hace falta cuando hay tres o más participantes. */
const ReceiverSelectionForm: React.FC<PropsWithChildren> = ({ children }) => {
  const { t } = useTranslationWithUtils();
  const participants = useAddExpenseStore((s) => s.participants);
  const paidBy = useAddExpenseStore((s) => s.paidBy);
  const transferToId = useAddExpenseStore((s) => s.transferToId);

  return (
    <AppDrawer
      trigger={children}
      title={t('transfer.pick_receiver')}
      className="h-[70vh]"
      shouldCloseOnAction
    >
      <div className="flex flex-col gap-6 overflow-auto">
        {participants
          .filter((p) => p.id !== paidBy?.id)
          .map((participant) => (
            <ReceiverRow
              key={participant.id}
              p={participant}
              isReceiving={participant.id === transferToId}
            />
          ))}
      </div>
    </AppDrawer>
  );
};

const PersonBadge: React.FC<{ user?: Participant; fallback: string }> = ({ user, fallback }) => {
  const { displayName } = useTranslationWithUtils();
  const currentUser = useAddExpenseStore((s) => s.currentUser);

  return (
    <div className="flex min-w-0 flex-col items-center gap-1">
      {user ? (
        <EntityAvatar entity={user} size={40} />
      ) : (
        <div className="border-border size-10 rounded-full border border-dashed" />
      )}
      <span className="text-muted-foreground max-w-24 truncate text-xs">
        {user ? displayName(user, currentUser?.id) : fallback}
      </span>
    </div>
  );
};

/**
 * Quién transfiere y quién recibe. Con dos personas se resuelve solo (el otro es el que recibe) y
 * el botón del medio da vuelta el sentido; con tres o más hay que elegir las dos puntas.
 */
export const TransferDirection: React.FC<{ className?: string }> = ({ className }) => {
  const { t } = useTranslationWithUtils();
  const participants = useAddExpenseStore((s) => s.participants);
  const paidBy = useAddExpenseStore((s) => s.paidBy);
  const transferToId = useAddExpenseStore((s) => s.transferToId);
  const { swapTransferDirection } = useAddExpenseStore((s) => s.actions);

  const receiver = resolveTransferReceiver(participants, paidBy?.id, transferToId);

  if (2 < participants.length) {
    return (
      <div className={cn('flex flex-col gap-3', className)}>
        <PayerSelector label={t('transfer.sender_label')} />
        <div className="flex flex-col gap-1">
          <span className="section-label">{t('transfer.receiver_label')}</span>
          <ReceiverSelectionForm>
            <Button
              variant="outline"
              className="h-9 w-full justify-start gap-2 rounded-full px-2 text-sm"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                {receiver ? <EntityAvatar entity={receiver} size={20} /> : null}
                <span className="truncate">
                  {receiver ? (
                    <PersonName user={receiver} />
                  ) : (
                    t('transfer.pick_receiver_placeholder')
                  )}
                </span>
              </span>
            </Button>
          </ReceiverSelectionForm>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex items-center justify-center gap-4', className)}>
      <PersonBadge user={paidBy} fallback={t('transfer.sender_label')} />
      <div className="flex flex-col items-center gap-1">
        <ArrowRightIcon className="text-muted-foreground size-5" />
        <Button
          variant="ghost"
          size="sm"
          className="text-primary h-7 gap-1 px-2 text-xs"
          onClick={swapTransferDirection}
          disabled={!receiver}
        >
          <ArrowRightLeft className="size-3.5" />
          {t('transfer.swap')}
        </Button>
      </div>
      <PersonBadge user={receiver} fallback={t('transfer.receiver_label')} />
    </div>
  );
};

const PersonName: React.FC<{ user: Participant }> = ({ user }) => {
  const { displayName } = useTranslationWithUtils();
  const currentUser = useAddExpenseStore((s) => s.currentUser);

  return <>{displayName(user, currentUser?.id)}</>;
};
