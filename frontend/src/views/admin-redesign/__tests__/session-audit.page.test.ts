/**
 * 会话评审报告页（SessionAudit，2026-11-22 UX 走查 P2.1）：
 * 裁判/角色审计双评估自 2026-09-27 拆独立 API 面后一直没有管理台页面，本页补消费端。
 * 锁三件事：深链 ?session= 自动生成、双报告完整渲染（verdict/评分/完整性原因/发现/建议/证据）、
 * 失败不清空已有报告（就地重试）。渲染断言全部走 wrapper.text()——<details> 折叠内容
 * 仍在 DOM 里，与用户展开后看到的口径一致。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';

const { generateEvaluationsMock } = vi.hoisted(() => ({ generateEvaluationsMock: vi.fn() }));

vi.mock('@/api/adminApi', () => ({
  adminSessionAuditsApi: { generateEvaluations: generateEvaluationsMock }
}));
vi.mock('../live', () => ({
  errMsg: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  shortId: (s: string) => (s.length > 18 ? `${s.slice(0, 12)}…${s.slice(-6)}` : s)
}));

import SessionAudit from '../SessionAudit.vue';

const refereeRecord = {
  evaluatedAt: '2026-11-22T10:00:00.000Z',
  reused: false,
  evaluator: { model: 'test-model-a' },
  report: {
    verdict: 'pass_with_concerns',
    integrity: {
      valid: false,
      missingScores: ['teachingExperience'],
      missingDimensionEvidence: ['pathExperience']
    },
    scores: {
      overall: 71, goalExperience: 80, goalUnderstanding: 75, pathExperience: null,
      teachingExperience: null, controlConsistency: 82, boundaryIntegrity: 90, evidenceSufficiency: 40
    },
    findings: [
      {
        code: 'PATH_NO_EVIDENCE', severity: 'major', category: 'path',
        title: '路径阶段缺少实质证据', detail: '只有阶段元数据，没有该阶段的真实交互记录。', evidenceIds: ['e1']
      },
      {
        code: 'ANSWER_GIVEN', severity: 'minor', category: 'teaching',
        title: '教师两次直接给出答案', detail: '第 3 轮与第 7 轮复述了完整答案。', evidenceIds: []
      }
    ],
    recommendations: [
      {
        priority: 'P0', action: '先补齐路径阶段再重评',
        rationale: '路径维度缺少实质证据，这部分评分不可信。', findingCodes: ['PATH_NO_EVIDENCE']
      }
    ],
    evidence: [
      {
        id: 'e1', source: 'publicTrace', index: 1, path: 'observation.1.message',
        timestamp: '2026-11-22T09:30:00.000Z',
        excerpt: '老师：这道题的答案是 42。',
        interpretation: '教师直接给出完整答案，学生没有独立作答机会。'
      }
    ]
  }
};
const actorRecord = {
  evaluatedAt: '2026-11-22T10:01:00.000Z',
  reused: true,
  evaluator: { model: 'test-model-a' },
  report: {
    verdict: 'credible',
    scores: {
      overall: 88, personaConsistency: 90, storyConsistency: 85, disclosureDiscipline: 92,
      frictionCalibration: 80, stateContinuity: 86, behaviorPlausibility: 84, evidenceSufficiency: 70
    },
    findings: [], recommendations: [], evidence: []
  }
};

function makeRouter(initialQuery: Record<string, string> = {}) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/admin/session-audit', name: 'SessionAudit', component: SessionAudit }]
  });
  return router.push({ path: '/admin/session-audit', query: initialQuery }).then(() => router);
}

async function mountPage(query: Record<string, string> = {}) {
  const router = await makeRouter(query);
  const w = mount(SessionAudit, { attachTo: document.body, global: { plugins: [router] } });
  await flushPromises();
  return w;
}

beforeEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
  generateEvaluationsMock.mockResolvedValue({
    data: { success: true, data: { platform: refereeRecord, actor: actorRecord } }
  });
});

describe('会话评审报告页', () => {
  it('初始态：输入卡 + 空态，不自动发请求，空输入时按钮禁用', async () => {
    const w = await mountPage();
    expect(w.find('input[aria-label="会话 ID"]').exists()).toBe(true);
    expect(w.text()).toContain('还没有评审报告');
    expect(w.text()).toContain('裁判终局评审与角色保真审计');
    expect(generateEvaluationsMock).not.toHaveBeenCalled();
    const btn = w.findAll('button').find((b) => b.text().includes('生成评审报告'))!;
    expect(btn.attributes('disabled')).toBeDefined();
    w.unmount();
  });

  it('深链 ?session= 预填并自动生成，双报告完整渲染', async () => {
    const w = await mountPage({ session: 'sess-abc-123' });
    expect(generateEvaluationsMock).toHaveBeenCalledTimes(1);
    expect(generateEvaluationsMock).toHaveBeenCalledWith('sess-abc-123');

    const text = w.text();
    // 裁判卡：verdict 徽章 + 总分 + 完整性原因（含维度名中文化）
    expect(text).toContain('裁判终局评审');
    expect(text).toContain('通过，有保留意见');
    expect(text).toContain('总分 71');
    expect(text).toContain('这份报告证据不完整：缺少评分：教学体验；缺少实质证据的维度：路径体验');
    // 缺分的维度显示 —（不冒充 0 分）
    expect(text).toContain('—');
    // 发现 / 建议 / 证据
    expect(text).toContain('路径阶段缺少实质证据');
    expect(text).toContain('教师两次直接给出答案');
    expect(text).toContain('涉及证据：e1');
    expect(text).toContain('先补齐路径阶段再重评');
    expect(text).toContain('对应问题：PATH_NO_EVIDENCE');
    expect(text).toContain('公开轨迹');
    expect(text).toContain('第 2 条');
    expect(text).toContain('observation.1.message');
    expect(text).toContain('教师直接给出完整答案');
    // 角色卡：复用标记如实展示
    expect(text).toContain('角色保真审计');
    expect(text).toContain('角色可信');
    expect(text).toContain('复用已有报告');
    // 会话对象回显
    expect(text).toContain('会话');
    w.unmount();
  });

  it('输入会话 ID 回车生成；失败保留已有报告并给就地重试', async () => {
    const w = await mountPage();
    const input = w.find('input[aria-label="会话 ID"]');
    await input.setValue('sess-manual-1');
    const btn = w.findAll('button').find((b) => b.text().includes('生成评审报告'))!;
    await btn.trigger('click');
    await flushPromises();
    expect(generateEvaluationsMock).toHaveBeenCalledWith('sess-manual-1');
    expect(w.text()).toContain('裁判终局评审');

    // 重生成失败：旧报告不丢，错误条给重试
    generateEvaluationsMock.mockRejectedValueOnce(new Error('黑盒实验尚未结束'));
    const again = w.findAll('button').find((b) => b.text().includes('重新生成'))!;
    await again.trigger('click');
    await flushPromises();
    expect(w.text()).toContain('生成评审报告失败：黑盒实验尚未结束');
    expect(w.text()).toContain('裁判终局评审');
    const retry = w.findAll('button').find((b) => b.text() === '重试')!;
    expect(retry).toBeTruthy();
    w.unmount();
  });

  it('深链带 fromProfile 时页头给「返回画像」，点击回画像二级页（2026-11-22 审计：本页是一级场景，壳层回不去）', async () => {
    const w = await mountPage({ session: 'sess-abc-123', fromProfile: 'prof-9' });
    const back = w.findAll('button').find((b) => b.text() === '返回画像')!;
    expect(back).toBeTruthy();
    await back.trigger('click');
    await flushPromises();
    expect(w.vm.$router.currentRoute.value.fullPath).toBe('/admin/virtual-learners?view=virtual&id=prof-9');
    w.unmount();
  });

  it('不带 fromProfile 的深链/手动输入不给返回入口（无来处可回）', async () => {
    const w = await mountPage({ session: 'sess-abc-123' });
    expect(w.findAll('button').some((b) => b.text() === '返回画像')).toBe(false);
    w.unmount();
  });
});
