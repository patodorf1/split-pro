import Link from 'next/link';
import { useRouter } from 'next/router';
import { useCallback } from 'react';
import { useTranslationWithUtils } from '~/hooks/useTranslationWithUtils';
import { EntityAvatar } from '../ui/avatar';
import { ConvertibleBalance } from './ConvertibleBalance';

const emptyBalances: { currency: string; amount: bigint }[] = [];

export const BalanceEntry: React.FC<{
  entity: { name?: string | null; image?: string | null; email?: string | null };
  balances?: { currency: string; amount: bigint }[];
  id: number;
  /** Dirección del detalle. Por defecto cuelga de la pantalla actual. */
  href?: string;
}> = ({ entity, balances = emptyBalances, id, href }) => {
  const { displayName } = useTranslationWithUtils();
  const router = useRouter();

  const currentRoute = router.pathname;

  const stopPropagation = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  }, []);

  return (
    <Link className="flex items-center justify-between" href={href ?? `${currentRoute}/${id}`}>
      <div className="flex min-w-0 items-center gap-3">
        <EntityAvatar entity={entity} size={35} />
        <div className="text-foreground truncate">{displayName(entity)}</div>
      </div>
      <div className="text-right" onClick={stopPropagation}>
        <ConvertibleBalance withText balances={balances} entityId={id} />
      </div>
    </Link>
  );
};
