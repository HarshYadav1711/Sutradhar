import styles from './App.module.css';

export function App() {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <p className={styles.productName}>Sutradhar</p>
          <p className={styles.productTag}>Operator console</p>
        </div>
      </header>

      <main className={styles.main}>
        <section className={styles.empty} aria-labelledby="empty-title">
          <h1 id="empty-title" className={styles.emptyTitle}>
            Operational views are not available yet
          </h1>
          <p className={styles.emptyBody}>
            Conversations, bookings, handoffs, and the operational trace will appear here in a later
            stage. This shell is ready for those views.
          </p>
        </section>
      </main>
    </div>
  );
}
