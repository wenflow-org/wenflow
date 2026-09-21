<template>
  <section class="ac">
    <!-- 启动失败（非 401；401 由路由守卫与拦截器导向登录页） -->
    <div v-if="bootError" class="ac-error">
      <div class="ac-error__card">
        <strong>控制台暂时无法打开</strong>
        <span>数据服务返回异常，所有页面受影响。可直接重试；若仍失败，请复制下方诊断信息发给研发。</span>
        <div class="ac-error__actions">
          <button type="button" class="ac-error__retry" @click="boot">重试</button>
          <button type="button" class="ac-error__retry ac-error__retry--ghost" @click="copyDiagnostics">复制诊断信息</button>
        </div>
        <details class="ac-error__diag">
          <summary>诊断信息</summary>
          <code>{{ bootError }}</code>
        </details>
      </div>
    </div>

    <Shell :current="scene" :crumb="crumbLabel" :crumb-title="crumbTitle" release @navigate="navigate" @glossary="glossaryOpen = true">
      <MkLoading v-if="booting" class="ac-boot" text="加载中…" />
      <component v-else :is="detailComponent || currentComponent" />
    </Shell>

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
    // 统一加载态：与页面级 MkLoading 同源（原先自搓 .admin-page-loading + 非 mk 的 .spinner）
    loadingComponent: h(MkLoading, { min: true, text: '加载中…' }),
    delay: 200,
    errorComponent: {
      setup() {
        return () => h('div', { class: 'errorbar admin-page-error' }, [
          h('strong', '页面加载失败'),
          h('p', '资源加载失败（部署更新或网络异常）'),
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
const People = asyncPage(() => import('./People.vue'));
const Sessions = asyncPage(() => import('./GoalConversations.vue'));
const VirtualLearners = asyncPage(() => import('./VirtualLearners.vue'));
const Skills = asyncPage(() => import('./Skills.vue'));
const Orchestrator = asyncPage(() => import('./Orchestrator.vue'));
const ExecLogs = asyncPage(() => import('./ExecLogs.vue'));
const AuditLogs = asyncPage(() => import('./AuditLogs.vue'));
const ApiConfig = asyncPage(() => import('./ApiConfig.vue'));
const PromptWorkbench = asyncPage(() => import('./PromptWorkbench.vue'));
const PromptEval = asyncPage(() => import('./PromptEval.vue'));
const OpsHub = asyncPage(() => import('./OpsHub.vue'));
const OpsCenter = asyncPage(() => import('./OpsCenter.vue'));
const LearnerDetail = asyncPage(() => import('./LearnerDetail.vue'));
const VirtualProfile = asyncPage(() => import('./VirtualProfile.vue'));
const UserDetail = asyncPage(() => import('./UserDetail.vue'));
const SessionCockpit = asyncPage(() => import('./SessionCockpit.vue'));
const MemoryReview = asyncPage(() => import('./MemoryReview.vue'));
const BatchExperiments = asyncPage(() => import('./BatchExperiments.vue'));

const components: Record<string, unknown> = {
  'overview': Overview,
  // 导航收敛 2026-09-04：users+learner-center → people；teaching-sessions+goal-conversations → sessions；
  // announcements+notifications → messages；token-cost → execution-logs（成本分析 tab）
  // 导航一级收敛 2026-09-19（阶段 1）：feedback/ops-achievements/messages → ops-hub 宿主 tab；
  // addons → api-config 宿主 tab；session-security → ops-center 宿主 tab（场景下线，URL 重定向兼容）
  // 阶段 3（2026-09-19）：health-center → skills 宿主 tab（健康检查/漂移/对账），场景下线
  'people': People,
  'sessions': Sessions,
  'virtual-learners': VirtualLearners,
  'skills': Skills,
  'orchestrator': Orchestrator,
  'prompt-eval': PromptEval,
  'execution-logs': ExecLogs,
  'memory-review': MemoryReview,
  'batch-experiments': BatchExperiments,
  'audit-logs': AuditLogs,
  'api-config': ApiConfig,
  // 隐藏场景（不在 manifest 侧栏）：PromptWorkbench 是「新建 Skill」骨架生成的唯一入口，
  // 健康中心 hash/yaml 跳转深链至此，勿删注册
  'skill-workbench': PromptWorkbench,
  'ops-hub': OpsHub,
  'ops-center': OpsCenter
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
import { computed, defineAsyncComponent, h, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Shell from './Shell.vue';
import SkillDrawer from './SkillDrawer.vue';
import AdminGlossaryDrawer from './AdminGlossaryDrawer.vue';
import MkLoading from '@/components/mk/MkLoading.vue';
import { intent, intentQueryParams, subPage, closeSkillDrawer, type SubPageView } from './store';
import { loadLiveData } from './live';
import '@/styles/mk-primitives.css';

const scene = ref('overview');
const glossaryOpen = ref(false);
const booting = ref(true);
const bootError = ref('');

const currentComponent = computed(() => components[scene.value]);
const detailComponent = computed(() => (subPage.value ? detailComponents[subPage.value.view] : null));
/* 面包屑：二级页优先显示中文名/短标识（label），未设置时回退 ID 截断；title 始终给全 ID。
   三级页（会话座舱由画像打开）拼出「二级 / 三级」，否则进详情后会丢掉二级名。 */
function crumbPart(label?: string, id?: string): string {
  const text = label || id || ''
  if (text.length <= 12) return text
  return `${text.slice(0, 8)}…${text.slice(-4)}`
}
const crumbLabel = computed(() => {
  const sp = subPage.value
  if (!sp) return ''
  const current = crumbPart(sp.label, sp.id)
  const parent = sp.from ? crumbPart(sp.from.label, sp.from.id) : ''
  return parent ? `${parent} / ${current}` : current
})
const crumbTitle = computed(() => {
  const sp = subPage.value
  if (!sp) return ''
  const parent = sp.from ? (sp.from.label || sp.from.id) : ''
  return parent ? `${parent} / ${sp.id}` : sp.id
})

/* —— 真路由化：scene ↔ URL /admin/:page 双向同步 —— */
const route = useRoute()
const router = useRouter()

/* —— 二级页 subPage ↔ URL query（?view=&id=）双向同步 ——
   二级页此前只存在内存 ref，刷新/深链/前进后退均无法寻址（URL 不显示）。
   打开：openSubPage（任意组件）→ subPage 变化 → URL 补 query；
   恢复：整页刷新 /admin/:page?view=virtual&id=xxx → query watch → subPage 恢复 → 详情组件直接渲染。 */
const SUBPAGE_VIEWS = ['learner', 'virtual', 'user', 'session', 'session-real']
// URL → subPage（深链/刷新/前进后退）；includeTest 透传（虚拟学习者/测试账号深链可查）
watch(
  () => [route.query.view, route.query.id, route.query.includeTest] as [unknown, unknown, unknown],
  ([v, id, includeTest]) => {
    const view = typeof v === 'string' ? v : ''
    const sid = typeof id === 'string' ? id : ''
    const it = String(includeTest || '') === 'true'
    if (sid && SUBPAGE_VIEWS.includes(view)) {
      const next: { view: SubPageView; id: string; includeTest?: boolean } = it ? { view: view as SubPageView, id: sid, includeTest: true } : { view: view as SubPageView, id: sid }
      const cur = subPage.value
      if (!cur || cur.view !== next.view || cur.id !== next.id || !!cur.includeTest !== it) {
        subPage.value = next
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
      const q: Record<string, string | (string | null)[]> = { ...route.query, view: sp.view, id: sp.id } as Record<string, string | (string | null)[]>
      if (sp.includeTest) q.includeTest = 'true'
      else delete q.includeTest
      if (curView !== sp.view || curId !== sp.id || (sp.includeTest ? route.query.includeTest !== 'true' : route.query.includeTest != null)) {
        void router.push({ query: q })
      }
    } else if (curView || curId) {
      // 场景切换中（scene watch 已 push 新路径、route 尚未落地）时跳过：
      // 新路径本身不含 subPage query，此时 replace 会覆盖掉待处理的场景导航
      const curPage = typeof route.params.page === 'string' ? route.params.page : ''
      if (curPage === scene.value) {
        const q = { ...route.query }
        delete q.view
        delete q.id
        delete q.includeTest
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
// scene → URL（侧栏/意图跳转）；push 保留历史，浏览器后退可回到上一页面
// 门闩 bootstrapped：挂载完成前不主动 push，避免初始化瞬态把深链 URL 改写掉（QA ISSUE-001）
let bootstrapped = false;
watch(scene, (s) => {
  const cur = typeof route.params.page === 'string' ? route.params.page : ''
  if (bootstrapped && cur !== s) {
    /* 排查动线（P0）：intent 筛选随跳转进 URL——执行日志「已过滤故障视图」
       可刷新/分享/前进后退还原（ExecLogs 侧做 URL↔筛选双向同步）。
       只带 intent 参数、不透传当前页 query（避免把 ?view=&id= 等二级页状态漏进目标页） */
    const q = intentQueryParams(s)
    if (Object.keys(q).length) void router.push({ path: `/admin/${s}`, query: q })
    else void router.push(`/admin/${s}`)
  }
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
    // 挂载完成前以 URL 为唯一权威：忽略残留的跨页 intent，避免深链被历史意图改写（QA ISSUE-001）
    if (!bootstrapped) return;
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

/* 多标签页已删除（2026-09-19）：实测切标签不保状态（无 keep-alive，滚动/筛选被重置）、切走丢 URL 查询，
   却常驻 36px 并复制侧栏导航。子页/子标签现已全部 URL 直达，导航统一为「侧栏 + 面包屑 + 深链」。 */
try {
  localStorage.removeItem('wf_admin_tabs')
  localStorage.removeItem('wf_admin_pinned_tabs')
} catch { /* 隐私模式忽略 */ }

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

/** 复制诊断信息（bootError 原文，含后端 message；剪贴板不可用则静默） */
async function copyDiagnostics() {
  try {
    await navigator.clipboard.writeText(`控制台数据加载失败：${bootError.value}`);
  } catch {
    /* 剪贴板权限不可用：忽略 */
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
  // URL 为唯一权威：挂载后立即用当前 scene 归一 intent，清除可能残留的历史跨页意图，
  // 避免 intent → scene 反向覆盖深链（QA ISSUE-001）。随后开门闩允许正常跨页跳转。
  intent.scene = scene.value
  bootstrapped = true
  void boot();
});
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
  font-size: var(--mk-fs-14);
}
/* 启动屏 spinner 略大：需 :deep() 才能命中子组件内部节点（scoped 属性不作用于组件内部） */
.ac-boot :deep(.mk-spinner) { width: 16px; height: 16px; border-width: 2px; }

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
  border: 1px solid var(--mk-line);
  border-radius: 16px;
  background: var(--mk-surface);
  box-shadow: var(--mk-shadow-modal);
}
.ac-error__card strong { font-size: var(--mk-fs-16); color: var(--mk-ink); }
.ac-error__card span { font-size: var(--mk-fs-13); color: #5b6577; }
.ac-error__retry {
  margin-top: 6px;
  padding: 8px 20px;
  border: 0;
  border-radius: 9px;
  background: var(--mk-blue, #2c63d0);
  color: #fff;
  font: inherit;
  font-size: var(--mk-fs-13);
  font-weight: 700;
  cursor: pointer;
}
.ac-error__actions { display: flex; gap: 10px; margin-top: 6px; }
.ac-error__actions .ac-error__retry { margin-top: 0; }
.ac-error__retry--ghost {
  background: transparent;
  color: var(--mk-blue, #2c63d0);
  border: 1px solid var(--mk-line);
}
.ac-error__diag { max-width: 460px; font-size: var(--mk-fs-12); color: var(--mk-faint); }
.ac-error__diag summary { cursor: pointer; }
.ac-error__diag code {
  display: block;
  margin-top: 6px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #f3f5f9;
  color: var(--mk-muted);
  word-break: break-all;
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
  font-size: var(--mk-fs-14);
}
.admin-page-error {
  margin: 24px;
}
</style>
