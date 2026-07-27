import { useCallback, useState } from 'react';
import type { OperatorBookingListResponse } from '@sutradhar/contracts';

import type { OperatorApiClient } from '../api/client';
import { ApiClientError } from '../api/client';
import { PaginationControls } from '../components/PaginationControls';
import { StatePanel } from '../components/StatePanel';
import { StatusBadge } from '../components/StatusBadge';
import { conversationStatusTone } from '../lib/statusTone';
import {
  formatDateTime,
  formatInrFromMinor,
  humanizeStatus,
  maskCustomerLabel,
} from '../lib/format';
import { usePolling } from '../lib/usePolling';
import styles from '../styles/console.module.css';

/** Filters for persisted Booking rows. Pending proposals live on PendingAction, not Booking. */
const BOOKING_STATUSES = ['', 'CONFIRMED', 'RESCHEDULED', 'CANCELLED', 'COMPLETED'] as const;

function bookingTone(status: string) {
  if (status === 'CONFIRMED' || status === 'RESCHEDULED' || status === 'COMPLETED') {
    return 'ok' as const;
  }
  if (status === 'CANCELLED') {
    return 'danger' as const;
  }
  return conversationStatusTone(status);
}

export type BookingsViewProps = {
  client: OperatorApiClient;
};

export function BookingsView({ client }: BookingsViewProps) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [data, setData] = useState<OperatorBookingListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const response = await client.listBookings({
        page,
        pageSize: 20,
        ...(status ? { status } : {}),
      });
      setData(response);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Unable to load bookings');
    } finally {
      setLoading(false);
    }
  }, [client, page, status]);

  const { refresh } = usePolling(load, { intervalMs: 4000 });

  if (loading && !data) {
    return <StatePanel title="Loading bookings" body="Fetching confirmed and pending bookings." />;
  }

  if (error && !data) {
    return (
      <StatePanel
        title="Bookings unavailable"
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
          <h1 className={styles.pageTitle}>Bookings</h1>
          <p className={styles.pageMeta}>Confirmed service visits and schedule changes</p>
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
            {BOOKING_STATUSES.map((value) => (
              <option key={value || 'all'} value={value}>
                {value === '' ? 'All statuses' : humanizeStatus(value)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? <p className={styles.muted}>{error}</p> : null}

      {!data || data.items.length === 0 ? (
        <StatePanel title="No bookings" body="There are no bookings for this filter yet." />
      ) : (
        <>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Reference</th>
                  <th scope="col">Customer</th>
                  <th scope="col">Service</th>
                  <th scope="col">Scheduled</th>
                  <th scope="col">Qty</th>
                  <th scope="col">Price</th>
                  <th scope="col">Status</th>
                  <th scope="col">Confirmed</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id}>
                    <td className={styles.mono}>{item.reference}</td>
                    <td>{maskCustomerLabel(item.customer)}</td>
                    <td>{item.serviceName}</td>
                    <td>{formatDateTime(item.startsAt)}</td>
                    <td>{item.quantity}</td>
                    <td>{formatInrFromMinor(item.estimatedPriceMinor)}</td>
                    <td>
                      <StatusBadge label={humanizeStatus(item.status)} tone={bookingTone(item.status)} />
                    </td>
                    <td>{formatDateTime(item.confirmedAt)}</td>
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
