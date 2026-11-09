/**
 * 清理候选筛选口径（2026-11-09）。
 *
 * 背景：判定此前长在清理向导组件里、只对**当前载入页**的行生效（列表一次最多 1000 行），
 * 超出的同龄实例静默漏删——向导报「将删除 3 人」时库里可能还有几百个。口径下沉到服务端后
 * 本文件钉住三条：在跑的豁免（autopilot 状态判，不看 session.status）、保留名单不在服务端过滤、
 * 建号时间与标签如实带出（标签坏 JSON 不炸、退化为空数组）。
 */
import { selectCleanupCandidates } from '../cleanup-candidates';

const NOW = new Date('2026-11-09T12:00:00.000Z');
const STALE_BEFORE = new Date('2026-11-09T11:00:00.000Z');

const aged = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  tags: null as string | null,
  users: { name: `名字-${id}` },
  _count: { sessions: 2 },
  ...over,
});

describe('selectCleanupCandidates', () => {
  it('在推进的实例豁免（autopilot=running 且心跳新鲜），其余入选', () => {
    const rows = [aged('p-run'), aged('p-idle')];
    const { candidates, runningCount } = selectCleanupCandidates(rows, [
      {
        virtualProfileId: 'p-run',
        status: 'created',
        stageResults: JSON.stringify({ autopilot: { status: 'running' } }),
        updatedAt: NOW,
      },
    ], STALE_BEFORE);

    expect(candidates.map((c) => c.id)).toEqual(['p-idle']);
    expect(runningCount).toBe(1);
  });

  it('goal 阶段（session.status=created）在跑也算在跑——判据是 autopilot 而非 session 状态', () => {
    const { candidates, runningCount } = selectCleanupCandidates([aged('p1')], [
      { virtualProfileId: 'p1', status: 'created', stageResults: JSON.stringify({ autopilot: { status: 'running' } }), updatedAt: NOW },
    ], STALE_BEFORE);

    expect(candidates).toHaveLength(0);
    expect(runningCount).toBe(1);
  });

  it('在推但心跳超阈值（停滞）不豁免：那是「无响应」，不是正在干活', () => {
    const stale = new Date('2026-11-01T00:00:00.000Z');
    const { candidates } = selectCleanupCandidates([aged('p1')], [
      { virtualProfileId: 'p1', status: 'running', stageResults: JSON.stringify({ autopilot: { status: 'running' } }), updatedAt: stale },
    ], STALE_BEFORE);

    expect(candidates.map((c) => c.id)).toEqual(['p1']);
  });

  it('保留名单不在服务端过滤（标签原样带出，由界面按输入过滤）', () => {
    const { candidates } = selectCleanupCandidates([aged('p1', { tags: JSON.stringify(['cohort-keep']) })], [], STALE_BEFORE);

    expect(candidates[0].tags).toEqual(['cohort-keep']);
  });

  it('标签坏 JSON / null 退化为空数组，不炸；会话数与名字缺失有兜底', () => {
    const { candidates } = selectCleanupCandidates([
      aged('p1', { tags: '{oops', users: null, _count: null }),
      aged('p2', { tags: null }),
    ], [], STALE_BEFORE);

    expect(candidates[0].tags).toEqual([]);
    expect(candidates[0].name).toBe('p1');
    expect(candidates[0].sessions).toBe(0);
    expect(candidates[1].tags).toEqual([]);
  });
});
