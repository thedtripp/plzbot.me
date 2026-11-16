import type pg from "pg";

/**
 * The store creates its tables (and moves any legacy `fingerprints` table into them) in the
 * background at startup. Wait for that to finish, then start the test from empty tables.
 */
export async function resetStoreTables(db: pg.Pool): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const r = await db.query("SELECT to_regclass('public.visits') AS visits, to_regclass('public.suppressed_fingerprints') AS s, to_regclass('public.fingerprints') AS legacy");
    if (r.rows[0].visits && r.rows[0].s && !r.rows[0].legacy) break;
    await new Promise((res) => setTimeout(res, 50));
  }
  await db.query("TRUNCATE visits, fingerprint_docs, suppressed_fingerprints");
}
