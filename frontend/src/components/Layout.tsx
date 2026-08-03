import {
  ArrowLeftRight,
  ArrowUpRight,
  Banknote,
  BookOpen,
  KeyRound,
  Settings2,
  Store,
  Webhook,
} from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router-dom';

import { useSession } from '../lib/session';
import { cn, formatMoney } from '../lib/utils';

interface NavItem {
  to: string;
  labelKey: string;
  icon: ComponentType<{ className?: string }>;
}

const NAV: NavItem[] = [
  { to: '/transactions', labelKey: 'nav.transactions', icon: ArrowLeftRight },
  { to: '/my-store', labelKey: 'nav.myStore', icon: Store },
  { to: '/withdrawals', labelKey: 'nav.withdrawals', icon: Banknote },
  { to: '/tokens', labelKey: 'nav.tokens', icon: KeyRound },
  { to: '/webhooks', labelKey: 'nav.webhooks', icon: Webhook },
  { to: '/settings', labelKey: 'nav.settings', icon: Settings2 },
];

/**
 * Fixed ink rail plus paper content. The rail is a channel strip: identity at the top,
 * destinations in the middle, the acting user pinned at the bottom because "who am I right
 * now" is the panel's central concept.
 */
export function Layout() {
  const { merchant, signOut } = useSession();
  const { t } = useTranslation();

  return (
    // minmax(0,1fr) e não 1fr: `1fr` é minmax(auto,1fr), e esse mínimo `auto` deixa a
    // trilha de conteúdo crescer com o filho mais largo, empurrando a página inteira.
    <div className="min-h-dvh md:grid md:grid-cols-[220px_minmax(0,1fr)]">
      <nav className="flex flex-col gap-1 bg-ink px-4 py-5 text-white/90 md:sticky md:top-0 md:h-dvh">
        <div className="px-2 pb-5">
          <span className="font-mono text-[15px] font-semibold tracking-[0.16em] text-white">
            SCR<span className="text-trace">IP</span>
          </span>
        </div>

        <ul className="flex flex-1 flex-col gap-0.5">
          {NAV.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-[var(--radius-panel)] px-2.5 py-2 text-[15px]',
                    'transition-colors',
                    isActive
                      ? 'bg-trace/18 text-white'
                      : 'text-white/60 hover:bg-white/6 hover:text-white/90',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      aria-hidden
                      className={cn(
                        'h-5 w-[2px] rounded-full',
                        isActive ? 'bg-trace' : 'bg-transparent',
                      )}
                    />
                    <item.icon className="size-4 shrink-0" />
                    {t(item.labelKey)}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="mt-4 pt-3">
          <NavLink
            to="/documentation"
            className={cn(
              'flex items-center gap-3 rounded-[var(--radius-panel)] px-2.5 py-2 text-[15px]',
              'transition-colors',
              'text-white/60 hover:bg-white/6 hover:text-white/90',
            )}
          >
            <span
              aria-hidden
              className="h-4 w-[2px] rounded-full bg-transparent"
            />
            <BookOpen className="size-4 shrink-0" />
            <span className="flex-1">{t('nav.documentation')}</span>
            <ArrowUpRight className="size-3 shrink-0 opacity-60" aria-hidden />
          </NavLink>
        </div>

        {merchant ? (
          <div className="mt-2 border-t border-white/10 pt-3">
            <p className="font-mono text-[9px] tracking-[0.12em] text-white/40 uppercase">
              {t('nav.storeLabel')}
            </p>
            <p className="truncate text-[15px] font-medium text-white">{merchant.name}</p>
            <p className="tnum truncate text-[15px] text-settle">
              {formatMoney(merchant.balance?.available ?? 0)}
            </p>
            <button
              type="button"
              onClick={signOut}
              className="mt-2 font-mono text-[10px] tracking-[0.1em] text-white/50 uppercase hover:text-white"
            >
              {t('nav.switchStore')}
            </button>
          </div>
        ) : null}
      </nav>

      <div className="flex min-w-0 flex-col">
        <main className="min-w-0 flex-1 p-5 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** Page heading. `meta` carries counts or filters, never decoration. */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow ? <p className="eyebrow mb-1">{eyebrow}</p> : null}
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-0.5 max-w-2xl text-[13px] text-[var(--text-muted)]">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}
