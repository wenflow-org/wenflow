/**
 * 复现「＋ 加字段」按钮是否真的打不开向导（审计疑似缺陷）。
 *
 * 静态接线：openWizard() => wizardOpen=true；<FieldAddWizard v-if="wizardOpen" :stage="data.stage">。
 * 本用例给出合法路由数据（core.exists && core.sync 非空 → canAdd=true），点击按钮后
 * 断言 FieldAddWizard 的 .mk-modal 确实挂到 body（Teleport）。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { nextTick } from 'vue';
import SkillFieldRouting from '../SkillFieldRouting.vue';

const routingPayload = {
  data: {
    data: {
      skillId: 'skill:goal-conversation',
      stage: 'goal',
      agentId: 'skill:goal-conversation',
      routings: [],
      fields: [],
      promptRoleMeta: [{ id: 'core', label: '核心' }],
      core: {
        exists: true,
        fields: [],
        diagnostics: [],
        sync: { state: 'ok', missing: [], orphan: [], typeMismatch: [] }
      }
    }
  }
};

vi.mock('@/api/adminApi', () => ({
  adminFieldRoutingsApi: {
    getSkillRoutings: vi.fn(async () => routingPayload)
  },
  adminPromptWorkbenchApi: {
    getCoreLineage: vi.fn(async () => ({ data: { lineage: [] } }))
  }
}));

vi.mock('@/utils/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

async function settle() {
  await flushPromises();
  await nextTick();
  await flushPromises();
}

async function mountRouting() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div/>' } }]
  });
  await router.push('/');
  await router.isReady();
  const wrapper = mount(SkillFieldRouting, {
    props: { skillId: 'skill:goal-conversation' },
    global: { plugins: [router] },
    attachTo: document.body
  });
  await settle();
  return wrapper;
}

describe('字段路由 · 加字段向导', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('canAdd 为真时「＋ 加字段」可打开向导', async () => {
    const wrapper = await mountRouting();
    const addBtn = wrapper.findAll('button').find((b) => b.text().includes('加字段'));
    expect(addBtn, '未渲染「＋ 加字段」按钮').toBeTruthy();
    expect(addBtn!.attributes('disabled')).toBeUndefined();

    await addBtn!.trigger('click');
    await settle();

    // FieldAddWizard 通过 <Teleport to="body"> 渲染
    const modal = document.body.querySelector('.mk-modal');
    expect(modal, '点击后未出现向导 .mk-modal').toBeTruthy();
    expect(document.body.textContent).toContain('加字段');
    wrapper.unmount();
  });

  it('canAdd 为假（core.sync 缺失）时按钮 disabled、点击不弹向导', async () => {
    // 覆盖为 sync 为 null 的载荷
    const mod = await import('@/api/adminApi');
    (mod.adminFieldRoutingsApi.getSkillRoutings as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: {
        data: {
          skillId: 'skill:goal-conversation',
          stage: 'goal',
          agentId: 'skill:goal-conversation',
          routings: [],
          fields: [],
          promptRoleMeta: [],
          core: { exists: true, fields: [], diagnostics: [], sync: null }
        }
      }
    } as never);

    const wrapper = await mountRouting();
    const addBtn = wrapper.findAll('button').find((b) => b.text().includes('加字段'));
    expect(addBtn!.attributes('disabled')).toBeDefined();
    await addBtn!.trigger('click');
    await settle();
    expect(document.body.querySelector('.mk-modal')).toBeNull();
    wrapper.unmount();
  });
});
