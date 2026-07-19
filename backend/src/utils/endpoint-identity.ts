export function normalizeEndpointIdentity(value: unknown): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    return url.toString();
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

export function endpointsMatch(left: unknown, right: unknown): boolean {
  return normalizeEndpointIdentity(left) === normalizeEndpointIdentity(right);
}

export function resolveEndpointBoundSecret(
  endpoint: unknown,
  providedSecret: unknown,
  existingEndpoint: unknown,
  existingSecret: unknown
): string {
  const freshSecret = typeof providedSecret === 'string' ? providedSecret.trim() : '';
  if (freshSecret) return freshSecret;
  if (!endpointsMatch(endpoint, existingEndpoint)) return '';
  return typeof existingSecret === 'string' ? existingSecret.trim() : '';
}
