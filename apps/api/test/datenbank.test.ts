import postgres from "postgres";
import { afterAll, expect, test } from "vitest";

// Prüft nur, dass die Datenbank aus docker-compose.yml bzw. der Service der CI erreichbar ist
const sql = postgres(
  process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/cevi_os",
);

afterAll(() => sql.end());

test("PostgreSQL 18 ist erreichbar", async () => {
  const [zeile] =
    await sql`select current_setting('server_version_num')::int as version`;
  expect(zeile.version).toBeGreaterThanOrEqual(180000);
});
