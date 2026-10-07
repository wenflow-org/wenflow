/**
 * 学习者域共享派生逻辑测试（ADMIN_DEEP_LEARNER_AUDIT P1 批）：
 * - isTestAccountUser 命名约定（与后端 utils/test-account.ts 同源）
 * - levelFromXp 等级公式（与后端 level.util.ts 一致）
 * - levelWordZh / levelBadgeZh 等级词汇单点（2026-10-02 人类可读性评审：四页三貌收敛）
 * - conceptLedger 概念条 tone/width 映射
 * - LearnerDetail tab 归一化（6 → 3 旧名重定向）
 */
import { describe, expect, it } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { isTestAccountUser, isVirtualLearnerAccount, isRealAccountUser, useListQueryState, levelFromXp, levelLabel, levelWordZh, levelBadgeZh, conceptBarTone, conceptBarWidth, transferReadinessZh, misconceptionRiskZh, normalizeLearnerTab, memoryReviewUrl } from '../learner-profile';

describe('isTestAccountUser（测试/虚拟账号识别，与后端同源）', () => {
  it('虚拟学习者：id 以 virtual_ 开头或邮箱 @test.local / virtual_ 前缀', () => {
    expect(isTestAccountUser({ id: 'virtual_93e4c032', name: '某人', email: 'a@b.com' })).toBe(true);
    expect(isTestAccountUser({ id: 'u1', name: '某人', email: 'virtual_93e4c032@test.local' })).toBe(true);
    expect(isTestAccountUser({ id: 'u1', name: '某人', email: 'anything@test.local' })).toBe(true);
  });

  it('审计/测试账号：name/email 命中约定前缀（e2e_/audit_probe_/uxaudit_/ui_check/motion_review/qa_audit_）', () => {
    expect(isTestAccountUser({ id: 'u1', name: 'E2E_ms0fz3yx', email: 'e2e@example.com' })).toBe(true);
    expect(isTestAccountUser({ id: 'u1', name: '财务助理小陈', email: 'audit_probe_01@example.com' })).toBe(true);
    expect(isTestAccountUser({ id: 'u1', name: 'motion_review', email: 'm@example.com' })).toBe(true);
    expect(isTestAccountUser({ id: 'u1', name: 'uxaudit_7', email: 'x@example.com' })).toBe(true);
    expect(isTestAccountUser({ id: 'u1', name: 'ui_check', email: 'x@example.com' })).toBe(true);
    expect(isTestAccountUser({ id: 'u1', name: 'qa_audit_0821', email: 'x@example.com' })).toBe(true);
  });

  it('dev.db 实测账号模式（与后端 TEST_ACCOUNT_PREFIXES 同步）：shotsnap/verify_real_user/vcheck/vqa_audit/align_/qa_delete_test_', () => {
    expect(isTestAccountUser({ id: 'u1', name: 'shotsnap547618', email: 'shotsnap547618@wenflow.local' })).toBe(true);
    expect(isTestAccountUser({ id: 'u1', name: 'x', email: 'shotsnap206060@wenflow.local' })).toBe(true);
    expect(isTestAccountUser({ id: 'u1', name: 'verify_real_user_0821', email: 'verify_real_user_0821@wenflow.local' })).toBe(true);
    expect(isTestAccountUser({ id: 'u1', name: 'vchecksgxvef', email: 'vchecksgxvef@wenflow.local' })).toBe(true);
    expect(isTestAccountUser({ id: 'u1', name: 'vqa_audit_user', email: 'vqa_audit_user@wenflow.local' })).toBe(true);
    expect(isTestAccountUser({ id: 'u1', name: 'align_x0tlh', email: 'align_x0tlh@wenflow.local' })).toBe(true);
    expect(isTestAccountUser({ id: 'u1', name: 'qa_delete_test_879', email: 'qa_delete_test_879@wenflow.local' })).toBe(true);
  });

  it('真实用户不误伤', () => {
    expect(isTestAccountUser({ id: 'u1', name: '陈晓', email: 'chenxiao@example.com' })).toBe(false);
    expect(isTestAccountUser({ id: 'u1', name: 'admin', email: 'admin@wenflow.local' })).toBe(false);
    expect(isTestAccountUser({ id: 'u1', name: 'review', email: 'motion@example.com' })).toBe(false);
    expect(isTestAccountUser({})).toBe(false);
  });
});

