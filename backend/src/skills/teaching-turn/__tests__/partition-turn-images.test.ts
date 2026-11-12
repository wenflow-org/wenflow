/**
 * 图片分桶（2026-11-12 学生发图）：归属标签分角色的数据基础。
 *
 * 学生也能发图之后，同一份历史里有三种来源：学生本轮的图（最后一条 user 消息）、
 * 老师的板书图（assistant）、学生更早的图（user 历史）。分桶规则：
 * - 学生本轮的图不占历史配额（它是本轮的**主要输入**，不是背景）；
 * - 历史（老师板书 + 学生旧图）共享 4 张预算，从最新往回数；
 * - 各桶内部保持时间顺序。
 */
import { partitionTurnImages, type TeachingTurnInput } from '../index';

const img = (n: string) => ({ url: `data:image/png;base64,${n}` });

const message = (over: Partial<TeachingTurnInput['messages'][number]>): TeachingTurnInput['messages'][number] =>
  ({ role: 'user', content: 'x', ...over }) as TeachingTurnInput['messages'][number];

describe('partitionTurnImages（学生发图的分桶）', () => {
  it('学生本轮的图进 learnerCurrent，不占历史预算', () => {
    const out = partitionTurnImages([
      message({ role: 'assistant', content: '上一轮板书', images: [img('board1'), img('board2')] }),
      message({ role: 'user', content: '你看我拍的这道题', images: [img('photo1'), img('photo2'), img('photo3'), img('photo4')] }),
    ]);
    expect(out.learnerCurrent.map((i) => i.url)).toEqual([
      'data:image/png;base64,photo1',
      'data:image/png;base64,photo2',
      'data:image/png;base64,photo3',
      'data:image/png;base64,photo4',
    ]);
    expect(out.teacherHistory.map((i) => i.url)).toEqual([
      'data:image/png;base64,board1',
      'data:image/png;base64,board2',
    ]);
    expect(out.learnerHistory).toEqual([]);
  });

  it('更早的学生图进 learnerHistory，与老师板书共享 4 张预算（从最新往回数）', () => {
    const out = partitionTurnImages([
      message({ role: 'user', content: '最早发的图', images: [img('old-student')] }), // 最旧，预算耗尽被丢
      message({ role: 'assistant', content: '板书A', images: [img('boardA')] }),
      message({ role: 'user', content: '学生旧图', images: [img('student-old')] }),
      message({ role: 'assistant', content: '板书B', images: [img('boardB')] }),
      message({ role: 'assistant', content: '板书C', images: [img('boardC')] }),
      message({ role: 'user', content: '最新提问' }),
    ]);
    expect(out.learnerCurrent).toEqual([]);
    // 预算 4 张：从最新往回 boardC → boardB → student-old → boardA，第 5 张 old-student 被挤出
    expect(out.teacherHistory.map((i) => i.url))
      .toEqual(['data:image/png;base64,boardA', 'data:image/png;base64,boardB', 'data:image/png;base64,boardC']);
    expect(out.learnerHistory.map((i) => i.url)).toEqual(['data:image/png;base64,student-old']);
  });

  it('无图消息安全返回三空桶', () => {
    const out = partitionTurnImages([message({ role: 'user', content: '纯文本' })]);
    expect(out).toEqual({ learnerCurrent: [], teacherHistory: [], learnerHistory: [] });
    expect(partitionTurnImages([])).toEqual({ learnerCurrent: [], teacherHistory: [], learnerHistory: [] });
  });

  it('无 url 的脏数据被过滤', () => {
    const out = partitionTurnImages([
      message({ role: 'user', content: '带脏图', images: [{ url: '' }, { url: '', caption: '没有 url' }, img('ok')] as unknown as TeachingTurnInput['messages'][number]['images'] }),
    ]);
    expect(out.learnerCurrent).toHaveLength(1);
    expect(out.learnerCurrent[0].url).toBe('data:image/png;base64,ok');
  });
});
