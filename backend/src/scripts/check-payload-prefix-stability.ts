/**
 * Payload 稳定前缀门禁（prompts:payload-prefix:check）
 *
 * 目的：为「稳定键前置」提供**回归护栏**——用真实遥测校验各 skill 最近 payload 的
 * 首键是否仍在声明的稳定段内（声明见 services/payload-stability.ts）。
 *
 * 判定：每条声明 skill 取最近 N 条 `prompt_call_logs.userPayload`（JSON 对象），
 * 若**最新一条**的首键不在声明内 → 记为违规；历史行仅统计占比（迁移期噪声）。
 *
 * 遥测瘦身兼容（2026-10-15）：成功行超过 4K 的 userPayload 会被 telemetry-writer 的
 * `slimPromptCallRow` 换成 `{__slim,bytes,sha256,head}` 标记（存储优化）——标记本身不是
 * 发给模型的那份载荷，首键会恒为 `__slim` ⇒ 护栏全线误报。故遇到标记时从 `head`
 * （原 JSON 的前 400 字符）还原首键，护栏继续盯真实载荷的稳定前缀。
 *
 * 用法：
 *   npm run prompts:payload-prefix:check               # 报告模式（默认，退出码恒 0）
 *   npm run prompts:payload-prefix:check -- --strict   # 严格模式：存在违规即退出码 1
 *
 * 说明：无遥测数据（如干净 CI）时跳过，退出码 0。
 */
import prisma from '../config/database';
import {
  PAYLOAD_STABILITY,
  isFirstKeyStable,
  isStablePrefix,
  validateStabilityMap,
} from '../services/payload-stability';

const TAKE = Number(process.env.PAYLOAD_PREFIX_TAKE || 30);

/** 从 JSON 文本开头取首个键名（供瘦身标记的 head 用：head 是被截断的 JSON，不能整体 parse）。 */
function firstKeyOfJsonHead(head: string): string | undefined {
  const m = head.match(/^\s*\{\s*"((?:[^"\\]|\\.)*)"/);
  return m ? m[1].replace(/\\(.)/g, '$1') : undefined;
}

export interface PayloadKeyInfo {
  keys: string[];
  /** true = 只能从瘦身 head 还原首键，完整键序不可得 */
  slim: boolean;
}

/** 提取 payload 顶层键序；瘦身行只返回首键并标记 slim。 */
export function keyInfoOf(userPayload: unknown): PayloadKeyInfo | undefined {
  if (typeof userPayload !== 'string' || !userPayload.trim().startsWith('{')) return undefined;
  try {
    const parsed = JSON.parse(userPayload);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const record = parsed as Record<string, unknown>;
    if (record.__slim === true) {
      const first = typeof record.head === 'string' ? firstKeyOfJsonHead(record.head) : undefined;
      return first ? { keys: [first], slim: true } : undefined;
    }
    return { keys: Object.keys(record), slim: false };
  } catch {
    return undefined;
  }
}

/** 兼容旧导出（测试/脚本可能只关心首键）。 */
export function firstKeyOf(userPayload: unknown): string | undefined {
  return keyInfoOf(userPayload)?.keys[0];
}

async function main() {
  const strict = process.argv.includes('--strict');

  const lines: string[] = [];
  let violations = 0;

  for (const issue of validateStabilityMap()) {
    lines.push(`[payload-prefix] FAIL(map) ${issue.skillId}: ${issue.detail}`);
    violations += 1;
  }

  const skillIds = Object.keys(PAYLOAD_STABILITY);
  let withData = 0;

  for (const skillId of skillIds) {
    const rows = await prisma.prompt_call_logs.findMany({
      where: { agentId: `skill:${skillId}` },
      orderBy: { createdAt: 'desc' },
      take: TAKE,
      select: { userPayload: true },
    });
    const infos = rows
      .map((row) => keyInfoOf(row.userPayload))
      .filter((info): info is PayloadKeyInfo => Boolean(info));
    if (infos.length === 0) {
      lines.push(`[payload-prefix] SKIP ${skillId}: 无可用遥测`);
      continue;
    }
    withData += 1;
    const declared = PAYLOAD_STABILITY[skillId].stable;
    const isOk = (info: PayloadKeyInfo) =>
      info.slim ? isFirstKeyStable(skillId, info.keys[0]) : isStablePrefix(skillId, info.keys);
    const stableCount = infos.filter(isOk).length;
    const latest = infos[0];
    const ok = isOk(latest);
    if (!ok) violations += 1;
    const expected = latest.slim ? `首键∈{${declared.join(',')}}（瘦身行）` : `前缀=${declared.join('→')}`;
    lines.push(
      `[payload-prefix] ${ok ? 'OK  ' : 'FAIL'} ${skillId}: 最新键序=${latest.keys.slice(0, declared.length + 1).join('→')}` +
        `（期望 ${expected}） 近${infos.length}条稳定占比=${Math.round((100 * stableCount) / infos.length)}%`
    );
  }

  for (const line of lines) console.log(line);
  console.log(
    `[payload-prefix] 声明 ${skillIds.length} 项（有遥测 ${withData} 项）；违规=${violations}；模式=${strict ? 'strict' : 'report'}`
  );
  process.exitCode = strict && violations > 0 ? 1 : 0;
}

if (require.main === module) {
  main()
    .catch((error) => {
      console.error('[payload-prefix] 执行失败:', error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(() => {
      void prisma.$disconnect();
    });
}
