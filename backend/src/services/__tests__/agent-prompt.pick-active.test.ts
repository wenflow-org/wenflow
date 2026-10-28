/**
 * 「线上生效版本」单一定义（2026-10-24 用户「什么是版本，单一源头」）：
 * Skill 列表「Prompt 版本」列、详情 hero、运行时定义 activePrompt 共用 pickActivePromptPerAgent，
 * 规则必须与 AgentConfigService.getActivePrompt（不传 selection）一致：取 ACTIVE 基线最高版本。
 */
import { pickActivePromptPerAgent } from '../agent-prompt.service';

interface Row {
  agentId: string;
  id: string;
  version: number;
  variant?: string | null;
}

const row = (agentId: string, id: string, version: number, variant: string | null = null): Row => ({
  agentId,
  id,
  version,
  variant,
});

describe('线上生效版本的单一定义', () => {
  test('取 ACTIVE 基线里的最高版本，实验臂不参与读数', () => {
    const picked = pickActivePromptPerAgent([
      row('skill:a', 'a-v3', 3),
      row('skill:a', 'a-v4', 4),
      row('skill:a', 'a-v9-exp', 9, 'B'),
    ]);
    expect(picked.get('skill:a')?.id).toBe('a-v4');
  });

  test('没有基线时退回最高版本（与运行时兜底一致，不留空）', () => {
    const picked = pickActivePromptPerAgent([
      row('skill:b', 'b-v2-exp', 2, 'A'),
      row('skill:b', 'b-v3-exp', 3, 'B'),
    ]);
    expect(picked.get('skill:b')?.id).toBe('b-v3-exp');
  });

  test('每个 agent 各自一行，互不串档', () => {
    const picked = pickActivePromptPerAgent([
      row('skill:a', 'a-v4', 4),
      row('skill:c', 'c-v7', 7),
      row('skill:c', 'c-v6', 6),
    ]);
    expect(picked.size).toBe(2);
    expect(picked.get('skill:a')?.version).toBe(4);
    expect(picked.get('skill:c')?.version).toBe(7);
    expect(picked.get('skill:missing')).toBeUndefined();
  });
});