describe('levelFromXp / levelLabel（等级公式与后端 level.util.ts 一致）', () => {
  it('floor(sqrt(xp/100))+1 分档', () => {
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(99)).toBe(1);
    expect(levelFromXp(100)).toBe(2);
    expect(levelFromXp(1600)).toBe(5);
    expect(levelFromXp(-5)).toBe(1);
  });

  it('徽章文案 L1-L5', () => {
    expect(levelLabel(0)).toBe('L1');
    expect(levelLabel(860)).toBe('L3');
    expect(levelLabel(2100)).toBe('L5');
  });
});

describe('levelWordZh / levelBadgeZh（等级词汇单点，2026-10-02 收敛）', () => {
  it('三档中文名唯一出处：入门 / 进阶 / 高级（以 LearnerDetail 现用词定稿）', () => {
    expect(levelWordZh('beginner')).toBe('入门');
    expect(levelWordZh('intermediate')).toBe('进阶');
    expect(levelWordZh('advanced')).toBe('高级');
    expect(levelWordZh('BEGINNER')).toBe('入门');
  });

  it('空值出空串；未知值原样透传（存量库里有 L1/L2 等历史值，不臆造词汇）', () => {
    expect(levelWordZh(null)).toBe('');
    expect(levelWordZh('')).toBe('');
    expect(levelWordZh('L2')).toBe('L2');
    expect(levelWordZh('expert')).toBe('expert');
  });

  it('并存格式统一「L2 · 进阶」', () => {
    expect(levelBadgeZh(100, 'intermediate')).toBe('L2 · 进阶');
    expect(levelBadgeZh(5, 'beginner')).toBe('L1 · 入门');
  });

  it('词汇缺失或与 Ln 同名（历史脏值）时只出 L2，不出「L2 · L2」', () => {
    expect(levelBadgeZh(100, '')).toBe('L2');
    expect(levelBadgeZh(100, null)).toBe('L2');
    expect(levelBadgeZh(100, 'L2')).toBe('L2');
  });
});

describe('conceptLedger 概念条映射', () => {
  it('tone：误解风险高或转移就绪低 → 红；中 → 琥珀；就绪高 → 绿；未知 → 灰', () => {
    expect(conceptBarTone({ transferReadiness: 'high', misconceptionRisk: 'low' })).toBe('ok');
    expect(conceptBarTone({ transferReadiness: 'medium', misconceptionRisk: 'medium' })).toBe('warn');
    expect(conceptBarTone({ transferReadiness: 'low', misconceptionRisk: 'low' })).toBe('bad');
    expect(conceptBarTone({ transferReadiness: 'high', misconceptionRisk: 'high' })).toBe('bad');
    expect(conceptBarTone({})).toBe('muted');
  });

  it('width：高 90 / 中 55 / 低 25 / 未知 8', () => {
    expect(conceptBarWidth('high')).toBe(90);
    expect(conceptBarWidth('medium')).toBe(55);
    expect(conceptBarWidth('low')).toBe(25);
    expect(conceptBarWidth(undefined)).toBe(8);
  });

  it('中文标签', () => {
    expect(transferReadinessZh('high')).toBe('可迁移');
    expect(transferReadinessZh('low')).toBe('不宜迁移');
    expect(misconceptionRiskZh('high')).toBe('高');
    expect(transferReadinessZh('nope')).toBe('—');
  });
});

describe('normalizeLearnerTab（6 tab → 3 tab 深链重定向）', () => {
  it('新 tab 名原样保留', () => {
    expect(normalizeLearnerTab('overview')).toBe('overview');
    expect(normalizeLearnerTab('profile')).toBe('profile');
    expect(normalizeLearnerTab('evidence')).toBe('evidence');
  });

  it('旧 tab 名重定向：cognitive→profile、memory→profile、teaching→profile、dynamic→evidence', () => {
    expect(normalizeLearnerTab('cognitive')).toBe('profile');
    expect(normalizeLearnerTab('memory')).toBe('profile');
    expect(normalizeLearnerTab('teaching')).toBe('profile');
    expect(normalizeLearnerTab('dynamic')).toBe('evidence');
  });

  it('未知值兜底 overview', () => {
    expect(normalizeLearnerTab(undefined)).toBe('overview');
    expect(normalizeLearnerTab('whatever')).toBe('overview');
    expect(normalizeLearnerTab('COGNITIVE')).toBe('profile');
  });
});

