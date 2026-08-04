import { isSecretFieldName } from './secret-crypto'

const TEXT_PATTERNS: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]'],
  [/\bsk-[A-Za-z0-9_-]{12,}\b/g, 'sk-[REDACTED]'],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[JWT REDACTED]']
]
const OPAQUE_SECRET_CONTAINERS = new Set(['headers', 'env'])

function hasConfiguredSecret(value: unknown): boolean {
  return typeof value === 'string' ? Boolean(value.trim()) : Boolean(value)
}

function isBlankSecretValue(value: unknown): boolean {
  return value === undefined
    || value === null
    || (typeof value === 'string' && !value.trim())
}

export function redactSecretText(value: string): string {
  return TEXT_PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value)
}

function redactUrlQuery(value: string): string {
  try {
    const url = new URL(value)
    if (!url.search && !url.hash && !url.username && !url.password) return value
    url.username = ''
    url.password = ''
    for (const key of [...url.searchParams.keys()]) {
      url.searchParams.set(key, '[REDACTED]')
    }
    url.hash = ''
    return url.toString()
  } catch {
    return value
  }
}

export function redactLogValue(
  value: unknown,
  seen = new WeakSet<object>(),
  forceSecretStrings = false
): unknown {
  if (typeof value === 'string') return forceSecretStrings ? '[REDACTED]' : redactSecretText(value)
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) return '[Circular]'
  seen.add(value)

  if (Array.isArray(value)) {
    return value.map(item => redactLogValue(item, seen, forceSecretStrings))
  }

  const source = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(source)) {
    const forceChildSecrets = forceSecretStrings || OPAQUE_SECRET_CONTAINERS.has(key.toLowerCase())
    result[key] = (forceSecretStrings || isSecretFieldName(key)) && item
      ? '[REDACTED]'
      : redactLogValue(item, seen, forceChildSecrets)
  }
  return result
}

export function toSecretSafeResponse<T>(
  value: T,
  seen = new WeakSet<object>(),
  forceSecretStrings = false
): T {
  if (!value || typeof value !== 'object') return value
  if (seen.has(value as object)) return value
  seen.add(value as object)

  if (Array.isArray(value)) {
    return value.map(item => toSecretSafeResponse(item, seen, forceSecretStrings)) as T
  }

  const source = value as Record<string, unknown>
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(source)) {
    if (forceSecretStrings || isSecretFieldName(key)) {
      result[key] = ''
      result[`${key}Configured`] = hasConfiguredSecret(item)
      continue
    }
    const forceChildSecrets = OPAQUE_SECRET_CONTAINERS.has(key.toLowerCase())
    result[key] = key.toLowerCase().endsWith('endpoint') && typeof item === 'string'
      ? redactUrlQuery(redactSecretText(item))
      : toSecretSafeResponse(item, seen, forceChildSecrets)
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
    if (isBlankSecretValue(result[field]) && hasConfiguredSecret(existing?.[field])) {
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
      .map(item => [String(item.id).trim().toLowerCase(), item])
  )
  return incoming.map(item => {
    const id = item.id !== undefined && item.id !== null ? String(item.id).trim().toLowerCase() : ''
    return preserveNestedSecrets(item, id ? existingById.get(id) : undefined, fields) as T
  })
}

export function preserveNestedSecrets(
  incoming: any,
  existing: any,
  fields: string[] = [],
  forceSecretFields = false
): any {
  if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return incoming
  const result: Record<string, any> = { ...incoming }
  for (const [key, value] of Object.entries(result)) {
    const secretField = forceSecretFields || isSecretFieldName(key) || fields.includes(key)
    if (secretField && isBlankSecretValue(value) && hasConfiguredSecret(existing?.[key])) {
      result[key] = existing[key]
      continue
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = preserveNestedSecrets(
        value,
        existing?.[key],
        fields,
        forceSecretFields || OPAQUE_SECRET_CONTAINERS.has(key.toLowerCase())
      )
    }
  }
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    for (const [key, value] of Object.entries(existing)) {
      if (!Object.prototype.hasOwnProperty.call(result, key)) {
        const preserved = extractSecretSubtree(value, key, fields, forceSecretFields)
        if (preserved !== undefined) result[key] = preserved
      }
    }
  }
  return result
}

function extractSecretSubtree(
  value: any,
  key: string,
  fields: string[],
  forceSecretFields = false
): any {
  if (forceSecretFields || isSecretFieldName(key) || fields.includes(key)) {
    return hasConfiguredSecret(value) ? value : undefined
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const result: Record<string, any> = {}
  const forceChildSecrets = OPAQUE_SECRET_CONTAINERS.has(key.toLowerCase())
  for (const [childKey, childValue] of Object.entries(value)) {
    const preserved = extractSecretSubtree(childValue, childKey, fields, forceChildSecrets)
    if (preserved !== undefined) result[childKey] = preserved
  }
  return Object.keys(result).length > 0 ? result : undefined
}
