import styles from './twin.module.css';

/** A list of label and value pairs, one per line: what the selection card and the device inspector say of a thing. */
export function Facts({ rows }: { rows: readonly (readonly [label: string, value: string])[] }) {
  return (
    <dl className={styles.facts}>
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
