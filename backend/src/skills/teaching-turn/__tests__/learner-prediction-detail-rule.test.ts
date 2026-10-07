/**
 * P1-13（LP-1）teaching-turn 侧配套：learnerPrediction 自由描述原文（toneDetail）必须驱动开场策略。
 *
 * 实证（审计 LP-1）：learning-predictor 的 pick() 把 98/100 条自由描述抹成 'smooth'，teaching-turn
 * 只读 normalized 枚举值，模型说的「反复卡壳」到达开场策略时已完全丢失。修复后预测器把原文透传为
 * toneDetail/depthDetail，本规则要求：即使 stallRisk < 0.7，只要语义含「反复卡壳/吃力/受阻/放慢」，
 * 开场也不得全速（混合描述按非乐观侧处理）。
 *
 * 两个不变量（与 text-observable-rules.test.ts 同构）：
 * ① 规则必须真的编译进 md 产物（core yaml → md 编译链回归护栏，改 yaml 不改产物 = 空改）；
 * ② 规则必须点名 toneDetail/depthDetail 字段与「不得全速」的判定口径。
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

const RULE = CORE.rules.find((r) => r.includes('scenario.learnerPrediction')) || '';

describe('P1-13：learnerPrediction 自由描述（toneDetail/depthDetail）驱动开场策略', () => {
  it('core yaml：规则点名 toneDetail/depthDetail 字段', () => {
    expect(RULE).not.toBe('');
    expect(RULE).toContain('toneDetail');
    expect(RULE).toContain('depthDetail');
  });

  it('core yaml：stallRisk < 0.7 但语义含反复卡壳时不得全速（非乐观侧）', () => {
    expect(RULE).toContain('即使 stallRisk < 0.7');
    expect(RULE).toContain('反复卡壳');
    expect(RULE).toContain('不得全速');
    // 混合描述点名叫停「句尾顺畅就全速」的误读
    expect(RULE).toContain('不要因为句尾带「较顺畅」就当作全速信号');
  });

  it('core yaml：疲劳语义分支仍保留（toneDetail 一并纳入判据）', () => {
    expect(RULE).toContain('疲劳');
    expect(RULE).toContain('先确认学习者状态再进入正题');
  });

  it('编译产物 md：规则逐字携带新口径（core→md 编译链）', () => {
    expect(MD).toContain(RULE);
    const line = MD.split('\n').find((l) => l.includes('scenario.learnerPrediction')) || '';
    expect(line.trimStart().startsWith('11.')).toBe(true);
    expect(line).toContain('toneDetail');
    expect(line).toContain('不得全速推进');
  });

  it('md 规则编号连续（编辑不跳号、不夹塞）', () => {
    const nums = [...MD.matchAll(/^(\d+)\.\s/gm)].map((m) => Number(m[1]));
    expect(nums.length).toBeGreaterThan(0);
    expect(nums.every((n, i) => n === i + 1)).toBe(true);
  });
});