<template>
  <section class="ac">
    <!-- 启动失败（非 401；401 由路由守卫与拦截器导向登录页） -->
    <!-- 2026-11-04 用户「这个页面重新设计，诊断信息很奇怪的位置」：
         原先是一张居中排版的小卡，三个按钮横排，诊断信息作为一枚裸 <details> 挂在按钮下面——
         收起来只剩一个 ▸ 三角 + 一行灰字，展开后又把整块内容顶歪。现在按「错误页」该有的层级排：
         图标 + 标题 + 一句人话说明 + 两个动作（重试 / 退出登录），诊断信息收进卡内独立的
         带分隔线的区块（标题行右侧是复制），长文本限高滚动。 -->
    <div v-if="bootError" class="ac-error">
      <div class="ac-error__card" role="alert" aria-labelledby="ac-error-title">
        <div class="ac-error__head">
          <TriangleAlert class="ac-error__icon" :size="20" :stroke-width="2" aria-hidden="true" />
          <h1 id="ac-error-title" class="ac-error__title">控制台暂时无法打开</h1>
        </div>
        <p class="ac-error__lead">
          {{ bootErrorIsAuth
            ? '登录状态已经失效，重新登录就能继续。'
            : '数据服务没有正常响应，所有页面都受影响。可以先重试。仍然打不开就退出重登，或把下面的诊断信息发给研发。' }}
        </p>
        <div class="ac-error__actions">
          <!-- 登录失效时「重试」修不了问题，主按钮让给「重新登录」——别让人对着一个 403 反复点重试 -->
          <button type="button" class="mk-btn" :class="{ 'mk-btn--primary': !bootErrorIsAuth }" @click="boot">重试</button>
          <!-- 长故障兜底：会话可能已失效（否则重试应能恢复），退出重登不困在错误页 -->
          <button type="button" class="mk-btn" :class="{ 'mk-btn--primary': bootErrorIsAuth }" @click="logoutFromError">
            {{ bootErrorIsAuth ? '重新登录' : '退出登录' }}
          </button>
        </div>
        <div class="ac-error__diag">
          <div class="ac-error__diag-head">
            <span>诊断信息</span>
            <button type="button" class="mk-link" @click="copyDiagnostics">复制</button>
          </div>
          <code class="ac-error__diag-code">{{ bootError }}</code>
        </div>
      </div>
    </div>

      <!-- 面包屑回总览/上级由 crumb-click 承担；帮助按钮跳运营术语表整页（2026-10-10 抽屉退役） -->
      <Shell
        :current="scene"
        :crumb="crumbLabel"
        :crumb-title="crumbTitle"
        :crumb-clickable="!!subPage"
        release
        @navigate="navigate"
        @glossary="navigate('glossary')"
        @crumb-click="closeSubPage"
      >
      <!-- 骨架补 .mk-page 容器（2026-10-06 审核）：骨架卡本身无 margin/padding，
           直接贴在内容区左上角；正式页面走 .mk-page 的 20/20 留白 —— 从加载态切到
           正式页面的瞬间整页内容会右移/下移 20px。包一层同款容器即对齐同一条竖线。 -->
      <div v-if="booting" class="mk-page">
        <MockSkeletonTable :rows="7" :cols="6" />
      </div>
      <!-- :key=详情 id+includeTest（回归 R3）：两个实体深链间前进/后退时强制重建组件，
           否则 <component> 同类型复用实例，旧实体的异步写入会串到新 id 的页面上；
           同 id 深链带/不带 includeTest 是两次不同取数（LearnerDetail 挂载时读 subPage.includeTest），
           仅 key=id 时 includeTest 变化不会重建组件，旧取数（不含测试数据）残留 -->
      <component v-else :is="detailComponent || currentComponent" :key="pageKey" />
    </Shell>
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
    // 统一加载态：表格骨架屏（与页面自身骨架同源同观感；原 spinner 与骨架体系割裂且切换观感差）
    loadingComponent: h(MockSkeletonTable, { rows: 7, cols: 6 }),
    delay: 200,
    errorComponent: {
      setup() {
        // 错误面统一 mk-alert--row（原 errorbar 是零定义死类，渲染成无样式裸文字）
        return () => h('div', { class: 'admin-page-error' }, [
          h('div', { class: 'mk-alert mk-alert--row' }, [
            h('div', { class: 'mk-alert__msg' }, [
              h('strong', { style: 'margin-right: 8px' }, '页面加载失败'),
              h('span', '页面依赖模块加载失败（可能是网络异常、开发态依赖缓存过期，或平台刚更新）'),
            ]),
            h('div', { class: 'mk-alert__act' }, [
              h('button', { type: 'button', class: 'mk-btn mk-btn--sm', onClick: () => window.location.reload() }, '刷新页面'),
            ]),
          ]),
        ]);
      }
    },
    onError(error, retry, fail, attempts) {
      // 宽化重试匹配：动态 import 的失败信息随浏览器/打包器而异（Failed to fetch /
      // error loading dynamically imported module / Importing a module script failed / Loading chunk X failed），
      // 只精确匹配 'Failed to fetch' 会漏掉部署更新后 chunk 404 的主流报错，重试机制形同虚设
      // attempts 封顶 3（回归 R1）：持久性 chunk 404（部署更新后旧文件已消失）重试永远不会成功，
      // 不封顶会无限重试打爆网络与控制台；到顶 fail() 交错误面，由用户点「刷新页面」人工 reload
      if (attempts < 3 && /failed to fetch|module|import|load/i.test(String(error?.message || error || ''))) { retry(); } else { fail(); }
    }
  });
}

