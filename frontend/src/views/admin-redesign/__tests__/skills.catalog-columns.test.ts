/**
 * Skill 目录 · 图 3 走查修复批（2026-11-09）回归：
 *
 * A. 右侧两列数字（调用次数 / 成功率）补齐表头，且表头格数 = 行格数（含 colspan 口径）
 * B. 中区成列：归属 Agent / 路由模型 / 最近更新 各自成列（不再挤在左格留 1000px 空白），
 *    列宽以固定列宽表声明（colgroup + th 同用列宽类）
 * C. 卡头筛选顺序与全站一致：归属 / 窗口 下拉在左组（关注之后），搜索框在右组
 * D. 成功率着色单一规则：色点承载档位色，百分比文字恒为 --mk-ink（不再对文字着色）
 * E. 「查看失败记录」在 操作 列（不再是 Skill 信息副行的小字）
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Skills from '../Skills.vue';
import { dataSource, liveSkillStatsMap } from '../store';
import { liveSkillProfiles } from '../live';

const { getReconciliationMock } = vi.hoisted(() => ({
  getReconciliationMock: vi.fn(),
}));

function apiObject(custom?: Record<string, unknown>): Record<string, unknown> {
  return new Proxy(custom || ({} as Record<string, unknown>), {
    get: (_t, prop) => {
      if (typeof prop !== 'string' || prop === 'then') return undefined;
      if (custom && prop in custom) return (custom as Record<string, unknown>)[prop];
      return vi.fn(async () => ({ data: {} }));
    }
  });
}

vi.mock('@/api/adminApi', () => ({
  adminAuthApi: apiObject(),
  adminSkillsApi: apiObject({
    getReconciliation: getReconciliationMock,
    getSkills: vi.fn(async () => ({ data: { data: { skills: [] } } }))
  }),
  adminMcpApi: apiObject(),
  adminGlossaryApi: apiObject(),
  adminAnnouncementsApi: apiObject(),
  adminPlatformSettingsApi: apiObject(),
  adminAuditApi: apiObject(),
  adminFieldRoutingsApi: apiObject(),
  adminPromptWorkbenchApi: apiObject(),
  adminFeedbackApi: apiObject(),
  adminGoalConversationsApi: apiObject(),
  adminRuntimeDefinitionsApi: apiObject(),
  adminPromptOpsApi: apiObject(),
  adminHealthCenterApi: apiObject(),
  adminVirtualLearnersApi: apiObject(),
  adminSessionsApi: apiObject(),
  adminSkillWorkbenchApi: apiObject(),
  adminAgentPromptsApi: apiObject(),
  adminTeachingSessionsApi: apiObject(),
  adminUsersApi: apiObject(),
  adminDashboardApi: apiObject(),
  adminLearnerModelsApi: apiObject(),
  adminApiConfigApi: apiObject(),
  adminAgentsApi: apiObject(),
  adminAgentTopologyApi: apiObject(),
  adminApi: apiObject(),
  clearAdminSession: vi.fn(),
  markAdminSession: vi.fn(),
  hasAdminSession: vi.fn(() => true),
  getUserIncludingDeleted: vi.fn(async () => ({ data: {} })),
  getDeletedUsers: vi.fn(async () => ({ data: {} })),
  restoreUser: vi.fn(async () => ({ data: {} }))
}));

/** 三档成功率各一行：ok（100%）/ warn（95%）/ bad（80%）+ 一行无归属、无调用 */
function prime() {
  dataSource.value = 'live';
  liveSkillProfiles.value = [
    { id: 'skill:healthy', name: '健康技能', agentId: 'agent-1', agentName: '目标 Agent', category: 'teaching' },
    { id: 'skill:warn', name: '告警技能', agentId: 'agent-1', agentName: '目标 Agent', category: 'teaching' },
    { id: 'skill:bad', name: '异常技能', agentId: 'agent-2', agentName: '路径 Agent', category: 'tool' },
    { id: 'skill:idle', name: '空闲技能', agentId: '', agentName: '', category: 'tool' },
  ] as never;
  liveSkillStatsMap.value = {
    'skill:healthy': { calls: 40, errors: 0, avgMs: 100, lastAt: '刚刚', lastCalledAt: '2026-11-11T10:30:00Z' },
    'skill:warn': { calls: 40, errors: 2, avgMs: 100, lastAt: '2 小时前' },
    'skill:bad': { calls: 40, errors: 8, avgMs: 100, lastAt: '1 天前' },
    'skill:idle': { calls: 0, errors: 0, avgMs: 0, lastAt: '从未' },
  } as never;
}