describe('memoryReviewUrl（跨组件深链契约）', () => {
  it('参数名与 MemoryReview 约定一致（userId）', () => {
    expect(memoryReviewUrl('u-123')).toBe('/admin/memory-review?userId=u-123');
  });

  it('特殊字符要转义（学习者 id 里出现过冒号/中文）', () => {
    expect(memoryReviewUrl('a b:c')).toBe('/admin/memory-review?userId=a%20b%3Ac');
  });

  it('空值不抛错（详情页拿不到 id 时按钮不渲染，但函数要稳）', () => {
    expect(memoryReviewUrl('')).toBe('/admin/memory-review?userId=');
  });
});

/**
 * 账号域口径单点（2026-10-07 运营走查 F1-1）：含测试档下「普通用户」pill 曾比同屏 KPI
 * 「真实用户」多 10——卡库/预置库造出的虚拟学习者（vl-*@cards.local / builtin_*@preset.local）
 * payload 标了 isVirtualLearner=true，命名约定正则却认不出，于是既被算进「普通用户」、
 * 又能勾选进批量删除 / 导出。以下锁死「标记优先 ∪ 正则兜底」的判据。
 */
describe('账号域口径单点（isVirtualLearnerAccount / isRealAccountUser，F1-1）', () => {
  const vlCard = { id: '77703637-190c-4e62-9c0f-e4398492447f', name: '研一学生小陈', email: 'vl-mat-book-e2e-01@cards.local', isVirtualLearner: true, isTestAccount: false };
  const builtinPreset = { id: '569d04fc-29a2-40bc-a6d0-b0d09cba0474', name: '沈舟', email: 'builtin_backend-eng-distributed@preset.local', isVirtualLearner: true, isTestAccount: false };
  const real = { id: 'user_1', name: '陈晓', email: 'chenxiao@example.com', isVirtualLearner: false, isTestAccount: false };
  const testAcc = { id: 'user_2', name: 'uitestnldh', email: 'uitestnldh@wenflow.local', isVirtualLearner: false, isTestAccount: true };

  it('卡库 / 预置库虚拟学习者：正则认不出，但 payload 标记必须让它出真实域', () => {
    for (const u of [vlCard, builtinPreset]) {
      expect(isVirtualLearnerAccount(u)).toBe(true);
      expect(isRealAccountUser(u)).toBe(false);
    }
  });

  it('payload 标记优先于命名约定（后端说虚拟就是虚拟）', () => {
    expect(isVirtualLearnerAccount({ ...real, isVirtualLearner: true })).toBe(true);
    expect(isRealAccountUser({ ...real, isVirtualLearner: true })).toBe(false);
  });

  it('无标记（mock / 旧响应 / 已删除窗口行）时按创建约定兜底', () => {
    expect(isVirtualLearnerAccount({ email: 'virtual_93e4c032@test.local' })).toBe(true);
    expect(isVirtualLearnerAccount({ id: 'virtual_93e4c032' })).toBe(true);
    expect(isRealAccountUser({ email: 'virtual_93e4c032@test.local' })).toBe(false);
  });

  it('测试 / 审计账号（payload 标记或命名约定）都不算真实账号', () => {
    expect(isRealAccountUser(testAcc)).toBe(false);
    expect(isRealAccountUser({ id: 'u1', name: 'x', email: 'e2e_1@example.com' })).toBe(false);
    expect(isRealAccountUser({ id: 'u1', name: 'shotsnap547618', email: 's@wenflow.local' })).toBe(false);
  });

  it('真实用户不误伤（管理员也是真实账号）', () => {
    expect(isVirtualLearnerAccount(real)).toBe(false);
    expect(isRealAccountUser(real)).toBe(true);
    // 传整行（含 isAdmin 等额外字段）也不受影响：判据只看账号性质字段
    const adminRow = { ...real, isAdmin: true, xp: 860, paths: 3 };
    expect(isRealAccountUser(adminRow)).toBe(true);
  });
});

