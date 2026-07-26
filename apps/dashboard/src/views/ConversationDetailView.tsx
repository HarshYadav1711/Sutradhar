import { useCallback, useState } from 'react';
import type {
  OperatorConversationDetail,
  OperatorConversationTrace,
} from '@sutradhar/contracts';

import type { OperatorApiClient } from '../api/client';
import { ApiClientError } from '../api/client';
import { StatePanel } from '../components/StatePanel';
import { StatusBadge } from '../components/StatusBadge';
import { conversationStatusTone, toolStatusTone } from '../lib/statusTone';
import {
  formatDateTime,
  formatInrFromMinor,
  humanizeEventType,
  humanizeStatus,
  maskCustomerLabel,
} from '../lib/format';
import type { AppRoute } from '../lib/routing';
import { usePolling } from '../lib/usePolling';
import styles from '../styles/console.module.css';

export type ConversationDetailViewProps = {
  client: OperatorApiClient;
  conversationId: string;
  onNavigate: (route: AppRoute) => void;
};

type DetailData = {
  detail: OperatorConversationDetail;
  trace: OperatorConversationTrace;
};

export function ConversationDetailView({
  client,
  conversationId,
  onNavigate,
}: ConversationDetailViewProps) {
  const [data, setData] = useState<DetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [detail, trace] = await Promise.all([
        client.getConversation(conversationId),
        client.getConversationTrace(conversationId),
      ]);
      setData({ detail, trace });
      setError(null);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Unable to load conversation');
    } finally {
      setLoading(false);
    }
  }, [client, conversationId]);

  const { refresh } = usePolling(load, { intervalMs: 4000 });

  if (loading && !data) {
    return <StatePanel title="Loading conversation" body="Fetching messages and operational trace." />;
  }

  if (error && !data) {
    return (
      <StatePanel
        title="Conversation unavailable"
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
    return <StatePanel title="Conversation not found" body="No conversation payload was returned." />;
  }

  const { detail, trace } = data;
  const structuredEntries = Object.entries(detail.structuredState);

  return (
    <div className={styles.stack}>
      <div className={styles.pageHeader}>
        <div>
          <p className={styles.pageMeta}>
            <a
              href="#/conversations"
              onClick={(event) => {
                event.preventDefault();
                onNavigate({ name: 'conversations' });
              }}
            >
              Conversations
            </a>
            {' / '}
            Detail
          </p>
          <h1 className={styles.pageTitle}>{maskCustomerLabel(detail.customer)}</h1>
          <p className={styles.pageMeta}>
            <StatusBadge
              label={humanizeStatus(detail.status)}
              tone={conversationStatusTone(detail.status)}
            />{' '}
            Last activity {formatDateTime(detail.lastActivityAt)}
          </p>
        </div>
        <button type="button" className={styles.button} onClick={() => void refresh()}>
          Refresh
        </button>
      </div>

      {error ? <p className={styles.muted}>{error}</p> : null}

      <div className={styles.detailGrid}>
        <section className={styles.panel} aria-labelledby="timeline-title">
          <h2 id="timeline-title" className={styles.panelTitle}>
            Message timeline
          </h2>
          {detail.messages.length === 0 ? (
            <p className={styles.muted}>No messages yet.</p>
          ) : (
            <div className={styles.timeline}>
              {detail.messages.map((message) => (
                <article
                  key={message.id}
                  className={`${styles.message} ${
                    message.direction === 'OUTBOUND' ? styles.messageOutbound : ''
                  }`}
                >
                  <div className={styles.messageMeta}>
                    <span>{message.direction === 'INBOUND' ? 'Customer' : 'Agent'}</span>
                    <span>{formatDateTime(message.createdAt)}</span>
                    <span>{message.messageType}</span>
                  </div>
                  <div className={styles.messageBody}>{message.content}</div>
                </article>
              ))}
            </div>
          )}
        </section>

        <div className={styles.stack}>
          <section className={styles.panel} aria-labelledby="state-title">
            <h2 id="state-title" className={styles.panelTitle}>
              Structured state
            </h2>
            <dl className={styles.kv}>
              <dt>Intent</dt>
              <dd>{detail.currentIntent ?? '—'}</dd>
              <dt>Language</dt>
              <dd>{detail.detectedLanguage ?? '—'}</dd>
              <dt>Summary</dt>
              <dd>{detail.compactSummary ?? '—'}</dd>
            </dl>
            {structuredEntries.length > 0 ? (
              <dl className={styles.kv} style={{ marginTop: '0.85rem' }}>
                {structuredEntries.map(([key, value]) => (
                  <div key={key} style={{ display: 'contents' }}>
                    <dt>{key}</dt>
                    <dd className={styles.mono}>
                      {typeof value === 'string' || typeof value === 'number'
                        ? String(value)
                        : JSON.stringify(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className={styles.muted} style={{ marginTop: '0.75rem' }}>
                No additional structured fields.
              </p>
            )}
          </section>

          <section className={styles.panel} aria-labelledby="booking-title">
            <h2 id="booking-title" className={styles.panelTitle}>
              Active booking
            </h2>
            {detail.activeBooking ? (
              <dl className={styles.kv}>
                <dt>Reference</dt>
                <dd className={styles.mono}>{detail.activeBooking.reference}</dd>
                <dt>Service</dt>
                <dd>{detail.activeBooking.serviceName}</dd>
                <dt>When</dt>
                <dd>{formatDateTime(detail.activeBooking.startsAt)}</dd>
                <dt>Quantity</dt>
                <dd>{detail.activeBooking.quantity}</dd>
                <dt>Price</dt>
                <dd>{formatInrFromMinor(detail.activeBooking.estimatedPriceMinor)}</dd>
                <dt>Status</dt>
                <dd>{humanizeStatus(detail.activeBooking.status)}</dd>
              </dl>
            ) : (
              <p className={styles.muted}>No active booking.</p>
            )}
          </section>

          <section className={styles.panel} aria-labelledby="pending-title">
            <h2 id="pending-title" className={styles.panelTitle}>
              Pending action
            </h2>
            {detail.pendingAction ? (
              <dl className={styles.kv}>
                <dt>Type</dt>
                <dd>{humanizeStatus(detail.pendingAction.actionType)}</dd>
                <dt>Status</dt>
                <dd>{humanizeStatus(detail.pendingAction.status)}</dd>
                <dt>Expires</dt>
                <dd>{formatDateTime(detail.pendingAction.expiresAt)}</dd>
                <dt>Proposal</dt>
                <dd>{detail.pendingAction.proposalSummary ?? '—'}</dd>
              </dl>
            ) : (
              <p className={styles.muted}>No pending action.</p>
            )}
          </section>
        </div>
      </div>

      <section className={styles.panel} aria-labelledby="trace-title">
        <h2 id="trace-title" className={styles.panelTitle}>
          Operational trace
        </h2>
        {trace.operationalEvents.length === 0 ? (
          <p className={styles.muted}>No operational events recorded.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Event</th>
                  <th scope="col">Detail</th>
                </tr>
              </thead>
              <tbody>
                {trace.operationalEvents.map((event) => (
                  <tr key={event.id}>
                    <td>{formatDateTime(event.createdAt)}</td>
                    <td>{humanizeEventType(event.eventType)}</td>
                    <td>{event.detail ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.panel} aria-labelledby="tools-title">
        <h2 id="tools-title" className={styles.panelTitle}>
          Tool executions
        </h2>
        {trace.toolExecutions.length === 0 ? (
          <p className={styles.muted}>No tool executions recorded.</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Tool</th>
                  <th scope="col">Status</th>
                  <th scope="col">Duration</th>
                  <th scope="col">Error</th>
                </tr>
              </thead>
              <tbody>
                {trace.toolExecutions.map((execution) => (
                  <tr key={execution.id}>
                    <td>{formatDateTime(execution.createdAt)}</td>
                    <td className={styles.mono}>{execution.toolName}</td>
                    <td>
                      <StatusBadge
                        label={humanizeStatus(execution.status)}
                        tone={toolStatusTone(execution.status)}
                      />
                    </td>
                    <td>{execution.durationMs} ms</td>
                    <td>
                      {execution.errorCode
                        ? `${execution.errorCode}${execution.errorMessage ? `: ${execution.errorMessage}` : ''}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
