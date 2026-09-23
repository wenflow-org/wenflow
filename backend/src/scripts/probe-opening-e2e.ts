/* eslint-disable no-console, @typescript-eslint/no-explicit-any -- 一次性验收 CLI */
/**
 * 课堂开场生成器端到端探针（审计 P1 §2.4b）。
 *
 * 变更：core 里「quickReplies 必须与 mode 匹配」这条规则**逐字重复了两遍**（169 字），删掉一份。
 * 这是纯 prompt 去重，风险是"删错一份导致行为变化"——所以真跑几个 mode，核对产出仍是
 * 「可执行的下一步动作 + 与 mode 匹配」，而不是自评标签式选项。
 *
 * 用法：npx ts-node --transpile-only src/scripts/probe-opening-e2e.ts
 */
import 'dotenv/config';
import { executeSkill } from '../skills';
import { auxSkillDefinitionMap } from '../skills';

const CASES = [
  { openingMode: 'example-first', topic: '主谓宾结构', subject: '英语' },
  { openingMode: 'predict', topic: '一元二次方程判别式', subject: '数学' },
  { openingMode: 'self-assess', topic: '牛顿第一定律', subject: '物理' },
];

async function main() {
  const def = (auxSkillDefinitionMap as any)['teaching-opening-generator'];
  if (!def) throw new Error('找不到 teaching-opening-generator 定义');

  let ok = 0;
  for (const c of CASES) {
    try {
      const result: any = await executeSkill(def, {
        learner: { name: '林慧敏', level: 'beginner' },
        openingMode: c.openingMode,
        subject: c.subject,
        topic: c.topic,
        taskType: 'acquire',
        currentMilestoneTitle: c.topic,
      } as any);
      const out = result?.opening || result?.internal?.ext?.opening || result;
      const message = String(out?.message || '').slice(0, 70);
      const replies = (out?.quickReplies || []).map((r: any) => r?.text || r);
      console.log(`[probe] mode=${c.openingMode} | message=${message}…`);
      console.log(`[probe]   quickReplies = ${JSON.stringify(replies)}`);
      const labelish = replies.some((t: string) => /^(装过|没装过|会|不会|掌握了|没掌握|能|不能)/.test(String(t)));
      console.log(`[probe]   自评标签式选项 = ${labelish ? 'YES（不合规则）' : 'NO'}`);
      if (message && replies.length > 0 && !labelish) ok += 1;
    } catch (error) {
      console.log(`[probe] mode=${c.openingMode} 失败 | ${(error as Error).message}`);
    }
  }
  console.log(ok === CASES.length
    ? '[probe] PASS 三个 mode 均产出动作式、非自评标签的 quickReplies'
    : `[probe] CHECK ${ok}/${CASES.length} 通过，见上方`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
