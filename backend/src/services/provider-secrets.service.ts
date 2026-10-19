import systemPrisma from '../config/system-database';
import { decryptSecret, encryptSecret } from '../utils/secret-crypto';
import { logger } from '../utils/logger';

/**
 * 供应商级密钥（BYOK，2026-10-18）。
 *
 * 为什么单开一张表：`config/llm-providers.json` 是供应商与模型的**唯一真源**，但文件自己的
 * 校验规则（models.config.ts）严禁把真实密钥写进文件——只允许 `apiKeyEnv` 环境变量名。
 * 所以管理台表单里填的密钥落这里（AES-256-GCM 密文），文件里同步补一个环境变量名兜底。
 *
 * 解析顺序：本表密文 → `process.env[apiKeyEnv]`（见 gateway/api-gateway/router.ts）。
 * 进程内缓存 60s（与路由缓存同档），写接口主动失效——保证「页面点保存 → 下一次调用就用新密钥」。
 */

const SECRET_AAD = 'system.provider_secrets.apiKey';
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  apiKey: string;
  source: 'db' | 'env';
  at: number;
}

const cache = new Map<string, CacheEntry>();
let warnedStorageUnavailable = false;

/** 写接口调用：让下一次解析立刻看到新值（不必等 TTL） */
export function invalidateProviderSecretCache(providerId?: string): void {
  if (providerId) cache.delete(providerId);
  else cache.clear();
}

/**
 * 运行时解析某供应商的密钥。DB 不可用/无该表（旧库未迁移、单测无库）时静默回落环境变量——
 * 缺表不该让整条调用链挂掉，回落路径正是本功能引入前的老行为。
 */
export async function resolveProviderApiKey(
  providerId: string,
  apiKeyEnv?: string
): Promise<{ apiKey: string; source: 'db' | 'env' } | null> {
  const cached = cache.get(providerId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { apiKey: cached.apiKey, source: cached.source };
  }

  let fromDb: string | null = null;
  try {
    const row = await systemPrisma.provider_secrets.findUnique({ where: { providerId } });
    if (row?.apiKey) fromDb = decryptSecret(row.apiKey, SECRET_AAD) || null;
  } catch (e) {
    if (!warnedStorageUnavailable) {
      warnedStorageUnavailable = true;
      logger.warn('[provider-secrets] 供应商密钥表不可读，本次回落环境变量', {
        errorMessage: e instanceof Error ? e.message : String(e)
      });
    }
  }

  const envKey = apiKeyEnv ? String(process.env[apiKeyEnv] || '').trim() : '';
  const resolved = fromDb
    ? { apiKey: fromDb, source: 'db' as const }
    : envKey
      ? { apiKey: envKey, source: 'env' as const }
      : null;

  if (resolved) cache.set(providerId, { ...resolved, at: Date.now() });
  else cache.delete(providerId);
  return resolved;
}

/** 写入/更换密钥（管理台表单）：密文落库，同时把环境变量名记下来做回落兜底 */
export async function setProviderSecret(providerId: string, apiKey: string, apiKeyEnv: string | null): Promise<void> {
  const encrypted = encryptSecret(apiKey, SECRET_AAD);
  if (!encrypted) throw new Error('密钥加密失败：请检查服务端 SECRET_ENCRYPTION_KEYS 配置');
  await systemPrisma.provider_secrets.upsert({
    where: { providerId },
    create: { providerId, apiKey: encrypted, apiKeyEnv },
    update: { apiKey: encrypted, apiKeyEnv }
  });
  invalidateProviderSecretCache(providerId);
}

/** 清除密钥（管理台「移除密钥」）。注册表文件里的 apiKeyEnv 名保留——它仍是回落来源 */
export async function deleteProviderSecret(providerId: string): Promise<void> {
  await systemPrisma.provider_secrets.deleteMany({ where: { providerId } });
  invalidateProviderSecretCache(providerId);
}

/** 密钥来源一览（GET 视图用；只报来源，不回显任何密钥内容） */
export async function providerSecretSources(): Promise<Record<string, 'db'>> {
  try {
    const rows = await systemPrisma.provider_secrets.findMany({ select: { providerId: true } });
    return Object.fromEntries(rows.map((r) => [r.providerId, 'db' as const]));
  } catch {
    return {};
  }
}

/**
 * GET 视图的密钥摘要：来源 + 尾部 4 位。
 * 只回吐尾巴是各家 BYOK 界面的通行做法（够运维确认「填的是哪把」，又不构成泄密面），
 * 短于 8 位的密钥不给尾巴——短密钥露 4 位等于露一半。
 */
export async function providerSecretSummary(
  providerId: string,
  apiKeyEnv?: string | null
): Promise<{ keySource: 'db' | 'env' | 'none'; keyHint: string | null }> {
  const resolved = await resolveProviderApiKey(providerId, apiKeyEnv || undefined);
  if (!resolved) return { keySource: 'none', keyHint: null };
  const key = resolved.apiKey;
  return { keySource: resolved.source, keyHint: key.length >= 8 ? `····${key.slice(-4)}` : null };
}
