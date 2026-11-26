// Ready only when the database answers and every registered migration is in the ledger.
// Deploying code before its migrations would otherwise pass /auth/health while login fails.
export async function checkReadiness(
  query: (sql: string) => Promise<Array<{ name: string }>>,
  expectedMigrations: readonly string[],
): Promise<boolean> {
  try {
    const applied = new Set((await query('SELECT name FROM public.migrations')).map((row) => row.name));
    return expectedMigrations.every((name) => applied.has(name));
  } catch {
    return false;
  }
}
