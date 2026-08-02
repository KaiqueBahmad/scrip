import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

import { cn, truncateMiddle } from '../lib/utils';

/**
 * Nearly every value in this product is a long identifier meant to be pasted into a
 * terminal — charge ids, JWTs, BR Codes, webhook secrets. Copying is the primary verb, so
 * it is attached directly to the value instead of hidden in a menu.
 */
export function Copyable({
  value,
  display,
  truncate,
  className,
  label,
}: {
  value: string;
  display?: string;
  truncate?: { head: number; tail: number };
  className?: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  const shown =
    display ?? (truncate ? truncateMiddle(value, truncate.head, truncate.tail) : value);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        } catch {
          // Clipboard is unavailable outside a secure context; the value stays selectable.
        }
      }}
      title={label ? `Copiar ${label}` : 'Copiar'}
      className={cn(
        'group inline-flex max-w-full items-center gap-1.5 rounded-[2px] text-left',
        'hover:bg-[var(--hairline-soft)]',
        className,
      )}
    >
      {/* min-w-0 is required for `truncate` to engage: as a flex item this span would
          otherwise refuse to shrink below its text and overflow the row instead. */}
      <span className="tnum min-w-0 truncate text-xs">{shown}</span>
      {copied ? (
        <Check aria-hidden className="size-3 shrink-0 text-settle" />
      ) : (
        <Copy
          aria-hidden
          className="size-3 shrink-0 text-[var(--text-muted)] opacity-0 transition-opacity group-hover:opacity-100"
        />
      )}
      <span className="sr-only">{copied ? 'Copiado' : `Copiar ${label ?? 'valor'}`}</span>
    </button>
  );
}

/** Reveal-on-demand for secrets that are shown in the panel by design. */
export function Secret({ value, label }: { value: string; label: string }) {
  const [revealed, setRevealed] = useState(false);

  return (
    <span className="inline-flex items-center gap-2">
      {revealed ? (
        <Copyable value={value} truncate={{ head: 14, tail: 8 }} label={label} />
      ) : (
        <span className="tnum text-xs text-[var(--text-muted)]">••••••••••••</span>
      )}
      <button
        type="button"
        onClick={() => setRevealed((current) => !current)}
        className="eyebrow hover:text-[var(--text)]"
      >
        {revealed ? 'ocultar' : 'mostrar'}
      </button>
    </span>
  );
}
