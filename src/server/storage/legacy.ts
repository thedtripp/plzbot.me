import type pg from "pg";
import type { Fingerprint } from "../../shared/schema/types.js";
import { describeVisit } from "./dedupe.js";
import { INSERT_VISIT, visitParams } from "./schema.js";

interface LegacyRow {
  id: string;
  seen_at: string;
  kind: string;
  ip: string | null;
  doc: Fingerprint;
}

/**
 * One-time move from the original layout (a single `fingerprints` table with one full document
 * per visit) to fingerprint_docs + visits. Safe to run repeatedly: inserts are idempotent, and the
 * old table is only RENAMED (to fingerprints_legacy) after every row has been copied, never
 * deleted. If anything fails it is logged and retried on the next start.
 */
export async function migrateLegacy(pool: pg.Pool, log: (msg: string) => void): Promise<void> {
  try {
    const exists = await pool.query("SELECT to_regclass('public.fingerprints') AS t");
    if (!exists.rows[0].t) return;

    let moved = 0;
    let skipped = 0;
    // Keyset pagination: each page starts after the last (seen_at, id) of the previous one.
    const page = async (after: { seen_at: string; id: string } | null): Promise<LegacyRow[]> =>
      (
        await pool.query<LegacyRow>(
          `SELECT id, to_char(seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS seen_at, kind, host(client_ip) AS ip, doc
           FROM fingerprints ${after ? "WHERE (seen_at, id) > ($1::timestamptz, $2::uuid)" : ""} ORDER BY seen_at, id LIMIT 200`,
          after ? [after.seen_at, after.id] : [],
        )
      ).rows;
    let cursor: { seen_at: string; id: string } | null = null;
    for (;;) {
      const rows: LegacyRow[] = await page(cursor);
      if (rows.length === 0) break;
      for (const r of rows) {
        try {
          await pool.query(INSERT_VISIT, visitParams(r.doc, describeVisit(r.doc), r.id, r.seen_at, r.kind, r.ip));
          moved++;
        } catch (err) {
          skipped++;
          log(`[store] legacy record ${r.id} not migrated: ${(err as Error).message}`);
        }
      }
      const last = rows[rows.length - 1]!;
      cursor = { seen_at: last.seen_at, id: last.id };
    }

    if (skipped === 0) await pool.query("ALTER TABLE fingerprints RENAME TO fingerprints_legacy");
    const docs = (await pool.query("SELECT count(*)::int AS n FROM fingerprint_docs")).rows[0].n;
    log(`[store] migrated ${moved} legacy record(s) into ${docs} distinct fingerprint(s)${skipped ? `; ${skipped} skipped, old table kept in place` : "; old table kept as fingerprints_legacy"}`);
  } catch (err) {
    log(`[store] legacy migration failed (will retry on next start): ${(err as Error).message}`);
  }
}
