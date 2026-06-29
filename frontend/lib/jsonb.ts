/**
 * coerceJsonb — read a jsonb column safely regardless of how it was written.
 *
 * THE postgres.js trap (verified): a jsonb value written `${JSON.stringify(x)}::jsonb`
 * double-encodes and reads back as a STRING (JSON text), while a value written via
 * `sql.json(x)` or a DDL DEFAULT reads back PARSED. A string still has .indexOf /
 * .includes / .length / for..of, so array/object ops silently MISBEHAVE (iterate
 * characters, substring-match, char-count) instead of throwing — corrupting data.
 *
 * Use this at every read site that consumes a jsonb column as an object/array.
 * For new writes prefer `sql.json(x)` so the value round-trips parsed; this keeps
 * existing string-encoded rows correct too. Returns `fallback` on null/parse-failure.
 */
export function coerceJsonb<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return (parsed == null ? fallback : parsed) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}
