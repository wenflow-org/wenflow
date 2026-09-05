import {
  getAgentMembersOfAgent,
  getAgentManifest,
  listTopLevelAgents,
  listAgentManifest,
  getAgentRelations,
  LEGACY_AGENT_MEMBERS,
  validateManifest,
} from '../agent-manifest.service';

describe('agentMembers 派生等价（P1 迁移红线：与旧手写值逐项相等）', () => {
  const agentIds = Object.keys(LEGACY_AGENT_MEMBERS);

  it('getAgentMembersOfAgent 与 LEGACY 手写镜像逐项相等（保序）', () => {
    for (const agentId of agentIds) {
      expect(getAgentMembersOfAgent(agentId)).toEqual(LEGACY_AGENT_MEMBERS[agentId]);
    }
  });

  it('getAgentManifest / listAgentManifest / listTopLevelAgents 返回的 agentMembers 与手写一致', () => {
    for (const agentId of agentIds) {
      expect(getAgentManifest(agentId)?.agentMembers).toEqual(LEGACY_AGENT_MEMBERS[agentId]);
    }
    const fromList = listAgentManifest().filter((item) => item.kind === 'agent');
    for (const agent of fromList) {
      expect(agent.agentMembers).toEqual(LEGACY_AGENT_MEMBERS[agent.id]);
    }
    const topAgents = listTopLevelAgents();
    expect(topAgents).toHaveLength(agentIds.length);
    for (const agent of topAgents) {
      expect(agent.agentMembers).toEqual(LEGACY_AGENT_MEMBERS[agent.id]);
    }
  });

  it('getAgentRelations members 与手写一致（拓扑消费方依赖）', () => {
    const relations = getAgentRelations();
    expect(relations.map((relation) => relation.agentId).sort()).toEqual([...agentIds].sort());
    for (const relation of relations) {
      expect(relation.members).toEqual(LEGACY_AGENT_MEMBERS[relation.agentId]);
    }
  });

  it('skill 条目不附加 agentMembers（kind=skill 行为不变）', () => {
    expect(getAgentManifest('skill:goal-conversation')?.agentMembers).toBeUndefined();
  });

  it('validateManifest 基于派生成员仍通过（启动自洽）', () => {
    expect(validateManifest()).toEqual({ ok: true });
  });
});