const Overview = asyncPage(() => import('./Overview.vue'));
const People = asyncPage(() => import('./People.vue'));
// 2026-10-04 用户拍板拆回独立页：学习状态从 people 宿主 tab 释放（组件沿用 LearnerCenter.vue，转正为页面）
const LearnerState = asyncPage(() => import('./LearnerCenter.vue'));
// 2026-09-29 用户拍板拆回独立页：「学习会话」合并宿主退役，教学会话/目标对话/学习路径各自成页
const TeachingSessions = asyncPage(() => import('./TeachingSessions.vue'));
const GoalConversations = asyncPage(() => import('./GoalConversations.vue'));
const LearningPaths = asyncPage(() => import('./OpsContent.vue'));
const VirtualLearners = asyncPage(() => import('./VirtualLearners.vue'));
const VirtualLearnerCards = asyncPage(() => import('./VirtualLearnerCards.vue'));
const Skills = asyncPage(() => import('./Skills.vue'));
const Orchestrator = asyncPage(() => import('./Orchestrator.vue'));
const ExecLogs = asyncPage(() => import('./ExecLogs.vue'));
// 2026-09-29 拆回独立页：成本分析从执行日志宿主释放
const TokenCost = asyncPage(() => import('./TokenCost.vue'));
const AuditLogs = asyncPage(() => import('./AuditLogs.vue'));
// 系统设置（2026-11-01）：模型与接入 + 运营中心原系统运维四页签合并（用户「这四个拆出来，
// 和模型与接入作为一个页面，但是模型与接入要改名字了」）。模型与接入降为该页首屏页签，
// 不再作为独立场景注册——旧 id api-config 的 URL 在 router 改投过来。
const SystemSettings = asyncPage(() => import('./SystemSettings.vue'));
const PromptWorkbench = asyncPage(() => import('./PromptWorkbench.vue'));
// 运营术语表（2026-10-10 抽屉退役改整页）：壳层帮助按钮跳转的隐藏场景，不进侧栏
const AdminGlossary = asyncPage(() => import('./AdminGlossary.vue'));
const OpsHub = asyncPage(() => import('./OpsHub.vue'));
// 外挂能力（2026-10-19 用户拍板从 api-config 宿主拆回独立页，归入侧栏 Skill 组）：
// 能力 Skill 与 MCP 服务的登记/测试，页头自带刷新
const Addons = asyncPage(() => import('./Addons.vue'));
const LearnerDetail = asyncPage(() => import('./LearnerDetail.vue'));
const VirtualProfile = asyncPage(() => import('./VirtualProfile.vue'));
const PathDetail = asyncPage(() => import('./PathDetail.vue'));
// 技能详情二级页（原型 renderSkillDetail 落点；Skill 目录行 / 编排图节点下钻）。
// 2026-10-15 用户拍板：独立「Skill 设计页」退役，其可编辑六页签内容平铺进本页各页签
// （只读概览在上、设计区块在下），故不再有单独的 design 子页。
const SkillDetail = asyncPage(() => import('./SkillDetail.vue'));
// 卡库二级页（2026-10-06 抽屉退役：卡详情/导入卡从 mk-drawer 迁标准二级页）
const CardDetailPage = asyncPage(() => import('./CardDetailPage.vue'));
const CardImportPage = asyncPage(() => import('./CardImportPage.vue'));
const SessionCockpit = asyncPage(() => import('./SessionCockpit.vue'));
/* 记忆与复习（2026-10-12 两段拍板）：独立页先退役并入学习者详情页签，同日恢复**跨用户总览**
 * （MemoryReviewOverview：按待复习量排序的用户列表 + 到期时间轴）；单用户明细留在
 * 学习者详情「记忆与复习 / 记忆调度」页签，?userId= 旧深链由总览页转发过去 */
