import { canReadTeachingSession } from '../admin/virtual-learners.teaching-detail-access';

const base = {
  currentId: 't-current',
  archivedIds: new Set(['t-archived']),
  requestedPathId: 'lp-1',
  sessionPathId: 'lp-1',
  requestedUserId: 'u-1',
  sessionUserId: 'u-1',
};

describe('canReadTeachingSession（虚拟会话座舱选课）', () => {
  it('当前绑定课堂放行', () => {
    expect(canReadTeachingSession({ ...base, requestedId: 't-current' })).toBe(true);
  });

  it('教学历史里的课堂放行', () => {
    expect(canReadTeachingSession({ ...base, requestedId: 't-archived' })).toBe(true);
  });

  it('同会话同路径的延伸课/复习课放行（#124 回归）', () => {
    expect(canReadTeachingSession({ ...base, requestedId: 't-extension', archivedIds: [] })).toBe(true);
  });

  it('不同路径拒绝', () => {
    expect(canReadTeachingSession({
      ...base,
      requestedId: 't-other-path',
      archivedIds: [],
      requestedPathId: 'lp-2',
    })).toBe(false);
  });

  it('不同学习者拒绝', () => {
    expect(canReadTeachingSession({
      ...base,
      requestedId: 't-other-user',
      archivedIds: [],
      requestedUserId: 'u-2',
    })).toBe(false);
  });

  it('缺少路径或用户身份时拒绝', () => {
    expect(canReadTeachingSession({
      ...base,
      requestedId: 't-no-path',
      archivedIds: [],
      requestedPathId: null,
    })).toBe(false);
    expect(canReadTeachingSession({
      ...base,
      requestedId: 't-no-user',
      archivedIds: [],
      sessionUserId: null,
    })).toBe(false);
  });

  it('空 requestedId 拒绝', () => {
    expect(canReadTeachingSession({ ...base, requestedId: '' })).toBe(false);
  });
});
