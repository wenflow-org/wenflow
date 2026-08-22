<template>
  <section class="ac">
    <!-- 启动失败（非 401；401 由路由守卫与拦截器导向登录页） -->
    <div v-if="bootError" class="ac-error">
      <div class="ac-error__card">
        <strong>控制台数据加载失败</strong>
        <span>{{ bootError }}</span>
        <button type="button" class="ac-error__retry" @click="boot">重试</button>
      </div>
    </div>

    <Shell :current="scene" :crumb="crumbLabel" :crumb-title="crumbTitle" release @navigate="navigate" @palette="paletteOpen = true" @glossary="glossaryOpen = true">
      <div v-if="booting" class="ac-boot">
        <span class="mk-spinner mk-spinner--lg"></span>
        加载中…
      </div>
      <component v-else :is="detailComponent || currentComponent" />
    </Shell>

    <CommandPalette
      :open="paletteOpen"
      @close="paletteOpen = false"
      @navigate="navigate"
    />
    <AdminGlossaryDrawer :open="glossaryOpen" @close="glossaryOpen = false" />
    <SkillDrawer />
  </section>
</template>

<script lang="ts">
/**
 * 页面注册表（测试只读视图 + 模块级单源）：
 * AdminConsole 是唯一注册点，SCENE_COMPONENTS/DETAIL_COMPONENTS 供冒烟测试断言
 * 「manifest 每项 → 注册组件」一一对应，防止加菜单忘注册 / 删菜单留死组件
 */
// 子页面按需加载（拍板 2026-08-21）：静态全量引入曾把整个管理台打成单个 696KB 路由包；
// 异步化后各 tab 首次点击时加载，显著缩小首包。
// asyncPage 封装 defineAsyncComponent 的 loading/error 兜底：
// 200ms 延迟避免缓存命中闪烁；部署更新后旧 chunk 404 自动重试一次；
// 不可恢复时展示「刷新页面」按钮（人工 reload 绕过 CDN 缓存）。
function asyncPage(loader: () => Promise<any>) {
  return defineAsyncComponent({
    loader,
    loadingComponent: h('div', { class: 'admin-page-loading' }, [
      h('span', { class: 'spinner' }),
      h('p', '加载中…')
    ]),
    delay: 200,
    errorComponent: {
      setup() {
        return () => h('div', { class: 'errorbar admin-page-error' }, [
          h('strong', '页面加载失败'),
          h('p', '网络问题或部署更新导致资源不可用'),
          h('button', { type: 'button', class: 'errorbar__retry', onClick: () => window.location.reload() }, '刷新页面')
        ]);
      }
    },
    onError(error, retry, fail, _attempts) {
      if (String(error?.message || error || '').includes('Failed to fetch')) { retry(); } else { fail(); }
    }
  });
}

const Overview = asyncPage(() => import('./Overview.vue'));
const Users = asyncPage(() => import('./Users.vue'));
const LearnerCenter = asyncPage(() => import('./LearnerCenter.vue'));
const VirtualLearners = asyncPage(() => import('./VirtualLearners.vue'));
const Skills = asyncPage(() => import('./Skills.vue'));
const Orchestrator = asyncPage(() => import('./Orchestrator.vue'));
const ExecLogs = asyncPage(() => import('./ExecLogs.vue'));
const TraceWaterfall = asyncPage(() => import('./TraceWaterfall.vue'));
const AuditLogs = asyncPage(() => import('./AuditLogs.vue'));
const ApiConfig = asyncPage(() => import('./ApiConfig.vue'));
const Addons = asyncPage(() => import('./Addons.vue'));
const Announcements = asyncPage(() => import('./Announcements.vue'));
const SessionSecurity = asyncPage(() => import('./SessionSecurity.vue'));
const PromptWorkbench = asyncPage(() => import('./PromptWorkbench.vue'));
const HealthCenter = asyncPage(() => import('./HealthCenter.vue'));
const LearnerDetail = asyncPage(() => import('./LearnerDetail.vue'));
const TeachingSessions = asyncPage(() => import('./TeachingSessions.vue'));
const GoalConversations = asyncPage(() => import('./GoalConversations.vue'));
const Feedback = asyncPage(() => import('./Feedback.vue'));
const SessionCockpit = asyncPage(() => import('./SessionCockpit.vue'));
const VirtualProfile = asyncPage(() => import('./VirtualProfile.vue'));
const UserDetail = asyncPage(() => import('./UserDetail.vue'));

const components: Record<string, unknown> = {
  'overview': Overview,
  'users': Users,
  'learner-center': LearnerCenter,
  'teaching-sessions': TeachingSessions,
  'goal-conversations': GoalConversations,
  feedback: Feedback,
  'virtual-learners': VirtualLearners,
  'skills': Skills,
  'orchestrator': Orchestrator,
  'execution-logs': ExecLogs,
  'trace-waterfall': TraceWaterfall,
  'audit-logs': AuditLogs,
  'api-config': ApiConfig,
  'addons': Addons,
  'announcements': Announcements,
  'session-security': SessionSecurity,
  'skill-workbench': PromptWorkbench,
  'health-center': HealthCenter
};

