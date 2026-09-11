import systemPrisma from '../config/system-database'
import { logger } from '../utils/logger'

export type AdminAccessMode = 'loopback' | 'private' | 'any'

export type RuntimeNetworkPolicy = {
  adminAccessMode: AdminAccessMode
  adminAllowedIps: string[]
  allowPrivateNetwork: boolean
  privateNetworkHosts: string[]
  source: 'database' | 'environment'
}

function parseList(value?: string | null): string[] {
  return Array.from(new Set(
    String(value || '')
      .split(',')
      .map(item => item.trim().toLowerCase().replace(/^\[|\]$/g, ''))
      .filter(Boolean)
  ))
}

function parseAdminAccessMode(value?: string | null): AdminAccessMode {
  return value === 'loopback' || value === 'any' ? value : 'private'
}

/**
 * 生产环境访问范围门禁：'any'（不限制来源）在生产被降级为 'private'。
 * 说明：'private' 仍允许通过 ADMIN_ALLOWED_IPS 精确放行公网管理 IP，
 * 因此降级不阻断受控远程管理，只关闭“无限制来源”这一高风险姿态。
 * 纯函数、显式传入 isProduction，便于单测。
 */
export function applyProductionAccessGuard(mode: AdminAccessMode, isProduction: boolean): AdminAccessMode {
  return isProduction && mode === 'any' ? 'private' : mode
}

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production'
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback
  return value.trim().toLowerCase() === 'true'
}

function environmentDefaults(): RuntimeNetworkPolicy {
  const legacyMode = process.env.ADMIN_LOCALHOST_ONLY === 'false' ? 'any' : 'private'
  return {
    adminAccessMode: parseAdminAccessMode(process.env.ADMIN_ACCESS_MODE || legacyMode),
    adminAllowedIps: parseList(process.env.ADMIN_ALLOWED_IPS),
    allowPrivateNetwork: parseBoolean(
      process.env.SAFE_HTTP_ALLOW_PRIVATE_NETWORK,
      process.env.NODE_ENV !== 'production'
    ),
    privateNetworkHosts: parseList(process.env.SAFE_HTTP_PRIVATE_HOSTS),
    source: 'environment'
  }
}

let currentPolicy = environmentDefaults()

export function getRuntimeNetworkPolicy(): RuntimeNetworkPolicy {
  return {
    ...currentPolicy,
    adminAllowedIps: [...currentPolicy.adminAllowedIps],
    privateNetworkHosts: [...currentPolicy.privateNetworkHosts]
  }
}

export function canAccessPrivateNetwork(hostname: string, address: string): boolean {
  if (currentPolicy.allowPrivateNetwork) return true
  const allowed = new Set(currentPolicy.privateNetworkHosts)
  return allowed.has(hostname.toLowerCase()) || allowed.has(address.toLowerCase())
}

export async function refreshRuntimeNetworkPolicy(): Promise<RuntimeNetworkPolicy> {
  const defaults = environmentDefaults()
  try {
    const config = await systemPrisma.platform_api_configs.findUnique({
      where: { id: 'platform' },
      select: {
        adminAccessMode: true,
        adminAllowedIps: true,
        allowPrivateNetwork: true,
        privateNetworkHosts: true
      }
    })

    currentPolicy = config
      ? {
          adminAccessMode: config.adminAccessMode
            ? parseAdminAccessMode(config.adminAccessMode)
            : defaults.adminAccessMode,
          adminAllowedIps: config.adminAllowedIps !== null
            ? parseList(config.adminAllowedIps)
            : defaults.adminAllowedIps,
          allowPrivateNetwork: config.allowPrivateNetwork ?? defaults.allowPrivateNetwork,
          privateNetworkHosts: config.privateNetworkHosts !== null
            ? parseList(config.privateNetworkHosts)
            : defaults.privateNetworkHosts,
          source: config.adminAccessMode !== null
            || config.adminAllowedIps !== null
            || config.allowPrivateNetwork !== null
            || config.privateNetworkHosts !== null
            ? 'database'
            : 'environment'
        }
      : defaults

    // 生产门禁：DB/env 解析出的 'any' 在生产强制降级为 'private'（QA 遗留项 4）
    const rawMode = currentPolicy.adminAccessMode
    const guardedMode = applyProductionAccessGuard(rawMode, isProduction())
    if (guardedMode !== rawMode) {
      logger.warn('生产环境禁止 Admin 访问范围为 any，已自动降级为 private（如需远程管理请用 ADMIN_ALLOWED_IPS 精确放行）', {
        requested: rawMode,
        effective: guardedMode
      })
      currentPolicy = { ...currentPolicy, adminAccessMode: guardedMode }
    }
  } catch (error) {
    currentPolicy = defaults
    logger.warn('加载运行时网络策略失败，使用环境变量默认值', {
      error: error instanceof Error ? error.message : String(error)
    })
  }

  return getRuntimeNetworkPolicy()
}

export async function updateRuntimeNetworkPolicy(input: {
  adminAccessMode: AdminAccessMode
  adminAllowedIps: string[]
  allowPrivateNetwork: boolean
  privateNetworkHosts: string[]
}): Promise<RuntimeNetworkPolicy> {
  const normalized = {
    adminAccessMode: parseAdminAccessMode(input.adminAccessMode),
    adminAllowedIps: parseList(input.adminAllowedIps.join(',')),
    allowPrivateNetwork: Boolean(input.allowPrivateNetwork),
    privateNetworkHosts: parseList(input.privateNetworkHosts.join(','))
  }

  await systemPrisma.platform_api_configs.upsert({
    where: { id: 'platform' },
    update: {
      adminAccessMode: normalized.adminAccessMode,
      adminAllowedIps: normalized.adminAllowedIps.join(',') || null,
      allowPrivateNetwork: normalized.allowPrivateNetwork,
      privateNetworkHosts: normalized.privateNetworkHosts.join(',') || null,
      updatedAt: new Date()
    },
    create: {
      id: 'platform',
      adminAccessMode: normalized.adminAccessMode,
      adminAllowedIps: normalized.adminAllowedIps.join(',') || null,
      allowPrivateNetwork: normalized.allowPrivateNetwork,
      privateNetworkHosts: normalized.privateNetworkHosts.join(',') || null
    }
  })

  currentPolicy = { ...normalized, source: 'database' }
  logger.info('运行时网络策略已更新', {
    adminAccessMode: currentPolicy.adminAccessMode,
    adminAllowedIpCount: currentPolicy.adminAllowedIps.length,
    allowPrivateNetwork: currentPolicy.allowPrivateNetwork,
    privateNetworkHostCount: currentPolicy.privateNetworkHosts.length
  })
  return getRuntimeNetworkPolicy()
}
