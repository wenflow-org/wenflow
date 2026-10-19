#!/usr/bin/env node
/**
 * runtime:validate —— 运行时环境变量校验（唯一入口；#97 收尾：补 env Zod Schema）
 *
 * 校验「缺失或格式错即导致启动失败」的隐式依赖，口径对齐：
 *   src/bootstrap/env.ts（JWT_SECRET 强校验）、src/utils/secret-crypto.ts（加密密钥环）、
 *   src/utils/runtime-paths.ts（旧数据库路径拦截）。
 *
 * 必需变量：
 *   JWT_SECRET（≥32 位、非文档弱值）、DATABASE_URL / SYSTEM_DATABASE_URL（连接串）、
 *   SECRET_ENCRYPTION_CURRENT_KEY_ID / SECRET_ENCRYPTION_KEYS（32 字节 Base64 密钥环，
 *   当前密钥 ID 必须指向密钥环中的一把）。
 * 格式校验（可选，配置了就必须合法）：PORT（1-65535）、NODE_ENV（development / test / production）。
 * 其余变量一律放行：可选变量缺失不收紧，test / CI / dev 三环境行为保持原状。
 * 所有问题一次性聚合报出后退出码 1（fail-fast）。
 *
 * 注意：本文件被 Dockerfile 单独 COPY 进镜像，须保持单文件、只依赖生产依赖（dotenv / zod），
 * 不要再拆模块或引入 devDependency。
 */
require('dotenv').config();

const { z } = require('zod');

/** 与 src/utils/runtime-paths.ts 同口径的旧数据库路径拦截。 */
const LEGACY_MAIN_DB_PATH = /^file:\.\/prisma\//i;
const LEGACY_SYSTEM_DB_PATH = /^file:\.\/(?:prisma\/)?system\.db(?:[?#].*)?$/i;
/** 连接串只要求「scheme:非空内容」：SQLite（file:./dev.db）与 PostgreSQL（postgresql://...）都放行。 */
const CONNECTION_STRING = /^[a-z][a-z0-9+.-]*:\S+$/i;
/** 密钥 ID：字母数字开头，允许 _ . -，最长 64 位。 */
const ENCRYPTION_KEY_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
/** 文档示例 / 默认弱值（与 .env.example、.env.production.example 中对齐）。 */
const DOC_WEAK_JWT_SECRETS = new Set([
  'your-secret-key-change-in-production',
  'secret',
  'jwt-secret',
  'changeme'
]);

/** 参与校验的变量名单；名单外的变量原样放行（不识别、不收紧）。 */
const VALIDATED_KEYS = [
  'NODE_ENV',
  'PORT',
  'DATABASE_URL',
  'SYSTEM_DATABASE_URL',
  'JWT_SECRET',
  'SECRET_ENCRYPTION_CURRENT_KEY_ID',
  'SECRET_ENCRYPTION_KEYS'
];

/** 与 src/utils/secret-crypto.ts#decodeBase64Key 同口径：必须能还原成标准 Base64 的 32 字节。 */
function decodeBase64Key(value) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 === 1) return null;
  const decoded = Buffer.from(value, 'base64');
  return decoded.toString('base64').replace(/=+$/, '') === value.replace(/=+$/, '')
    ? decoded
    : null;
}

/**
 * 解析 `keyId:32字节Base64[,keyId:...]` 密钥环。
 * 只回报问题文案与密钥映射，绝不回显密钥本身（报错文案里只出现密钥 ID）。
 */
function parseKeyring(serialized) {
  const entries = String(serialized).split(',').map(entry => entry.trim()).filter(Boolean);
  const keys = new Map();
  const problems = [];
  if (entries.length === 0) {
    problems.push('SECRET_ENCRYPTION_KEYS 至少要有一把密钥（keyId:32字节Base64）');
  }
  entries.forEach((entry, index) => {
    const separator = entry.indexOf(':');
    if (separator <= 0) {
      problems.push(`SECRET_ENCRYPTION_KEYS 第 ${index + 1} 项不是 keyId:32字节Base64 形式`);
      return;
    }
    const keyId = entry.slice(0, separator).trim();
    const encodedKey = entry.slice(separator + 1).trim();
    if (!keyId || !ENCRYPTION_KEY_ID.test(keyId)) {
      problems.push(`SECRET_ENCRYPTION_KEYS 第 ${index + 1} 项的密钥 ID 缺失或格式无效`);
      return;
    }
    const key = decodeBase64Key(encodedKey);
    if (!key || key.length !== 32) {
      problems.push(`SECRET_ENCRYPTION_KEYS 密钥 ${keyId} 不是 32 字节 Base64`);
      return;
    }
    if (keys.has(keyId)) {
      problems.push(`SECRET_ENCRYPTION_KEYS 密钥 ID 重复: ${keyId}`);
      return;
    }
    keys.set(keyId, key);
  });
  return { keys, problems };
}

const runtimeEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production'], {
    errorMap: () => ({ message: 'NODE_ENV 只能是 development / test / production（注意大小写）' })
  }).optional(),

  PORT: z.string().trim().superRefine((value, ctx) => {
    if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'PORT 必须是 1-65535 的整数' });
    }
  }).optional(),

  DATABASE_URL: z.string({
    required_error: 'DATABASE_URL 未配置或为空（本地示例 file:./dev.db，生产示例 postgresql://user:pass@host:5432/wenflow）'
  })
    .refine(value => CONNECTION_STRING.test(value.trim()),
      'DATABASE_URL 不是合法连接串（示例 file:./dev.db 或 postgresql://user:pass@host:5432/db）')
    .refine(value => !LEGACY_MAIN_DB_PATH.test(value.trim().replace(/\\/g, '/')),
      'DATABASE_URL 使用了旧嵌套路径；当前本地路径应为 file:./dev.db'),

  SYSTEM_DATABASE_URL: z.string({
    required_error: 'SYSTEM_DATABASE_URL 未配置或为空（本地示例 file:../system.db，生产示例 postgresql://user:pass@host:5432/wenflow_system）'
  })
    .refine(value => CONNECTION_STRING.test(value.trim()),
      'SYSTEM_DATABASE_URL 不是合法连接串（示例 file:../system.db 或 postgresql://user:pass@host:5432/db）')
    .refine(value => !LEGACY_SYSTEM_DB_PATH.test(value.trim().replace(/\\/g, '/')),
      'SYSTEM_DATABASE_URL 使用了旧歧义路径；当前本地路径应为 file:../system.db'),

  JWT_SECRET: z.string({
    required_error: 'JWT_SECRET 未配置或为空；生成：openssl rand -base64 32'
  }).superRefine((value, ctx) => {
    const secret = value.trim();
    if (secret.length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `JWT_SECRET 长度不足 32 位（当前 ${secret.length} 位）；生成：openssl rand -base64 32`
      });
      return;
    }
    if (DOC_WEAK_JWT_SECRETS.has(secret.toLowerCase())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'JWT_SECRET 不能使用文档示例 / 默认弱值'
      });
    }
  }),

  SECRET_ENCRYPTION_CURRENT_KEY_ID: z.string({
    required_error: 'SECRET_ENCRYPTION_CURRENT_KEY_ID 未配置或为空（须指向 SECRET_ENCRYPTION_KEYS 中的一把密钥）'
  }).refine(value => ENCRYPTION_KEY_ID.test(value.trim()),
    'SECRET_ENCRYPTION_CURRENT_KEY_ID 格式无效（字母数字开头，允许 _ . -，最长 64 位）'),

  SECRET_ENCRYPTION_KEYS: z.string({
    required_error: 'SECRET_ENCRYPTION_KEYS 未配置或为空（keyId:32字节Base64，多把密钥用逗号分隔）'
  }).superRefine((value, ctx) => {
    for (const problem of parseKeyring(value).problems) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
    }
  })
}).passthrough().superRefine((env, ctx) => {
  // 交叉校验：当前密钥 ID 必须落在密钥环内（与 secret-crypto.ts#loadKeyring 同口径）。
  if (typeof env.SECRET_ENCRYPTION_KEYS !== 'string' || typeof env.SECRET_ENCRYPTION_CURRENT_KEY_ID !== 'string') return;
  const { keys } = parseKeyring(env.SECRET_ENCRYPTION_KEYS);
  const currentKeyId = env.SECRET_ENCRYPTION_CURRENT_KEY_ID.trim();
  if (keys.size > 0 && currentKeyId && !keys.has(currentKeyId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SECRET_ENCRYPTION_CURRENT_KEY_ID'],
      message: `SECRET_ENCRYPTION_CURRENT_KEY_ID（${currentKeyId}）未指向 SECRET_ENCRYPTION_KEYS 中的有效密钥`
    });
  }
});

/** 只取受校验的变量；空串（含全空白）按「未配置」处理（与 process.env 的 falsy 语义一致）。 */
function collectCandidate(env) {
  const candidate = {};
  for (const key of VALIDATED_KEYS) {
    const raw = env ? env[key] : undefined;
    candidate[key] = typeof raw === 'string' && raw.trim() === '' ? undefined : raw;
  }
  return candidate;
}

function validateRuntimeEnvironment(env) {
  const outcome = runtimeEnvironmentSchema.safeParse(collectCandidate(env || process.env));
  if (outcome.success) return { success: true, errors: [] };
  const errors = [];
  for (const issue of outcome.error.issues) {
    const message = issue.message.trim();
    if (message && !errors.includes(message)) errors.push(message);
  }
  return { success: false, errors };
}

const result = validateRuntimeEnvironment(process.env);

if (!result.success) {
  console.error(`❌ 运行时环境校验失败（runtime:validate，共 ${result.errors.length} 项）：`);
  for (const message of result.errors) {
    console.error(`  - ${message}`);
  }
  console.error('  变量模板见 backend/.env.example；修复后重试。');
  process.exit(1);
}

console.log(JSON.stringify({ success: true }));
