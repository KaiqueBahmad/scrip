import { Check, Copy } from 'lucide-react';
import { useState } from 'react';

import { cn } from '../lib/utils';

/**
 * Code sample with a copy button. Every snippet in the docs is meant to be pasted into a
 * terminal or editor, so copying is the primary action rather than an afterthought.
 */
export function CodeBlock({
  code,
  label,
  className,
}: {
  code: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    // max-w matches the prose measure; min-w-0 is what lets the <pre> below actually
    // scroll instead of stretching its grid track.
    <div className={cn('group relative max-w-3xl min-w-0', className)}>
      {label ? (
        <div className="flex items-center justify-between border border-b-0 bg-[var(--surface)] px-3 py-1.5">
          <span className="eyebrow">{label}</span>
        </div>
      ) : null}

      <div className="relative">
        <pre className="overflow-x-auto border bg-[var(--surface)] p-3 font-mono text-[11.5px] leading-relaxed">
          <code>{code}</code>
        </pre>

        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1400);
            } catch {
              // Clipboard needs a secure context; the text stays selectable either way.
            }
          }}
          className={cn(
            'absolute top-2 right-2 flex items-center gap-1 rounded-[var(--radius-panel)] border',
            'bg-[var(--surface-raised)] px-1.5 py-1 font-mono text-[10px] tracking-[0.08em] uppercase',
            'opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100',
            copied && 'opacity-100',
          )}
        >
          {copied ? (
            <>
              <Check aria-hidden className="size-3 text-settle" /> copiado
            </>
          ) : (
            <>
              <Copy aria-hidden className="size-3" /> copiar
            </>
          )}
        </button>
      </div>
    </div>
  );
}
