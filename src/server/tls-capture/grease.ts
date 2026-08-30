/**
 * GREASE values per RFC 8701 (https://www.rfc-editor.org/rfc/rfc8701).
 * Clients (notably Chromium) insert these reserved values into cipher suite lists,
 * extension lists, supported groups, etc. so servers don't ossify around a fixed set.
 * JA3/JA4 both exclude GREASE values before hashing, since they're randomized per
 * connection and would otherwise make every fingerprint unique.
 */
export const GREASE_VALUES: ReadonlySet<number> = new Set(
  Array.from({ length: 16 }, (_, i) => 0x0a0a + i * 0x1010),
);

export function isGrease(value: number): boolean {
  return GREASE_VALUES.has(value);
}
