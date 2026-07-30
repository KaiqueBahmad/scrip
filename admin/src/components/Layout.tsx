import {
  ArrowLeftRight,
  BookOpen,
  KeyRound,
  Settings2,
  ShieldCheck,
  Store,
  Users,
  Webhook,
} from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { NavLink, Outlet } from 'react-router-dom';

import { useSession } from '../lib/session';
import { cn } from '../lib/utils';

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

const NAV: NavItem[] = [
  { to: '/transacoes', label: 'Transações', icon: ArrowLeftRight },
  { to: '/comerciantes', label: 'Comerciantes', icon: Store },
  { to: '/usuarios', label: 'Usuários', icon: Users },
  { to: '/tokens', label: 'Meus tokens', icon: KeyRound },
  { to: '/kyc', label: 'KYC', icon: ShieldCheck },
  { to: '/webhooks', label: 'Webhooks', icon: Webhook },
  { to: '/configuracoes', label: 'Configurações', icon: Settings2 },
  { to: '/docs', label: 'Documentação', icon: BookOpen },
];

/**
 * Fixed ink rail plus paper content. The rail is a channel strip: identity at the top,
 * destinations in the middle, the acting user pinned at the bottom because "who am I right
 * now" is the panel's central concept (specs.md:54).
 */
export function Layout() {
  const { user, signOut } = useSession();

  return (
    // minmax(0,1fr) e não 1fr: `1fr` é minmax(auto,1fr), e esse mínimo `auto` deixa a
    // trilha de conteúdo crescer com o filho mais largo, empurrando a página inteira.
    <div className="min-h-dvh md:grid md:grid-cols-[188px_minmax(0,1fr)]">
      <nav className="flex flex-col gap-1 bg-ink px-3 py-4 text-white/90 md:sticky md:top-0 md:h-dvh">
        <div className="px-1.5 pb-4">
          <span className="font-mono text-[13px] font-semibold tracking-[0.16em] text-white">
            PSEUDO<span className="text-trace">PAY</span>
          </span>
          <p className="mt-0.5 font-mono text-[9px] tracking-[0.12em] text-white/40 uppercase">
            gateway pix simulado
          </p>
        </div>

        <ul className="flex flex-1 flex-col gap-0.5">
          {NAV.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2.5 rounded-[var(--radius-panel)] px-2 py-1.5 text-[13px]',
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
                        'h-4 w-[2px] rounded-full',
                        isActive ? 'bg-trace' : 'bg-transparent',
                      )}
                    />
                    <item.icon className="size-3.5 shrink-0" />
                    {item.label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>

        {user ? (
          <div className="mt-4 border-t border-white/10 pt-3">
            <p className="font-mono text-[9px] tracking-[0.12em] text-white/40 uppercase">
              atuando como
            </p>
            <p className="truncate text-[13px] font-medium text-white">{user.name}</p>
            <p className="truncate font-mono text-[10px] text-white/45">{user.email}</p>
            <button
              type="button"
              onClick={signOut}
              className="mt-2 font-mono text-[10px] tracking-[0.1em] text-white/50 uppercase hover:text-white"
            >
              trocar usuário
            </button>
          </div>
        ) : null}
      </nav>

      <div className="flex min-w-0 flex-col">
        <main className="min-w-0 flex-1 p-4 md:p-6">
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
