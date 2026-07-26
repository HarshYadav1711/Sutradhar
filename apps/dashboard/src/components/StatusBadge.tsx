import type { StatusTone } from '../lib/statusTone';
import styles from '../styles/console.module.css';

const TONE_CLASS: Record<StatusTone, string | undefined> = {
  default: undefined,
  ok: styles.badgeOk,
  warn: styles.badgeWarn,
  danger: styles.badgeDanger,
  accent: styles.badgeAccent,
};

export function StatusBadge({ label, tone = 'default' }: { label: string; tone?: StatusTone }) {
  const toneClass = TONE_CLASS[tone];
  return <span className={[styles.badge, toneClass].filter(Boolean).join(' ')}>{label}</span>;
}