async function mountSkills() {
  prime();
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/admin/:page?', component: { template: '<div />' } }],
  });
  await router.push('/admin/skills');
  await router.isReady();
  const w = mount(Skills, { global: { plugins: [router], stubs: { teleport: true } } });
  await flushPromises();
  return w;
}

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'Skills.vue'),
  'utf8'
);

describe('Skill 目录 · 列结构（图 3 走查 A/B）', () => {
  beforeEach(() => {
    localStorage.removeItem('wf_skills_list_sort');
    getReconciliationMock.mockReset();
    getReconciliationMock.mockResolvedValue({ data: { data: { items: [] } } });
  });

  it('A：调用次数 / 成功率 两列有表头，且右对齐 + 可排序标记', async () => {
    const w = await mountSkills();
    const heads = w.findAll('.sk-catalog thead th');
    const texts = heads.map((t) => t.text());
    expect(texts).toContain('调用次数');
    expect(texts).toContain('成功率');
    // 两列都是数字列：右对齐 + 可排序 + caret（与全站表头同一套标记）
    for (const label of ['调用次数', '成功率']) {
      const th = heads.find((t) => t.text() === label)!;
      expect(th.classes()).toContain('mk-th--right');
      expect(th.classes()).toContain('mk-th--sortable');
      expect(th.find('.mk-th__caret').exists()).toBe(true);
    }
    w.unmount();
  });

  it('A：表头格数 = 每行格数（无 colspan 错位）', async () => {
    const w = await mountSkills();
    const headCount = w.findAll('.sk-catalog thead tr')[0].findAll('th').length;
    expect(headCount).toBe(7);
    const rows = w.findAll('.sk-catalog tbody tr');
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const tds = r.findAll('td');
      expect(tds.length).toBe(headCount);
      // 不允许 colspan 把格数算错
      for (const td of tds) expect(td.attributes('colspan')).toBeUndefined();
    }
    w.unmount();
  });

  it('A：点击 调用次数 / 成功率 表头即按该列排序（与下拉共用 useTableSort 单点）', async () => {
    const w = await mountSkills();
    const heads = w.findAll('.sk-catalog thead th');
    const callsTh = heads.find((t) => t.text() === '调用次数')!;
    await callsTh.trigger('click');
    expect((w.vm as unknown as { sortKey: string }).sortKey).toBe('calls');
    const rateTh = w.findAll('.sk-catalog thead th').find((t) => t.text() === '成功率')!;
    await rateTh.trigger('click');
    expect((w.vm as unknown as { sortKey: string }).sortKey).toBe('rate');
    expect(rateTh.attributes('aria-sort')).toBe('descending');
    w.unmount();
  });

  it('B：中区标签各自成列（归属 Agent / 路由模型 / 最近更新），不再挤在 Skill 信息格', async () => {
    const w = await mountSkills();
    const heads = w.findAll('.sk-catalog thead th').map((t) => t.text());
    expect(heads).toEqual(['Skill 信息', '归属 Agent', '路由模型', '最近更新', '调用次数', '成功率', '操作']);
    // 第一列是 Skill 信息（名称 + 英文 ID 副行），不再含归属标签
    const firstRow = w.findAll('.sk-catalog tbody tr')[0];
    const infoCell = firstRow.findAll('td')[0];
    expect(infoCell.classes()).toContain('sk-c-info');
    expect(infoCell.find('.sk-name-main').exists()).toBe(true);
    expect(infoCell.find('.sk-agent-tag').exists()).toBe(false);
    expect(infoCell.find('.sk-model-chip').exists()).toBe(false);
    // 归属 / 路由 / 最近更新 在各自的格子里
    const tds = firstRow.findAll('td');
    expect(tds[1].classes()).toContain('sk-c-agent');
    expect(tds[1].find('.sk-agent-tag').exists()).toBe(true);
    expect(tds[2].classes()).toContain('sk-c-model');
    expect(tds[2].find('.sk-model-chip').exists()).toBe(true);
    expect(tds[3].classes()).toContain('sk-c-updated');
    expect(tds[3].find('.sk-recent').exists()).toBe(true);
    w.unmount();
  });

  /* 2026-11-11：最近更新仍是相对时间（2 小时前）为主口径，但 title 必须是
     YYYY-MM-DD HH:mm 绝对时刻；无调用的行给「该窗口内暂无调用」，不硬造日期。 */
  it('B：最近更新的悬停是绝对时刻（YYYY-MM-DD HH:mm），无调用行给明确空态', async () => {
    const w = await mountSkills();
    const rows = w.findAll('.sk-catalog tbody tr');
    const recentOf = (id: string) =>
      rows.find((r) => r.attributes('aria-label')?.includes(id))!.find('.sk-recent');
    expect(recentOf('skill:healthy').attributes('title')).toMatch(/^最近调用：\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(recentOf('skill:idle').attributes('title')).toBe('该窗口内暂无调用');
    w.unmount();
  });

  it('B：固定列宽表声明了每列宽度（colgroup + th 同用列宽类，合计 100%）', async () => {
    const w = await mountSkills();
    const table = w.find('.sk-catalog');
    expect(table.classes()).toContain('mk-table--fixed');
    const cols = table.findAll('colgroup col');
    expect(cols.length).toBe(7);
    const colClasses = cols.map((c) => c.classes()[0]);
    expect(colClasses).toEqual(['sk-c-info', 'sk-c-agent', 'sk-c-model', 'sk-c-updated', 'sk-c-calls', 'sk-c-rate', 'sk-c-act']);
    // th 上也带同一套列宽类（阅读/测试从 th 读列宽）
    const thClasses = table.findAll('thead th').map((t) => t.classes());
    colClasses.forEach((cls, i) => expect(thClasses[i]).toContain(cls));
    // 样式里每列都声明了 width（percent + px min/max），且百分比合计 100%
    const pct: number[] = [];
    for (const cls of colClasses) {
      const rule = new RegExp(`\\.${cls}\\s*\\{[^}]*\\}`).exec(SRC);
      expect(rule, `${cls} 应有宽度声明`).toBeTruthy();
      const block = rule![0];
      expect(block).toMatch(/width:\s*\d+%/);
      expect(block).toMatch(/min-width:\s*\d+px/);
      // 不加 max-width：否则在 1920 处各列触顶后会留出 void（图 3 走查 B 的痛点）
      expect(block).not.toMatch(/max-width:\s*\d+px/);
      pct.push(Number(/width:\s*(\d+)%/.exec(block)![1]));
    }
    expect(pct.reduce((a, b) => a + b, 0)).toBe(100);
    w.unmount();
  });
});