/**
 * 列表筛选 / 页码 ↔ URL query（2026-10-07 运营走查 F1-2）：进二级详情时列表组件被整个卸载，
 * 组件内 ref 清零——返回后筛选必须靠 URL 还原。这里锁「URL 落位 / 变化写回 / 缺省不写 /
 * 脏值回落 / 无 Router 降级」五条契约。
 */
describe('useListQueryState（列表筛选·页码 ↔ URL query，F1-2）', () => {
  function makeRouter() {
    return createRouter({ history: createMemoryHistory(), routes: [{ path: '/admin/:page', component: { template: '<div />' } }] });
  }

  async function mountState(initialUrl: string, opts: { bin?: boolean; pageSize?: boolean } = {}) {
    const router = makeRouter();
    await router.push(initialUrl);
    await router.isReady();
    const pill = ref('all');
    const keyword = ref('');
    const page = ref(1);
    const pageSize = ref(15);
    const bin = ref<number | null>(null);
    const wrapper = mount(
      defineComponent({
        setup() {
          useListQueryState({
            pill,
            keyword,
            page,
            pageSize: opts.pageSize ? pageSize : undefined,
            bin: opts.bin ? bin : undefined,
            allowedPills: ['all', 'admin', 'user', 'online', 'deleted']
          });
          return () => h('div');
        }
      }),
      { global: { plugins: [router] } }
    );
    await nextTick();
    return { router, wrapper, pill, keyword, page, pageSize, bin };
  }

  it('挂载落位：URL 的 pill / 搜索词 / 页码 / 分段序号写进状态（返回与深链还原）', async () => {
    const { pill, keyword, page, bin } = await mountState('/admin/people?pill=user&q=uitest&page=2&bin=1', { bin: true });
    expect(pill.value).toBe('user');
    expect(keyword.value).toBe('uitest');
    expect(page.value).toBe(2);
    expect(bin.value).toBe(1);
  });

  it('变化写回：筛选与翻页只 replace 自己管的键，其余 query（tab/view/id）原样保留', async () => {
    const { router, pill, keyword, page } = await mountState('/admin/people?tab=account&view=user&id=u1');
    pill.value = 'online';
    keyword.value = '陈';
    page.value = 3;
    await nextTick();
    await flushPromises();
    expect(router.currentRoute.value.query).toMatchObject({ tab: 'account', view: 'user', id: 'u1', pill: 'online', q: '陈', page: '3' });
    // 回到缺省：自己管的键被删干净，别人的键不动
    pill.value = 'all';
    keyword.value = '';
    page.value = 1;
    await nextTick();
    await flushPromises();
    expect(router.currentRoute.value.query).toMatchObject({ tab: 'account', view: 'user', id: 'u1' });
    expect(router.currentRoute.value.query.pill).toBeUndefined();
    expect(router.currentRoute.value.query.q).toBeUndefined();
    expect(router.currentRoute.value.query.page).toBeUndefined();
  });

  it('外部改 URL（浏览器后退 / 手改地址）回写状态；自己写的 URL 不引发回环', async () => {
    const { router, pill, page } = await mountState('/admin/people?pill=user&page=2');
    await router.push('/admin/people?pill=deleted');
    await nextTick();
    await flushPromises();
    expect(pill.value).toBe('deleted');
    expect(page.value).toBe(1);
    // 再 push 一次相同 query：状态不被清掉（路由回调只在签名变化时才落位）
    await router.push('/admin/people?pill=deleted');
    await nextTick();
    await flushPromises();
    expect(pill.value).toBe('deleted');
  });

  it('脏值回落：不在词表里的 pill、非正整数页码不把列表筛空', async () => {
    const { pill, page, pageSize } = await mountState('/admin/people?pill=nope&page=abc&size=-3', { pageSize: true });
    expect(pill.value).toBe('all');
    expect(page.value).toBe(1);
    expect(pageSize.value).toBe(15);
  });

  it('无 Router 上下文挂载时降级为纯内存状态（不抛错、不改状态）', async () => {
    const pill = ref('user');
    const keyword = ref('x');
    const page = ref(2);
    const wrapper = mount(
      defineComponent({
        setup() {
          useListQueryState({ pill, keyword, page, allowedPills: ['user'] });
          return () => h('div');
        }
      })
    );
    await nextTick();
    expect(pill.value).toBe('user');
    expect(keyword.value).toBe('x');
    expect(page.value).toBe(2);
    wrapper.unmount();
  });
});
