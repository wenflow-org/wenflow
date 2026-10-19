import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

/**
 * runtime:validate（#97 收尾：补 env Zod Schema）的包装测试：spawn
 * backend/scripts/validate-runtime-environment.js，断言
 *   ① 必需变量齐备（CI / dev 形态）→ 退出码 0、输出 {"success":true}；
 *   ② 缺必需变量 → 全部缺失项一次性聚合报出、退出码 1（fail-fast）；
 *   ③ 格式错 → 退出码 1，且报错文案不回显密钥材料。
 * 子进程 cwd 用新建临时目录，避免 backend/.env 兜底掩盖「缺失」用例；子进程 env 显式重建，
 * 不受 jest 进程环境（其他用例会写 process.env.JWT_SECRET）污染。
 * 参考：backend/scripts/validate-runtime-environment.js 头部注释、doc/local/ISSUE-RECON-20261019.md「### #97」。
 */
const BACKEND_ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(BACKEND_ROOT, 'scripts', 'validate-runtime-environment.js');

/** 与脚本内 VALIDATED_KEYS 对齐：重建子进程环境时先全部清掉，保证用例确定性。 */
const VALIDATED_KEYS = [
  'NODE_ENV',
  'PORT',
  'DATABASE_URL',
  'SYSTEM_DATABASE_URL',
  'JWT_SECRET',
  'SECRET_ENCRYPTION_CURRENT_KEY_ID',
  'SECRET_ENCRYPTION_KEYS'
];

const KEY_32_BYTES = Buffer.alloc(32, 3).toString('base64');

const COMPLETE_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'file:./ci-main.db',
  SYSTEM_DATABASE_URL: 'file:./ci-system.db',
  JWT_SECRET: 'ci-only-jwt-secret-with-at-least-32-characters',
  SECRET_ENCRYPTION_CURRENT_KEY_ID: 'ci',
  SECRET_ENCRYPTION_KEYS: `ci:${KEY_32_BYTES}`
};

interface ScriptRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runValidator(overrides: Record<string, string | undefined> = {}, cwd: string): ScriptRun {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of VALIDATED_KEYS) delete env[key];
  Object.assign(env, COMPLETE_ENV, overrides);
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete env[key];
  }
  const res = spawnSync(process.execPath, [SCRIPT], { cwd, env, encoding: 'utf-8', timeout: 30_000 });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

describe('runtime:validate 环境校验（#97 env Zod Schema）', () => {
  let cwd: string;

  beforeAll(() => {
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-validate-jest-'));
  });

  afterAll(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it('必需变量齐备（无 .env 的 CI 形态）：退出码 0，输出 success', () => {
    const res = runValidator({}, cwd);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('"success":true');
    expect(res.stderr).toBe('');
  });

  it('缺必需变量：全部缺失项聚合报出并退出码 1（fail-fast）', () => {
    const res = runValidator({
      JWT_SECRET: undefined,
      SECRET_ENCRYPTION_KEYS: undefined,
      SECRET_ENCRYPTION_CURRENT_KEY_ID: undefined
    }, cwd);
    expect(res.status).toBe(1);
    expect(res.stdout).toBe('');
    expect(res.stderr).toContain('JWT_SECRET 未配置或为空');
    expect(res.stderr).toContain('SECRET_ENCRYPTION_KEYS 未配置或为空');
    expect(res.stderr).toContain('SECRET_ENCRYPTION_CURRENT_KEY_ID 未配置或为空');
    expect(res.stderr).toContain('共 3 项');
  });

  it('格式错（空串 / 旧路径 / 短密钥 / 密钥非 32 字节 / PORT 越界 / 当前密钥 ID 不在环内）：退出码 1，不回显密钥材料', () => {
    const weakKey = Buffer.alloc(16, 7).toString('base64');
    const cases: Array<{ override: Record<string, string>; expect: string }> = [
      { override: { DATABASE_URL: '' }, expect: 'DATABASE_URL 未配置或为空' },
      { override: { DATABASE_URL: 'file:./prisma/dev.db' }, expect: 'DATABASE_URL 使用了旧嵌套路径' },
      { override: { SYSTEM_DATABASE_URL: 'file:./system.db' }, expect: 'SYSTEM_DATABASE_URL 使用了旧歧义路径' },
      { override: { JWT_SECRET: 'short' }, expect: 'JWT_SECRET 长度不足 32 位' },
      { override: { JWT_SECRET: 'your-secret-key-change-in-production' }, expect: 'JWT_SECRET 不能使用文档示例 / 默认弱值' },
      { override: { SECRET_ENCRYPTION_KEYS: `ci:${weakKey}` }, expect: 'SECRET_ENCRYPTION_KEYS 密钥 ci 不是 32 字节 Base64' },
      { override: { SECRET_ENCRYPTION_CURRENT_KEY_ID: 'v9' }, expect: '未指向 SECRET_ENCRYPTION_KEYS 中的有效密钥' },
      { override: { PORT: '70000' }, expect: 'PORT 必须是 1-65535 的整数' }
    ];
    for (const { override, expect: expected } of cases) {
      const res = runValidator(override, cwd);
      expect(res.status).toBe(1);
      expect(res.stdout).toBe('');
      expect(res.stderr).toContain(expected);
      // 报错文案只允许出现密钥 ID，不得回显密钥材料本身。
      expect(res.stderr).not.toContain(weakKey);
      expect(res.stderr).not.toContain(KEY_32_BYTES);
    }
  });

  it('可选变量缺失不收紧：未设 PORT / NODE_ENV 仍通过', () => {
    const res = runValidator({ PORT: undefined, NODE_ENV: undefined }, cwd);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('"success":true');
  });
});