describe('Skill 目录 · 卡头筛选顺序（图 3 走查 C）', () => {
  beforeEach(() => {
    localStorage.removeItem('wf_skills_list_sort');
    getReconciliationMock.mockReset();
    getReconciliationMock.mockResolvedValue({ data: { data: { items: [] } } });
  });

  it('C：归属 / 窗口 下拉在左组（关注之后），搜索框在右组', async () => {
    const w = await mountSkills();
    const head = w.find('.mk-card__head');
    const left = head.find('.mk-filter');
    const right = head.find('.mk-card__head-right');
    const dims = left.findAll('.mk-pillselect__k').map((k) => k.text());
    expect(dims).toEqual(['关注', '归属', '窗口']);
    // 左组里没有搜索框；右组里没有下拉筛选
    expect(left.find('input.mk-filter__input').exists()).toBe(false);
    expect(right.find('.mk-pillselect').exists()).toBe(false);
    expect(right.find('input.mk-filter__input').exists()).toBe(true);
    // DOM 顺序：归属 / 窗口 出现在搜索框之前
    const html = head.html();
    const idxAgent = html.indexOf('aria-label="按归属 Agent 筛选"');
    const idxRange = html.indexOf('aria-label="统计窗口"');
    const idxSearch = html.indexOf('mk-filter__input');
    expect(idxAgent).toBeGreaterThan(-1);
    expect(idxRange).toBeGreaterThan(-1);
    expect(idxSearch).toBeGreaterThan(-1);
    expect(idxAgent).toBeLessThan(idxSearch);
    expect(idxRange).toBeLessThan(idxSearch);
    w.unmount();
  });
});

