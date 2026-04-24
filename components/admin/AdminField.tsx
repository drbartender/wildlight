'use client';

import { useEffect, useState, type ReactNode } from 'react';

// Small shared input component. For simple read/display, pass `value` +
// `onSave` and the input commits on blur (or Enter) when changed.

interface Props {
  label: string;
  value?: string | number | null;
  placeholder?: string;
  type?: string;
  name?: string;
  multiline?: boolean;
  rows?: number;
  onSave?: (next: string) => void;
  onChange?: (next: string) => void;
  children?: ReactNode;
}

export function AdminField({
  label,
  value,
  placeholder,
  type = 'text',
  name,
  multiline,
  rows = 3,
  onSave,
  onChange,
  children,
}: Props) {
  const [v, setV] = useState(String(value ?? ''));
  useEffect(() => {
    setV(String(value ?? ''));
  }, [value]);

  function commit() {
    if (onSave && v !== String(value ?? '')) onSave(v);
  }

  return (
    <label className="wl-adm-field">
      <span className="wl-adm-field-label">{label}</span>
      {children
        ? children
        : multiline
          ? (
              <textarea
                className="wl-adm-field-textarea"
                name={name}
                rows={rows}
                value={v}
                placeholder={placeholder}
                onChange={(e) => {
                  setV(e.target.value);
                  onChange?.(e.target.value);
                }}
                onBlur={commit}
              />
            )
          : (
              <input
                className="wl-adm-field-input"
                name={name}
                type={type}
                value={v}
                placeholder={placeholder}
                onChange={(e) => {
                  setV(e.target.value);
                  onChange?.(e.target.value);
                }}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !multiline) (e.target as HTMLInputElement).blur();
                }}
              />
            )}
    </label>
  );
}
