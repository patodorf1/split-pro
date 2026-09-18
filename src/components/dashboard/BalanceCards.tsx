import { clsx } from 'clsx';
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
          <p className="text-muted-foreground text-xs leading-snug">
            {'settled' === sentence
              ? t('home_summary.balance.settled_subtitle')
              : t(`home_summary.balance.${sentence}`, {
                  name: card.counterpart ? displayName(card.counterpart) : '',
                })}
          </p>
        </Card>
      </Link>
    </li>
  );
};

/**
 * Saldos de Inicio en una grilla de dos columnas: una tarjeta por grupo y moneda.
 * Si queda una sola tarjeta (o una suelta al final de una cantidad impar), ocupa
 * el ancho completo para que la grilla no quede coja.
 */
export const BalanceCards: React.FC<{ cards: BalanceCard[] }> = ({ cards }) => {
  const { t } = useTranslationWithUtils();

  if (0 === cards.length) {
    return null;
  }

  return (
    <section className="flex flex-col gap-2">
      <SectionLabel className="px-1">{t('home_summary.balances_title')}</SectionLabel>
      <ul className="grid grid-cols-2 gap-3">
        {cards.map((card, index) => (
          <BalanceCardItem
            key={card.key}
            card={card}
            wide={1 === cards.length % 2 && index === cards.length - 1}
          />
        ))}
      </ul>
    </section>
  );
};
