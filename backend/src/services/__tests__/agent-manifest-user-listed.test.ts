/**
 * #219 数据契约：用户默认「AI 任务记录」列表口径 = manifest userListed（真实写日志的业务动作），
 * 与 userVisible（是否顶层编排器）解耦。
 *
 * 背景：默认过滤此前用 userVisible=true 放行，manifest 里只有 goal-agent / path-agent /
 * teaching-agent 三个顶层编排器为 true；但 goal-agent、teaching-agent 全表 0 行（真实调用
 * 记在 skill:goal-conversation / skill:teaching-turn 名下），于是默认视图结构性只剩 path-agent。
 *
 * 这里锁住白名单本身：新增业务 skill 需显式标 userListed 并同步本契约；0 行的展示身份
 * （goal-agent / teaching-agent）不得再回到默认口径。
 */
import { listAgentManifest, listUserListedAgentIds } from '../agent-manifest.service';

describe('#219 默认列表口径 userListed', () => {
  const listed = listUserListedAgentIds();

  it('只放行真实写日志的业务动作（白名单锁定）', () => {
    expect([...listed].sort()).toEqual([
      'path-agent',
      'skill:goal-conversation',
      'skill:path-planning',
      'skill:session-wrapup',
      'skill:teaching-turn'
    ]);
  });

  it('userVisible 的展示身份不进默认口径（goal-agent / teaching-agent 全表 0 行）', () => {
    const manifest = listAgentManifest();
    const visibleOrchestrators = manifest
      .filter((entry) => entry.kind === 'agent' && entry.userVisible)
      .map((entry) => entry.id);

    expect(visibleOrchestrators).toEqual(
      expect.arrayContaining(['goal-agent', 'path-agent', 'teaching-agent'])
    );
    // 只有真实写日志的 path-agent 同时是 userListed；其余编排器只做展示
    expect(listed).toEqual(expect.arrayContaining(['path-agent']));
    expect(listed).not.toContain('goal-agent');
    expect(listed).not.toContain('teaching-agent');
  });

  it('内部机制 skill 与平台底层调用不在白名单', () => {
    for (const internal of [
      'skill:kc-mapper',
      'skill:adaptive-guidance-copy',
      'skill:learner-model',
      'skill:virtual-learner-goal-dialogue-simulator',
      'api-gateway',
      'system-call',
      'unknown'
    ]) {
      expect(listed).not.toContain(internal);
    }
  });
});
