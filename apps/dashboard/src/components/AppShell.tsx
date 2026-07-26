import type { ReactNode } from 'react';

import type { AppRoute } from '../lib/routing';
import { routeToHash } from '../lib/routing';
import styles from '../styles/console.module.css';

const NAV_ITEMS: Array<{ label: string; route: AppRoute }> = [
  { label: 'Overview', route: { name: 'overview' } },
  { label: 'Conversations', route: { name: 'conversations' } },
  { label: 'Bookings', route: { name: 'bookings' } },
  { label: 'Handoffs', route: { name: 'handoffs' } },
];

export type AppShellProps = {
  route: AppRoute;
  onNavigate: (route: AppRoute) => void;
  onSignOut: () => void;
  children: ReactNode;
};

export function AppShell({ route, onNavigate, onSignOut, children }: AppShellProps) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <p className={styles.productName}>Sutradhar</p>
          <p className={styles.productTag}>Operator console</p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={`${styles.button} ${styles.buttonDanger}`} onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>

      <div className={styles.layout}>
        <nav className={styles.nav} aria-label="Primary">
          {NAV_ITEMS.map((item) => {
            const active =
              item.route.name === route.name ||
              (item.route.name === 'conversations' && route.name === 'conversation');
            return (
              <a
                key={item.label}
                href={routeToHash(item.route)}
                className={`${styles.navLink} ${active ? styles.navLinkActive : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  onNavigate(item.route);
                }}
              >
                {item.label}
              </a>
            );
          })}
        </nav>
        <main className={styles.main}>{children}</main>
      </div>
    </div>
  );
}
