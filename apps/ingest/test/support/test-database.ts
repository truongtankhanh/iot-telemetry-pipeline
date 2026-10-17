import type { Pool } from 'pg';

/**
 * Empties the database behind `db`, which the e2e suite owns (V1-T03). e2e-env.js has already
 * refused any `TEST_DATABASE_URL` whose name does not end in `_test`; this is the second line of
 * defence, on the name the server reports and not the one in the URL. Every spec file calls it
 * before it touches the schema.
 */
export async function resetTestDatabase(db: Pool): Promise<void> {
  const { rows } = await db.query<{ name: string }>('SELECT current_database() AS name');
  if (!rows[0]!.name.endsWith('_test')) {
    throw new Error(`Refusing to wipe "${rows[0]!.name}": its name does not end in "_test"`);
  }
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
}
