/**
 * 提示词 ↔ 代码阈值耦合机械校验（2026-10-24 契约同步批）。
 *
 * 背景：两处"文字约定"的数值耦合此前只存在于注释/提示词文本，改代码常量会静默漂移——
 * ① memory-curator 的 mastered/stuck 阈值与 virtual-lab/learner-memory.ts 常量互引；
 * ② session-wrapup 的档位区间描述与 session-evaluation-scale.ts 锚点互引（"改锚点必须同步改
 *   这里与 yaml"）；本批另把 teaching.yaml 档位映射描述也纳入。
 *
 * 纪律：从源码文本正则提取常量（不 import 业务模块，避免 prisma 等副作用），
 * 与提示词文本比对；任何不一致 → 退出码 1。
 */
import * as fs from 'fs';
import * as path from 'path';

const BACKEND_ROOT = path.resolve(__dirname, '../../..'); // src/services/prompt-manifest → backend/
const read = (rel: string): string => fs.readFileSync(path.join(BACKEND_ROOT, rel), 'utf-8');
const readPrompt = (rel: string): string => fs.readFileSync(path.join(BACKEND_ROOT, '..', rel), 'utf-8');

interface Finding {
  ok: boolean;
  item: string;
  detail: string;
}

function extractConst(source: string, name: string): number | null {
  const m = new RegExp(`export const ${name} = ([\\d.]+)`).exec(source);
  return m ? Number(m[1]) : null;
}

/** 从 session-evaluation-scale.ts 提取档位锚点三元组（min/max/representative） */
function extractTierAnchors(
  source: string,
): Array<{ tier: string; min: number; max: number; representative: number }> {
  const anchors: Array<{ tier: string; min: number; max: number; representative: number }> = [];
  const blockRe = /tier:\s*'(low|mid|high)',\s*min:\s*(\d+),\s*max:\s*(\d+),\s*representative:\s*([\d.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(source)) !== null) {
    anchors.push({ tier: m[1], min: Number(m[2]), max: Number(m[3]), representative: Number(m[4]) });
  }
  return anchors;
}

export function checkPromptThresholdCoupling(): { findings: Finding[]; exitCode: number } {
  const findings: Finding[] = [];

  // ① memory-curator ↔ learner-memory 常量
  const learnerMemorySrc = read('src/virtual-lab/learner-memory.ts');
  const masteredThreshold = extractConst(learnerMemorySrc, 'MASTERED_CONFIDENCE_THRESHOLD');
  const stuckThreshold = extractConst(learnerMemorySrc, 'STUCK_MASTERY_THRESHOLD');
  const curatorYaml = readPrompt('prompts/core/virtual-learner-memory-curator.yaml');
  if (masteredThreshold === null || stuckThreshold === null) {
    findings.push({
      ok: false,
      item: 'curator-threshold',
      detail: '未能从 learner-memory.ts 提取 MASTERED_CONFIDENCE_THRESHOLD / STUCK_MASTERY_THRESHOLD（常量改名或改写法？校验器需同步）',
    });
  } else {
    for (const [label, value] of [['MASTERED_CONFIDENCE_THRESHOLD', masteredThreshold], ['STUCK_MASTERY_THRESHOLD', stuckThreshold]] as const) {
      const ok = curatorYaml.includes(String(value));
      findings.push({
        ok,
        item: `curator:${label}(${value})`,
        detail: ok
          ? 'memory-curator.yaml 含该阈值'
          : `memory-curator.yaml 未出现 ${value}——与代码常量漂移（提示词侧「与代码侧兜底阈值一致」的互引失效）`,
      });
    }
  }

  // ② session-wrapup 档位区间 ↔ 锚点 min/max（三指标 × 三档，描述形如 "high＝8-10"）
  const scaleSrc = read('src/services/learning/session-evaluation-scale.ts');
  const anchors = extractTierAnchors(scaleSrc);
  const wrapupYaml = readPrompt('prompts/core/session-wrapup.yaml');
  if (anchors.length !== 3) {
    findings.push({
      ok: false,
      item: 'wrapup-anchors',
      detail: `从 session-evaluation-scale.ts 提取到 ${anchors.length} 个档位锚点（预期 3）——锚点结构改写？校验器需同步`,
    });
  } else {
    for (const metric of ['sessionKtl', 'sessionLss', 'sessionLf']) {
      for (const a of anchors) {
        const needle = `${a.tier}＝${a.min}-${a.max}`;
        const ok = wrapupYaml.includes(needle);
        findings.push({
          ok,
          item: `wrapup:${metric}:${a.tier}`,
          detail: ok
            ? `档位区间 ${needle} 与锚点一致`
            : `session-wrapup.yaml 缺「${needle}」——与 SESSION_EVALUATION_TIER_ANCHORS(${a.min}-${a.max}) 漂移（scale 注释约定：改锚点必须同步改 yaml）`,
        });
      }
    }
  }

  // ③ teaching.yaml 档位映射描述 ↔ 锚点 representative（low=x/mid=y/high=z 一句）
  if (anchors.length === 3) {
    const byTier = new Map(anchors.map((a) => [a.tier, a.representative]));
    const needle = `low=${byTier.get('low')}/mid=${byTier.get('mid')}/high=${byTier.get('high')}`;
    const teachingYaml = readPrompt('prompts/orchestration/teaching.yaml');
    const ok = teachingYaml.includes(needle);
    findings.push({
      ok,
      item: 'teaching:tier-mapping',
      detail: ok
        ? `档位映射描述（${needle}）与锚点中点一致`
        : `teaching.yaml 缺「${needle}」——evaluation 档位映射描述与锚点 representative 漂移`,
    });
  }

  return { findings, exitCode: findings.every((f) => f.ok) ? 0 : 1 };
}

export function main(): void {
  const { findings, exitCode } = checkPromptThresholdCoupling();
  for (const f of findings) {
    console.log(`${f.ok ? 'OK ' : 'FAIL'} [threshold-coupling] ${f.item}：${f.detail}`);
  }
  const failed = findings.filter((f) => !f.ok).length;
  console.log(`[threshold-coupling] 汇总：${findings.length} 项，失败 ${failed}；退出码=${exitCode}`);
  process.exitCode = exitCode;
}

if (require.main === module) {
  main();
}
