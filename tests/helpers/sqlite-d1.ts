import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
export function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  let clock = 1800000000;
  sqlite.function("unixepoch", { varargs: true }, () => clock);
  sqlite.exec("PRAGMA foreign_keys=ON");
  for (const f of readdirSync("drizzle")
    .filter((f) => f.endsWith(".sql"))
    .sort())
    sqlite.exec(readFileSync("drizzle/" + f, "utf8"));
  function prepare(query: string, values: unknown[] = []): any {
    return {
      bind: (...v: unknown[]) => prepare(query, v),
      first: async (column?: string) => {
        const r = sqlite.prepare(query).get(...(values as any[]));
        return column ? (r?.[column] ?? null) : (r ?? null);
      },
      all: async () => ({
        success: true,
        results: sqlite.prepare(query).all(...(values as any[])),
        meta: {},
      }),
      run: async () => {
        const r = sqlite.prepare(query).run(...(values as any[]));
        return {
          success: true,
          results: [],
          meta: { changes: Number(r.changes) },
        };
      },
      _run: () => {
        const q = sqlite.prepare(query);
        const results = q.columns().length ? q.all(...(values as any[])) : [];
        if (!q.columns().length) q.run(...(values as any[]));
        return {
          success: true,
          results,
          meta: {
            changes: Number(sqlite.prepare("SELECT changes() c").get()?.c),
          },
        };
      },
    };
  }
  const db = {
    prepare,
    batch: async (statements: any[]) => {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((s) => s._run());
        sqlite.exec("COMMIT");
        return results;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  } as unknown as D1Database;
  return {
    db,
    sqlite,
    now: () => clock,
    advance: (seconds: number) => {
      clock += seconds;
    },
  };
}
