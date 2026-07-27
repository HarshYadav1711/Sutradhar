import { useCallback, useState } from 'react';
import {
  HandoffStatusSchema,
  type OperatorHandoffListResponse,
} from '@sutradhar/contracts';

import type { OperatorApiClient } from '../api/client';
import { ApiClientError } from '../api/client';
import { PaginationControls } from '../components/PaginationControls';
import { StatePanel } from '../components/StatePanel';
import { StatusBadge } from '../components/StatusBadge';
import { handoffStatusTone } from '../lib/statusTone';
import { humanizeStatus, maskCustomerLabel } from '../lib/format';
import { usePolling } from '../lib/usePolling';
import styles from '../styles/console.module.css';

const STATUS_FILTERS = ['', ...HandoffStatusSchema.options] as const;

const STATUS_OPTIONS = [
  { value: 'OPEN', label: 'Open' },
  { value: 'IN_PROGRESS', label: 'In review' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'CLOSED', label: 'Closed' },
] as const;

type HandoffUpdateStatus = (typeof STATUS_OPTIONS)[number]['value'];

export type HandoffsViewProps = {
  client: OperatorApiClient;
};

export function HandoffsView({ client }: HandoffsViewProps) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [data, setData] = useState<OperatorHandoffListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await client.listHandoffs({
        page,
        pageSize: 20,
        ...(status ? { status } : {}),
      });
      setData(response);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Unable to load handoffs');
    } finally {
      setLoading(false);
    }
  }, [client, page, status]);

  const { refresh } = usePolling(load, { intervalMs: 4000 });

  const updateStatus = async (handoffId: string, nextStatus: HandoffUpdateStatus) => {
    setUpdatingId(handoffId);
    setActionError(null);
    try {
      await client.updateHandoff(handoffId, { status: nextStatus });
      await refresh();
    } catch (err) {
      setActionError(err instanceof ApiClientError ? err.message : 'Unable to update handoff');
    } finally {
      setUpdatingId(null);
    }
  };

  if (loading && !data) {
    return <StatePanel title="Loading handoffs" body="Fetching open and historical escalations." />;
  }

  if (error && !data) {
    return (
      <StatePanel
        title="Handoffs unavailable"
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
          <h1 className={styles.pageTitle}>Human handoffs</h1>
          <p className={styles.pageMeta}>
            Escalations for complaints, refunds, and unsupported requests. Refund approval is outside
            this console.
          </p>
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
      {actionError ? (
        <p className={styles.muted} role="alert">
          {actionError}
        </p>
      ) : null}

      {!data || data.items.length === 0 ? (
        <StatePanel title="No handoffs" body="There are no handoffs for this filter yet." />
      ) : (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Reference</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Priority</th>
                  <th scope="col">Booking</th>
                  <th scope="col">Summary</th>
                  <th scope="col">Status</th>
                  <th scope="col">Update</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id}>
                    <td className={styles.mono}>{item.reference}</td>
                    <td>{maskCustomerLabel(item.customer)}</td>
                    <td>{item.reason}</td>
                    <td>{humanizeStatus(item.priority)}</td>
                    <td className={styles.mono}>{item.bookingId ?? '—'}</td>
                    <td>{item.summary}</td>
                    <td>
                      <StatusBadge
                        label={humanizeStatus(item.status)}
                        tone={handoffStatusTone(item.status)}
                      />
                    </td>
                    <td>
                      <label className={styles.field}>
                        <span className={styles.fieldLabel}>Set status</span>
                        <select
                          className={styles.select}
                          aria-label={`Update status for ${item.reference}`}
                          value={item.status}
                          disabled={updatingId === item.id}
                          onChange={(event) => {
                            const next = event.target.value as HandoffUpdateStatus;
                            void updateStatus(item.id, next);
                          }}
                        >
                          {STATUS_OPTIONS.map((entry) => (
                            <option key={entry.value} value={entry.value}>
                              {entry.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </td>
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
