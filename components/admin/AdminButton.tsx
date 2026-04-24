'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'ghost' | 'danger';

interface Props extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: Variant;
  small?: boolean;
  icon?: ReactNode;
  children: ReactNode;
}

export function AdminButton({
  variant,
  small,
  icon,
  children,
  type = 'button',
  ...rest
}: Props) {
  const parts = ['wl-adm-btn'];
  if (small) parts.push('small');
  if (variant) parts.push(variant);
  return (
    <button {...rest} type={type} className={parts.join(' ')}>
      {icon}
      {children}
    </button>
  );
}
