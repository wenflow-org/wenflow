/**
 * #10 回归：嵌套字段「编辑」预填的 desc 必须取路由行自身的值，不能被 core 侧子字段说明覆盖。
 *
 * 病根：`editInitialOf` 对嵌套字段（如 `summary.topicSummary`）从 core 文件那段 desc 的
 * 「· 子字段（type）说明」里正则抠出描述当值。core 侧说明与编排文件 description 不同源，
 * 于是任何一次保存（哪怕只为改 persistKey）都会把预填值当「用户确认的描述」写回编排文件，
 * 改掉无关的 description —— 「改回原值不等于还原」。
 * 本用例钉住：预填 desc === 路由行 desc（编排文件值），core 子字段说明只用于展示。
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { createRouter, createMemoryHistory } from 'vue-router';
import { nextTick } from 'vue';
import SkillFieldRouting from '../SkillFieldRouting.vue';

// core 侧 summary 的 desc 里带子字段说明（与编排文件 description 不同源）
const routingPayload = {
  data: {
    data: {
      skillId: 'skill:session-wrapup',
      stage: 'wrapup',
      agentId: 'skill:session-wrapup',
      // 编排文件行：描述是「本次会话主题总结」
      routings: [
        { agentId: 'skill:session-wrapup', fieldId: 'summary.topicSummary', render: 'visible', handoff: [], internal: false, accumulate: false }
      ],
      fields: [
        { fieldId: 'summary.topicSummary', description: '本次会话主题总结', valueType: 'string', promptRole: 'public-reply', persistKey: 'summary.topicSummary' }
      ],
      promptRoleMeta: [{ id: 'public-reply', label: '公开回复', hint: '' }],
      core: {
        exists: true,
        diagnostics: [],
        sync: { skillId: 'skill:session-wrapup', stage: 'wrapup', state: 'ok', missing: [], orphan: [], typeMismatch: [] },
        fields: [
          {
            name: 'summary',
            type: 'object',
            desc: '给学生看的课后总结，子字段：\n· topicSummary（string）本节课围绕主题的核心总结\n· knowledgeSummary（string）知识点掌握情况总结'
          }
        ]
      }
    }
  }
};

vi.mock('@/api/adminApi', () => ({
  adminFieldRoutingsApi: { getSkillRoutings: vi.fn(async () => routingPayload) },
  adminPromptWorkbenchApi: { getCoreLineage: vi.fn(async () => ({ data: { lineage: [] } })) }
}));
vi.mock('@/utils/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

async function settle() {
  await flushPromises();
  await nextTick();
  await flushPromises();
}

async function mountRouting() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { template: '<div/>' } }] });
  await router.push('/');
  await router.isReady();
  const wrapper = mount(SkillFieldRouting, {
    props: { skillId: 'skill:session-wrapup' },
    global: { plugins: [router] },
    attachTo: document.body
  });
  await settle();
  return wrapper;
}

describe('#10 嵌套字段编辑预填的 desc 取路由行自身值', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('预填 desc = 编排文件 description，而不是 core 子字段说明', async () => {
    const wrapper = await mountRouting();
    const editBtn = wrapper.findAll('button').find((b) => b.text().trim() === '编辑');
    expect(editBtn, '未渲染「编辑」按钮').toBeTruthy();
    await editBtn!.trigger('click');
    await settle();

    // FieldAddWizard 经 Teleport 挂到 body；找到它的 initial prop
    const wizard = wrapper.findComponent({ name: 'FieldAddWizard' });
    expect(wizard.exists(), '未打开编辑向导').toBe(true);
    const initial = wizard.props('initial') as { desc?: string } | null;
    expect(initial?.desc).toBe('本次会话主题总结');
    // 反证：core 子字段说明不能出现在预填值里
    expect(initial?.desc).not.toContain('本节课围绕主题的核心总结');
  });
});
