import { SplitType } from '@prisma/client';
import Link from 'next/link';
import React, { useMemo } from 'react';

import { EntityAvatar } from '~/components/ui/avatar';
import { CategoryIcon } from '~/components/ui/categoryIcons';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { findBrand } from '~/lib/brands';
import { cn } from '~/lib/utils';
import { api } from '~/utils/api';

import { BrandLogo } from './BrandLogo';

/** Persona como la mandan las consultas de gastos (alcanza con lo que dibuja el avatar). */
export interface RowPerson {
  id: number;
  name?: string | null;
  email?: string | null;
  image?: string | null;
}

export type RowTone = 'positive' | 'negative' | 'muted';

const TONE_CLASSES: Record<RowTone, string> = {
  positive: 'text-positive',
  negative: 'text-negative',
  muted: 'text-muted-foreground',
};

/** React ya escapa el texto: sin esto, "H&M" se vería "H&amp;M". */
const NO_ESCAPE = { escapeValue: false };

const LEADING_SIZE = 44;
const LEADING_STYLE = { width: LEADING_SIZE, height: LEADING_SIZE };
const PAYER_SIZE = 20;

/**
 * Fecha corta de las filas: "30 sept" (o "Sep 30" en inglés). El año aparece solo si no es el
 * actual: "30 sept 2024".
 */
export const formatRowDate = (date: Date, locale: string, now: Date = new Date()): string => {
  const withYear = date.getFullYear() !== now.getFullYear();
  const parts = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : null),
  }).formatToParts(date);

  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value.replace('.', '') ?? '';

  if (locale.startsWith('es')) {
    return [part('day'), part('month'), withYear ? part('year') : ''].filter(Boolean).join(' ');
  }

  return parts
    .map((p) => p.value)
    .join('')
    .replace('.', '');
};

/**
 * Círculo de la izquierda: el logo de la marca si el nombre nombra una conocida; si no, el emoji de
 * la categoría sobre un fondo suave. Abajo a la derecha, la carita de quien pagó.
 */
const RowLeading: React.FC<{
  name: string;
  category?: string | null;
  splitType?: SplitType | null;
  payer?: RowPerson | null;
}> = ({ name, category, splitType, payer }) => {
  const isPlainExpense =
    SplitType.SETTLEMENT !== splitType && SplitType.CURRENCY_CONVERSION !== splitType;
  const brand = useMemo(() => (isPlainExpense ? findBrand(name) : null), [isPlainExpense, name]);

  return (
    <span className="relative shrink-0" style={LEADING_STYLE}>
      {brand ? (
        <BrandLogo brand={brand} size={LEADING_SIZE} />
      ) : (
        <span className="bg-muted flex size-full items-center justify-center rounded-full">
          <CategoryIcon
            category={category ?? undefined}
            splitType={splitType ?? undefined}
            size={24}
          />
        </span>
      )}
      {payer ? (
        <span className="ring-card absolute -right-1 -bottom-1 rounded-full ring-2">
          <EntityAvatar entity={payer} size={PAYER_SIZE} />
        </span>
      ) : null}
    </span>
  );
};

/**
 * Fila de gasto, la misma en todas las listas (grupo, amigo, Actividad, Inicio y Estadísticas):
 * logo o emoji con la carita de quien pagó, el nombre y "Pagó Belén · 30 sept", y a la derecha el
 * monto. Debajo del monto puede ir un detalle chico (cuánto prestaste o debés).
 */
export const ExpenseRow: React.FC<{
  href: string;
  title: React.ReactNode;
  /** Nombre del gasto, para buscar la marca (por defecto, el título si es texto). */
  name?: string;
  category?: string | null;
  splitType?: SplitType | null;
  payer?: RowPerson | null;
  /** Texto gris de abajo, sin la fecha (que se agrega sola). */
  subtitle?: React.ReactNode;
  date: Date;
  amount?: React.ReactNode;
  detail?: { text: React.ReactNode; tone: RowTone } | null;
  deleted?: boolean;
  className?: string;
}> = ({
  href,
  title,
  name,
  category,
  splitType,
  payer,
  subtitle,
  date,
  amount,
  detail,
  deleted = false,
  className,
}) => {
  const { i18n } = useTranslationWithUtils();
  const dateLabel = formatRowDate(date, i18n.language);

  return (
    <Link
      href={href}
      className={cn('flex min-w-0 items-center gap-3 py-2.5', deleted && 'opacity-60', className)}
    >
      <RowLeading
        name={name ?? ('string' === typeof title ? title : '')}
        category={category}
        splitType={splitType}
        payer={payer}
      />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'text-foreground truncate text-[15px] leading-tight',
            deleted && 'line-through',
          )}
        >
          {title}
        </p>
        <p
          className={cn(
            'mt-0.5 truncate text-xs',
            deleted ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {subtitle ? (
            <>
              {subtitle}
              {' · '}
            </>
          ) : null}
          {dateLabel}
        </p>
      </div>
      {amount || detail ? (
        <div className="max-w-[45%] shrink-0 text-right">
          {amount ? (
            <p
              className={cn(
                'text-foreground truncate text-[15px] leading-tight tabular-nums',
                deleted && 'line-through',
              )}
            >
              {amount}
            </p>
          ) : null}
          {detail ? (
            <p className={cn('mt-0.5 truncate text-[11px]', TONE_CLASSES[detail.tone])}>
              {detail.text}
            </p>
          ) : null}
        </div>
      ) : null}
    </Link>
  );
};

/**
 * Título de una transferencia: "Belén le pagó a Pato", "Le pagaste a Belén" o "Belén te pagó". El
 * nombre de quien recibe se busca aparte (las listas solo traen a quien pagó).
 */
export const SettlementTitle: React.FC<{
  payer?: RowPerson | null;
  receiverId?: number | null;
  userId: number;
}> = ({ payer, receiverId, userId }) => {
  const { t } = useTranslationWithUtils();
  const receiverQuery = api.user.getUserDetails.useQuery(
    { userId: receiverId ?? 0 },
    { enabled: Boolean(receiverId) && receiverId !== userId },
  );

  const payerName = payer?.name ?? payer?.email ?? '';
  const receiverName = receiverQuery.data?.name ?? receiverQuery.data?.email ?? '';

  if (payer?.id === userId) {
    return (
      <>
        {t('expense_row.settlement.you_paid', { receiver: receiverName, interpolation: NO_ESCAPE })}
      </>
    );
  }

  if (receiverId === userId) {
    return (
      <>{t('expense_row.settlement.paid_you', { payer: payerName, interpolation: NO_ESCAPE })}</>
    );
  }

  return (
    <>
      {t('expense_row.settlement.paid', {
        payer: payerName,
        receiver: receiverName,
        interpolation: NO_ESCAPE,
      })}
    </>
  );
};
