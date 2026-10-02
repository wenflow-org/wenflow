import { resolveCompletionScope, COMPLETION_SCOPE_OUT_MIN_TURNS } from '../teaching-turn-engine';

/**
 * 收束判定的范围外点排除（scope-out）。
 * 背景（XIAOCHEN-REVIEW-20261002 P0-1）：开课种子把画像 struggleConcepts（后续章节概念）
 * 注入目标集，单任务课堂整节教不到 ⇒ pending+0 永久压死 noPendingPoints，
 * targets/backstop/soft 三条收束路径全失效，西瓜书绪论课被拖到 40 轮 timebox 硬跳。
 */
describe('resolveCompletionScope（收束判定的范围外点排除）', () => {
  // 复刻小陈会话的知识看板形态：3 个已掌握 + 2 个跨章节种子点永久 pending
  const xiaochenLikeBoard = [
    { name: '机器学习的问题定位：从数据中归纳规律', status: 'mastered', progress: 100 },
    { name: '规则驱动与数据驱动的分界', status: 'mastered', progress: 100 },
    { name: '学到的规律要能用在没见过的例子上', status: 'mastered', progress: 100 },
    { name: '模型假设经误差度量与优化求解形成闭合推导链', status: 'pending', progress: 0 },
    { name: '推导链三环骨架', status: 'pending', progress: 0 },
  ];
  const OUT_OF_SCOPE = ['模型假设经误差度量与优化求解形成闭合推导链', '推导链三环骨架'];

  it('轮数不足时不排除任何点（保护教师计划后置教的点）', () => {
    const { inScope, outOfScopeNames } = resolveCompletionScope(xiaochenLikeBoard, [], COMPLETION_SCOPE_OUT_MIN_TURNS - 1);
    expect(inScope).toHaveLength(5);
    expect(outOfScopeNames.size).toBe(0);
  });

  it('达到轮数后：pending+零进度+本轮未申报的点被摘出', () => {
    const { inScope, outOfScopeNames } = resolveCompletionScope(xiaochenLikeBoard, [], 5);
    expect(inScope).toHaveLength(3);
    expect(inScope.every((point) => point.status === 'mastered')).toBe(true);
    for (const name of OUT_OF_SCOPE) expect(outOfScopeNames.has(name)).toBe(true);
  });

  it('本轮教师申报过的点即使仍 pending+0 也不摘（在教=在范围内）', () => {
    const declared = ['推导链三环骨架'];
    const { inScope, outOfScopeNames } = resolveCompletionScope(xiaochenLikeBoard, declared, 10);
    expect(inScope.some((point) => point.name === '推导链三环骨架')).toBe(true);
    expect(outOfScopeNames.has('推导链三环骨架')).toBe(false);
    expect(outOfScopeNames.has('模型假设经误差度量与优化求解形成闭合推导链')).toBe(true);
  });

  it('非 pending 或有进度的点永不排除', () => {
    const board = [
      { name: '正在学的点', status: 'learning', progress: 30 },
      { name: '有进度但没到线', status: 'review', progress: 60 },
      { name: '零进度但非 pending', status: 'review', progress: 0 },
    ];
    const { inScope } = resolveCompletionScope(board, [], 20);
    expect(inScope).toHaveLength(3);
  });

  it('全部点都在范围外时 inScope 为空（= 这课什么都没教，不该收）', () => {
    const board = [{ name: '范围外的点', status: 'pending', progress: 0 }];
    const { inScope } = resolveCompletionScope(board, [], 10);
    expect(inScope).toHaveLength(0);
  });

  it('本轮申报名单大小写/空白差异按 trim+lowercase 归一', () => {
    const board = [{ name: '推导链三环骨架', status: 'pending', progress: 0 }];
    const { inScope } = resolveCompletionScope(board, [' 推导链三环骨架 '], 10);
    expect(inScope).toHaveLength(1);
  });
});
