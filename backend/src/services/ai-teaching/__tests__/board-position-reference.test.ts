import { findDanglingBoardPositionReferences } from '../board-intent';

/**
 * 板面位置/槽位指认存在性守卫（修复批 38-①，u01L2 reeval31 实证）：
 * T4 教师说「右栏第 3 行我留了空槽」，板上右栏只有 2 行（空槽在第 2 行，label "?"）——
 * 位置指认越界。批 13-① 的引号内容守卫抓不住该形态（无引号片段）。
 */
describe('findDanglingBoardPositionReferences（位置/槽位指认存在性）', () => {
  // u01L2 rev2 原始字节（取证还原）
  const u01l2Rev2 = {
    left: {
      rows: [
        { label: '合同期两年', sub: '24 个月' },
        { label: '试用期三个月', sub: '超过两个月上限' },
        { label: '试用期结束后再约定一次', sub: '同一用人单位只能约定一次' },
      ],
    },
    right: {
      rows: [{ label: '合同期两年', sub: '24 个月' }, { label: '?' }],
    },
  };

  it('病历单形态：右栏第 3 行越界 → 命中；左栏第 3 行存在 → 不命中；空槽存在 → 不因空槽命中', () => {
    const { misses } = findDanglingBoardPositionReferences({
      reply: '左栏第 3 行对应的是「只能约定一次」，右栏第 3 行我留了空槽——你把它填一下：这一格该写哪条法定条件？',
      spec: u01l2Rev2,
    });
    expect(misses).toEqual(['右栏第3行']);
  });

  it('判官误报反例：右栏那个空槽（rows[3] label "?" 存在）→ 不命中', () => {
    const filled = {
      left: { rows: [{ label: '提前离职' }, { label: '需支付违约金三万元' }, { label: '培训费' }, { label: '服务期' }] },
      right: { rows: [{ label: '提前离职' }, { label: '公司支付专项培训费' }, { label: '约定服务期' }, { label: '?' }] },
    };
    const { misses } = findDanglingBoardPositionReferences({
      reply: '右栏那个空槽，你把它补上：既然违约金只认两种情形，那除了服务期，另一种是什么？',
      spec: filled,
    });
    expect(misses).toEqual([]);
  });

  it('空槽承诺但板上无待填位 → 命中', () => {
    const noBlank = { right: { rows: [{ label: '营业收入' }, { label: '营业成本' }] } };
    const { misses } = findDanglingBoardPositionReferences({
      reply: '右栏那个空槽，你把它补上。',
      spec: noBlank,
    });
    expect(misses.length).toBe(1);
    expect(misses[0]).toContain('空槽');
  });

  it('中文序数：右栏第三行越界 → 命中；第N条（法条语义）不校验', () => {
    const { misses } = findDanglingBoardPositionReferences({
      reply: '右栏第三行对应「只能约定一次」。违约金只认两种法定情形，你先看第⑤条。',
      spec: { right: { rows: [{ label: 'a' }, { label: 'b' }] } },
    });
    expect(misses).toEqual(['右栏第三行']);
  });

  it('帧越界：板面 2 帧说「第 3 帧」→ 命中；8 帧说「第 2 帧」→ 不命中（u19L1 形态）', () => {
    const twoFrames = { frames: [{ label: '帧1', items: ['a'] }, { label: '帧2', items: ['b'] }] };
    expect(findDanglingBoardPositionReferences({ reply: '看第 3 帧', spec: twoFrames }).misses).toEqual(['第3帧']);
    const eightFrames = { frames: Array.from({ length: 8 }, (_, i) => ({ label: `帧${i + 1}`, items: ['x'] })) };
    expect(findDanglingBoardPositionReferences({ reply: '被问哪帧答哪帧，比如第 2 帧', spec: eightFrames }).misses).toEqual([]);
  });

  it('无前缀行指认：任一栏行数足够即放行；两栏都不够才命中', () => {
    const spec = { left: { rows: [{ label: '1' }, { label: '2' }, { label: '3' }] }, right: { rows: [{ label: 'x' }] } };
    expect(findDanglingBoardPositionReferences({ reply: '看第 3 行', spec }).misses).toEqual([]);
    expect(findDanglingBoardPositionReferences({ reply: '看第 4 行', spec }).misses).toEqual(['第4行']);
  });

  it('豁免：spec 为空/无行无帧结构/空回复 → 不动作', () => {
    expect(findDanglingBoardPositionReferences({ reply: '右栏第 5 行', spec: null }).misses).toEqual([]);
    expect(findDanglingBoardPositionReferences({ reply: '右栏第 5 行', spec: {} }).misses).toEqual([]);
    expect(findDanglingBoardPositionReferences({ reply: '右栏第 5 行', spec: { note: '文字说明' } }).misses).toEqual([]);
    expect(findDanglingBoardPositionReferences({ reply: '', spec: u01l2Rev2 }).misses).toEqual([]);
  });
});
