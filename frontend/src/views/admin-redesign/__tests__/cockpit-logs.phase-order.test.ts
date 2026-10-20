/**
 * 会话日志阶段筛选 chips 的排序（2026-10-19 用户走查「顺序调一下」）。
 *
 * 原实现按「首次出现顺序」出 chips，于是日志窗口里证据事件先于课堂行出现时，
 * chips 读成 目标对话 · 路径 · 证据 · 课堂——与同屏阶段条（目标 → 路径 → 课堂）不成一条线。
 * 现在固定按阶段顺序排，证据（过程记录、不是阶段）排最后；词表外阶段仍按首次出现接在后面。
 */
import { describe, expect, it } from 'vitest';
import { useCockpitLogs, type CockpitLogEntry } from '../useCockpitLogs';

function entry(phase: string, i = 0): CockpitLogEntry {
  return {
    id: `e${i}-${phase}`,
    time: '08:00:00',
    text: phase,
    view: { phase, durationText: '', text: phase, isError: false, rawJson: '' }
  };
}

describe('useCockpitLogs 阶段 chips 顺序', () => {
  it('按阶段推进顺序排：目标对话 → 路径 → 课堂 → 证据（与首次出现顺序无关）', () => {
    const { appendLogs, logPhases } = useCockpitLogs();
    // 故意按「证据最先出现」的顺序灌入（线上实测就是这样读成 目标·路径·证据·课堂 的）
    appendLogs([entry('证据', 1), entry('路径', 2), entry('目标对话', 3), entry('课堂', 4)]);

    expect(logPhases.value).toEqual(['目标对话', '路径', '课堂', '证据']);
  });

  it('词表外阶段接在后面并保持首次出现顺序（虚拟会话的 学习者回复 / 错误）', () => {
    const { appendLogs, logPhases } = useCockpitLogs();
    appendLogs([
      entry('错误', 1),
      entry('课堂', 2),
      entry('学习者回复', 3),
      entry('目标对话', 4)
    ]);

    expect(logPhases.value).toEqual(['目标对话', '课堂', '错误', '学习者回复']);
  });

  it('筛选逻辑不受排序影响：点某阶段只留该阶段的行', () => {
    const { appendLogs, logPhases, logPhaseFilter, filteredLogs } = useCockpitLogs();
    appendLogs([entry('路径', 1), entry('证据', 2), entry('课堂', 3)]);

    logPhaseFilter.value = logPhases.value[1];
    expect(logPhaseFilter.value).toBe('课堂');
    expect(filteredLogs.value.map((l) => l.view.phase)).toEqual(['课堂']);
  });
});
