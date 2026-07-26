import { useCallback, useState } from 'react';
import {
  ConversationStatusSchema,
  type OperatorConversationListResponse,
} from '@sutradhar/contracts';

import type { OperatorApiClient } from '../api/client';
import { ApiClientError } from '../api/client';
import { PaginationControls } from '../components/PaginationControls';
import { StatePanel } from '../components/StatePanel';
import { StatusBadge } from '../components/StatusBadge';
import { conversationStatusTone } from '../lib/statusTone';
import { formatDateTime, humanizeStatus, maskCustomerLabel } from '../lib/format';
import type { AppRoute } from '../lib/routing';
import { usePolling } from '../lib/usePolling';
import styles from '../styles/console.module.css';

const STATUS_FILTERS = ['', ...ConversationStatusSchema.options] as const;

export type ConversationsViewProps = {
  client: OperatorApiClient;
  onNavigate: (route: AppRoute) => void;
};

export function ConversationsView({ client, onNavigate }: ConversationsViewProps) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [data, setData] = useState<OperatorConversationListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const response = await client.listConversations({
        page,
        pageSize: 20,
        ...(status ? { status } : {}),
      });
      setData(response);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Unable to load conversations');
    } finally {
      setLoading(false);
    }
  }, [client, page, status]);

  const { refresh } = usePolling(load, { intervalMs: 4000 });

  if (loading && !data) {
    return <StatePanel title="Loading conversations" body="Fetching the conversation list." />;
  }

  if (error && !data) {
    return (
      <StatePanel
        title="Conversations unavailable"
        body={error}
        actionLabel="Retry"
        onAction={() => {
          setLoading(true);
          void refresh();
        }}
      />
    );
  }

  return (
    <div className={styles.stack}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Conversations</h1>
          <p className={styles.pageMeta}>Customer threads and confirmation state</p>
        </div>
        <button type="button" className={styles.button} onClick={() => void refresh()}>
          Refresh
        </button>
      </div>

      <div className={styles.toolbar}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Status</span>
          <select
            className={styles.select}
            value={status}
            onChange={(event) => {
              setPage(1);
              setStatus(event.target.value);
              setLoading(true);
            }}
          >
            {STATUS_FILTERS.map((value) => (
              <option key={value || 'all'} value={value}>
                {value === '' ? 'All statuses' : humanizeStatus(value)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? <p className={styles.muted}>{error}</p> : null}

      {!data || data.items.length === 0 ? (
        <StatePanel
          title="No conversations"
          body="There are no conversations for this filter yet."
        />
      ) : (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Customer</th>
                  <th scope="col">Intent</th>
                  <th scope="col">Language</th>
                  <th scope="col">Status</th>
                  <th scope="col">Booking</th>
                  <th scope="col">Pending</th>
                  <th scope="col">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id}>
                    <td>
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
                    </td>
                    <td>{item.currentIntent ?? '—'}</td>
                    <td>{item.detectedLanguage ?? '—'}</td>
                    <td>
                      <StatusBadge
                        label={humanizeStatus(item.status)}
                        tone={conversationStatusTone(item.status)}
                      />
                    </td>
                    <td className={styles.mono}>{item.activeBookingReference ?? '—'}</td>
                    <td>{item.pendingActionId ? 'Yes' : 'No'}</td>
                    <td>{formatDateTime(item.lastActivityAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PaginationControls
            page={data.pagination.page}
            pageSize={data.pagination.pageSize}
            total={data.pagination.total}
            totalPages={data.pagination.totalPages}
            onPageChange={(next) => {
              setPage(next);
              setLoading(true);
            }}
          />
        </>
      )}
    </div>
  );
}
