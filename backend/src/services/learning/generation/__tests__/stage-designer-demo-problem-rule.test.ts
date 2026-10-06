/**
 * R4 实测修复批 B 项（2026-10-06）：stage-designer 引用示范题/例题/真题时必须自带题面。
 *
 * 实证：rw-school6-09 全程引用从未展示的示范题（422 次提及、0 次展示），学生与下游教学层
 * 拿不到题面，任务不可执行。提示词侧修复 = stage-designer 新增
 * 「示范题/例题/真题引用必须自带题面」规则（按仓库约定追加在末位）。
 *
 * 两个不变量（与 stage-filler-prompt-rule.test.ts 同构）：
 * ① 规则必须真的编译进 md 产物（core yaml → md 编译链回归护栏，改 yaml 不改产物 = 空改）；
 * ② 规则必须同时给出"直接给题面"与"引用 materials 实存小节"两条合法路径，并点名禁止悬空引用。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import yaml from 'js-yaml';

// 本文件位于 backend/src/services/learning/generation/__tests__/ → 仓库根上溯 6 层
const REPO_ROOT = path.resolve(__dirname, '../../../../../..');
const read = (p: string) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
const CORE_TEXT = read('prompts/core/stage-designer.yaml');
const MD = read('prompts/skill.stage-designer.md');
const CORE = yaml.load(CORE_TEXT) as { rules: string[] };

const RULE = CORE.rules.find((r) => r.includes('示范题/例题/真题引用必须自带题面')) || '';

describe('B 项：示范题/例题/真题引用必须自带题面', () => {
  it('core yaml 含新规则，且按仓库约定追加在末位', () => {
    expect(RULE).not.toBe('');
    expect(CORE.rules[CORE.rules.length - 1]).toBe(RULE);
  });

  it('规则给出两条合法路径：直接给题面 / 引用 materials 实存小节', () => {
    expect(RULE).toContain('直接给出具体题面');
    expect(RULE).toContain('已知条件');
    expect(RULE).toContain('求证或求解目标');
    expect(RULE).toContain('图形也要用文字写清');
    expect(RULE).toContain('materials 中实际存在的小节');
    expect(RULE).toContain('sectionId');
  });

  it('规则点名禁止无主体的悬空引用，并给出改写逃生口', () => {
    expect(RULE).toContain('悬空引用');
    expect(RULE).toContain('对照一道完整示范证明');
    expect(RULE).toContain('没有主体');
    expect(RULE).toContain('改写任务');
  });

  it('编译产物 md：末位编号规则逐字携带新规则（core→md 编译链）', () => {
    const nums = [...MD.matchAll(/^(\d+)\.\s/gm)].map((m) => Number(m[1]));
    const last = Math.max(...nums);
    const line = MD.split('\n').find((l) => l.includes('示范题/例题/真题引用必须自带题面')) || '';
    expect(line.trimStart().startsWith(`${last}.`)).toBe(true);
    expect(MD).toContain(RULE);
    // 编号连续：追加不跳号、不夹塞
    expect(nums.every((n, i) => n === i + 1)).toBe(true);
  });
});
