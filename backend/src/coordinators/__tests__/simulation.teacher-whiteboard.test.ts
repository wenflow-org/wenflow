/**
 * 教师白板/结构图 → 模拟学习者可见上下文（2026-11-11 外部评审隐患 3）。
 *
 * teaching-turn 的「图文互锁」要求正文不罗列图上的分支/数值，只说「直接看图」。
 * 真实学生看得见前端渲染的 SVG/Mermaid，虚拟学习者的 visibleContext 只有文本；
 * 这里钉住「图面内容必须被文本化并附在教师消息后」，防再次退回盲人状态。
 */
import { buildTeacherWhiteboardText, buildTeacherVisibleContent } from '../simulation.learn.steps';
import { normalizeProcessTeachingTurn } from '../simulation.coordinator';

describe('buildTeacherWhiteboardText', () => {
  it('没有图时返回空串（不污染教师原文）', () => {
    expect(buildTeacherWhiteboardText(null)).toBe('');
    expect(buildTeacherWhiteboardText({})).toBe('');
    expect(buildTeacherWhiteboardText({ figures: [], diagrams: [] })).toBe('');
  });

  it('figure 的 kind/caption/axis/marks 被序列化进白板块', () => {
    const text = buildTeacherWhiteboardText({
      figures: [{
        engine: 'svg',
        kind: 'position-line',
        caption: '两车位置线',
        axis: { min: 0, max: 100, unit: 'km', ticks: [{ at: 0, label: 'A' }, { at: 100, label: 'B' }] },
        marks: [{ at: 40, label: '甲', dir: 'right' }],
      }],
    });

    expect(text).toContain('【课堂白板】');
    expect(text).toContain('position-line');
    expect(text).toContain('两车位置线');
    expect(text).toContain('"at":40');
    expect(text).toContain('甲');
    expect(text).toContain('不要问「图在哪」');
  });

  it('diagram 的 Mermaid 源码被带进白板块', () => {
    const text = buildTeacherWhiteboardText({
      diagrams: [{ engine: 'mermaid', code: 'graph TD; A-->B', caption: '归因流程' }],
    });

    expect(text).toContain('结构图');
    expect(text).toContain('归因流程');
    expect(text).toContain('graph TD; A-->B');
  });

  it('最多取 4 个图，且畸形输入不抛错', () => {
    const text = buildTeacherWhiteboardText({
      figures: [
        null,
        { kind: 'grid', spec: { rows: 1 } },
        { kind: 'matrix', spec: { rows: 2 } },
        { kind: 'compare', spec: { left: 'A' } },
        { kind: 'quadrant', spec: { x: 'B' } },
        { kind: 'board', spec: { bins: 3 } },
      ],
    });

    expect(text).toContain('grid');
    expect(text).toContain('matrix');
    expect(text).toContain('compare');
    expect(text).toContain('quadrant');
    expect(text).not.toContain('board');
  });

  it('buildTeacherVisibleContent 保留原文并追加白板块', () => {
    const content = buildTeacherVisibleContent('两条线怎么走直接看图。', {
      diagrams: [{ engine: 'mermaid', code: 'graph LR; X-->Y', caption: null }],
    });

    expect(content.startsWith('两条线怎么走直接看图。')).toBe(true);
    expect(content).toContain('graph LR; X-->Y');
  });
});

describe('normalizeProcessTeachingTurn 透传图面', () => {
  it('diagrams / figures 进入 NormalizedTeachingTurn（此前只透传 images）', () => {
    const normalized = normalizeProcessTeachingTurn({
      aiResponse: '看图',
      revision: 3,
      knowledgePoints: [],
      isCompletion: false,
      autoEnded: false,
      analysis: { cognitiveLevel: 'apply' },
      knowledgePoint: null,
      strategies: [],
      peerTriggered: false,
      peerMessage: null,
      currentState: null,
      promptDebug: null,
      diagrams: [{ engine: 'mermaid', code: 'graph TD; A-->B', caption: '流程' }],
      figures: [{ engine: 'svg', kind: 'position-line', caption: '位置线', axis: { min: 0, max: 10 } }],
    } as any);

    expect(normalized.diagrams).toEqual([{ engine: 'mermaid', code: 'graph TD; A-->B', caption: '流程' }]);
    expect(normalized.figures).toHaveLength(1);
    expect((normalized.figures![0] as { kind?: string }).kind).toBe('position-line');
  });
});
