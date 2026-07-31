/**
 * shadcn/ui-shaped primitives (specs.md:34), written against this project's blueprint
 * tokens rather than pulled in wholesale. Same composition API — `className` merges,
 * variants via props — minus the Radix dependency, which nothing here needs.
 */
import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes, forwardRef } from 'react';

import { cn } from '../../lib/utils';

// ---------------------------------------------------------------------- Button

type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger' | 'settle';
type ButtonSize = 'sm' | 'md' | 'icon';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-trace text-white hover:bg-trace/90 border-transparent',
  settle: 'bg-settle text-white hover:bg-settle/90 border-transparent',
  danger: 'bg-halt text-white hover:bg-halt/90 border-transparent',
  outline: 'bg-[var(--surface-raised)] hover:bg-[var(--hairline-soft)] border-[var(--hairline)]',
  ghost: 'bg-transparent hover:bg-[var(--hairline-soft)] border-transparent',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
  icon: 'h-7 w-7 justify-center',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'outline', size = 'md', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center rounded-[var(--radius-panel)] border font-medium',
        'transition-colors disabled:pointer-events-none disabled:opacity-45',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    />
  );
});

// ----------------------------------------------------------------------- Panel

/**
 * The one surface container. No shadow — a single hairline does the separating.
 *
 * min-w-0 is part of the base: a Panel is almost always a grid/flex item, and with the
 * default min-width:auto any wide child (a table, a JSON dump, a long id) would stretch its
 * track past the viewport instead of scrolling inside the Panel.
 */
export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section
      className={cn(
        'min-w-0 rounded-[var(--radius-panel)] border bg-[var(--surface-raised)]',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function PanelHeader({
  title,
  hint,
  actions,
}: {
  title: string;
  hint?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-2.5">
      <div className="min-w-0">
        <h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>
        {hint ? <p className="text-xs text-[var(--text-muted)]">{hint}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}

// ------------------------------------------------------------------ Form parts

export function Field({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={htmlFor} className="eyebrow">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-[var(--text-muted)]">{hint}</p> : null}
    </div>
  );
}

const CONTROL_CLASS =
  'h-9 w-full rounded-[var(--radius-panel)] border bg-[var(--surface)] px-2.5 text-sm ' +
  'placeholder:text-[var(--text-muted)] disabled:opacity-50';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(CONTROL_CLASS, className)} {...props} />;
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(CONTROL_CLASS, 'h-auto min-h-20 py-2 font-mono text-xs', className)}
        {...props}
      />
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return <select ref={ref} className={cn(CONTROL_CLASS, 'pr-8', className)} {...props} />;
  },
);

// ----------------------------------------------------------------------- Table

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full border-collapse text-sm', className)}>{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th className={cn('eyebrow border-b px-4 py-2 text-left font-medium', className)}>{children}</th>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn('border-b border-[var(--hairline-soft)] px-4 py-2.5', className)}>{children}</td>;
}

/** Empty states are an invitation to act, not a shrug. */
export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="px-4 py-12 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children ? (
        <div className="mx-auto mt-2 max-w-lg text-xs text-[var(--text-muted)]">{children}</div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------- Feedback

export function Alert({
  tone = 'halt',
  children,
}: {
  tone?: 'halt' | 'flag' | 'trace' | 'settle';
  children: ReactNode;
}) {
  const tones = {
    halt: 'border-halt/35 bg-halt-soft text-halt',
    flag: 'border-flag/35 bg-flag-soft text-[#8a5d00]',
    trace: 'border-trace/35 bg-trace-soft text-trace',
    settle: 'border-settle/35 bg-settle-soft text-settle',
  } as const;

  return (
    <div className={cn('rounded-[var(--radius-panel)] border px-3 py-2 text-xs', tones[tone])}>
      {children}
    </div>
  );
}

/** Lightweight modal. Native <dialog> semantics without the Radix surface area. */
export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/45 p-4 pt-[8vh]"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-[var(--radius-panel)] border bg-[var(--surface-raised)]"
        onClick={(event) => event.stopPropagation()}
      >
        <PanelHeader
          title={title}
          actions={
            <Button size="icon" variant="ghost" onClick={onClose} aria-label="Fechar">
              ✕
            </Button>
          }
        />
        <div className="grid gap-3 p-4">{children}</div>
        {footer ? <div className="flex justify-end gap-2 border-t px-4 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}