describe('Skill 目录 · 成功率着色规则（图 3 走查 D）', () => {
  beforeEach(() => {
    localStorage.removeItem('wf_skills_list_sort');
    getReconciliationMock.mockReset();
    getReconciliationMock.mockResolvedValue({ data: { data: { items: [] } } });
  });

  it('D：三档都用色点表达，百分比文字恒为 --mk-ink（不再对文字着色）', async () => {
    const w = await mountSkills();
    const rows = w.findAll('.sk-catalog tbody tr');
    const dotOf = (id: string) => {
      const row = rows.find((r) => r.attributes('aria-label')?.includes(id))!;
      return row.find('.sk-c-rate .sk-dot');
    };
    expect(dotOf('skill:healthy').classes()).toContain('sk-dot--ok');
    expect(dotOf('skill:warn').classes()).toContain('sk-dot--warn');
    expect(dotOf('skill:bad').classes()).toContain('sk-dot--error');
    // 文字不再带档位类（旧 sk-rate--warn / sk-rate--bad 已退役）
    for (const r of rows) {
      const rate = r.find('.sk-c-rate .sk-rate');
      expect(rate.classes()).not.toContain('sk-rate--warn');
      expect(rate.classes()).not.toContain('sk-rate--bad');
    }
    w.unmount();
  });

  it('D：CSS 里 .sk-rate 的文字色是 --mk-ink，且不再有按档位给文字着色的规则', () => {
    const rateRule = /\.sk-rate\s*\{[^}]*\}/.exec(SRC);
    expect(rateRule).toBeTruthy();
    expect(rateRule![0]).toMatch(/color:\s*var\(--mk-ink\)/);
    expect(SRC).not.toMatch(/\.sk-rate--warn\s*\{/);
    expect(SRC).not.toMatch(/\.sk-rate--bad\s*\{/);
  });
});

describe('Skill 目录 · 操作列（图 3 走查 E）', () => {
  beforeEach(() => {
    localStorage.removeItem('wf_skills_list_sort');
    getReconciliationMock.mockReset();
    getReconciliationMock.mockResolvedValue({ data: { data: { items: [] } } });
  });

  it('E：查看失败记录 在 操作 列；无失败行渲染弱化占位', async () => {
    const w = await mountSkills();
    const heads = w.findAll('.sk-catalog thead th').map((t) => t.text());
    const actIdx = heads.indexOf('操作');
    expect(actIdx).toBe(heads.length - 1);
    const rows = w.findAll('.sk-catalog tbody tr');
    for (const r of rows) {
      const actCell = r.findAll('td')[actIdx];
      expect(actCell.classes()).toContain('sk-c-act');
      // 失败入口只可能在操作列，不在 Skill 信息格
      const infoCell = r.findAll('td')[0];
      expect(infoCell.text()).not.toContain('查看失败记录');
      const label = r.attributes('aria-label') || '';
      const hasFail = label.includes('skill:warn') || label.includes('skill:bad');
      if (hasFail) {
        const btn = actCell.findAll('button').find((b) => b.text() === '查看失败记录');
        expect(btn, `${label} 操作列应有失败入口`).toBeTruthy();
      } else {
        expect(actCell.text()).not.toContain('查看失败记录');
        expect(actCell.find('.sk-act-na').exists()).toBe(true);
      }
      // 每行操作列都有「详情」，与其它列表页同一落点
      expect(actCell.findAll('button').some((b) => b.text() === '详情')).toBe(true);
    }
    w.unmount();
  });
});
