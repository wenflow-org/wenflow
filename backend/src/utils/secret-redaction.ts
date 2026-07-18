import { isSecretFieldName } from './secret-crypto'

const TEXT_PATTERNS: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]'],
  [/\bsk-[A-Za-z0-9_-]{12,}\b/g, 'sk-[REDACTED]'],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[JWT REDACTED]']
]

export function redactSecretText(value: string): string {
  return TEXT_PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value)
}

export function redactLogValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactSecretText(value)
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) return '[Circular]'
  seen.add(value)

  if (Array.isArray(value)) {
    return value.map(item => redactLogValue(item, seen))
  }

  const source = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(source)) {
    result[key] = isSecretFieldName(key) && item
      ? '[REDACTED]'
      : redactLogValue(item, seen)
  }
  return result
}

export function toSecretSafeResponse<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== 'object') return value
  if (seen.has(value as object)) return value
  seen.add(value as object)

  if (Array.isArray(value)) {
    return value.map(item => toSecretSafeResponse(item, seen)) as T
  }

  const source = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(source)) {
    if (isSecretFieldName(key)) {
      result[key] = ''
      result[`${key}Configured`] = Boolean(item)
      continue
    }
    result[key] = toSecretSafeResponse(item, seen)
  }
  return result as T
}

export function preserveConfiguredSecret<T extends Record<string, any>>(
  incoming: T,
  existing: T | null | undefined,
  fields: string[] = ['apiKey']
): T {
  const result: Record<string, any> = { ...incoming }
  for (const field of fields) {
    if ((result[field] === undefined || result[field] === null || result[field] === '') && existing?.[field]) {
      result[field] = existing[field]
    }
  }
  return result as T
}

export function preserveNestedSecretsById<T extends Record<string, any>>(
  incoming: T[],
  existing: T[],
  fields: string[] = []
): T[] {
  const existingById = new Map(
    existing
      .filter(item => item.id !== undefined && item.id !== null && String(item.id).trim())
      .map(item => [String(item.id), item])
  )
  return incoming.map(item => {
    const id = item.id !== undefined && item.id !== null ? String(item.id) : ''
    return preserveNestedSecrets(item, id ? existingById.get(id) : undefined, fields) as T
  })
}

export function preserveNestedSecrets(incoming: any, existing: any, fields: string[] = []): any {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return incoming
  const result: Record<string, any> = { ...incoming }
  for (const [key, value] of Object.entries(result)) {
    const secretField = isSecretFieldName(key) || fields.includes(key)
    if (secretField && (value === undefined || value === null || value === '') && existing?.[key]) {
      result[key] = existing[key]
      continue
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = preserveNestedSecrets(value, existing?.[key], fields)
    }
  }
  return result
}
