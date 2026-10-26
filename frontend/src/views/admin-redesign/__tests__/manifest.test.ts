/**
 * Admin 页面注册表完整性（J P0 核心）：
 * manifest.ts（侧栏场景清单）每项都必须有 AdminConsole 注册组件，
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
    // HIDDEN_SCENE_IDS：有意不在侧栏展示的隐藏场景（深链直达），豁免孤儿检查。
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

  it('导航（2026-10-26 收口）：6 分组 + 置顶总览，20 个可见场景与目标 IA 一致', () => {
    // 隐藏场景（hidden: true，如运营术语表）不占侧栏席位：由顶栏帮助按钮跳转，单独断言
    const visible = MOCK_SCENES.filter((s) => !s.hidden);
    expect(MOCK_SCENES).toHaveLength(21);
    expect(visible).toHaveLength(20);
    // 分组顺序即侧栏渲染顺序（总览为 pinned，但仍计入分组集合）
    const groups = visible.map((s) => s.group);
    expect([...new Set(groups)]).toEqual(['总览', '运营', '学习', '仿真', 'Skill', '观测与排查', '账号与接入']);
    const byGroup: Record<string, string[]> = {};
    for (const s of visible) (byGroup[s.group] ||= []).push(s.id);
    expect(byGroup).toEqual({
      总览: ['overview'],
      // 运营中心紧跟总览：日循环是「总览看待办 → 运营中心处置」
      运营: ['ops-hub'],
      // 排列＝学习流程：Goal 目标对话 → Path 学习路径 → Learn 教学会话 → 学习状态（工作台）→ 复习积压
      学习: ['goal-conversations', 'learning-paths', 'teaching-sessions', 'learner-state', 'memory-review'],
      // 组名与总览状态条同词（「仿真 · 仿真空闲」）：实例 + 身份池
      仿真: ['virtual-learners', 'virtual-learner-cards'],
      Skill: ['orchestrator', 'skills', 'prompt-eval', 'addons'],
      // 健康中心 13 项都是排查项，与两份日志同一动线
      观测与排查: ['execution-logs', 'audit-logs', 'token-cost', 'health-center'],
      // 接哪个上游、谁能进、账号怎么管
      账号与接入: ['api-config', 'access-control', 'people']
    });
    expect(MOCK_SCENES.filter((s) => s.hidden).map((s) => s.id)).toEqual(['glossary']);
  });

  it('页面搜索检索词：每项 keywords 可选，填入的必须是可检索的短词（无空串）', () => {
    for (const scene of MOCK_SCENES) {
      if (scene.keywords === undefined) continue;
      expect(Array.isArray(scene.keywords), `「${scene.id}」keywords 不是数组`).toBe(true);
      for (const k of scene.keywords) {
        expect(typeof k, `「${scene.id}」keywords 含非字符串`).toBe('string');
        expect(k.trim().length, `「${scene.id}」keywords 含空串`).toBeGreaterThan(0);
      }
    }
    // 运营搜「密钥」应命中两处：插件（MCP/联网）与模型与接入（上游密钥）
    const hit = MOCK_SCENES.filter((s) => (s.keywords || []).includes('密钥')).map((s) => s.id);
    expect(hit).toEqual(expect.arrayContaining(['addons', 'api-config']));
  });

  it('退役场景（已折入宿主 tab / 已下线）不再出现在侧栏清单', () => {
    const ids = new Set(MOCK_SCENES.map((s) => s.id));
    // health-center 2026-09-29 回归侧栏（系统组独立场景），故不在退役名单；
    // batch-experiments 2026-10-04 整体下线（运行态并入 virtual-learners、资产输入归卡库，URL 重定向）
    // prompt-eval 2026-10-25 拆回独立页（此前 2026-10-04 曾折入 skills 页签）——已不在退役名单
    // memory-review 2026-10-12 一度退役，同日恢复跨用户总览（单用户明细在学习者详情页签）——不再列退役
    // ops-center 2026-10-16 解散并入运营中心（运维工具 / 数据导出 / 会话安全三页签），侧栏撤除
    // addons 2026-10-19 移出退役名单——「外挂能力」拆回独立页，重回侧栏 Skill 组
    for (const retired of ['feedback', 'ops-achievements', 'messages', 'session-security', 'ops-center', 'batch-experiments']) {
      expect(ids.has(retired), `退役场景「${retired}」不应在侧栏清单`).toBe(false);
    }
  });

  it('侧栏徽章 key 必须指向存在的场景（防悬空徽章：公告曾因 manifest 缺 announcements 而悬空）', async () => {
    const { liveNavBadges, alarmNavBadges } = await import('../live');
    const ids = new Set(MOCK_SCENES.map((s) => s.id));
    for (const key of Object.keys(liveNavBadges.value)) {
      expect(ids.has(key), `liveNavBadges 含未注册场景 key「${key}」`).toBe(true);
    }
    for (const id of alarmNavBadges) {
      expect(ids.has(id), `alarmNavBadges 含未注册场景 id「${id}」`).toBe(true);
    }
  });

  it('详情页注册表（subPage）视图齐全（设计页已平铺进 skill 详情，2026-10-15 无独立 skill-design）', () => {
    expect(DETAIL_COMPONENTS).toMatchObject({
      learner: expect.anything(),
      virtual: expect.anything(),
      user: expect.anything(),
      session: expect.anything(),
      skill: expect.anything()
    });
    // 独立设计页退役：注册表不再有 skill-design 键
    expect(DETAIL_COMPONENTS).not.toHaveProperty('skill-design');
  });
});
