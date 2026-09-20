import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getTestPrisma } from './test/helpers/db.js';

/** Hand-maintained partial unique indexes — not expressible in schema.prisma. */
const HAND_MAINTAINED = ['items_household_barcode_active_key', 'sli_household_item_open_key'] as const;

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'prisma', 'migrations');

function migrationFiles(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({ name: e.name, sql: readFileSync(join(MIGRATIONS_DIR, e.name, 'migration.sql'), 'utf8') }));
}

describe('hand-maintained partial unique indexes', () => {
  it('both exist in the live database', async () => {
    const rows = await getTestPrisma().$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE indexname IN ('items_household_barcode_active_key', 'sli_household_item_open_key')
    `;
    expect(rows.map((r) => r.indexname).sort()).toEqual([...HAND_MAINTAINED].sort());
  });

  it('no migration drops either of them', () => {
    const files = migrationFiles();
    expect(files.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const { name, sql } of files) {
      for (const index of HAND_MAINTAINED) {
        // `DROP INDEX [IF EXISTS] "name"` / unquoted, any casing.
        const re = new RegExp(`DROP\\s+INDEX[^;]*\\b"?${index}"?\\b`, 'i');
        if (re.test(sql)) offenders.push(`${name}: drops ${index}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
