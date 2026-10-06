<template>
  <!-- ===== 加载完成：原型 renderPathDetail 的完整版式 =====
       hero（头像「路」+ 标题 + 学习者/阶段/更新副文 + 状态/当前阶段/预计 pills + 动作）
       → 总体进度卡（meterrow「总体进度」+ mono % + 任务完成数 + 8px meter）
       → stagecard 手风琴（阶段头点击展开 → taskrow 列表）。
       （2026-10-02 用户拍板「也是kpi问题」：撤 statstrip——原型路径详情无此带，
       阶段完成/最近更新已在 hero 副文，任务完成/预计时长收进进度卡与 pills） -->
  <div v-if="d" class="mk-page pd">
    <MkDetailHero avatar="路" :title="d.title" :sub="heroSub">
      <template #pills>
        <span class="mk-badge" :class="statusBadge(d.status)">{{ statusText(d.status) }}</span>
        <span v-if="currentStageLabel" class="mk-badge mk-badge--muted" :title="currentStageHint">当前：{{ currentStageLabel }}</span>
        <span v-if="d.estimatedHours" class="mk-badge mk-badge--muted" title="后端 estimatedHours 估算值，带 ~ 表示近似">预计 ~{{ d.estimatedHours }}h</span>
      </template>
      <template #actions>
        <button type="button" class="mk-btn" :disabled="busy" @click="toggleArchive">
          {{ d.status === 'archived' ? '恢复路径' : '下线路径' }}
        </button>
        <button type="button" class="mk-btn" :disabled="loading" @click="load(true)">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
        <!-- 真实下钻：路径 → 所属学习者画像（UserDetail 的「查看学习者画像 →」同款习惯） -->
        <button v-if="learner?.id" type="button" class="mk-btn mk-btn--primary" @click="goLearner">查看学习者 →</button>
      </template>
    </MkDetailHero>

    <!-- 总体进度（原型 renderPathDetail 的 meterrow：label + mono % + 8px meter 条）；
         右侧补任务完成数——原 statstrip 唯一不与 hero 重复的读数，收进本卡不再另设统计带 -->
    <section class="mk-card pd-progress">
      <div class="pd-meterrow">
        <span class="pd-meterrow__label" title="口径：按阶段（已完成阶段数 / 总阶段数）；右侧「任务 X / Y」按子任务口径，两者分母不同">总体进度（按阶段）</span>
        <span class="pd-meterrow__right">
          <span v-if="taskTotals.total" class="pd-meterrow__tasks" title="已完成子任务数 / 子任务总数（按详情接口 subtasks 统计；与本条 % 的阶段口径分母不同）">任务 {{ taskTotals.done }} / {{ taskTotals.total }}</span>
          <span class="pd-meterrow__num mono" title="口径：已完成阶段 {{ stageDone }} / {{ stageTotal }} 阶段">{{ overallPct }}%</span>
        </span>
      </div>
      <span class="mk-minibar pd-meter"><i class="mk-minibar__fill" :style="{ width: overallPct + '%' }"></i></span>
      <!-- 口径常显（2026-10-06 审核 #75）：两个分母并排（阶段 % vs 任务 X/Y）的歧义
           此前只写在 title 里，触屏/键盘/读屏拿不到；title 保留作读屏兜底 -->
      <p class="pd-note">口径：% 按阶段（{{ stageDone }}/{{ stageTotal }}）；「任务 X / Y」按子任务（{{ taskTotals.done }}/{{ taskTotals.total }}），两者分母不同</p>
    </section>

    <!-- stagecard 手风琴（原型：单开、点击阶段头切换展开；默认展开「当前阶段」——2026-10-06 审核 #80） -->
    <MkEmptyState
      v-if="!stages.length"
      icon="◌"
      title="该路径尚未拆解出阶段"
      description="目标对话生成路径后，阶段与任务会出现在这里。"
    />
    <div v-else class="pd-stack">
      <section
        v-for="(m, i) in stages"
        :key="m.id"
        class="pd-stage"
        :class="{ 'pd-stage--idle': m.status !== 'in_progress' && m.status !== 'completed' }"
      >
        <button
          type="button"
          class="pd-stage__head"
          :aria-expanded="openStage === i"
          @click="toggleStage(i)"
        >
          <span class="pd-stage__n" aria-hidden="true">{{ m.stageNumber || i + 1 }}</span>
          <strong class="pd-stage__title" :title="m.title">{{ m.title }}</strong>
          <span class="pd-stage__meta">{{ doneTasks(m) }} / {{ m.subtasks.length }} 任务</span>
          <span class="mk-badge" :class="milestoneBadge(m.status)">{{ milestoneText(m.status) }}</span>
          <span class="pd-stage__caret" aria-hidden="true">{{ openStage === i ? '▾' : '▸' }}</span>
        </button>
        <div v-if="openStage === i" class="pd-stage__body">
          <!-- 阶段内容层（2026-10-06 审核 #54）：阶段自身的描述/目标/预计学时/核心概念
               此前在模板零引用（类型里已声明的字段被丢），页面层级只落到「阶段→任务」两级。
               字段全来自详情接口 include 的 milestones 原行，无值不渲染、不硬造。 -->
          <div v-if="m.description || m.goal || m.coreConceptName || m.estimatedHours" class="pd-stage__brief">
            <p v-if="m.description" class="pd-stage__desc">{{ m.description }}</p>
            <p v-if="m.goal" class="pd-stage__goal"><span class="pd-stage__brief-label">目标</span>{{ m.goal }}</p>
            <div class="pd-stage__brief-meta">
              <span v-if="m.coreConceptName" class="mk-badge mk-badge--muted" title="该阶段的核心概念">核心概念：{{ m.coreConceptName }}</span>
              <span v-if="m.estimatedHours" class="pd-stage__hours" title="后端 estimatedHours 估算值">预计 ~{{ m.estimatedHours }}h</span>
            </div>
          </div>
          <button
            v-for="t in m.subtasks"
            :key="t.id"
            type="button"
            class="pd-task"
            :class="{ 'pd-task--done': t.status === 'completed', 'pd-task--active': t.status === 'in_progress' }"
            @click="openTask(m, t)"
          >
            <span class="pd-task__box" aria-hidden="true">✓</span>
            <span class="pd-task__main">
              <strong class="pd-task__title">{{ t.title }}</strong>
              <span class="pd-task__sub">{{ taskSub(t) }}</span>
            </span>
            <span class="mk-badge" :class="taskBadge(t.status)">{{ taskText(t.status) }}</span>
          </button>
          <!-- 阶段内空态走共享一行式空态 .mk-empty--line（审核 #76）：此前用私有 .pd-none
               自绘（字号/色阶/内衬与全站内联空态不一致）。保留 pd-none 仅作既有单测的钩子类
               （path-detail.redesign.test.ts:186 断言 .pd-none），样式已由共享类承担。 -->
          <p v-if="!m.subtasks.length" class="mk-empty mk-empty--line pd-none">该阶段暂无任务</p>
        </div>
      </section>
    </div>

    <!-- 任务详情弹层（原型 openTaskDetail 三段式：head 序号圆+任务名+阶段名+关闭 /
         body 状态 pill 行 + 事实栅格 / foot 关闭）。验收点/关联产出/学习证据等
         原型字段后端详情接口未返回（subtasks select 不含 acceptanceCriteria），不硬造。 -->
    <Teleport to="body">
      <div v-if="taskRef" ref="maskRef" class="mk-modal">
        <div ref="panelRef" class="mk-modal__panel pd-tk" role="dialog" aria-modal="true" aria-label="任务详情">
          <div class="mk-modal__head">
            <div class="pd-tk__head">
              <span class="pd-tk__num" aria-hidden="true">{{ taskRef.stage.stageNumber || 1 }}</span>
              <div class="pd-tk__meta">
                <h2 class="mk-modal__title">{{ taskRef.task.title }}</h2>
                <span class="pd-tk__sub">{{ taskRef.stage.title }}</span>
              </div>
            </div>
            <button type="button" class="mk-modal__close" aria-label="关闭" @click="closeTask">✕</button>
          </div>
          <div class="mk-modal__body">
            <div class="pd-tk__row">
              <span class="mk-badge" :class="taskBadge(taskRef.task.status)">{{ taskText(taskRef.task.status) }}</span>
              <span class="pd-tk__grow"></span>
              <span class="pd-tk__note mono" :title="taskRef.task.id">{{ shortId(taskRef.task.id, 8, 4) }}</span>
            </div>
            <div class="mk-facts">
              <div><span>任务类型</span><strong>{{ taskTypeText(taskRef.task.taskType) }}</strong></div>
              <div><span>预计用时</span><strong class="mono">{{ taskRef.task.estimatedMinutes }} 分钟</strong></div>
              <div v-if="cognitiveText(taskRef.task.cognitiveLoad)"><span>认知负荷</span><strong>{{ cognitiveText(taskRef.task.cognitiveLoad) }}</strong></div>
              <div v-if="taskRef.task.completedAt"><span>完成时间</span><strong>{{ timeAgo(taskRef.task.completedAt) }}</strong></div>
            </div>
          </div>
          <div class="mk-modal__foot">
            <button type="button" class="mk-btn" @click="closeTask">关闭</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>

  <!-- ===== 加载失败：明确错误态 + 重试（MkEmptyState tone=error，判例 UserDetail） ===== -->
  <div v-else-if="loadError" class="mk-page pd">
    <MkEmptyState
      icon="◌"
      tone="error"
      title="路径详情加载失败"
      :description="loadError"
      action-text="重试"
      @action="load(true)"
    />
  </div>

  <!-- ===== 首次加载：骨架屏（形状走 MkSkeleton 版式，避免布局跳动） ===== -->
  <div v-else class="mk-page pd">
    <div class="pd-skel" aria-hidden="true">
      <MkSkeleton variant="identity" :avatar="48" />
      <MkSkeleton variant="cards" :count="1" :h="56" :cols="1" :radius="12" />
      <MkSkeleton variant="cards" :count="4" :h="64" :cols="1" :radius="12" />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 路径详情二级页（newui 原型 renderPathDetail 的落点，2026-10-01 新建）。
 *
 * 原型口径：hero → 总体进度 meter → stagecard 手风琴（展开出 taskrow）→
 * 任务详情三段式弹层（openTaskDetail）。
 * 数据口径：全部来自 adminLearningContentApi.getPathDetail(pathId) 的真实字段；
 * 原型有而接口没有的字段（验收点/关联产出/学习证据）不渲染，绝不硬造。
 * 动作口径：原型 hero 的「导出」是假按钮不搬；「重规划」（原型 2288 + openReplanConfirm 2637）
 * 经核查管理员侧无任何可达的重规划能力，按「宁缺勿假」不搬（2026-10-01 核查）：
 *   - 治理接口 adminLearningContentApi（backend routes/admin/learning-content.ts）只有
 *     list/detail/archive/restore/delete/stats，没有 replan；
 *   - 用户侧 POST /learning/paths/:pathId/replan（backend routes/learning.ts:943）走 user
 *     authMiddleware（req.user.userId）且注释标明「当前仅返回占位结果」，admin 控制台无用户会话、不可达；
 *   - 管理员可达的只有会话级 POST /admin/virtual-learners/sessions/:sessionId/replan-path
 *     （adminApi.replanVirtualSessionPath），需要 sessionId，且只用于 SessionCockpit 的
 *     path-review 流程；路径详情接口不返回任何 sessionId，无法落到具体会话。
 * 因此 hero actions 只放真实能力（下线/恢复真实接口、刷新、查看学习者下钻）。
 */
