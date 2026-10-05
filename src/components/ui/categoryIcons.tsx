import { SplitType } from '@prisma/client';
import {
  Baby,
  Backpack,
  Banknote,
  Bike,
  Bone,
  Bus,
  Car,
  CarTaxiFront,
  Construction,
  DollarSign,
  DoorOpen,
  FerrisWheel,
  Flame,
  Fuel,
  Gamepad2,
  Gift,
  GlassWater,
  Globe,
  GraduationCap,
  Hammer,
  HandCoins,
  HandIcon,
  Home,
  Hotel,
  type LucideIcon,
  type LucideProps,
  Music,
  Paintbrush,
  Paintbrush2,
  ParkingCircle,
  Phone,
  Pizza,
  Plane,
  Plug,
  Popcorn,
  ReceiptText,
  Shield,
  Shirt,
  ShoppingCart,
  Sofa,
  Sprout,
  Stethoscope,
  TrainFront,
  Trash,
  Trophy,
  Utensils,
  Wine,
  Wrench,
  Zap,
} from 'lucide-react';

import {
  CURRENCY_CONVERSION_EMOJI,
  type CategoryItem,
  DEFAULT_CATEGORY,
  SETTLEMENT_EMOJI,
  getCategoryEmoji,
} from '~/lib/category';
import { cn } from '~/lib/utils';

export const CategoryIcons: Record<CategoryItem, LucideIcon> = {
  games: Gamepad2,
  movies: Popcorn,
  music: Music,
  sports: Trophy,
  entertainment: FerrisWheel,
  food: Pizza,
  diningOut: Utensils,
  groceries: ShoppingCart,
  liquor: Wine,
  home: Home,
  electronics: Plug,
  furniture: Sofa,
  supplies: Paintbrush2,
  maintenance: Construction,
  mortgage: HandIcon,
  pets: Bone,
  rent: DoorOpen,
  services: Hammer,
  life: Sprout,
  childcare: Baby,
  clothing: Shirt,
  education: GraduationCap,
  gifts: Gift,
  medical: Stethoscope,
  taxes: ReceiptText,
  travel: Backpack,
  bus: Bus,
  train: TrainFront,
  car: Car,
  fuel: Fuel,
  parking: ParkingCircle,
  plane: Plane,
  taxi: CarTaxiFront,
  utilities: Wrench,
  electricity: Zap,
  gas: Flame,
  internet: Globe,
  phone: Phone,
  water: GlassWater,
  general: Banknote,
  cleaning: Paintbrush,
  trash: Trash,
  insurance: Shield,
  bicycle: Bike,
  hotel: Hotel,
};

export const CurrencyConversionIcon = DollarSign;

export const SettleupIcon = HandCoins;

export const DefaultCategoryIcon = CategoryIcons[DEFAULT_CATEGORY];

/** `size-N` de Tailwind (N × 0,25rem) para dar al emoji el mismo tamaño que tenía el ícono. */
const SIZE_CLASS = /(?:^|\s)size-(\d+(?:\.\d+)?)(?=\s|$)/;

const emojiFontSize = (size: LucideProps['size'], className?: string) => {
  if (size !== undefined) {
    return 'number' === typeof size ? `${size}px` : size;
  }

  const match = className ? SIZE_CLASS.exec(className) : null;

  return match?.[1] ? `${Number(match[1]) * 0.25}rem` : undefined;
};

/**
 * Casa: cada categoría se dibuja con su emoji de color (antes, un ícono lineal monocromo). Mantiene
 * la misma firma de siempre para que todos los usos hereden el cambio: `size` o una clase
 * `size-N` fijan el tamaño; sin ninguno de los dos, el emoji toma el tamaño de letra del lugar.
 */
export const CategoryIcon: React.FC<{ category?: string; splitType?: SplitType } & LucideProps> = ({
  category = DEFAULT_CATEGORY,
  splitType,
  size,
  className,
  style,
}) => {
  let emoji = getCategoryEmoji(category);
  if (SplitType.SETTLEMENT === splitType) {
    emoji = SETTLEMENT_EMOJI;
  } else if (SplitType.CURRENCY_CONVERSION === splitType) {
    emoji = CURRENCY_CONVERSION_EMOJI;
  }

  const fontSize = emojiFontSize(size, className);

  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center leading-none select-none',
        className,
      )}
      style={{
        ...(fontSize ? { fontSize, width: fontSize, height: fontSize } : null),
        ...(style as React.CSSProperties | undefined),
      }}
    >
      {emoji}
    </span>
  );
};
