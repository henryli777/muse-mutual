import { DatabaseSync, type SQLInputValue } from "node:sqlite";

function binding(value: unknown): SQLInputValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "bigint" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(
      new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
    );
  }
  if (
    Array.isArray(value) &&
    value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
  ) {
    return new Uint8Array(value);
  }
  throw new TypeError("Unsupported SQLite binding value");
}

/** The D1 methods used by the application, backed by one synchronous connection. */
export function createSqliteD1(sqlite: DatabaseSync): D1Database {
  sqlite.exec(
    "PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON",
  );
  const executions = new WeakMap<D1PreparedStatement, () => D1Result>();

  function execute(query: string, values: SQLInputValue[]): D1Result {
    const started = performance.now();
    const before = Number(
      sqlite.prepare("SELECT total_changes() AS n").get()?.n,
    );
    const statement = sqlite.prepare(query);
    // all() also executes writes and returns [] when they have no RETURNING.
    // This works on Node 22.13 without the newer StatementSync.columns() API.
    const results = statement.all(...values);
    const counts = sqlite
      .prepare(
        "SELECT total_changes() AS total, changes() AS changes, last_insert_rowid() AS id",
      )
      .get()!;
    // SQLite changes() retains the previous write's result after a SELECT. Only
    // expose it when this statement actually wrote, so retries report zero.
    const changed = Number(counts.total) !== before;
    const changes = changed ? Number(counts.changes) : 0;
    const pageCount = Number(
      sqlite.prepare("PRAGMA page_count").get()?.page_count,
    );
    const pageSize = Number(
      sqlite.prepare("PRAGMA page_size").get()?.page_size,
    );
    return {
      success: true,
      results,
      meta: {
        changes,
        changed_db: changed,
        last_row_id: Number(counts.id),
        duration: performance.now() - started,
        size_after: pageCount * pageSize,
        rows_read: results.length,
        rows_written: changes,
      },
    };
  }

  function prepare(
    query: string,
    values: SQLInputValue[] = [],
  ): D1PreparedStatement {
    const statement: D1PreparedStatement = {
      bind: (...next: unknown[]) => prepare(query, next.map(binding)),
      first: async <T = Record<string, unknown>>(
        column?: string,
      ): Promise<T | null> => {
        const row = execute(query, values).results[0] as
          | Record<string, unknown>
          | undefined;
        if (!row) return null;
        if (column === undefined) return row as T;
        if (!Object.hasOwn(row, column))
          throw new Error("Column does not exist: " + column);
        return (row[column] ?? null) as T | null;
      },
      all: async <T = Record<string, unknown>>() =>
        execute(query, values) as D1Result<T>,
      run: async <T = Record<string, unknown>>() =>
        execute(query, values) as D1Result<T>,
      raw: async () => {
        throw new Error(
          "Raw D1 queries are not used by the self-hosted application",
        );
      },
    };
    executions.set(statement, () => execute(query, values));
    return statement;
  }

  const db = {
    prepare,
    batch: async <T = unknown>(
      statements: D1PreparedStatement[],
    ): Promise<D1Result<T>[]> => {
      const run = statements.map((statement) => {
        const execution = executions.get(statement);
        if (!execution)
          throw new Error("Batch statement belongs to a different connection");
        return execution;
      });
      if (!run.length) return [];
      // No await occurs inside this transaction. Every write, including the
      // claim state and counter update, commits together or rolls back together.
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = run.map((execution) => execution() as D1Result<T>);
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        try {
          sqlite.exec("ROLLBACK");
        } catch {
          // A SQLite ROLLBACK conflict can already have ended the transaction.
        }
        throw error;
      }
    },
  } satisfies Pick<D1Database, "prepare" | "batch">;
  // Migrations operate directly on the separately exposed SQLite connection.
  // D1 sessions, dump and exec are not part of the repository's runtime contract.
  return db as D1Database;
}

export function openSqliteD1(path: string): {
  db: D1Database;
  sqlite: DatabaseSync;
  close: () => void;
} {
  const sqlite = new DatabaseSync(path);
  try {
    return { db: createSqliteD1(sqlite), sqlite, close: () => sqlite.close() };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