const MemoryReview = asyncPage(() => import('./MemoryReviewOverview.vue'));

const components: Record<string, unknown> = {
  'overview': Overview,
  // 导航收敛 2026-09-04：users+learner-center → people；announcements+notifications → messages；token-cost → execution-logs（成本分析 tab）
  // 导航一级收敛 2026-09-19（阶段 1）：feedback/ops-achievements/messages → ops-hub 宿主 tab；
  // session-security → ops-hub 宿主 tab（场景下线，URL 重定向兼容）
  // （addons 当时折入 api-config 宿主，2026-10-19 已拆回独立场景，见上）
  // 阶段 3（2026-09-19）：health-center → skills 宿主 tab（健康检查/漂移/对账），场景下线
  // 2026-09-29 用户拍板拆回：teaching-sessions / goal-conversations / learning-paths 各自独立成页
  //（2026-09-04 曾合并为「学习会话」宿主 sessions，场景已下线，URL 重定向兼容）
  // 2026-09-29 用户拍板：健康中心从 skills 宿主 tab 释放为独立场景（系统组）
  'health-center': HealthCenter,
  'people': People,
  'learner-state': LearnerState,
  'teaching-sessions': TeachingSessions,
  'goal-conversations': GoalConversations,
  'learning-paths': LearningPaths,
  'virtual-learners': VirtualLearners,
  // 学习者卡库（2026-10-01，2026-10-29 修正）：角色卡结构化导入/导出，卡=纯档案+故事池（不建账号），不经编译链
  'virtual-learner-cards': VirtualLearnerCards,
  // 「批量实验」2026-10-04 下线（运行态并入 virtual-learners、资产输入归卡库；
  // 建页至今 batch_experiments 两表 0 行）；旧 URL 在 router 重定向到 /admin/virtual-learners
  'skills': Skills,
  'orchestrator': Orchestrator,
  // 外挂能力（2026-10-19 从 api-config 宿主拆回独立场景，侧栏 Skill 组）
  'addons': Addons,
  // Prompt 评估 2026-11-01 下线：场景与侧栏项一并摘除，旧 URL 在 router 改投 /admin/skills
  'execution-logs': ExecLogs,
  'token-cost': TokenCost,
  'memory-review': MemoryReview,
  'audit-logs': AuditLogs,
  'system-settings': SystemSettings,
  // 访问与注册 2026-11-01 随系统运维四页签迁入「系统设置」（此前 2026-10-27 曾并入运营中心 tab）
  // 隐藏场景（不在 manifest 侧栏）：PromptWorkbench 是「新建 Skill」骨架生成的唯一入口，
  // 健康中心 hash/yaml 跳转深链至此，勿删注册
  'skill-workbench': PromptWorkbench,
  // 运营术语表（manifest hidden: true）：壳层帮助按钮 → /admin/glossary 整页
  'glossary': AdminGlossary,
  'ops-hub': OpsHub
};

