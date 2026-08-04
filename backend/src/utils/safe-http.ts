import axios, { AxiosRequestConfig, Method, ResponseType } from 'axios'
import { lookup } from 'dns/promises'
import http from 'http'
import https from 'https'
import { isIP } from 'net'
import { canAccessPrivateNetwork } from '../services/runtime-network-policy.service'

const DEFAULT_TIMEOUT_MS = 15_000
export const SAFE_HTTP_MAX_TIMEOUT_MS = 300_000
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const DEFAULT_MAX_REDIRECTS = 3
const SENSITIVE_REDIRECT_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization'])

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeUrlError'
  }
}

export class SafeHttpTimeoutError extends Error {
  code = 'ETIMEDOUT'

  constructor() {
    super('HTTP 请求超时')
    this.name = 'SafeHttpTimeoutError'
  }
}

export class SafeHttpAbortError extends Error {
  code = 'ERR_CANCELED'

  constructor() {
    super('HTTP 请求已取消')
    this.name = 'SafeHttpAbortError'
  }
}

export class SafeHttpBodyLimitError extends Error {
  code = 'BODY_LIMIT_EXCEEDED'

  constructor(maxResponseBytes: number) {
    super(`流式响应超过最大字节限制 ${maxResponseBytes}`)
    this.name = 'SafeHttpBodyLimitError'
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
  privateNetworkPolicy?: 'runtime' | 'public-only'
  signal?: AbortSignal
}

export type SafeHttpResponse<T> = {
  status: number
  statusText: string
  headers: Record<string, string>
  data: T
  url: string
}

export type SafeHttpStreamRequestOptions = {
  method?: Method
  headers?: Record<string, string>
  body?: unknown
  /** 响应头（首字节）超时预算；达到该预算仍未返回响应头即判定超时 */
  timeoutMs?: number
  /** 空闲超时：两次响应体数据块的最大间隔，收到数据即重置 */
  idleTimeoutMs?: number
  /** 累计响应体字节上限，超过则中断并抛 SafeHttpBodyLimitError */
  maxResponseBytes?: number
  privateNetworkPolicy?: 'runtime' | 'public-only'
  signal?: AbortSignal
  /** 响应头就绪时回调（在响应体数据之前同步触发） */
  onHeaders?: (status: number, headers: Record<string, string>) => void
  /** 每个响应体数据块回调 */
  onChunk?: (chunk: Buffer) => void
}

export type SafeHttpStreamResult = {
  status: number
  statusText: string
  headers: Record<string, string>
  url: string
  totalBytes: number
}

function buildPinnedLookup(validated: { address: string; family: 4 | 6 }) {
  return (
    _hostname: string,
    lookupOptions: { all?: boolean } | undefined,
    callback: (...args: any[]) => void
  ) => {
    if (lookupOptions?.all) {
      callback(null, [{ address: validated.address, family: validated.family }])
      return
    }
    callback(null, validated.address, validated.family)
  }
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

function parseIpv6Words(address: string): number[] | null {
  let normalized = address.toLowerCase().split('%')[0]
  if (isIP(normalized) !== 6) return null

  const lastColon = normalized.lastIndexOf(':')
  const dottedTail = normalized.slice(lastColon + 1)
  if (dottedTail.includes('.')) {
    const ipv4 = parseIpv4(dottedTail)
    if (!ipv4) return null
    const [a, b, c, d] = ipv4
    normalized = `${normalized.slice(0, lastColon)}:${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }

  const halves = normalized.split('::')
  if (halves.length > 2) return null
  const parseHalf = (value: string): number[] | null => {
    if (!value) return []
    const groups = value.split(':')
    if (groups.some(group => !/^[0-9a-f]{1,4}$/.test(group))) return null
    return groups.map(group => Number.parseInt(group, 16))
  }
  const left = parseHalf(halves[0])
  const right = parseHalf(halves[1] || '')
  if (!left || !right) return null

  if (halves.length === 1) return left.length === 8 ? left : null
  const omitted = 8 - left.length - right.length
  if (omitted < 1) return null
  return [...left, ...Array(omitted).fill(0), ...right]
}

function ipv6WordsToBytes(words: number[]): number[] {
  return words.flatMap(word => [word >> 8, word & 0xff])
}

type Nat64Prefix = { bytes: number[]; prefixLength: 32 | 40 | 48 | 56 | 64 | 96 }

function getConfiguredNat64Prefixes(): Nat64Prefix[] {
  const serialized = String(process.env.SAFE_HTTP_NAT64_PREFIXES || '').trim()
  if (!serialized) return []

  return serialized.split(',').map(rawEntry => {
    const entry = rawEntry.trim().toLowerCase()
    const [rawAddress, rawLength, ...extra] = entry.split('/')
    const prefixLength = Number(rawLength)
    const words = parseIpv6Words(rawAddress)
    const bytes = words ? ipv6WordsToBytes(words) : []
    const prefixBytes = prefixLength / 8
    if (extra.length > 0
      || !words
      || ![32, 40, 48, 56, 64, 96].includes(prefixLength)
      || bytes.slice(prefixBytes).some(byte => byte !== 0)) {
      throw new UnsafeUrlError(`SAFE_HTTP_NAT64_PREFIXES 配置无效: ${rawEntry.trim()}`)
    }
    return {
      bytes,
      prefixLength: prefixLength as Nat64Prefix['prefixLength']
    }
  }).sort((left, right) => right.prefixLength - left.prefixLength)
}

export function validateSafeHttpConfig(): void {
  getConfiguredNat64Prefixes()
}

function extractConfiguredNat64Ipv4(words: number[]): string | null {
  const addressBytes = ipv6WordsToBytes(words)
  for (const prefix of getConfiguredNat64Prefixes()) {
    const prefixBytes = prefix.prefixLength / 8
    if (!prefix.bytes.slice(0, prefixBytes).every((byte, index) => addressBytes[index] === byte)) {
      continue
    }

    let ipv4: number[]
    if (prefix.prefixLength === 96) {
      ipv4 = addressBytes.slice(12, 16)
    } else {
      if (addressBytes[8] !== 0) continue
      const beforeReservedOctet = (64 - prefix.prefixLength) / 8
      ipv4 = [
        ...addressBytes.slice(prefixBytes, prefixBytes + beforeReservedOctet),
        ...addressBytes.slice(9, 9 + (4 - beforeReservedOctet))
      ]
    }
    return ipv4.join('.')
  }
  return null
}

function extractEmbeddedIpv4(address: string): string | null {
  const words = parseIpv6Words(address)
  if (!words) return null

  const ipv4Compatible = words.slice(0, 6).every(word => word === 0)
    && (words[6] !== 0 || words[7] > 1)
  const ipv4Mapped = words.slice(0, 5).every(word => word === 0) && words[5] === 0xffff
  const ipv4Translatable = words.slice(0, 4).every(word => word === 0)
    && words[4] === 0xffff
    && words[5] === 0
  const nat64WellKnown = words[0] === 0x64
    && words[1] === 0xff9b
    && words.slice(2, 6).every(word => word === 0)
  const isatap = (words[4] === 0 || words[4] === 0x200) && words[5] === 0x5efe
  if (!ipv4Compatible && !ipv4Mapped && !ipv4Translatable && !nat64WellKnown && !isatap) {
    return extractConfiguredNat64Ipv4(words)
  }

  return [
    words[6] >> 8,
    words[6] & 0xff,
    words[7] >> 8,
    words[7] & 0xff
  ].join('.')
}

function isLocalOrPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0]
  const embeddedIpv4 = extractEmbeddedIpv4(normalized)
  if (embeddedIpv4 && isLocalOrPrivateIpv4(embeddedIpv4)) return true

  return normalized === '::1'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
}

function isAlwaysBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split('%')[0]
  const embeddedIpv4 = extractEmbeddedIpv4(normalized)
  if (embeddedIpv4 && isAlwaysBlockedIpv4(embeddedIpv4)) return true
  const words = parseIpv6Words(normalized)
  if (!words) return true

  return normalized === '::'
    || /^fe[89ab]/.test(normalized)
    || /^fe[c-f]/.test(normalized)
    || (words[0] === 0x64 && words[1] === 0xff9b && words[2] === 1)
    || (words[0] === 0x100 && words.slice(1, 4).every(word => word === 0))
    || (words[0] === 0x2001 && words[1] === 0)
    || normalized.startsWith('2001:db8:')
    || words[0] === 0x2002
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

function canAccessPrivateAddress(
  hostname: string,
  address: string,
  privateNetworkPolicy: SafeHttpRequestOptions['privateNetworkPolicy'] = 'runtime'
): boolean {
  if (privateNetworkPolicy === 'public-only') return false
  return canAccessPrivateNetwork(hostname, address)
}

function privateAddressDeniedMessage(
  privateNetworkPolicy: SafeHttpRequestOptions['privateNetworkPolicy'],
  resolvedFromDomain = false
): string {
  if (privateNetworkPolicy === 'public-only') {
    return resolvedFromDomain
      ? '域名解析到了当前调用不允许访问的本机或局域网地址'
      : '当前调用不允许访问本机或局域网地址'
  }
  return resolvedFromDomain
    ? '域名解析到了未授权的本机或局域网地址'
    : '生产环境不允许访问未授权的本机或局域网地址'
}

function normalizeHeaders(headers: unknown): Record<string, string> {
  if (!headers || typeof headers !== 'object') return {}
  return Object.fromEntries(
    Object.entries(headers as Record<string, unknown>)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key.toLowerCase(), Array.isArray(value) ? value.join(', ') : String(value)])
  )
}

function waitForAbortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(new SafeHttpAbortError())

  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new SafeHttpAbortError())
    signal.addEventListener('abort', abort, { once: true })
    promise.then(
      value => {
        signal.removeEventListener('abort', abort)
        resolve(value)
      },
      error => {
        signal.removeEventListener('abort', abort)
        reject(error)
      }
    )
  })
}

export async function validateExternalUrl(
  rawUrl: string,
  options: Pick<SafeHttpRequestOptions, 'privateNetworkPolicy' | 'signal'> = {}
): Promise<{ url: URL; address: string; family: 4 | 6 }> {
  if (options.signal?.aborted) throw new SafeHttpAbortError()
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new UnsafeUrlError('URL 格式无效')
  }

  const allowedProtocols = process.env.NODE_ENV === 'production' || options.privateNetworkPolicy === 'public-only'
    ? new Set(['https:'])
    : new Set(['http:', 'https:'])
  if (!allowedProtocols.has(url.protocol)) {
    throw new UnsafeUrlError(
      process.env.NODE_ENV === 'production' || options.privateNetworkPolicy === 'public-only'
        ? '当前调用仅允许 HTTPS URL'
        : '仅允许 HTTP 或 HTTPS URL'
    )
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError('URL 不允许包含用户名或密码')
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    const address = '127.0.0.1'
    if (!canAccessPrivateAddress(hostname, address, options.privateNetworkPolicy)) {
      throw new UnsafeUrlError(privateAddressDeniedMessage(options.privateNetworkPolicy))
    }
    return { url, address, family: 4 }
  }

  const literalVersion = isIP(hostname)
  if (literalVersion) {
    if (isAlwaysBlockedAddress(hostname)) {
      throw new UnsafeUrlError('不允许访问 Link-local、元数据或保留地址')
    }
    if (isLocalOrPrivateAddress(hostname) && !canAccessPrivateAddress(hostname, hostname, options.privateNetworkPolicy)) {
      throw new UnsafeUrlError(privateAddressDeniedMessage(options.privateNetworkPolicy))
    }
    return { url, address: hostname, family: literalVersion as 4 | 6 }
  }

  const addresses = await waitForAbortable(
    lookup(hostname, { all: true, verbatim: true }),
    options.signal
  )
  if (!addresses.length) {
    throw new UnsafeUrlError('域名未解析到可用地址')
  }
  if (addresses.some(item => isAlwaysBlockedAddress(item.address))) {
    throw new UnsafeUrlError('域名解析到了 Link-local、元数据或保留地址')
  }
  if (addresses.some(item => isLocalOrPrivateAddress(item.address)
    && !canAccessPrivateAddress(hostname, item.address, options.privateNetworkPolicy))) {
    throw new UnsafeUrlError(privateAddressDeniedMessage(options.privateNetworkPolicy, true))
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
  const timeoutMs = Number.isFinite(options.timeoutMs) && Number(options.timeoutMs) > 0
    ? Math.min(Math.floor(Number(options.timeoutMs)), SAFE_HTTP_MAX_TIMEOUT_MS)
    : DEFAULT_TIMEOUT_MS
  const deadline = Date.now() + timeoutMs
  const abortController = new AbortController()
  let timedOut = false
  let abortedByCaller = Boolean(options.signal?.aborted)
  const abortFromCaller = () => {
    abortedByCaller = true
    abortController.abort()
  }
  options.signal?.addEventListener('abort', abortFromCaller, { once: true })
  if (abortedByCaller) abortController.abort()
  const timeout = setTimeout(() => {
    timedOut = true
    abortController.abort()
  }, timeoutMs)
  timeout.unref?.()
  let currentUrl = rawUrl

  try {
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      const validated = await validateExternalUrl(currentUrl, {
        privateNetworkPolicy: options.privateNetworkPolicy,
        signal: abortController.signal
      })
      const remainingMs = deadline - Date.now()
      if (remainingMs <= 0) throw new SafeHttpTimeoutError()
      const lookupPinned = buildPinnedLookup(validated)
      const config: AxiosRequestConfig = {
        method: options.method || 'GET',
        url: validated.url.toString(),
        headers: options.headers,
        data: options.body,
        timeout: remainingMs,
        signal: abortController.signal,
        responseType: options.responseType || 'json',
        maxContentLength: options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
        maxBodyLength: options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
        maxRedirects: 0,
        validateStatus: () => true,
        proxy: false,
        httpAgent: new http.Agent({ lookup: lookupPinned }),
        httpsAgent: new https.Agent({ lookup: lookupPinned })
      }

      const response = await waitForAbortable(
        axios.request<T>(config),
        abortController.signal
      )
      if (Date.now() >= deadline) throw new SafeHttpTimeoutError()
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
  } catch (error) {
    if (timedOut || Date.now() >= deadline) throw new SafeHttpTimeoutError()
    if (abortedByCaller) throw new SafeHttpAbortError()
    throw error
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', abortFromCaller)
  }
}

/**
 * 流式 HTTP 请求（SSE / chunked 透传）。
 *
 * 与 safeHttpRequest 保持同等安全基线：validateExternalUrl 校验、
 * DNS pinning（防重绑定）、私网策略、调用方 AbortSignal 传播、禁止跨源重定向。
 *
 * 超时模型区别于缓冲式请求的单死线：
 * - timeoutMs 覆盖「请求发出 → 响应头就绪」（TTFT 预算）
 * - idleTimeoutMs 覆盖「响应体数据块之间的最大间隔」，收到数据即重置
 * - 累计字节超过 maxResponseBytes 时中断并抛 SafeHttpBodyLimitError
 *
 * 响应头先于响应体到达：onHeaders 在首个数据块前同步触发，调用方可在
 * 收到错误状态码时决定是否继续消费响应体。
 */
export async function safeHttpStreamRequest(
  rawUrl: string,
  options: SafeHttpStreamRequestOptions = {}
): Promise<SafeHttpStreamResult> {
  const timeoutMs = Number.isFinite(options.timeoutMs) && Number(options.timeoutMs) > 0
    ? Math.min(Math.floor(Number(options.timeoutMs)), SAFE_HTTP_MAX_TIMEOUT_MS)
    : DEFAULT_TIMEOUT_MS
  const idleTimeoutMs = Number.isFinite(options.idleTimeoutMs) && Number(options.idleTimeoutMs) > 0
    ? Math.min(Math.floor(Number(options.idleTimeoutMs)), SAFE_HTTP_MAX_TIMEOUT_MS)
    : 60_000
  const maxResponseBytes = Number.isFinite(options.maxResponseBytes) && Number(options.maxResponseBytes) > 0
    ? Math.floor(Number(options.maxResponseBytes))
    : 20 * 1024 * 1024

  const abortController = new AbortController()
  let timedOut = false
  let abortedByCaller = Boolean(options.signal?.aborted)
  let bodyLimitExceeded = false
  const abortFromCaller = () => {
    abortedByCaller = true
    abortController.abort()
  }
  options.signal?.addEventListener('abort', abortFromCaller, { once: true })
  if (abortedByCaller) abortController.abort()

  const ttftTimer = setTimeout(() => {
    timedOut = true
    abortController.abort()
  }, timeoutMs)
  ttftTimer.unref?.()

  try {
    const validated = await validateExternalUrl(rawUrl, {
      privateNetworkPolicy: options.privateNetworkPolicy,
      signal: abortController.signal
    })
    const lookupPinned = buildPinnedLookup(validated)
    const config: AxiosRequestConfig = {
      method: options.method || 'POST',
      url: validated.url.toString(),
      headers: options.headers,
      data: options.body,
      signal: abortController.signal,
      responseType: 'stream',
      maxRedirects: 0,
      validateStatus: () => true,
      proxy: false,
      httpAgent: new http.Agent({ lookup: lookupPinned }),
      httpsAgent: new https.Agent({ lookup: lookupPinned })
    }

    const response = await waitForAbortable(
      axios.request(config),
      abortController.signal
    )
    clearTimeout(ttftTimer)
    const headers = normalizeHeaders(response.headers)
    options.onHeaders?.(response.status, headers)

    const stream: NodeJS.ReadableStream = response.data
    return await new Promise<SafeHttpStreamResult>((resolve, reject) => {
      let idleTimer: NodeJS.Timeout | null = null
      let totalBytes = 0
      let settled = false

      const cleanup = () => {
        if (idleTimer) clearTimeout(idleTimer)
        abortController.signal.removeEventListener('abort', onAbort)
      }
      const settle = (action: () => void) => {
        if (settled) return
        settled = true
        action()
      }
      const fail = (error: Error) => settle(() => {
        cleanup()
        if (timedOut) reject(new SafeHttpTimeoutError())
        else if (abortedByCaller) reject(new SafeHttpAbortError())
        else if (bodyLimitExceeded) reject(new SafeHttpBodyLimitError(maxResponseBytes))
        else reject(error)
      })
      const resetIdle = () => {
        if (idleTimer) clearTimeout(idleTimer)
        idleTimer = setTimeout(() => {
          timedOut = true
          abortController.abort()
        }, idleTimeoutMs)
        idleTimer.unref?.()
      }
      const onAbort = () => fail(new SafeHttpAbortError())

      abortController.signal.addEventListener('abort', onAbort)
      resetIdle()
      stream.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length
        if (totalBytes > maxResponseBytes) {
          bodyLimitExceeded = true
          abortController.abort()
          return
        }
        options.onChunk?.(chunk)
        resetIdle()
      })
      stream.on('end', () => {
        settle(() => {
          cleanup()
          resolve({
            status: response.status,
            statusText: response.statusText,
            headers,
            url: validated.url.toString(),
            totalBytes
          })
        })
      })
      stream.on('error', (error) => fail(error))
    })
  } catch (error) {
    if (timedOut) throw new SafeHttpTimeoutError()
    if (abortedByCaller) throw new SafeHttpAbortError()
    if (bodyLimitExceeded) throw new SafeHttpBodyLimitError(maxResponseBytes)
    throw error
  } finally {
    clearTimeout(ttftTimer)
    options.signal?.removeEventListener('abort', abortFromCaller)
  }
}
