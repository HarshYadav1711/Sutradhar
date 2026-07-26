import { useCallback, useState } from 'react';
import type { OperatorConversationListResponse, OperatorOverview } from '@sutradhar/contracts';

import type { OperatorApiClient } from '../api/client';
import { ApiClientError } from '../api/client';
import { StatePanel } from '../components/StatePanel';
import { formatDateTime, humanizeStatus, maskCustomerLabel } from '../lib/format';
import type { AppRoute } from '../lib/routing';
import { usePolling } from '../lib/usePolling';
import styles from '../styles/console.module.css';

export type OverviewViewProps = {
  client: OperatorApiClient;
  onNavigate: (route: AppRoute) => void;
};

type OverviewData = {
  overview: OperatorOverview;
  recent: OperatorConversationListResponse;
};

export function OverviewView({ client, onNavigate }: OverviewViewProps) {
  const [data, setData] = useState<OverviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [overview, recent] = await Promise.all([
        client.getOverview(),
        client.listConversations({ page: 1, pageSize: 8 }),
      ]);
      setData({ overview, recent });
      setError(null);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Unable to load overview');
    } finally {
      setLoading(false);
    }
  }, [client]);

  const { refresh } = usePolling(load, { intervalMs: 4000 });

  if (loading && !data) {
    return <StatePanel title="Loading overview" body="Fetching current operational counts." />;
  }

  if (error && !data) {
    return (
      <StatePanel
        title="Overview unavailable"
        body={error}
        actionLabel="Retry"
        onAction={() => {
          setLoading(true);
          void refresh();
        }}
      />
    );
  }

  if (!data) {
    return <StatePanel title="No overview data" body="The operator API returned no overview payload." />;
  }

  const { overview, recent } = data;

  return (
    <div className={styles.stack}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Overview</h1>
          <p className={styles.pageMeta}>Updated {formatDateTime(overview.generatedAt)}</p>
        </div>
        <button type="button" className={styles.button} onClick={() => void refresh()}>
          Refresh
        </button>
      </div>

      {error ? <p className={styles.muted}>{error}</p> : null}

      <section className={styles.gridStats} aria-label="Current counts">
        <article className={styles.statCard}>
          <p className={styles.statLabel}>Active conversations</p>
          <p className={styles.statValue}>{overview.activeConversations}</p>
        </article>
        <article className={styles.statCard}>
          <p className={styles.statLabel}>Confirmed bookings</p>
          <p className={styles.statValue}>{overview.confirmedBookings}</p>
        </article>
        <article className={styles.statCard}>
          <p className={styles.statLabel}>Pending confirmations</p>
          <p className={styles.statValue}>{overview.pendingActions}</p>
        </article>
        <article className={styles.statCard}>
          <p className={styles.statLabel}>Open handoffs</p>
          <p className={styles.statValue}>{overview.openHandoffs}</p>
        </article>
        <article className={styles.statCard}>
          <p className={styles.statLabel}>Failed webhook events</p>
          <p className={styles.statValue}>{overview.failedWebhookEvents}</p>
        </article>
      </section>

      <section className={styles.panel} aria-labelledby="recent-activity-title">
        <h2 id="recent-activity-title" className={styles.panelTitle}>
          Recent conversations
        </h2>
        {recent.items.length === 0 ? (
          <p className={styles.muted}>No conversations yet.</p>
        ) : (
          <ul className={styles.listPlain}>
            {recent.items.map((item) => (
              <li key={item.id}>
                <a
                  href={`#/conversations/${encodeURIComponent(item.id)}`}
                  className={styles.rowLink}
                  onClick={(event) => {
                    event.preventDefault();
                    onNavigate({ name: 'conversation', conversationId: item.id });
                  }}
                >
                  {maskCustomerLabel(item.customer)}
                </a>
                <div className={styles.muted}>
                  {humanizeStatus(item.status)}
                  {item.currentIntent ? ` · ${item.currentIntent}` : ''}
                  {' · '}
                  {formatDateTime(item.lastActivityAt)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
