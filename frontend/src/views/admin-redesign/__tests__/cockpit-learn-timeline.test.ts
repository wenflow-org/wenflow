/**
 * 课堂时间轴：消息与检查点交错（2026-10-19 用户走查「这检查点怎么在下方，不符合课堂阅读顺序」）。
 *
 * 契约：
 *   1) 检查点按**作答的学员消息**落位：学员答完 → 题目与判分 → 老师讲评。
 *      `submittedAt` 是回合处理完才写的时间（真实样本晚于讲评 6 秒），不能直接拿它硬排，
 *      否则检查点会出现在讲评之后（2026-11-11 用户「顺序对吗」）；同刻仍按
 *      学员发言 → 检查点 → 老师讲评；
 *   2) 解析不出时间戳的条目排在末尾，不当作第 0 秒；
 *   3) 转录消息保留 figures/diagrams 与时间戳（座舱要渲染图、也要参与排序）。
 */
import { describe, expect, it } from 'vitest';
import { mergeLearnTimeline, transcriptMessages, timeValue } from '../cockpitFormat';

const msg = (role: string, content: string, timestamp: string, extra: Record<string, unknown> = {}) => ({
  role,
  content,
  timestamp,
  ...extra,
});

describe('cockpitFormat · 课堂时间轴', () => {
  it('timeValue：解析不出返回 null（不当作第 0 秒）', () => {
    expect(timeValue('2026-10-18T15:55:16.050Z')).toBe(Date.parse('2026-10-18T15:55:16.050Z'));
    expect(timeValue('')).toBeNull();
    expect(timeValue(null)).toBeNull();
    expect(timeValue('不是时间')).toBeNull();
  });

  it('transcriptMessages：带上时间戳，并保留 figures/diagrams', () => {
    const out = transcriptMessages([
      msg('assistant', '老师讲话', '2026-10-18T15:54:05.849Z', {
        diagrams: [{ engine: 'mermaid', code: 'flowchart TD\nA-->B' }],
      }),
      msg('user', '我的答案：C', '2026-10-18T15:54:50.468Z'),
      // 只带图、没有文字的消息也要留（否则图会凭空消失）
      { role: 'assistant', timestamp: '2026-10-18T15:55:00.000Z', figures: [{ kind: 'compare', spec: {} }] },
      { role: 'assistant', content: '   ', timestamp: '2026-10-18T15:55:10.000Z' },
    ]);
    expect(out).toHaveLength(3);
    expect(out[0].at).toBe('2026-10-18T15:54:05.849Z');
    expect(out[0].diagrams).toHaveLength(1);
    expect(out[2].figures).toHaveLength(1);
  });

  it('检查点与同刻消息：检查点在前（真实样本 15:55:16）', () => {
    const timeline = mergeLearnTimeline(
      transcriptMessages([
        msg('user', '我的答案：C. 地形平坦', '2026-10-18T15:54:50.468Z'),
        msg('assistant', '先停一下——这道不对', '2026-10-18T15:55:16.050Z'),
        msg('user', '我的答案：A. 劳动力充足', '2026-10-18T15:55:26.577Z'),
      ]),
      [
        { checkpointId: 'cp_1', question: '下面哪条判断符合判据？', passed: false, submittedAt: '2026-10-18T15:55:16.050Z' },
        { checkpointId: 'cp_2', question: '劳动力这条该标哪一档？', passed: true, submittedAt: '2026-10-18T15:55:36.383Z' },
      ]
    );
    expect(timeline.map((entry) => `${entry.kind}:${entry.checkpoint?.checkpointId || entry.message?.content.slice(0, 2)}`)).toEqual([
      'message:我的',
      'checkpoint:cp_1',
      'message:先停',
      'message:我的',
      'checkpoint:cp_2',
    ]);
  });

  it('检查点落库晚于老师讲评：仍插在学员作答之后、讲评之前（2026-11-10 真实样本）', () => {
    const timeline = mergeLearnTimeline(
      transcriptMessages([
        msg('assistant', '好，那我们不先背…左边那一派判断共同前提是哪一个？', '2026-11-10T03:35:49.276Z'),
        msg('user', '我的答案：A. 原因在身体上，要能查得到、看得见才算数', '2026-11-10T03:42:08.934Z'),
        msg('assistant', '对，左边这栏答对了——他们赌的就是查得到、看得见才算原因', '2026-11-10T03:42:28.562Z'),
        msg('user', '我不知道', '2026-11-10T03:44:41.031Z'),
      ]),
      [
        // 真实落库时间在讲评之后 6 秒；硬按时间排会跑到讲评后面
        { checkpointId: 'cp_1', question: '依赖的共同前提是哪一个？', passed: true, submittedAt: '2026-11-10T03:42:34.646Z' },
      ]
    );
    expect(timeline.map((entry) => entry.checkpoint?.checkpointId || entry.message?.content.slice(0, 4))).toEqual([
      '好，那我',
      '我的答案',
      'cp_1',
      '对，左边',
      '我不知道',
    ]);
  });

  it('多个检查点按时间升序插在各自回合；无时间戳的排末尾', () => {
    const timeline = mergeLearnTimeline(
      transcriptMessages([
        msg('assistant', '第一条', '2026-10-18T15:00:10.000Z'),
        msg('assistant', '第二条', '2026-10-18T15:00:30.000Z'),
      ]),
      [
        { checkpointId: 'late', submittedAt: '2026-10-18T15:00:20.000Z' },
        { checkpointId: 'early', submittedAt: '2026-10-18T15:00:05.000Z' },
        { checkpointId: 'no-time', submittedAt: null },
      ]
    );
    expect(timeline.map((entry) => entry.checkpoint?.checkpointId || entry.message?.content)).toEqual([
      'early',
      '第一条',
      'late',
      '第二条',
      'no-time',
    ]);
  });

  it('没有检查点或没有消息时不崩，仍按原顺序返回', () => {
    const messages = transcriptMessages([msg('assistant', '只有消息', '2026-10-18T15:00:00.000Z')]);
    expect(mergeLearnTimeline(messages, []).map((e) => e.kind)).toEqual(['message']);
    expect(mergeLearnTimeline([], [{ checkpointId: 'only' }]).map((e) => e.kind)).toEqual(['checkpoint']);
    expect(mergeLearnTimeline([], [])).toEqual([]);
  });
});
