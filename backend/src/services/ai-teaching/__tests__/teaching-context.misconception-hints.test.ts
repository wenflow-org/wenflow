/**
 * 课前注入半条链读侧单测（2026-09-26）：sidecar 解析 + planned 行构造。
 * 纯函数，无 DB / 无 LLM。
 */
import {
  buildPlannedMisconceptionRows,
  resolveTaskMisconceptionHints,
} from '../TeachingContextBuilder';

const templateWithHints = JSON.stringify({
  misconceptionHints: {
    byTask: {
      task_1: [
        { conceptKey: 'inventory-cycle', label: '以为整理就是把东西全部收进柜子', why: '日常经验里"收好"≈"藏起来"' },
        { conceptKey: 'inventory-cycle', label: '以为先进先出就是按时间排序', why: '字面理解 FIFO' },
      ],
      task_2: [{ conceptKey: 'x', label: '' }], // label 空 → 应被过滤
    },
  },
});

describe('resolveTaskMisconceptionHints（sidecar 读侧）', () => {
  it('按 taskId 读回预判，过滤空 label，限 3 条', () => {
    const hints = resolveTaskMisconceptionHints({ aiPromptTemplate: templateWithHints, taskId: 'task_1' });
    expect(hints).toHaveLength(2);
    expect(hints![0]).toEqual({
      conceptKey: 'inventory-cycle',
      label: '以为整理就是把东西全部收进柜子',
      why: '日常经验里"收好"≈"藏起来"',
    });
    expect(resolveTaskMisconceptionHints({ aiPromptTemplate: templateWithHints, taskId: 'task_2' })).toBeNull();
  });

  it('无 sidecar / 坏 JSON / 空输入 → null（fail-open）', () => {
    expect(resolveTaskMisconceptionHints({ aiPromptTemplate: null, taskId: 'task_1' })).toBeNull();
    expect(resolveTaskMisconceptionHints({ aiPromptTemplate: '{}', taskId: 'task_1' })).toBeNull();
    expect(resolveTaskMisconceptionHints({ aiPromptTemplate: '{broken', taskId: 'task_1' })).toBeNull();
    expect(resolveTaskMisconceptionHints({ aiPromptTemplate: undefined, taskId: '' })).toBeNull();
  });
});

describe('buildPlannedMisconceptionRows（planned 行构造）', () => {
  it('映射成台账行形状，source=planned、confidence 低档、occurrenceCount=0', () => {
    const rows = buildPlannedMisconceptionRows([
      { conceptKey: 'inventory-cycle', label: '以为整理就是把东西全部收进柜子', why: '日常经验' },
    ]);
    expect(rows).toEqual([
      {
        conceptKey: 'inventory-cycle',
        hypothesis: '以为整理就是把东西全部收进柜子',
        canonicalLabel: '以为整理就是把东西全部收进柜子',
        confidence: 25,
        status: 'suspected',
        occurrenceCount: 0,
        why: '日常经验',
        source: 'planned',
      },
    ]);
  });

  it('空/缺省 → 空数组（teaching-turn 拿到 null，行为与原先一致）', () => {
    expect(buildPlannedMisconceptionRows(null)).toEqual([]);
    expect(buildPlannedMisconceptionRows([])).toEqual([]);
  });
});
