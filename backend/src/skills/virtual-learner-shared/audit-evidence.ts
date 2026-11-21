/** Resolve a citation against the exact payload supplied to the evaluator. */
export function hasAuditEvidenceValue(source: string, root: unknown, path: string): boolean {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  if (parts[0] === source) parts.shift();
  let value = root;
  for (const key of parts) {
    if (!key || !value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, key)) return false;
    value = (value as Record<string, unknown>)[key];
  }
  if (typeof value === 'string') return !!value.trim();
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  return typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}