const detailComponents: Record<string, unknown> = {
  learner: LearnerDetail,
  virtual: VirtualProfile,
  user: UserDetail,
  session: SessionCockpit,
  'session-real': SessionCockpit
};

export const SCENE_COMPONENTS: Readonly<Record<string, unknown>> = components;
export const DETAIL_COMPONENTS: Readonly<Record<string, unknown>> = detailComponents;
</script>

<script setup lang="ts">
/**
 * WenFlow Admin 控制台（新版，已上线）
 * 原实验稿 /admin-redesign-lab 已废除，本组件为唯一管理后台入口。
 * 特点：
 */
import { computed, defineAsyncComponent, h, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Shell from './Shell.vue';
import SkillDrawer from './SkillDrawer.vue';
import AdminGlossaryDrawer from './AdminGlossaryDrawer.vue';
import CommandPalette from './CommandPalette.vue';
import { intent, subPage, closeSkillDrawer, type SubPageView } from './store';
import { loadLiveData } from './live';
import './shared.css';

const scene = ref('overview');
const paletteOpen = ref(false);
const glossaryOpen = ref(false);
const booting = ref(true);
const bootError = ref('');

const currentComponent = computed(() => components[scene.value]);
const detailComponent = computed(() => (subPage.value ? detailComponents[subPage.value.view] : null));
/* 面包屑：二级页优先显示中文名/短标识（label），未设置时回退 ID 截断；title 始终给全 ID */
const crumbLabel = computed(() => {
  const sp = subPage.value
  if (!sp) return ''
  const text = sp.label || sp.id
  if (text.length <= 12) return text
  return `${text.slice(0, 8)}…${text.slice(-4)}`
})
const crumbTitle = computed(() => subPage.value?.id || '')

/* —— 真路由化：scene ↔ URL /admin/:page 双向同步 —— */
const route = useRoute()
const router = useRouter()

/* —— 二级页 subPage ↔ URL query（?view=&id=）双向同步 ——
   二级页此前只存在内存 ref，刷新/深链/前进后退均无法寻址（URL 不显示）。
   打开：openSubPage（任意组件）→ subPage 变化 → URL 补 query；
   恢复：整页刷新 /admin/:page?view=virtual&id=xxx → query watch → subPage 恢复 → 详情组件直接渲染。 */
const SUBPAGE_VIEWS = ['learner', 'virtual', 'user', 'session', 'session-real']
// URL → subPage（深链/刷新/前进后退）
watch(
  () => [route.query.view, route.query.id] as [unknown, unknown],
  ([v, id]) => {
    const view = typeof v === 'string' ? v : ''
    const sid = typeof id === 'string' ? id : ''
    if (sid && SUBPAGE_VIEWS.includes(view)) {
      if (!subPage.value || subPage.value.view !== view || subPage.value.id !== sid) {
        subPage.value = { view: view as SubPageView, id: sid }
      }
    }
  },
  { immediate: true }
)
// subPage → URL（打开用 push：浏览器后退可回到列表；关闭用 replace：不污染历史栈；同页互斥无回环）
watch(
  subPage,
  (sp) => {
    const curView = typeof route.query.view === 'string' ? route.query.view : ''
    const curId = typeof route.query.id === 'string' ? route.query.id : ''
    if (sp) {
      if (curView !== sp.view || curId !== sp.id) {
        void router.push({ query: { ...route.query, view: sp.view, id: sp.id } })
      }
    } else if (curView || curId) {
      // 场景切换中（scene watch 已 push 新路径、route 尚未落地）时跳过：
      // 新路径本身不含 subPage query，此时 replace 会覆盖掉待处理的场景导航
      const curPage = typeof route.params.page === 'string' ? route.params.page : ''
      if (curPage === scene.value) {
        const q = { ...route.query }
        delete q.view
        delete q.id
        void router.replace({ query: q })
      }
    }
  },
  { immediate: true }
)

// URL → scene（浏览器前进/后退、深链直达）；非法 page 回退 overview 并修正 URL
// immediate：整页直达 /admin/:page 时初始值也需校验（否则 URL 与 scene 脱节）
watch(
  () => route.params.page,
  (p) => {
    const id = typeof p === 'string' ? p : ''
    if (id && components[id]) {
      if (id !== scene.value) scene.value = id
    } else if (id) {
      void router.replace('/admin/overview')
    }
  },
  { immediate: true }
)
// scene → URL（侧栏/命令面板/意图跳转）；push 保留历史，浏览器后退可回到上一页面
watch(scene, (s) => {
  const cur = typeof route.params.page === 'string' ? route.params.page : ''
  if (cur !== s) void router.push(`/admin/${s}`)
  subPage.value = null;
  // 切换页面时自动关闭 Skill 抽屉，避免遮挡侧栏导航
  closeSkillDrawer();
});
// SkillDrawer ↔ URL query（?skill=xxx）双向同步：刷新后恢复抽屉状态
watch(
  () => intent.skillDrawerId,
  (sid) => {
    const cur = typeof route.query.skill === 'string' ? route.query.skill : ''
    if (sid && sid !== cur) {
      void router.replace({ query: { ...route.query, skill: sid } })
    } else if (!sid && cur) {
      const q = { ...route.query }
      delete q.skill
      void router.replace({ query: q })
    }
  }
);
watch(
  () => route.query.skill,
  (s) => {
    const sid = typeof s === 'string' ? s : ''
    if (sid && sid !== intent.skillDrawerId) {
      intent.skillDrawerId = sid
    }
  },
  { immediate: true }
);
watch(scene, (s) => {
  if (intent.scene !== s) intent.scene = s;
});
watch(
  () => intent.scene,
  (s) => {
    if (s && s !== scene.value) scene.value = s;
  }
);

function navigate(id: string) {
  // 相同 scene 再点击：scene watch 不会触发，这里显式清空 subPage 返回列表
  if (id === scene.value) {
    subPage.value = null;
    return;
  }
  scene.value = id;
}

async function boot() {
  booting.value = true;
  bootError.value = '';
  await loadLiveData();
  booting.value = false;
  // loadLiveData 内部已做局部容错；仅核心域（日志）失败才提示整页错误
  const { liveFailures } = await import('./live');
  if (liveFailures.value.spans) {
    bootError.value = liveFailures.value.spans;
  }
}

onMounted(() => {
  // 初始场景优先级：URL :page（深链/刷新恢复）> intent（跨路由入口）> overview 兜底
  const fromRoute = typeof route.params.page === 'string' ? route.params.page : ''
  if (fromRoute && components[fromRoute]) {
    scene.value = fromRoute
  } else if (components[intent.scene]) {
    scene.value = intent.scene
  }
  void boot();
  window.addEventListener('keydown', onGlobalKey);
});
onBeforeUnmount(() => window.removeEventListener('keydown', onGlobalKey));

function onGlobalKey(e: KeyboardEvent) {
  const target = e.target as HTMLElement | null
  const isTyping = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    if (isTyping) return
    e.preventDefault()
    paletteOpen.value = !paletteOpen.value
  } else if (e.key === 'Escape' && paletteOpen.value) {
    paletteOpen.value = false
  }
}
</script>