const detailComponents: Record<string, unknown> = {
  learner: LearnerDetail,
  virtual: VirtualProfile,
  // 人员详情合并（2026-10-03）：?view=user 深链别名 = LearnerDetail（默认落「账号与许可」页签）
  user: LearnerDetail,
  session: SessionCockpit,
  'session-real': SessionCockpit,
  // 路径深链适配层（2026-10-12 拍板：路径不再有独立详情页；由它反查对话后换开座舱 Path 页签）
  path: PathDetail,
  // 技能详情二级页（原型 renderSkillDetail 落点；Skill 目录行/编排图节点下钻，替代 SkillDrawer 打开）。
  // 设计页能力已平铺进本页（2026-10-15），Skill 列表行点击、编排图节点下钻都落这里。
  skill: SkillDetail,
  // 卡库二级页（卡墙点卡 / 页头「导入卡」）
  card: CardDetailPage,
  'card-import': CardImportPage
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
import { TriangleAlert } from 'lucide-vue-next';
import Shell from './Shell.vue';
import HealthCenter from './HealthCenter.vue';
import MockSkeletonTable from './SkeletonTable.vue';
import { intent, intentQueryParams, subPage, closeSubPage, liveSpans, asSubPageStage, type SubPageView, type SubPageStage } from './store';
import { MOCK_SCENES } from './manifest';
import { loadLiveData } from './live';
import { clearAdminSession } from '@/api/adminApi';
import { useEscape } from './useEscape';
import { toast } from '@/utils/toast';
import '@/styles/mk-primitives.css';

/* 整页二级详情（?view=&id=）也走全站统一的 Esc 关浮层通道：LIFO 栈保证盖在详情上的
   抽屉/弹层先关，再按一次 Esc 才退出详情（与面包屑返回/浏览器后退同一出口语义） */
useEscape(() => !!subPage.value, closeSubPage);

const scene = ref('overview');
const booting = ref(true);
const bootError = ref('');
/* 失败原因分两类：会话失效（403 / 「权限已失效」）与数据服务不可用。
   前者重试没用、退出重登才有用，所以文案与主按钮都要跟着换（2026-11-04 实机踩到）。 */
const bootErrorIsAuth = computed(() => /权限|登录|401|403|unauthori[sz]ed|forbidden/i.test(bootError.value));

const currentComponent = computed(() => components[scene.value]);
const detailComponent = computed(() => (subPage.value ? detailComponents[subPage.value.view] : null));
// 详情组件 key（回归 R3）：id + includeTest 二元化，includeTest 深链变化也强制重建详情组件
const pageKey = computed(() => (subPage.value ? `${subPage.value.id}:${subPage.value.includeTest ? 1 : 0}` : undefined));
/* 面包屑：二级页优先显示中文名/短标识（label），未设置时回退 ID 截断；title 始终给全 ID。
   2026-10-24：from 支持 parent 链（二级 → 三级 → 四级），逐层拼出完整路径；
   超过 3 段时保留最近 3 段并用「…」占位，避免顶栏被长链撑爆。 */
const CRUMB_MAX_DEPTH = 3
/* 不截断实体名：teaching-turn 这类 13 字符标识按「前 8 + … + 后 4」反而更长，
   顶栏右侧留白足够，交给 CSS ellipsis 处理（2026-10-30 外部评审）。 */
function crumbPart(label?: string, id?: string): string {
  return label || id || ''
}
/** 从当前 subPage 往上取完整链路（最外层在前） */
function crumbChain(): string[] {
  const sp = subPage.value
  if (!sp) return []
  const chain: string[] = [crumbPart(sp.label, sp.id)]
  let from = sp.from
  while (from) {
    chain.unshift(crumbPart(from.label, from.id))
    from = from.parent
  }
  /* 2026-11-09 走查（面包屑与左侧菜单对不上）：链根若不是当前栏目，就把当前栏目接到最前。
     典型是「会话监控」——它是一个下钻页，左侧菜单里根本没有这一栏，于是顶栏副行写着
     「会话监控」而菜单高亮「目标对话」，读者不知道自己在哪一节。顶栏副行读的就是链首，
     补上栏目后两处一致；返回目标仍是链尾那条真实来源页（from 没动）。
     链已经到 CRUMB_MAX_DEPTH 时不补——否则三级链会被挤成「… / x / y」，把有用的层级挤掉。 */
  const sectionLabel = MOCK_SCENES.find((s) => s.id === scene.value)?.label
  if (sectionLabel && chain[0] !== sectionLabel && chain.length < CRUMB_MAX_DEPTH) {
    chain.unshift(sectionLabel)
  }
  return chain
}
const crumbLabel = computed(() => {
  const chain = crumbChain()
  if (!chain.length) return ''
  if (chain.length > CRUMB_MAX_DEPTH) {
    return ['…', ...chain.slice(chain.length - CRUMB_MAX_DEPTH)].join(' / ')
  }
  return chain.join(' / ')
})
const crumbTitle = computed(() => {
  const sp = subPage.value
  if (!sp) return ''
  // label 回填后tooltip也应显示中文名（除名，避免裸 UUID）；深链瞬间 label 未到，回退 id
  const chain: string[] = [sp.label || sp.id]
  let from = sp.from
  while (from) {
    chain.unshift(from.label || from.id)
    from = from.parent
  }
  return chain.join(' / ')
})

/* —— 真路由化：scene ↔ URL /admin/:page 双向同步 —— */
const route = useRoute()
const router = useRouter()

/* —— 二级页 subPage ↔ URL query（?view=&id=）双向同步 ——
   二级页此前只存在内存 ref，刷新/深链/前进后退均无法寻址（URL 不显示）。
   打开：openSubPage（任意组件）→ subPage 变化 → URL 补 query；
   恢复：整页刷新 /admin/:page?view=virtual&id=xxx → query watch → subPage 恢复 → 详情组件直接渲染。 */
const SUBPAGE_VIEWS = ['learner', 'virtual', 'user', 'session', 'session-real', 'path', 'skill', 'card', 'card-import']
/* 没有实体 id 的二级视图：导入卡是纯表单页，本身不带 id（CardImportPage.vue 文件头
   写明的深链就是 ?view=card-import）。守卫此前要求 view 与 id 同时非空，这种写法会
   落到下面的「无 id 即关闭二级页」分支、渲染回场景页（卡墙）——导入页只有带哨兵 id
   才进得去（应用内入口 VirtualLearnerCards 正是 openSubPage('card-import','new')）。
   给它一个默认 id，让「手敲深链」与「应用内入口」两种写法等价。 */
const IDLESS_SUBPAGE_VIEWS = ['card-import']
// URL → subPage（深链/刷新/前进后退）；includeTest 透传（虚拟学习者/测试账号深链可查）
// stage 透传（2026-10-12）：座舱落点页签（?view=session-real&id=..&stage=path），刷新/深链保持落点
watch(
  () => [route.query.view, route.query.id, route.query.includeTest, route.query.stage] as [unknown, unknown, unknown, unknown],
  ([v, id, includeTest, stage]) => {
    const view = typeof v === 'string' ? v : ''
    const sid = typeof id === 'string' ? id : ''
    const it = String(includeTest || '') === 'true'
    const st = asSubPageStage(stage)
    if ((sid || IDLESS_SUBPAGE_VIEWS.includes(view)) && SUBPAGE_VIEWS.includes(view)) {
      const nextId = sid || 'new'
      const next: { view: SubPageView; id: string; includeTest?: boolean; stage?: SubPageStage } =
        it ? { view: view as SubPageView, id: nextId, includeTest: true } : { view: view as SubPageView, id: nextId }
      if (st) next.stage = st
      const cur = subPage.value
      if (!cur || cur.view !== next.view || cur.id !== next.id || !!cur.includeTest !== it || cur.stage !== next.stage) {
        subPage.value = next
      }
    } else if (!sid) {
      // 浏览器后退：?view=&id= 从 URL 消失但 subPage 仍开着 → 关闭二级页（此前缺这条
      // else 分支，后退只改 query、详情残留，URL 与渲染脱节）。场景切换中（scene watch
      // 已自行清空 subPage 并 push 新路径）不抢动作，判据与下方 subPage→URL watch 同款。
      const curPage = typeof route.params.page === 'string' ? route.params.page : ''
      if (subPage.value && curPage === scene.value) {
        closeSubPage()
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
      if (sp.stage) q.stage = sp.stage
      else delete q.stage
      /* 详情内部页签落点（learner）：并进同一次 push，详情挂载即从 ?tab= 取到落点。
         不让详情挂载后再补一笔 replace——两笔导航互相竞态时，补参数那笔会把 view/id 冲掉，
         二级页被自己的 URL 同步当场关掉。离开 learner 详情时顺手清掉它，避免列表 URL 上
         留一个无主 tab（skills 宿主的 ?tab= 不受影响：只在 curView=learner 时清）。 */
      /* Skill 详情的页签用独立键 skdTab：?tab= 归宿主列表（Skills/Orchestrator），
         两边共用会互相覆盖（2026-10-24 层级收口）。 */
      if (sp.tab) {
        if (sp.view === 'skill') q.skdTab = sp.tab
        else q.tab = sp.tab
      } else {
        if (curView === 'learner') delete q.tab
        if (sp.view === 'skill') delete q.skdTab
      }
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
        delete q.stage
        // 落点页签是详情自己的参数，随详情一起收（learner 用 ?tab=，skill 用 ?skdTab=）
        if (curView === 'learner') delete q.tab
        if (curView === 'skill') delete q.skdTab
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
      // 静默 replace 会让打错的深链看起来"点了没反应"：先告知，再回总览
      toast.warning(`未知管理页「${id}」，已回到总览`)
      void router.replace('/admin/overview')
    }
  },
  { immediate: true }
)
// scene → URL（侧栏/意图跳转）；push 保留历史，浏览器后退可回到上一页面
// 门闩 bootstrapped：挂载完成前不主动 push，避免初始化瞬态把深链 URL 改写掉（QA ISSUE-001）
let bootstrapped = false;
/* 跨页跳转携带的目标页预筛（侧栏角标点进执行日志即 ?range=week&status=err 等）。
   与 intent 并存：intent 是模块级共享的排查动线，这里是「这一次导航」的一次性 query，
   push 落定即清空，不残留到下一次侧栏点击。 */
let pendingSceneQuery: Record<string, string> | null = null
watch(scene, (s) => {
  const cur = typeof route.params.page === 'string' ? route.params.page : ''
  if (bootstrapped && cur !== s) {
    /* 排查动线（P0）：intent 筛选随跳转进 URL——执行日志「已过滤故障视图」
       可刷新/分享/前进后退还原（ExecLogs 侧做 URL↔筛选双向同步）。
       只带 intent 参数、不透传当前页 query（避免把 ?view=&id= 等二级页状态漏进目标页） */
    const q = { ...intentQueryParams(s), ...(pendingSceneQuery || {}) }
    pendingSceneQuery = null
    if (Object.keys(q).length) void router.push({ path: `/admin/${s}`, query: q })
    else void router.push(`/admin/${s}`)
    subPage.value = null;
  } else {
    // route 驱动的场景变化（刷新深链 / 浏览器前进后退 / 带 query 的直达 push）：
    // 目标 URL 自带合法 ?view=&id= 时，subPage 的恢复权归「URL → subPage」watch，
    // 此处不得清空——本 watch 注册晚于该 watch，同一 flush 里会「先恢复后误杀」，
    // 深链详情永远打不开（刷新 /admin/people?view=user&id=xx 卡骨架屏的根因）。
    const qv = typeof route.query.view === 'string' ? route.query.view : ''
    const qid = typeof route.query.id === 'string' ? route.query.id : ''
    if (!(qid && SUBPAGE_VIEWS.includes(qv))) subPage.value = null;
  }
});
// 旧 ?skill=<id> 深链（健康中心「查看 →」等外部入口）翻译成二级页规范形 ?view=skill&id=<id>，
// 之后全部走「URL → subPage」标准机制：刷新恢复、前进后退、场景切换清理都免特判。
// （抽屉已退役：原型 open-skill 是 go("skill") 跳页，详情=SkillDetail 二级页，弹层只留子实体）
watch(
  () => route.query.skill,
  (s) => {
    const sid = typeof s === 'string' ? s : ''
    if (sid && !(route.query.view === 'skill' && route.query.id === sid)) {
      const q = { ...route.query }
      delete q.skill
      q.view = 'skill'
      q.id = sid
      void router.replace({ query: q })
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

function navigate(id: string, query?: Record<string, string>) {
  // 相同 scene 再点击：scene watch 不会触发，这里显式清空 subPage 返回列表
  if (id === scene.value) {
    subPage.value = null;
    /* 带预筛的同页点击（如已在执行日志再点角标）：直接 replace 到该筛选，
       否则「点了没反应」。 */
    if (query) void router.push({ path: `/admin/${id}`, query })
    return;
  }
  pendingSceneQuery = query || null
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
  // loadLiveData 内部已做局部容错；仅核心域（日志）失败才提示整页错误。
  // 判定与数据层对齐（loadLiveData 同款「有旧数据即放行」）：spans 请求失败但此前已有
  // 旧样本在手（TTL 内重进/局部重试场景）不锁整页，避免无谓的全屏死路。
  const { liveFailures } = await import('./live');
  if (liveFailures.value.spans && !(liveSpans.value && liveSpans.value.length)) {
    bootError.value = liveFailures.value.spans;
  }
}

/** 复制诊断信息（bootError 原文，含后端 message）。
    此前 catch 里只有注释（静默失败），而文案明确要求用户「复制下方诊断信息发给研发」，
    用户会以为已复制（2026-10-06 审核）。成功/失败都给 toast 反馈。 */
async function copyDiagnostics() {
  try {
    await navigator.clipboard.writeText(`控制台数据加载失败：${bootError.value}`);
    toast.success('诊断信息已复制');
  } catch {
    toast.error('复制失败，请手动选中诊断信息');
  }
}

/** 错误卡「退出登录」：清会话后回登录页（长故障时不至于死路） */
function logoutFromError() {
  clearAdminSession();
  void router.push('/admin/login');
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

.ac-error {
  position: fixed;
  inset: 0;
  /* 全屏兜底层：用 critical 档（500），此前 400 字面量与 toast 同档会互相抢占（2026-09-26 对齐） */
  z-index: var(--mk-z-critical, 500);
  background: var(--mk-bg, #f7f8fa);
  display: grid;
  place-items: center;
  padding: 24px;
}
/* 左对齐的单列卡：标题与说明读起来是一段话，而不是三行居中的标签 */
.ac-error__card {
  display: grid;
  gap: 12px;
  width: min(520px, 100%);
  padding: 24px 26px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-xl);
  background: var(--mk-surface);
  box-shadow: var(--mk-shadow-modal);
}
.ac-error__head { display: flex; align-items: center; gap: 10px; min-width: 0; }
.ac-error__icon { flex: none; color: var(--mk-red); }
.ac-error__title { margin: 0; font-size: var(--mk-fs-emphasis); font-weight: 700; color: var(--mk-ink); }
.ac-error__lead { margin: 0; font-size: var(--mk-fs-body); line-height: 1.6; color: var(--mk-muted); }
.ac-error__actions { display: flex; gap: 8px; flex-wrap: wrap; }
/* 诊断信息：卡内独立区块，与动作之间一条发丝线隔开；标题行右侧才是复制 */
.ac-error__diag {
  display: grid;
  gap: 6px;
  margin-top: 2px;
  padding-top: 12px;
  border-top: 1px solid var(--mk-line);
}
.ac-error__diag-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--mk-faint);
  font-size: var(--mk-fs-micro);
}
.ac-error__diag-code {
  display: block;
  max-height: 96px;
  overflow: auto;
  margin: 0;
  padding: 8px 10px;
  border-radius: var(--mk-radius-sm);
  background: var(--mk-surface-3);
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  word-break: break-all;
  white-space: pre-wrap;
}

/* ========== 大屏/4K 适配（全站 mk 体系档位：≥2000px 字号放大；zoom 档 ≥2800px→1.15） ========== */
@media (min-width: 2000px) {
  .ac-error__card { gap: 14px; padding: 30px 32px; }
  .ac-error__title { font-size: 18.5px; }
}
@media (min-width: 2800px) {
  .ac-error__card { gap: 16px; padding: 36px 38px; }
  .ac-error__title { font-size: var(--mk-fs-emphasis); }
}

/* 异步 tab 过渡态：错误卡（加载骨架已统一走 SkeletonTable） */
.admin-page-error {
  margin: 24px;
}
</style>