import { computed, ref, watch } from 'vue'
import { subPage, openSubPage, setSubPageLabel } from './store'
import { timeAgo, errMsg, shortId } from './live'
import { statusText, statusBadge } from './opsShared'
import { adminLearningContentApi } from '@/api/adminApi'
import MkDetailHero from '@/components/mk/MkDetailHero.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkSkeleton from '@/components/mk/MkSkeleton.vue'
import { askConfirm, doneConfirm, failConfirm } from './useConfirm'
import { useOverlay, useMaskClose } from './useOverlay'
import { useEscape } from './useEscape'
import { toast } from '@/utils/toast'

/* 契约与 OpsContent 抽屉同源（详情接口返回 prisma 原行：用户关系字段名是 users，
   列表接口才映射成 user——两种形状都读，防止上游改名时静默空）。 */
interface PathSubtask {
  id: string
  title: string
  status: string
  taskType: string
  estimatedMinutes: number
  completedAt?: string | null
  cognitiveLoad?: string | null
}
interface PathMilestone {
  id: string
  stageNumber: number
  title: string
  status: string
  estimatedHours?: number | null
  description?: string | null
  /** 阶段目标（schema.goal；后端详情 include 原样带回） */
  goal?: string | null
  /** 阶段核心概念名（schema.coreConceptName） */
  coreConceptName?: string | null
  subtasks: PathSubtask[]
}
interface PathLearner { id?: string; name?: string; email?: string; isVirtualLearner?: boolean }
interface PathDetailData {
  title: string
  subject?: string | null
  description?: string | null
  status: string
  difficulty?: string | null
  estimatedHours?: number | null
  totalMilestones?: number
  completedMilestones?: number
  updatedAt?: string | null
  users?: PathLearner | null
  user?: PathLearner | null
  milestones: PathMilestone[]
}

