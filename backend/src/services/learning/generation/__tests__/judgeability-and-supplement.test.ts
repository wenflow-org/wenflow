/**
 * 2026-10-26 外部评审修复的单测：
 * ① not_judgeable 验收越界检测（detectUnjudgeableAcceptance）——
 *    越界=要求平台判定看不到的声音/动作属性；合法=练习事实+自述归因。
 * ② 补课双条件（needsLessonSupplement）——课数不足**且**分钟未饱和才补。
 */
import { detectUnjudgeableAcceptance } from '../stage-enrichment';
import { needsLessonSupplement } from '../stage-task-supplement';

describe('detectUnjudgeableAcceptance：not_judgeable 验收越界检测', () => {
  it('越界：要求平台确认声音/动作质量（吉他实证句）', () => {
    const tasks = [
      { title: 'Em 逐根拨弦', acceptanceHint: '六根空弦能逐根拨响，声音清晰无闷响，并且能说出拇指与食指中指各自负责哪几根弦。' },
    ];
    const violations = detectUnjudgeableAcceptance(tasks);
    expect(violations).toHaveLength(1);
    expect(violations[0].taskTitle).toBe('Em 逐根拨弦');
    expect(violations[0].matchedTerms.length).toBeGreaterThan(0);
  });

  it('越界：听感判据（录回来听 / 听不出抢拍）', () => {
    const violations = detectUnjudgeableAcceptance([
      { title: '副歌扫弦', acceptanceHint: '能跟着节拍器把副歌整段扫完一遍，录回来听时听不出某一拍明显抢或拖。' },
    ]);
    expect(violations).toHaveLength(1);
  });

  it('合法：练习事实 + 自述归因不算越界', () => {
    const tasks = [
      { title: '换和弦归因', acceptanceHint: '能说出哪一两个和弦在换过去之后反复出现闷音，并判断问题出在那个和弦的指法而不是换的速度。' },
      { title: '训练复盘', acceptanceHint: '用文字记录本周练了几遍、哪一次最卡、卡在哪个和弦，并写下你判断的原因与下次要改的一处。' },
    ];
    expect(detectUnjudgeableAcceptance(tasks)).toHaveLength(0);
  });

  it('边界：手型/姿势标准类判据越界', () => {
    const violations = detectUnjudgeableAcceptance([
      { title: '持琴姿势', acceptanceHint: '手型标准，姿势到位，琴颈抬起角度不别扭。' },
    ]);
    expect(violations).toHaveLength(1);
  });

  it('无验收字段的任务跳过；空数组安全', () => {
    expect(detectUnjudgeableAcceptance([{ title: 'x' }])).toHaveLength(0);
    expect(detectUnjudgeableAcceptance([])).toHaveLength(0);
  });
});

describe('needsLessonSupplement：补课双条件（课数不足 且 分钟未饱和）', () => {
  const task = (minutes: number) => ({ title: `t${minutes}`, type: 'execute', estimatedMinutes: minutes });

  it('课数不足且分钟未饱和 → 补', () => {
    expect(needsLessonSupplement([task(10), task(10)], 4, 120)).toBe(true);
  });

  it('课数不足但分钟已吃满预算 75% → 不补（评审悖论4：2×30 装满 60 分钟预算而锚是 3 课）', () => {
    expect(needsLessonSupplement([task(30), task(30)], 3, 60)).toBe(false);
  });

  it('课数充足 → 不补（与预算无关）', () => {
    expect(needsLessonSupplement([task(10), task(10), task(10)], 3, 120)).toBe(false);
  });

  it('无分钟预算锚 → 退回纯课数判据（行为不变）', () => {
    expect(needsLessonSupplement([task(30), task(30)], 3, null)).toBe(true);
    expect(needsLessonSupplement([task(30), task(30), task(30)], 3, undefined)).toBe(false);
  });

  it('锚 <2 或任务为空 → 不补（防御）', () => {
    expect(needsLessonSupplement([task(10)], 1, null)).toBe(false);
    expect(needsLessonSupplement([], 4, 120)).toBe(false);
  });
});
