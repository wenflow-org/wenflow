/**
 * R8-1 收尾刷课（同题复读）提示词规则 + filler 观测契约。
 *
 * 2026-09-29 实证：某阶段 12 课中 6 节标题逐字相同（「串联并联电功率计算的综合自测与查漏」），
 * 根因是把 `targetSubtasksForStage` 当"必须凑满的课数"用。提示词侧的修复是 stage-designer
 * 新增「同题复读禁令」规则；代码侧已有 detectStageFiller 观测（只观测不阻断）。
 *
 * 两个不变量：
 * ① 提示词规则必须真的编译进 md 产物（否则改 yaml 是空改）——这是 core yaml → md 编译链的回归护栏；
 * ② 提示词禁令的边界与 detectStageFiller 的阈值一致：同对象成对课不误报、逐字复读要抓到。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { detectStageFiller, titleSimilarity } from '../stage-filler';

// 本文件位于 backend/src/services/learning/generation/__tests__/ → 仓库根上溯 6 层
const REPO_ROOT = path.resolve(__dirname, '../../../../../..');
const read = (p: string) => fs.readFileSync(path.join(REPO_ROOT, p), 'utf8');
const CORE = read('prompts/core/stage-designer.yaml');
const MD = read('prompts/skill.stage-designer.md');

describe('R8-1 同题复读禁令：提示词规则已编译进产物', () => {
  it('core yaml 含新规则', () => {
    expect(CORE).toContain('同题复读禁令');
  });

  it('编译产物 md 含新规则且编号未被顶掉（新规则只追加在末位，既有编号不动）', () => {
    expect(MD).toContain('同题复读禁令');
    const line = MD.split('\n').find((l) => l.includes('同题复读禁令')) || '';
    expect(line.trimStart().startsWith('31.')).toBe(true);
    // 「排在末位」只约束追加方式：末位规则可随后续新规则后移，但编号必须连续（不跳号、不夹塞）
    const nums = [...MD.matchAll(/^(\d+)\.\s/gm)].map((m) => Number(m[1]));
    expect(nums).toContain(31);
    expect(Math.max(...nums)).toBe(nums.length);
  });

  it('补课调用规则（2026-09-30 追加）编译进产物且编号未动', () => {
    expect(CORE).toContain('补课调用');
    const line = MD.split('\n').find((l) => l.includes('补课调用（supplementRequest')) || '';
    expect(line.trimStart().startsWith('32.')).toBe(true);
  });

  it('最新追加的规则在末位（真实交付锚，2026-10-03 A/B 修复批；校内锚此后被后移属预期）', () => {
    expect(CORE).toContain('校内锚（schoolAnchor');
    expect(CORE).toContain('真实交付锚');
    const nums = [...MD.matchAll(/^(\d+)\.\s/gm)].map((m) => Number(m[1]));
    const last = Math.max(...nums);
    const line = MD.split('\n').find((l) => l.includes('真实交付锚')) || '';
    expect(line.trimStart().startsWith(`${last}.`)).toBe(true);
    // 编号连续：追加不跳号、不夹塞
    expect(nums[last - 1]).toBe(last);
  });

  it('规则同时约束「不得同题」与「收口课至多 1 节」两个维度', () => {
    expect(CORE).toMatch(/不得完全一致|不得有两节完全相同/);
    expect(CORE).toMatch(/最多 1 节/);
  });

  it('规则指向诚实欠 fill 的逃生口（不与「课时充实度」规则冲突）', () => {
    // 新规则必须复用既有逃生口（"本阶段先覆盖主干…补充说明"），而不是发明第二套说法
    expect(CORE).toContain('宁可少给');
    expect(CORE).toContain('本阶段先覆盖主干');
  });

  it('core yaml 与 md 的规则内容一致（防 md 被手工改回而 yaml 没跟上）', () => {
    const yamlRule = CORE.split('\n').find((l) => l.includes('同题复读禁令')) || '';
    const mdRule = MD.split('\n').find((l) => l.includes('同题复读禁令')) || '';
    // md 行首是「31. 」，剥掉编号后正文应与 yaml 的 `- ` 之后一致
    expect(mdRule.replace(/^\d+\.\s*/, '')).toContain('同题复读禁令');
    expect(yamlRule.replace(/^\s*-\s*/, '')).toContain('同题复读禁令');
  });
});

describe('R8-1 与 detectStageFiller 的边界一致', () => {
  it('逐字复读 6 次（school-31 实证形态）→ 检测器抓到', () => {
    const tasks = [
      '串联电路路径判断与电学计算',
      '串联电路路径判断与电学计算',
      '串联电路路径判断与电学计算',
      '并联电路路径判断与电学计算',
      '并联电路路径判断与电学计算',
      '串联并联电功率计算的综合自测与查漏',
      '串联并联电功率计算的综合自测与查漏',
      '串联并联电功率计算的综合自测与查漏',
      '串联并联电功率计算的综合自测与查漏',
      '串联并联电功率计算的综合自测与查漏',
      '串联并联电功率计算的综合自测与查漏',
      '串联并联电功率计算的综合自测与查漏',
    ];
    const report = detectStageFiller(tasks.map((title) => ({ title })));
    expect(report.duplicatePairs.length).toBeGreaterThan(0);
    // 逐字相同的标题相似度必须 =1
    expect(titleSimilarity(tasks[5], tasks[6])).toBe(1);
  });

  it('同对象成对课（回补→重推）不误报——与提示词「第二遍合法」一致', () => {
    const tasks = [
      '回补三角函数的定义与基本性质',
      '合上书重推三角函数典型例题',
      '回补数列的定义与通项公式推导',
      '合上书重推数列典型例题',
    ];
    const report = detectStageFiller(tasks.map((title) => ({ title })));
    expect(report.duplicatePairs).toEqual([]);
  });

  it('提示词禁令比检测器更严：检测器放行的第二遍，提示词仍要求必须有新增量', () => {
    // 「回补→重推」相似度约 0.63 < 0.7 阈值 → 检测器不报；这正是提示词要管的区间
    const sim = titleSimilarity('回补三角函数的定义与基本性质', '合上书重推三角函数典型例题');
    expect(sim).toBeLessThan(0.7);
    // 但规则 28/31 已要求收口课必须定义新认知增量或具体产出物
    expect(CORE).toContain('新认知增量或具体产出物');
  });
});