const d = ref<PathDetailData | null>(null)
const loading = ref(false)
const loadError = ref('')
const busy = ref(false)
/* 初值 null：真实展开项由 load() 按数据派生（审核 #80），骨架期本就无阶段可展开 */
const openStage = ref<number | null>(null)

const pathId = computed(() => subPage.value?.id || '')
/* subtasks 兜底成数组：阶段/任务计数与模板都直接读 .length，缺列时页面不应炸 */
const stages = computed<PathMilestone[]>(() =>
  (d.value?.milestones ?? []).map((m) => ({ ...m, subtasks: Array.isArray(m.subtasks) ? m.subtasks : [] }))
)
const learner = computed<PathLearner | null>(() => d.value?.users || d.value?.user || null)

/* 任务详情弹层状态（声明在 watch 之前：watch 带 immediate，setup 期同步调用 closeTask） */
const taskRef = ref<{ stage: PathMilestone; task: PathSubtask } | null>(null)
const maskRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
function closeTask() {
  taskRef.value = null
}

/* 加载序号：刷新/换路径时旧响应丢弃（判例 UserDetail last-wins 守卫） */
let loadSeq = 0

/** 手风琴默认展开的「当前阶段」索引（2026-10-06 审核 #80）：
 *  第一个有未完成任务的阶段 → 全部任务都完成回落最后一个阶段 → 无任何任务数据回落首阶段；
 *  无阶段返回 null。按 subtasks 实数据派生（与阶段/任务统计同口径，不依赖行上反规范化状态），
 *  subtasks 兜底成数组与 stages computed 同防御。 */
