/**
 * Admin 页面注册表完整性（J P0 核心）：
 * manifest.ts（侧栏/命令面板单一数据源）每项都必须有 AdminConsole 注册组件，
 * 且注册表不得残留 manifest 之外的孤儿组件——防止「加菜单忘注册 / 删页面留死组件」。
 */
import { describe, expect, it } from 'vitest';
import { MOCK_SCENES } from '../manifest';
import { SCENE_COMPONENTS, DETAIL_COMPONENTS } from '../AdminConsole.vue';

describe('AdminConsole 页面注册表', () => {
  it('manifest 每项都有对应注册组件', () => {
    for (const scene of MOCK_SCENES) {
      expect(
        SCENE_COMPONENTS[scene.id],
        `manifest 场景「${scene.id}」（${scene.label}）缺少注册组件`
      ).toBeDefined();
    }
  });

  it('注册表不残留 manifest 之外的孤儿组件', () => {
    const manifestIds = new Set(MOCK_SCENES.map((s) => s.id));
    // HIDDEN_SCENE_IDS：有意不在侧栏展示的隐藏场景（深链/命令面板直达），豁免孤儿检查。
    // skill-workbench = Skill 工作台（PromptWorkbench），历史设计为深链访问的二级页面。
    const HIDDEN_SCENE_IDS = new Set(['skill-workbench']);
    for (const id of Object.keys(SCENE_COMPONENTS)) {
      if (HIDDEN_SCENE_IDS.has(id)) continue;
      expect(manifestIds.has(id), `注册表含孤儿组件「${id}」（manifest 无此场景）`).toBe(true);
    }
  });

  it('manifest 场景 id 唯一、label 非空、分组非空', () => {
    const seen = new Set<string>();
    for (const scene of MOCK_SCENES) {
      expect(seen.has(scene.id), `场景 id 重复：${scene.id}`).toBe(false);
      seen.add(scene.id);
      expect(scene.label.trim().length, `「${scene.id}」label 为空`).toBeGreaterThan(0);
      expect(scene.group.trim().length, `「${scene.id}」group 为空`).toBeGreaterThan(0);
      expect(scene.glyph.length, `「${scene.id}」glyph 为空`).toBeGreaterThan(0);
    }
  });

  it('每页必须属于导航分组之一（侧栏组名稳定，防分组漂移）', () => {
    const groups = new Set(MOCK_SCENES.map((s) => s.group));
    expect(groups).toEqual(new Set(['总览', '学习者', '仿真实验室', 'Skill 管理', '运营', '配置', '观测']));
  });

  it('详情页注册表（subPage）四个视图齐全', () => {
    expect(DETAIL_COMPONENTS).toMatchObject({
      learner: expect.anything(),
      virtual: expect.anything(),
      user: expect.anything(),
      session: expect.anything()
    });
  });
});
