import { clsx } from 'clsx';
import { ChartPieIcon, ChevronRightIcon } from 'lucide-react';
import Link from 'next/link';
import React from 'react';

import { EntityAvatar } from '~/components/ui/avatar';
import { Card } from '~/components/ui/card';
import { SectionLabel } from '~/components/ui/section-label';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { type BalanceCard, balanceSentence } from '~/lib/balanceCards';
import { BigMath } from '~/utils/numbers';

const BalanceCardItem: React.FC<{ card: BalanceCard; wide: boolean }> = ({ card, wide }) => {
  const { t, displayName, getCurrencyHelpersCached } = useTranslationWithUtils();
  const sentence = balanceSentence(card);
  const tone =
    0n < card.amount ? 'text-positive' : 0n > card.amount ? 'text-negative' : 'text-foreground';

  return (
    <li className={clsx('min-w-0', wide && 'col-span-2')}>
      <Link
        href={card.href}
        className="focus-visible:ring-ring rounded-card block h-full focus-visible:ring-2 focus-visible:outline-none"
      >
        <Card className="flex h-full flex-col gap-2 active:opacity-80">
          <div className="flex min-w-0 items-center gap-2">
            <EntityAvatar entity={card} size={22} />
            <span className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">
              {card.name}
            </span>
            {card.currency ? (
              <span className="text-muted-foreground shrink-0 text-[0.6875rem] font-semibold tracking-wider">
                {card.currency}
              </span>
            ) : null}
          </div>
          {0n === card.amount ? (
            <p className="text-foreground text-xl leading-tight font-semibold">
              {t('home_summary.balance.settled')}
            </p>
          ) : (
            <p className={clsx('text-xl leading-tight font-semibold tabular-nums', tone)}>
              {getCurrencyHelpersCached(card.currency!).toUIString(BigMath.abs(card.amount))}
            </p>
          )}
          <p className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs leading-snug">
            {/* Casa: la carita de la otra persona del saldo (su foto, o su inicial). */}
            {card.counterpart ? (
              <EntityAvatar entity={card.counterpart} size={16} className="shrink-0" />
            ) : null}
            <span className="min-w-0">
              {'settled' === sentence
                ? t('home_summary.balance.settled_subtitle')
                : t(`home_summary.balance.${sentence}`, {
                    name: card.counterpart ? displayName(card.counterpart) : '',
                  })}
            </span>
          </p>
        </Card>
      </Link>
    </li>
  );
};

export interface SpentSummary {
  total: bigint;
  mine: bigint;
  currency: string;
}

/**
 * Lo gastado en el mes por todo el hogar, en la moneda elegida, con la parte del usuario abajo.
 * Va primera en la grilla de Saldos y lleva a Estadísticas.
 */
const SpentCardItem: React.FC<{ spent: SpentSummary; wide: boolean }> = ({ spent, wide }) => {
  const { t, getCurrencyHelpersCached } = useTranslationWithUtils();
  const helpers = getCurrencyHelpersCached(spent.currency);

  return (
    <li className={clsx('min-w-0', wide && 'col-span-2')}>
      <Link
        href="/stats"
        className="focus-visible:ring-ring rounded-card block h-full focus-visible:ring-2 focus-visible:outline-none"
      >
        <Card className="flex h-full flex-col gap-2 active:opacity-80">
          <div className="flex min-w-0 items-center gap-2">
            <span className="bg-primary-soft text-primary flex size-[22px] shrink-0 items-center justify-center rounded-full">
              <ChartPieIcon className="size-3.5" />
            </span>
            <span className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">
              {t('dashboard.spent.title')}
            </span>
            <ChevronRightIcon className="text-primary size-4 shrink-0" />
          </div>
          <p className="text-foreground text-xl leading-tight font-semibold tabular-nums">
            {helpers.toUIString(spent.total)}
          </p>
          <p className="text-muted-foreground text-xs leading-snug">
            {t('home_summary.your_share', { amount: helpers.toUIString(spent.mine) })}
          </p>
        </Card>
      </Link>
    </li>
  );
};

/**
 * Saldos de Inicio en una grilla de dos columnas: primero lo gastado en el mes y después una
 * tarjeta por grupo y moneda. Si la cantidad es impar, la primera ocupa el ancho completo para que
 * la grilla no quede coja.
 */
export const BalanceCards: React.FC<{ cards: BalanceCard[]; spent?: SpentSummary }> = ({
  cards,
  spent,
}) => {
  const { t } = useTranslationWithUtils();
  const count = cards.length + (spent ? 1 : 0);

  if (0 === count) {
    return null;
  }

  const firstIsWide = 1 === count % 2;

  return (
    <section className="flex flex-col gap-2">
      <SectionLabel className="px-1">{t('home_summary.balances_title')}</SectionLabel>
      <ul className="grid grid-cols-2 gap-3">
        {spent ? <SpentCardItem spent={spent} wide={firstIsWide} /> : null}
        {cards.map((card, index) => (
          <BalanceCardItem key={card.key} card={card} wide={firstIsWide && !spent && 0 === index} />
        ))}
      </ul>
    </section>
  );
};