function defaultOpenStage(list: PathMilestone[]): number | null {
  if (!list.length) return null
  const subs = (m: PathMilestone) => (Array.isArray(m.subtasks) ? m.subtasks : [])
  const pending = list.findIndex((m) => subs(m).some((t) => t.status !== 'completed'))
  if (pending >= 0) return pending
  return list.some((m) => subs(m).length) ? list.length - 1 : 0
}

async function load(force = false) {
  const pid = pathId.value
  if (!pid) return
  if (loading.value && !force) return
  const seq = ++loadSeq
  loading.value = true
  if (!d.value) loadError.value = ''
  try {
    const res = await adminLearningContentApi.getPathDetail(pid)
    if (seq !== loadSeq || pathId.value !== pid) return
    const body = (res.data?.data ?? res.data ?? null) as PathDetailData | null
    if (!body) throw new Error('详情数据为空')
    d.value = body
    loadError.value = ''
    // 面包屑回写路径名（内部 ID → 可读标题）
    if (body.title) setSubPageLabel(String(body.title))
    // 审核 #80：默认展开「当前阶段」（第一个有未完成任务的阶段；全完成回落最后阶段；
    //   无任务数据回落首阶段），单开模型不变、其余阶段收起；换路径重来时同样复位
    openStage.value = defaultOpenStage(body.milestones || [])
  } catch (e) {
    if (seq !== loadSeq || pathId.value !== pid) return
    // 刷新失败时保留旧数据（页面不白屏），首载失败走错误态
    if (!d.value) loadError.value = `暂时无法获取该路径的完整信息：${errMsg(e)}`
    else toast.error(`刷新失败：${errMsg(e)}`)
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

watch(
  pathId,
  (pid) => {
    loadSeq += 1
    d.value = null
    loadError.value = ''
    openStage.value = null
    closeTask()
    if (pid) void load()
  },
  { immediate: true }
)

/* ===== 阶段/任务统计（全部由真实 milestones/subtasks 派生，不用行上反规范化计数） =====
   2026-10-06 审核 #79：原 stageTotal 在 milestones 为空时回退读 learning_paths.totalMilestones，
   于是「尚未拆解出阶段」的空态页会同时出现「0 / 3 阶段完成」（反规范化旧值）——
   阶段总数一律取实际 milestones 长度，不用行上计数，口径与空态结论一致。 */
const stageDone = computed(() => stages.value.filter((m) => m.status === 'completed').length)
const stageTotal = computed(() => stages.value.length)
const overallPct = computed(() =>
  stageTotal.value ? Math.round((stageDone.value / stageTotal.value) * 100) : 0
)
const taskTotals = computed(() => {
  let done = 0
  let total = 0
  for (const m of stages.value) {
    total += m.subtasks.length
    done += m.subtasks.filter((t) => t.status === 'completed').length
  }
  return { done, total }
})
const doneTasks = (m: PathMilestone) => m.subtasks.filter((t) => t.status === 'completed').length

/** 当前阶段（原型 hero「当前：阶段名」）：优先进行中，其次第一个未完成，全完成给明确结论 */
const currentStageLabel = computed(() => {
  const list = stages.value
  if (!list.length) return ''
  const active = list.find((m) => m.status === 'in_progress')
  if (active) return active.title
  const pending = list.find((m) => m.status !== 'completed')
  if (pending) return pending.title
  return '全部阶段已完成'
})
const currentStageHint = computed(() =>
  currentStageLabel.value === '全部阶段已完成'
    ? '所有阶段均已完成'
    : `当前阶段按里程碑状态派生：优先「进行中」，否则第一个未完成阶段`
)

/* ===== hero 副文（原型：「学习者 X · N / M 阶段完成 · 最近更新 …」） ===== */
const heroSub = computed(() => {
  const v = d.value
  if (!v) return ''
  const who = learner.value?.name || '—'
  return `学习者 ${who} · ${stageDone.value} / ${stageTotal.value} 阶段完成 · 最近更新 ${v.updatedAt ? timeAgo(v.updatedAt) : '—'}`
})

/** 状态条：四个真实读数（阶段/任务/预计时长/最近更新） */
/* ===== 状态映射（与列表页 opsShared 同一套；子任务/里程碑为详情域映射） ===== */
const milestoneText = (s: string) => ({ completed: '已完成', in_progress: '进行中', locked: '未解锁' }[s] || s)
const milestoneBadge = (s: string) =>
  s === 'completed' ? 'mk-badge--ok' : s === 'in_progress' ? 'mk-badge--info' : 'mk-badge--muted'
const taskText = (s: string) => ({ completed: '已完成', in_progress: '进行中', todo: '未开始' }[s] || s)
const taskBadge = (s: string) =>
  s === 'completed' ? 'mk-badge--ok' : s === 'in_progress' ? 'mk-badge--info' : 'mk-badge--muted'
const taskTypeText = (t: string) => ({ practice: '练习', acquire: '习得', reflection: '反思', assessment: '评估' }[t] || t)
const cognitiveText = (c?: string | null) => ({ low: '低', medium: '中', high: '高' }[String(c || '')] || String(c || ''))
/** taskrow 副行：真实字段（任务类型 · 预计用时）；原型的「验收点」接口未返回，不硬造 */
const taskSub = (t: PathSubtask) => `${taskTypeText(t.taskType)} · ${t.estimatedMinutes} 分钟`

function toggleStage(i: number) {
  openStage.value = openStage.value === i ? null : i
}

/* ===== 任务详情弹层（原型 openTaskDetail；开合行为四件套：Esc/遮罩/焦点陷阱/滚动锁） ===== */
useOverlay(computed(() => !!taskRef.value), panelRef)
useMaskClose(maskRef, () => closeTask())
useEscape(() => !!taskRef.value, () => closeTask())

function openTask(stage: PathMilestone, task: PathSubtask) {
  taskRef.value = { stage, task }
}

/* ===== 治理动作（沿用已退役抽屉 foot 的真实能力：下线 / 恢复） ===== */
async function toggleArchive() {
  const v = d.value
  if (!v || busy.value || !pathId.value) return
  const archiving = v.status !== 'archived'
  const ok = await askConfirm({
    title: archiving ? '下线路径' : '恢复路径',
    message: archiving
      ? `确认下线「${v.title}」？\n用户端将无法继续学习该路径。`
      : restoreMessage(v.status, v.title),
    confirmText: archiving ? '下线' : '恢复',
    danger: archiving,
    /* 破坏性动作（下线）接 busy 模式（全站约定，判例 OpsContent.vue:450-467）：确认后按钮转
       「处理中…」，成功 doneConfirm() 关闭、失败 failConfirm() 关闭，与飞行中的请求对齐；
       恢复是非破坏性动作，保持普通模式（2026-10-06 审核 #53） */
    busy: archiving
  })
  if (!ok) return
  busy.value = true
  try {
    if (archiving) await adminLearningContentApi.archivePath(pathId.value)
    else await adminLearningContentApi.restorePath(pathId.value)
    /* 恢复态按真实返回值刷新：completed/failed 路径恢复后后端恒置 active，
       前端不得乐观写死（否则完成/失败态被静默抹掉，2026-10-06 审核 #55） */
    await load(true)
    toast.success(archiving ? '路径已下线' : '路径已恢复')
    if (archiving) doneConfirm()
  } catch (e) {
    toast.error(`${archiving ? '下线' : '恢复'}失败：${errMsg(e)}`)
    if (archiving) failConfirm()
  } finally {
    busy.value = false
  }
}

/** 恢复确认文案按当前状态分支：已完成/失败路径被恢复后状态会改写，
 *  固定文案「恢复后用户端立即可见并继续学习该路径」在这两态上不成立（2026-10-06 审核 #55） */
function restoreMessage(status: string, title: string): string {
  if (status === 'completed') return `确认恢复「${title}」？\n恢复后路径重新开放，已有完成记录保留。`
  if (status === 'failed') return `确认恢复「${title}」？\n恢复后该路径重新进入学习中，可继续推进未完成阶段。`
  return `确认恢复「${title}」？恢复后用户端立即可见并继续学习该路径。`
}

/** 路径 → 所属学习者画像（显式下钻，带 includeTest 以覆盖虚拟/测试账号） */
function goLearner() {
  const uid = learner.value?.id
  if (uid) openSubPage('learner', uid, { includeTest: true })
}
</script>

<style scoped>
.pd { gap: 16px; }
/* 骨架版式（形状）走 MkSkeleton；本类只管外层堆叠 */
.pd-skel { display: grid; gap: 14px; padding-top: 8px; }

/* 总体进度卡（原型 meterrow + height:8px meter；右侧 = 任务完成数 + 百分比） */
.pd-progress { padding: 12px 16px; display: grid; gap: 6px; }
.pd-meterrow { display: flex; align-items: center; gap: 8px; }
.pd-meterrow__label { color: var(--mk-muted); font-size: var(--mk-fs-micro); }
.pd-meterrow__right { margin-left: auto; display: flex; align-items: baseline; gap: 12px; }
.pd-meterrow__tasks { color: var(--mk-faint); font-size: var(--mk-fs-micro); font-family: var(--mk-mono); }
.pd-meterrow__num { color: var(--mk-muted); font-size: var(--mk-fs-micro); }
.pd-meter { height: 8px; }

/* stagecard 手风琴（原型 .stagecard：整卡描边、头浅底、体下沉任务行） */
.pd-stack { display: grid; gap: 12px; }
.pd-stage {
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-xl);
  overflow: hidden;
  background: var(--mk-surface);
}
.pd-stage__head {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 12px 16px;
  border: 0;
  background: var(--mk-surface-2);
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.pd-stage__n {
  width: 22px; height: 22px; border-radius: 50%;
  display: grid; place-items: center; flex: none;
  font-size: var(--mk-fs-micro); font-weight: 700;
  background: var(--mk-blue); color: var(--mk-on-fill, #ffffff);
}
.pd-stage--idle .pd-stage__n { background: var(--mk-surface-3); color: var(--mk-muted); }
/* 阶段头悬停反馈（2026-10-06 审核 #78）：整行可点却零 hover，而同页任务行有 hover 描边——
   同屏两个可点元素悬停语言一致（spec §4：悬停只允许变背景/边框/文字色） */
@media (hover: hover) {
  .pd-stage__head:hover { background: var(--mk-surface-3); }
}
.pd-stage__title {
  flex: 1; min-width: 0;
  font-size: var(--mk-fs-body);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pd-stage__meta { color: var(--mk-muted); font-size: var(--mk-fs-micro); white-space: nowrap; }
.pd-stage__caret { color: var(--mk-faint); flex: none; width: 12px; text-align: center; }
.pd-stage__body {
  display: grid; gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--mk-line);
}
/* 阶段内容层（#54）：描述/目标/核心概念/预计学时；与任务行同栏，底部分隔开 */
.pd-stage__brief { display: grid; gap: 6px; padding-bottom: 8px; border-bottom: 1px solid var(--mk-line); }
.pd-stage__desc { margin: 0; color: var(--mk-muted); font-size: var(--mk-fs-body); }
.pd-stage__goal { margin: 0; color: var(--mk-ink); font-size: var(--mk-fs-body); }
.pd-stage__brief-label { margin-right: 6px; color: var(--mk-faint); font-size: var(--mk-fs-micro); font-weight: 600; }
.pd-stage__brief-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.pd-stage__hours { color: var(--mk-faint); font-size: var(--mk-fs-micro); font-family: var(--mk-mono); }

/* taskrow（原型 .taskrow：✓ 框 + 任务名/副行 + 状态 pill；--done/--active 修饰） */
.pd-task {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-sm);
  background: var(--mk-surface);
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
@media (hover: hover) {
  .pd-task:hover { border-color: color-mix(in srgb, var(--mk-blue) 34%, var(--mk-line)); }
}
.pd-task__box {
  width: 18px; height: 18px; flex: none; margin-top: 1px;
  border: 2px solid var(--mk-line);
  border-radius: var(--mk-radius-xs);
  display: grid; place-items: center;
  font-size: var(--mk-fs-micro); color: transparent;
}
.pd-task--done .pd-task__box { background: var(--mk-green); border-color: var(--mk-green); color: var(--mk-on-fill, #ffffff); }
.pd-task--active .pd-task__box { border-color: var(--mk-blue); }
.pd-task__main { display: grid; gap: 2px; flex: 1; min-width: 0; }
.pd-task__title { font-size: var(--mk-fs-body); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pd-task__sub { color: var(--mk-muted); font-size: var(--mk-fs-micro); }
/* .pd-none 私有样式已删（2026-10-06 审核 #76）：阶段内空态改用共享 .mk-empty--line
   （字号/色阶/内衬由原语统一）；.pd-none 仅作单测钩子保留在模板上，不再自持样式。 */

/* 任务详情弹层（原型 .ovl__ 三段式内容物；外壳走共享 .mk-modal 原语） */
.pd-tk__head { display: flex; align-items: center; gap: 10px; min-width: 0; }
.pd-tk__num {
  width: 24px; height: 24px; border-radius: 999px; flex: none;
  display: grid; place-items: center;
  font-size: var(--mk-fs-micro); font-weight: 700;
  background: var(--mk-blue); color: var(--mk-on-fill, #ffffff);
}
.pd-tk__meta { display: grid; gap: 2px; min-width: 0; }
.pd-tk__sub { color: var(--mk-muted); font-size: var(--mk-fs-micro); }
.pd-tk__row { display: flex; align-items: center; gap: 8px; }
.pd-tk__grow { flex: 1; }
.pd-tk__note { color: var(--mk-faint); font-size: var(--mk-fs-micro); }

/* ===== 大屏/4K 适配（全站 mk 体系档位：≥2000px 字号放大；zoom 档 ≥2800px→1.15、≥3600px→1.3） ===== */
@media (min-width: 2000px) {
  .pd-stage__title { font-size: var(--mk-fs-emphasis); }
  .pd-task__title { font-size: var(--mk-fs-emphasis); }
  .pd-task__sub { font-size: var(--mk-fs-body); }
}
@media (min-width: 2800px) {
  .pd-stage__title { font-size: var(--mk-fs-emphasis); }
  .pd-task__title { font-size: var(--mk-fs-emphasis); }
  .pd-task__sub { font-size: var(--mk-fs-body); }
}
@media (min-width: 3600px) {
  .pd-stage__title { font-size: var(--mk-fs-emphasis); }
  .pd-task__title { font-size: var(--mk-fs-emphasis); }
  .pd-task__sub { font-size: var(--mk-fs-emphasis); }
}
</style>
