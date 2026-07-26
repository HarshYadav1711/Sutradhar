import styles from '../styles/console.module.css';

export type StatePanelProps = {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function StatePanel({ title, body, actionLabel, onAction }: StatePanelProps) {
  return (
    <section className={styles.statePanel} role="status">
      <h2 className={styles.statePanelTitle}>{title}</h2>
      <p className={styles.statePanelBody}>{body}</p>
      {actionLabel && onAction ? (
        <button type="button" className={styles.button} onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </section>
  );
}
