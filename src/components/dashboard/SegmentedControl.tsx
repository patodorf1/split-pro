import React, { useCallback } from 'react';

import { cn } from '~/lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  /** Spoken label, when `label` is a symbol or an abbreviation. */
  title?: string;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  size?: 'sm' | 'default';
  className?: string;
}

const SegmentedItem = <T extends string>({
  option,
  selected,
  onChange,
  size,
}: {
  option: SegmentedOption<T>;
  selected: boolean;
  onChange: (value: T) => void;
  size: 'sm' | 'default';
}) => {
  const handleClick = useCallback(() => onChange(option.value), [onChange, option.value]);

  return (
    <button
      type="button"
      aria-pressed={selected}
      title={option.title}
      onClick={handleClick}
      className={cn(
        'flex-1 rounded-full font-medium transition-colors',
        'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
        'sm' === size ? 'px-3 py-1 text-xs' : 'px-4 py-2 text-sm',
        selected
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {option.label}
    </button>
  );
};

/** Pill-shaped switch used for Me/Us and for the currency picker. */
export const SegmentedControl = <T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'default',
  className,
}: SegmentedControlProps<T>) => (
  <div
    role="group"
    aria-label={label}
    className={cn(
      'bg-primary-soft flex items-center gap-1 rounded-full',
      'sm' === size ? 'p-0.5' : 'p-1',
      className,
    )}
  >
    {options.map((option) => (
      <SegmentedItem
        key={option.value}
        option={option}
        selected={option.value === value}
        onChange={onChange}
        size={size}
      />
    ))}
  </div>
);
