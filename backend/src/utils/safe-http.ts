import axios, { AxiosRequestConfig, Method, ResponseType } from 'axios'
import { lookup } from 'dns/promises'
import http from 'http'
import https from 'https'
import { isIP } from 'net'
import { canAccessPrivateNetwork } from '../services/runtime-network-policy.service'

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const DEFAULT_MAX_REDIRECTS = 3
const SENSITIVE_REDIRECT_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization'])

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeUrlError'
  }
}

export type SafeHttpRequestOptions = {
  method?: Method
  headers?: Record<string, string>
  body?: unknown
  timeoutMs?: number
  maxResponseBytes?: number
  maxRedirects?: number
  responseType?: ResponseType
}

export type SafeHttpResponse<T> = {
  status: number
  statusText: string
  headers: Record<string, string>
  data: T
  url: string
}

function parseIpv4(address: string): number[] | null {
  if (isIP(address) !== 4) return null
  const parts = address.split('.').map(Number)
  return parts.length === 4 && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null
}

function isLocalOrPrivateIpv4(address: string): boolean {
  const parts = parseIpv4(address)
  if (!parts) return false
  const [a, b] = parts

  return a === 10
    || a === 127
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
}

function isAlwaysBlockedIpv4(address: string): boolean {
  const parts = parseIpv4(address)
  if (!parts) return false
  const [a, b, c] = parts

  return a === 0
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 192 && b === 0 && c === 0)
    || (a === 192 && b === 0 && c === 2)
    || (a === 192 && b === 88 && c === 99)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224
}

function isLocalOrPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0]
  const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1]
  if (mappedIpv4) return isLocalOrPrivateIpv4(mappedIpv4)

  return normalized === '::1'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
}

function isAlwaysBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0]
  const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1]
  if (mappedIpv4) return isAlwaysBlockedIpv4(mappedIpv4)

  return normalized === '::'
    || /^fe[89ab]/.test(normalized)
    || normalized.startsWith('2001:db8:')
    || normalized.startsWith('ff')
}

export function isLocalOrPrivateAddress(address: string): boolean {
  const version = isIP(address)
  if (version === 4) return isLocalOrPrivateIpv4(address)
  if (version === 6) return isLocalOrPrivateIpv6(address)
  return false
}

export function isAlwaysBlockedAddress(address: string): boolean {
  const version = isIP(address)
  if (version === 4) return isAlwaysBlockedIpv4(address)
  if (version === 6) return isAlwaysBlockedIpv6(address)
  return true
}

export function isPrivateNetworkAddress(address: string): boolean {
  return isLocalOrPrivateAddress(address) || isAlwaysBlockedAddress(address)
}

function canAccessPrivateAddress(hostname: string, address: string): boolean {
  return canAccessPrivateNetwork(hostname, address)
}

function normalizeHeaders(headers: unknown): Record<string, string> {
  if (!headers || typeof headers !== 'object') return {}
  return Object.fromEntries(
    Object.entries(headers as Record<string, unknown>)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key.toLowerCase(), Array.isArray(value) ? value.join(', ') : String(value)])
  )
}

export async function validateExternalUrl(rawUrl: string): Promise<{ url: URL; address: string; family: 4 | 6 }> {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new UnsafeUrlError('URL 格式无效')
  }

  const allowedProtocols = process.env.NODE_ENV === 'production' ? new Set(['https:']) : new Set(['http:', 'https:'])
  if (!allowedProtocols.has(url.protocol)) {
    throw new UnsafeUrlError(process.env.NODE_ENV === 'production' ? '生产环境仅允许 HTTPS URL' : '仅允许 HTTP 或 HTTPS URL')
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError('URL 不允许包含用户名或密码')
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    const address = '127.0.0.1'
    if (!canAccessPrivateAddress(hostname, address)) {
      throw new UnsafeUrlError('生产环境不允许访问未授权的本机或局域网地址')
    }
    return { url, address, family: 4 }
  }

  const literalVersion = isIP(hostname)
  if (literalVersion) {
    if (isAlwaysBlockedAddress(hostname)) {
      throw new UnsafeUrlError('不允许访问 Link-local、元数据或保留地址')
    }
    if (isLocalOrPrivateAddress(hostname) && !canAccessPrivateAddress(hostname, hostname)) {
      throw new UnsafeUrlError('生产环境不允许访问未授权的本机或局域网地址')
    }
    return { url, address: hostname, family: literalVersion as 4 | 6 }
  }

  const addresses = await lookup(hostname, { all: true, verbatim: true })
  if (!addresses.length) {
    throw new UnsafeUrlError('域名未解析到可用地址')
  }
  if (addresses.some(item => isAlwaysBlockedAddress(item.address))) {
    throw new UnsafeUrlError('域名解析到了 Link-local、元数据或保留地址')
  }
  if (addresses.some(item => isLocalOrPrivateAddress(item.address) && !canAccessPrivateAddress(hostname, item.address))) {
    throw new UnsafeUrlError('域名解析到了未授权的本机或局域网地址')
  }

  return {
    url,
    address: addresses[0].address,
    family: addresses[0].family as 4 | 6
  }
}

export async function safeHttpRequest<T = unknown>(
  rawUrl: string,
  options: SafeHttpRequestOptions = {}
): Promise<SafeHttpResponse<T>> {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  let currentUrl = rawUrl

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const validated = await validateExternalUrl(currentUrl)
    const lookupPinned = (_hostname: string, _options: unknown, callback: (error: Error | null, address: string, family: number) => void) => {
      callback(null, validated.address, validated.family)
    }
    const config: AxiosRequestConfig = {
      method: options.method || 'GET',
      url: validated.url.toString(),
      headers: options.headers,
      data: options.body,
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      responseType: options.responseType || 'json',
      maxContentLength: options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      maxBodyLength: options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
      maxRedirects: 0,
      validateStatus: () => true,
      proxy: false,
      httpAgent: new http.Agent({ lookup: lookupPinned }),
      httpsAgent: new https.Agent({ lookup: lookupPinned })
    }

    const response = await axios.request<T>(config)
    const headers = normalizeHeaders(response.headers)

    if (response.status >= 300 && response.status < 400 && headers.location) {
      if (redirectCount >= maxRedirects) {
        throw new UnsafeUrlError('重定向次数过多')
      }
      const redirectUrl = new URL(headers.location, validated.url)
      const requestHasSensitiveHeaders = Object.keys(options.headers || {})
        .some(header => SENSITIVE_REDIRECT_HEADERS.has(header.toLowerCase()))
      if (requestHasSensitiveHeaders && redirectUrl.origin !== validated.url.origin) {
        throw new UnsafeUrlError('携带敏感凭证的请求不允许跨源重定向')
      }
      currentUrl = redirectUrl.toString()
      continue
    }

    return {
      status: response.status,
      statusText: response.statusText,
      headers,
      data: response.data,
      url: validated.url.toString()
    }
  }

  throw new UnsafeUrlError('重定向次数过多')
}