<style scoped>
.ac {
  --ink: var(--mk-ink);
  min-height: 100vh;
  background: var(--mk-bg, #f7f8fa);
  font-family: var(--mk-sans);
}
.ac :deep(.mshell) {
  min-height: 100vh;
}

.ac-boot {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 50vh;
  color: #5b6577;
  font-size: 14px;
}
.ac-boot .mk-spinner { width: 16px; height: 16px; border-width: 2px; }

.ac-error {
  position: fixed;
  inset: 0;
  z-index: 400;
  background: var(--mk-bg, #f7f8fa);
  display: grid;
  place-content: center;
}
.ac-error__card {
  display: grid;
  gap: 10px;
  justify-items: center;
  padding: 32px 40px;
  border: 1px solid #e1e8f2;
  border-radius: 16px;
  background: #fff;
  box-shadow: var(--mk-shadow-modal);
}
.ac-error__card strong { font-size: 16px; color: #1a2a44; }
.ac-error__card span { font-size: 13px; color: #5b6577; }
.ac-error__retry {
  margin-top: 6px;
  padding: 8px 20px;
  border: 0;
  border-radius: 9px;
  background: var(--mk-blue, #2c63d0);
  color: #fff;
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

/* ========== 大屏/4K 适配（全站 mk 体系档位：≥2000px 字号放大；zoom 档 ≥2800px→1.15） ========== */
@media (min-width: 2000px) {
  .ac-boot { font-size: 16px; gap: 12px; }
  .ac-boot .mk-spinner { width: 19px; height: 19px; border-width: 2.5px; }
  .ac-error__card { gap: 12px; padding: 38px 48px; border-radius: 19px; }
  .ac-error__card strong { font-size: 18.5px; }
  .ac-error__card span { font-size: 15px; }
  .ac-error__retry { margin-top: 7px; padding: 9px 24px; border-radius: 10px; font-size: 15px; }
}
@media (min-width: 2800px) {
  .ac-boot { font-size: 19px; gap: 14px; }
  .ac-boot .mk-spinner { width: 22px; height: 22px; border-width: 3px; }
  .ac-error__card { gap: 14px; padding: 46px 58px; border-radius: 22px; }
  .ac-error__card strong { font-size: 21.5px; }
  .ac-error__card span { font-size: 17.5px; }
  .ac-error__retry { margin-top: 8px; padding: 11px 28px; border-radius: 12px; font-size: 17.5px; }
}

/* 异步 tab 过渡态：loading 骨架 + 加载失败错误卡 */
.admin-page-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 60px 20px;
  color: var(--mk-muted, #8896b0);
  font-size: 14px;
}
.admin-page-error {
  margin: 24px;
}
</style>
