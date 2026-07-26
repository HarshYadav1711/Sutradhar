import { useState, type FormEvent } from 'react';

import styles from '../styles/console.module.css';

export type SignInProps = {
  onSubmit: (token: string) => void | Promise<void>;
  errorMessage?: string | null;
};

export function SignIn({ onSubmit, errorMessage }: SignInProps) {
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = token.trim();
    if (trimmed === '') {
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
      setToken('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.signIn}>
      <section className={styles.signInCard} aria-labelledby="sign-in-title">
        <h1 id="sign-in-title" className={styles.signInTitle}>
          Sutradhar operator access
        </h1>
        <p className={styles.signInBody}>
          Enter the configured admin API token to inspect conversations, bookings, and handoffs.
          The token is kept in this browser session only.
        </p>
        <form className={styles.signInForm} onSubmit={(event) => void handleSubmit(event)}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Admin API token</span>
            <input
              className={styles.input}
              type="password"
              name="operatorToken"
              autoComplete="off"
              spellCheck={false}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              required
              disabled={submitting}
            />
          </label>
          {errorMessage ? (
            <p className={styles.muted} role="alert">
              {errorMessage}
            </p>
          ) : null}
          <button
            type="submit"
            className={`${styles.button} ${styles.buttonPrimary}`}
            disabled={submitting}
          >
            {submitting ? 'Checking…' : 'Continue'}
          </button>
        </form>
      </section>
    </div>
  );
}
