import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import i18n from './i18n';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

function isPt(): boolean {
  return i18n.language.startsWith('pt');
}

/**
 * Centavos -> "R$ 150,00" (pt) or "$150.00" (en). Same underlying integer amount either
 * way — this reformats for the interface language, it does not convert currency.
 */
export function formatMoney(centavos: number): string {
  return isPt()
    ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(centavos / 100)
    : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(centavos / 100);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(isPt() ? 'pt-BR' : 'en-US', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(iso));
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat(isPt() ? 'pt-BR' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(iso));
}

/** "4,0 s" / "820 ms" / "2,5 min" (pt) or "4.0s" / "820ms" / "2.5min" (en) — dwell times on the lifecycle trace. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return isPt() ? `${Math.round(ms)} ms` : `${Math.round(ms)}ms`;
  if (ms < 60_000) {
    const value = (ms / 1000).toFixed(1);
    return isPt() ? `${value.replace('.', ',')} s` : `${value}s`;
  }
  const value = (ms / 60_000).toFixed(1);
  return isPt() ? `${value.replace('.', ',')} min` : `${value}min`;
}

export function relativeToNow(iso: string | null | undefined): string {
  if (!iso) return '—';

  const diff = Date.now() - new Date(iso).getTime();
  const future = diff < 0;
  const abs = Math.abs(diff);
  const pt = isPt();

  const unit = (value: number, suffix: string) =>
    future ? (pt ? `em ${value}${suffix}` : `in ${value}${suffix}`) : `${value}${suffix}`;

  if (abs < 60_000) return unit(Math.round(abs / 1000), 's');
  if (abs < 3_600_000) return unit(Math.round(abs / 60_000), pt ? 'min' : 'min');
  if (abs < 86_400_000) return unit(Math.round(abs / 3_600_000), 'h');
  return unit(Math.round(abs / 86_400_000), 'd');
}

/** Long identifiers (JWTs, BR Codes, e2e ids) truncated in the middle. */
export function truncateMiddle(value: string, head = 10, tail = 6): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function maskDocument(document: string | null | undefined): string {
  if (!document) return '—';
  const digits = document.replace(/\D/g, '');

  if (digits.length === 11) {
    return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  }
  if (digits.length === 14) {
    return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  }
  return document;
}
