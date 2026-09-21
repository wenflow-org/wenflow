/* eslint-disable no-console -- 一次性评测 CLI：面向人读的输出，不需要 logger */
/**
 * 评测 `skill:triage-judge`：在 **60 例混合数据集**上算"分流判据"的准确率（离线、不落库）。
 *
 * 金标来自 case 自带标注：`record.story.recurrence`（once / recurring）。
 * 本脚本要回答的问题是：**"按阻塞类型分流" vs "按复现性分流"**，哪个更接近标注？
 *   - 规则 A（外部建议的形态）：blockType ∈ {oneoff_operation, permission_process, environment_tooling} ⇒ 不给路径
 *   - 规则 B（本方案）：判官判 recurrence=once ⇒ 不给路径
 * 判据依据（离线可复算，不需要跑批）：60 例中 blockType 与 recurrence 几乎正交 ——
 *   capability×recurring 14/14、oneoff×once 10/10、environment_tooling×recurring 10/11
 *   ⇒ 规则 A 会把 13 例"反复发生的环境排障/权限流程"误杀。
 *
 * ⚠️ 判官只看到**用户可见的文本**（诉求原话 + 情境 + 背景），看不到 blockType / recurrence 标注。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/eval-triage-judge.ts                # 全 60 例
 *   npx ts-node --transpile-only src/scripts/eval-triage-judge.ts --limit=15     # 先跑一小批
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { auxSkillDefinitionMap, executeSkillWithResult } from '../skills';

const CASE_DIR = path.resolve(__dirname, '..', '..', '..', 'data', 'vl-persona-mixed-2026-09-21', 'cases');
const NO_PATH_TYPES = new Set(['oneoff_operation', 'permission_process', 'environment_tooling']);

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

interface CaseRow {
  file: string;
  name: string;
  request: string;
  context: string;
  background: string;
  labelBlock: string;
  labelRecurrence: string;
}

function loadCases(limit: number): CaseRow[] {
  const files = fs.readdirSync(CASE_DIR).filter((f) => f.endsWith('.json')).sort();
  const rows: CaseRow[] = [];
  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(CASE_DIR, file), 'utf-8'));
    const spec = raw.spec || {};
    const story = (raw.record || {}).story || {};
    rows.push({
      file,
      name: spec.name || file,
      // 只用**用户可见**的文本（不含 blockType / recurrence / hiddenDetails）
      request: String(story.visibleOpening || spec.goalHint || '').trim(),
      context: [story.triggerEvent, spec.domain].filter(Boolean).join(' / '),
      background: String(spec.background || '').trim(),
      labelBlock: String(story.primaryBlockType || '?'),
      labelRecurrence: String(story.recurrence || '?'),
    });
    if (rows.length >= limit) break;
  }
  return rows;
}

async function main(): Promise<void> {
  const limit = Number(arg('limit', '60')) || 60;
  const delayMs = Number(arg('delay', '1500')) || 1500;
  const rows = loadCases(limit);
  console.log(`[eval] ${rows.length} 例（判官只见用户可见文本；金标 = case 自带 recurrence）\n`);

  const scored: Array<{
    name: string; block: string; goldOnce: boolean;
    judgeTransferable: boolean | null; judgeRecurrence: string; judgeArtifact: string;
    judgeConfidence: string; evidence: string; misdiagnosis: string | null;
  }> = [];
  let failures = 0;

  for (const [index, row] of rows.entries()) {
    let result: any = null;
    try {
      result = await executeSkillWithResult(auxSkillDefinitionMap['triage-judge'], {
        request: row.request,
        context: row.context,
        background: row.background,
        __prompt: { requestPath: 'eval-triage-judge' },
      } as any);
    } catch (error) {
      // 解析失败/超时：记为失败例，不中断整批（评测要的是分布，不是逐例全绿）
      failures += 1;
      console.log(`  [${index + 1}/${rows.length}] ✗ ${row.name}：${String((error as Error)?.message || error).slice(0, 80)}`);
      if (index < rows.length - 1) await new Promise((r) => setTimeout(r, delayMs));
      continue;
    }
    const out = result?.output ?? null;
    if (!result?.success || !out) {
      failures += 1;
      console.log(`  [${index + 1}/${rows.length}] ✗ ${row.name}：${String(result?.error?.message || result?.error || 'no output').slice(0, 90)}`);
      continue;
    }
    scored.push({
      name: row.name,
      block: row.labelBlock,
      goldOnce: row.labelRecurrence === 'once',
      judgeTransferable: out.transferable ?? null,
      judgeRecurrence: String(out.recurrence || 'unknown'),
      judgeArtifact: String(out.artifact || 'unknown'),
      judgeConfidence: String(out.confidence || 'low'),
      evidence: String(out.evidence || ''),
      misdiagnosis: out.misdiagnosis ?? null,
    });
    console.log(`  [${index + 1}/${rows.length}] ${row.name.padEnd(5)} 金标[${row.labelBlock}·${row.labelRecurrence}] → 判官[${out.transferable}/${out.recurrence}/${out.artifact}/${out.confidence}]`);
    if (index < rows.length - 1) await new Promise((r) => setTimeout(r, delayMs));
  }

  // ---------- 账 ----------
  const n = scored.length;
  const goldCards = scored.filter((s) => s.goldOnce);          // 金标：只此一次 ⇒ 不该排路径
  const goldPaths = scored.filter((s) => !s.goldOnce);         // 金标：反复发生 ⇒ 可以排路径

  const ruleA = (s: typeof scored[number]) => NO_PATH_TYPES.has(s.block);          // 按类型
  const ruleB = (s: typeof scored[number]) => s.judgeRecurrence === 'once';        // 按判官复现性

  const stat = (rule: (s: typeof scored[number]) => boolean, label: string) => {
    const killGoldPath = goldPaths.filter(rule).length;    // 误杀：金标该做路径，却被判"不给"
    const keepGoldCard = goldCards.filter((s) => !rule(s)).length; // 漏判：金标该给卡片，却被放行
    return { label, 误杀: killGoldPath, 漏判: keepGoldCard, 误杀率: `${(100 * killGoldPath / Math.max(1, goldPaths.length)).toFixed(0)}%` };
  };

  console.log('\n=== 结果 ===');
  console.log(JSON.stringify({
    样本: n, 失败: failures,
    金标该给卡片: goldCards.length, 金标该排路径: goldPaths.length,
    判官原始分布: {
      transferable: { true: scored.filter((s) => s.judgeTransferable === true).length, false: scored.filter((s) => s.judgeTransferable === false).length, null: scored.filter((s) => s.judgeTransferable === null).length },
      recurrence: { once: scored.filter((s) => s.judgeRecurrence === 'once').length, recurring: scored.filter((s) => s.judgeRecurrence === 'recurring').length, unknown: scored.filter((s) => s.judgeRecurrence === 'unknown').length },
      artifact: scored.reduce((m: Record<string, number>, s) => (m[s.judgeArtifact] = (m[s.judgeArtifact] || 0) + 1, m), {}),
      confidence: scored.reduce((m: Record<string, number>, s) => (m[s.judgeConfidence] = (m[s.judgeConfidence] || 0) + 1, m), {}),
      判出误诊: scored.filter((s) => !!s.misdiagnosis).length,
    },
  }, null, 1));

  console.log('\n=== 规则对照（金标 = case 自带 recurrence：once ⇒ 不该排路径）===');
  console.table([stat(ruleA, 'A 按阻塞类型（外部建议）'), stat(ruleB, 'B 按判官复现性（本方案）')]);

  const disagreements = scored.filter((s) => s.goldOnce !== (s.judgeRecurrence === 'once'));
  console.log(`\n=== 与金标不一致的 ${disagreements.length} 例 ===`);
  for (const s of disagreements) {
    console.log(`  ${s.name.padEnd(5)} 金标[${s.block}·${s.goldOnce ? 'once' : 'recurring'}] 判官[${s.judgeRecurrence}] 依据：${s.evidence.slice(0, 60)}`);
  }
}

void main().catch((error) => {
  console.error('[eval] 失败', error);
  process.exitCode = 1;
});
