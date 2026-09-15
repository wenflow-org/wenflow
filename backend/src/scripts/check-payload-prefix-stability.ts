/**
 * Payload 稳定前缀门禁（prompts:payload-prefix:check）
 *
 * 目的：为「稳定键前置」提供**回归护栏**——用真实遥测校验各 skill 最近 payload 的
 * 首键是否仍在声明的稳定段内（声明见 services/payload-stability.ts）。
 *
 * 判定：每条声明 skill 取最近 N 条 `prompt_call_logs.userPayload`（JSON 对象），
 * 若**最新一条**的首键不在声明内 → 记为违规；历史行仅统计占比（迁移期噪声）。
 *
 * 用法：
 *   npm run prompts:payload-prefix:check               # 报告模式（默认，退出码恒 0）
 *   npm run prompts:payload-prefix:check -- --strict   # 严格模式：存在违规即退出码 1
 *
 * 说明：无遥测数据（如干净 CI）时跳过，退出码 0。
 */
import prisma from '../config/database';
import { PAYLOAD_STABILITY, isFirstKeyStable, validateStabilityMap } from '../services/payload-stability';

const TAKE = Number(process.env.PAYLOAD_PREFIX_TAKE || 30);

function firstKeyOf(userPayload: unknown): string | undefined {
  if (typeof userPayload !== 'string' || !userPayload.trim().startsWith('{')) return undefined;
  try {
    const parsed = JSON.parse(userPayload);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    return Object.keys(parsed)[0];
  } catch {
    return undefined;
  }
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
    const firstKeys = rows
      .map((row) => firstKeyOf(row.userPayload))
      .filter((key): key is string => typeof key === 'string');
    if (firstKeys.length === 0) {
      lines.push(`[payload-prefix] SKIP ${skillId}: 无可用遥测`);
      continue;
    }
    withData += 1;
    const declared = PAYLOAD_STABILITY[skillId].stable;
    const stableCount = firstKeys.filter((key) => declared.includes(key)).length;
    const latest = firstKeys[0];
    const ok = isFirstKeyStable(skillId, latest);
    if (!ok) violations += 1;
    lines.push(
      `[payload-prefix] ${ok ? 'OK  ' : 'FAIL'} ${skillId}: 最新首键=${latest}（期望∈{${declared.join(',')}}）` +
        ` 近${firstKeys.length}条稳定占比=${Math.round((100 * stableCount) / firstKeys.length)}%`
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
