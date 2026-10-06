/**
 * R4 测量质量修复批 A 项（2026-10-06 实测）：教学回合的产出与练习动作必须纯文本可完成、平台可观测。
 *
 * 实证：rw-life6-06 等课出现"对着镜子念一遍"这类离线物理动作——平台观测不到，无法判定完成、
 * 也无法作为掌握证据。提示词侧修复 = teaching-turn「文本为主」规则补充禁令 + 口头宣称规则示例
 * 改为文本可观测写法（"把刚才那步做给我看" → "把这一步用你自己的话写出来"）。
 *
 * 两个不变量（与 stage-filler-prompt-rule.test.ts 同构）：
 * ① 规则必须真的编译进 md 产物（core yaml → md 编译链回归护栏，改 yaml 不改产物 = 空改）；
 * ② 文本为主规则必须点名叫停离线物理动作，且证据要求里不再出现"做给我看"这类演示型动作。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import yaml from 'js-yaml';

// 本文件位于 backend/src/skills/teaching-turn/__tests__/ → 仓库根上溯 5 层
const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const read = (p: string) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
const CORE_TEXT = read('prompts/core/teaching-turn.yaml');
const MD = read('prompts/skill.teaching-turn.md');
const CORE = yaml.load(CORE_TEXT) as { rules: string[] };

const TEXT_PRIMARY_RULE = CORE.rules.find((r) => r.includes('当前课堂以**文本为主**')) || '';
const CLAIM_RULE = CORE.rules.find((r) => r.includes('口头宣称不构成掌握证据')) || '';

describe('A 项：产出与练习动作必须纯文本可完成、平台可观测', () => {
  it('core yaml：文本为主规则点名学生产出/练习动作的文本可观测要求', () => {
    expect(TEXT_PRIMARY_RULE).toContain('学生产出与练习动作也必须是纯文本可完成、平台可观测的');
    expect(TEXT_PRIMARY_RULE).toContain('作答/复述/改写/解释');
    // 保留原有非文本媒介禁令（本次是补充而非改写）
    expect(TEXT_PRIMARY_RULE).toContain('不得要求学生通过图片、视频、音频、截图、界面观察或外部演示');
  });

  it('core yaml：点名叫停离线物理动作并给出反例', () => {
    expect(TEXT_PRIMARY_RULE).toContain('不得布置离线物理动作');
    expect(TEXT_PRIMARY_RULE).toContain('对着镜子念一遍');
    expect(TEXT_PRIMARY_RULE).toContain('用手比划');
    expect(TEXT_PRIMARY_RULE).toContain('写在纸上');
    expect(TEXT_PRIMARY_RULE).toContain('平台观测不到');
  });

  it('core yaml：课后练习降级为可选建议，且不作完成判断与掌握证据', () => {
    expect(TEXT_PRIMARY_RULE).toContain('一句可选建议');
    expect(TEXT_PRIMARY_RULE).toContain('不作为完成判断与掌握证据');
  });

  it('core yaml：口头宣称规则的最小产出示例改为文本可观测写法', () => {
    expect(CLAIM_RULE).toContain('把这一步用你自己的话写出来');
    expect(CORE_TEXT).not.toContain('做给我看');
  });

  it('编译产物 md：规则 14 逐字携带新禁令', () => {
    const line = MD.split('\n').find((l) => l.includes('当前课堂以**文本为主**')) || '';
    expect(line.trimStart().startsWith('14.')).toBe(true);
    expect(line).toContain('不得布置离线物理动作');
    expect(line).toContain('对着镜子念一遍');
    expect(line).toContain('平台观测不到');
  });

  it('编译产物 md：口头宣称规则（37.）示例同步替换', () => {
    const line = MD.split('\n').find((l) => l.includes('口头宣称不构成掌握证据')) || '';
    expect(line.trimStart().startsWith('37.')).toBe(true);
    expect(line).toContain('把这一步用你自己的话写出来');
    expect(MD).not.toContain('做给我看');
  });

  it('两条编辑过的规则 core→md 逐字一致（防对手改产物或 yaml 空改）', () => {
    expect(MD).toContain(TEXT_PRIMARY_RULE);
    expect(MD).toContain(CLAIM_RULE);
  });

  it('md 规则编号连续（编辑不跳号、不夹塞）', () => {
    const nums = [...MD.matchAll(/^(\d+)\.\s/gm)].map((m) => Number(m[1]));
    expect(nums.length).toBeGreaterThan(0);
    expect(nums.every((n, i) => n === i + 1)).toBe(true);
  });
});
