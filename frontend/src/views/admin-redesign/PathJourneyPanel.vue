<template>
  <!-- ===== 路径内容面板（嵌在会话座舱 Path 页签内） =====
       2026-10-12 用户拍板：路径不再有独立详情页（?view=path 退役为深链适配层），
       路径内容统一长在座舱的阶段页签里。本组件 = 原 PathDetail.vue 的内容体
       （阶段全展开的分区 + 任务弹层 + 治理动作），去 hero / 学习者下钻（座舱本身就是
       该学习者的上下文）；「总体进度」「技术细节」随拍板一并撤（同日走查），
       类名沿用 pd- 域。 -->
  <div class="pjp">
    <!-- 首载失败：错误态 + 重试（MkEmptyState tone=error，判例 UserDetail） -->
    <MkEmptyState
      v-if="loadError && !d"
      icon="◌"
      tone="error"
      title="路径内容加载失败"
      :description="loadError"
      action-text="重试"
      @action="load(true)"
    />
    <div v-else-if="!d" class="pd-skel" aria-hidden="true">
      <MkSkeleton variant="cards" :count="1" :h="56" :cols="1" :radius="12" />
      <MkSkeleton variant="cards" :count="4" :h="64" :cols="1" :radius="12" />
    </div>
    <template v-else>
      <!-- 治理动作（2026-10-22 用户「下线路径属于比较危险操作？这个位置也不合适」）：
           下线/恢复、重试生成都是低频且带后果的动作，收进右缘 ⋯ 菜单，不在内容区平铺；
           刷新钮撤销——顶栏刷新已覆盖本面板（watch liveRefreshSeq），同屏不再出第二颗。 -->
      <div class="pjp-acts">
        <span v-if="d.status !== 'active'" class="mk-badge" :class="statusBadge(d.status)">{{ statusText(d.status) }}</span>
        <div class="mk-menu">
          <button
            type="button"
            class="mk-menu__btn"
            aria-label="路径操作"
            aria-haspopup="menu"
            :aria-expanded="menuOpen"
            :disabled="busy"
            @click="menuOpen = !menuOpen"
          >⋯</button>
          <div v-if="menuOpen" class="pjp-menu__scrim" @click="menuOpen = false"></div>
          <div v-if="menuOpen" class="mk-menu__pop" role="menu" aria-label="路径操作" @click.stop>
            <button
              v-if="canRetry"
              type="button"
              class="mk-menu__item"
              role="menuitem"
              :title="retryTitle"
              :disabled="busy"
              @click="menuOpen = false; retryGeneration()"
            >重试生成</button>
            <button
              type="button"
              class="mk-menu__item"
              :class="{ 'mk-menu__item--danger': d.status !== 'archived' }"
              role="menuitem"
              :disabled="busy"
              @click="menuOpen = false; toggleArchive()"
            >{{ d.status === 'archived' ? '恢复路径' : '下线路径' }}</button>
          </div>
        </div>
      </div>

      <!-- 阶段全展开（2026-10-18 用户走查：后台运营要「一眼看到信息」，不接受点开一个就把
           别的阶段收起）。原单开手风琴退役：阶段头只作分区标题、不再可点；所有阶段的说明与
           任务行始终渲染，长度由分区层级承担（可折叠的只有任务详情弹层，那层是补充信息）。
           2026-10-12 用户拍板撤「总体进度」与「技术细节」两块：各阶段头自带「N / M 任务」，
           总进度 % 与双分母口径注释是重复噪音；工程标识（路径 id / 生成运行 id）不进运营页面。 -->
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
          :class="{ 'pd-stage--idle': m.status !== 'active' && m.status !== 'completed' }"
        >
          <div class="pd-stage__head">
            <span class="pd-stage__n" aria-hidden="true">{{ m.stageNumber || i + 1 }}</span>
            <strong class="pd-stage__title" :title="m.title">{{ m.title }}</strong>
            <span class="pd-stage__meta">{{ doneTasks(m) }} / {{ m.subtasks.length }} 任务</span>
            <span class="mk-badge" :class="milestoneBadge(m.status)">{{ milestoneText(m.status) }}</span>
          </div>
          <div class="pd-stage__body">
            <!-- 阶段内容层（2026-10-06 审核 #54）：描述/目标/核心概念/预计学时，无值不渲染、不硬造 -->
            <div v-if="m.description || m.goal || m.coreConceptName || m.estimatedHours" class="pd-stage__brief">
              <p v-if="m.description" class="pd-stage__desc">{{ m.description }}</p>
              <p v-if="m.goal" class="pd-stage__goal"><span class="pd-stage__brief-label">目标</span>{{ m.goal }}</p>
              <div class="pd-stage__brief-meta">
                <span v-if="m.coreConceptName" class="mk-badge mk-badge--muted" title="该阶段的核心概念">核心概念：{{ m.coreConceptName }}</span>
                <span v-if="m.estimatedHours" class="pd-stage__hours" title="预计时长为估算值">预计 ~{{ m.estimatedHours }}h</span>
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
                <span class="pd-task__sub" :title="taskSubTitle(t)">{{ taskSub(t) }}</span>
              </span>
              <span class="mk-badge" :class="taskBadge(t.status)">{{ taskText(t.status) }}</span>
            </button>
            <!-- .pd-none 仅作既有单测钩子保留（样式由共享 .mk-empty--line 承担，审核 #76） -->
            <p v-if="!m.subtasks.length" class="mk-empty mk-empty--line pd-none">该阶段暂无任务</p>
          </div>
        </section>
      </div>
    </template>

    <!-- 任务详情弹层（原型 openTaskDetail 三段式；验收点等原型字段后端未返回，不硬造） -->
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
              <div><span>任务类型</span><strong :title="taskSubTitle(taskRef.task)">{{ taskTypeText(taskRef.task.taskType) }}</strong></div>
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
</template>

<script setup lang="ts">
/**
 * 路径内容面板（会话座舱 Path 页签的内容体，2026-10-12 自 PathDetail.vue 移植）。
 * 数据口径不变：全部来自 adminLearningContentApi.getPathDetail 的真实字段，
 * 原型有而接口没有的字段（验收点/关联产出/学习证据）不渲染，绝不硬造。
 * 动作口径：重试生成（只服务 failed 行，守卫自动判 core/stageDesign）、
 * 下线/恢复（恢复文案按状态分支，2026-10-06 审核 #55）。治理动作收在右缘 ⋯ 菜单；
 * 刷新跟顶栏（watch liveRefreshSeq），本面板不再出第二颗刷新。
 * 成功后 emit('changed') 让宿主（座舱）重拉路径状态，页签 meta 与 stepper 不留旧值。
 */
import { computed, ref, watch } from 'vue'
import { adminLearningContentApi } from '@/api/adminApi'
import { timeAgo, errMsg, shortId, liveRefreshSeq } from './live'
import { subPage, setSubPageLabel } from './store'
import { statusText, statusBadge, pathRetryTypeText } from './opsShared'
/* 任务类型字典单源（F2-2）：与 TeachingSessions 同源，两页同批枚举不得各译一套 */
import { taskTypeText, taskTypeTitle } from './statusText'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkSkeleton from '@/components/mk/MkSkeleton.vue'
import { askConfirm, doneConfirm, failConfirm } from './useConfirm'
import { useOverlay, useMaskClose } from './useOverlay'
import { useEscape } from './useEscape'
import { toast } from '@/utils/toast'

const props = defineProps<{ pathId: string }>()
const emit = defineEmits<{ (e: 'changed'): void }>()

/* 契约与 PathDetail 时代一致（详情接口返回 prisma 原行） */
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
  goal?: string | null
  coreConceptName?: string | null
  subtasks: PathSubtask[]
}
interface PathDetailData {
  title: string
  status: string
  updatedAt?: string | null
  /** 真墙钟「最近活动」（后端派生；updatedAt 会被虚拟学习者的模拟钟写成未来日期） */
  lastActivityAt?: string | null
  milestones: PathMilestone[]
  activeGenerationRunId?: string | null
}

const d = ref<PathDetailData | null>(null)
const loading = ref(false)
const loadError = ref('')
const busy = ref(false)

/* subtasks 兜底成数组：阶段/任务计数与模板都直接读 .length，缺列时面板不应炸 */
const stages = computed<PathMilestone[]>(() =>
  (d.value?.milestones ?? []).map((m) => ({ ...m, subtasks: Array.isArray(m.subtasks) ? m.subtasks : [] }))
)

/* 任务详情弹层状态（声明在 watch 之前：watch 带 immediate，setup 期同步调用 closeTask） */
const taskRef = ref<{ stage: PathMilestone; task: PathSubtask } | null>(null)
const maskRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
function closeTask() {
  taskRef.value = null
}

/* 加载序号：刷新/换路径时旧响应丢弃（判例 UserDetail last-wins 守卫） */
let loadSeq = 0

/* 面包屑名（2026-10-12）：座舱的 subPage 不再由（已退役的）路径详情页回写可读名，
   深链/列表进来会露裸会话 id。面板持有详情接口的真标题，成功后回写——仅当本面板
   所属座舱仍是当前二级页，且现有名为空或座舱 watch 写入的泛型兜底「学习路径」。 */
const ownerSubPageId = subPage.value?.id || ''
function writeBreadcrumbLabel(title: string) {
  const sp = subPage.value
  if (!title || !sp || sp.id !== ownerSubPageId) return
  if (sp.label && sp.label !== '学习路径') return
  setSubPageLabel(title)
}

async function load(force = false) {
  const pid = props.pathId
  if (!pid) return
  if (loading.value && !force) return
  const seq = ++loadSeq
  loading.value = true
  if (!d.value) loadError.value = ''
  try {
    const res = await adminLearningContentApi.getPathDetail(pid)
    if (seq !== loadSeq || props.pathId !== pid) return
    const body = (res.data?.data ?? res.data ?? null) as PathDetailData | null
    if (!body) throw new Error('详情数据为空')
    d.value = body
    loadError.value = ''
    if (body.title) writeBreadcrumbLabel(String(body.title))
  } catch (e) {
    if (seq !== loadSeq || props.pathId !== pid) return
    /* 刷新失败保留旧数据（面板不白屏），首载失败走错误态 */
    if (!d.value) loadError.value = `暂时无法获取该路径的完整信息：${errMsg(e)}`
    else toast.error(`刷新失败：${errMsg(e)}`)
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

watch(
  () => props.pathId,
  (pid) => {
    loadSeq += 1
    d.value = null
    loadError.value = ''
    closeTask()
    if (pid) void load()
  },
  { immediate: true }
)

/* 顶栏刷新驱动本面板（2026-10-22 用户「刷新应该不需要吧，已经有刷新了」）：
   页面级刷新已由座舱 watch(liveRefreshSeq) 接住，面板不再自带刷新钮，但要跟着同一次刷新生效。 */
watch(liveRefreshSeq, () => {
  if (props.pathId) void load(true)
})

/* 治理菜单（下线/恢复、重试生成）开合：遮罩点击与 Esc 关闭，动作执行后立即收起 */
const menuOpen = ref(false)
useEscape(() => menuOpen.value, () => { menuOpen.value = false })

/* ===== 阶段/任务统计：各阶段头自带「N / M 任务」，总体 % 不再单算（2026-10-12 用户拍板撤） ===== */
const doneTasks = (m: PathMilestone) => m.subtasks.filter((t) => t.status === 'completed').length

/* ===== 状态映射（与列表页 opsShared 同一套；子任务/里程碑为详情域映射） =====
   里程碑状态枚举单源 = 后端 task-completion.service.ts（建路径时 'locked' → 逐级解锁写 'active'
   → 收齐写 'completed'），**没有 'in_progress'**——那是子任务的状态词。此前里程碑映射只认
   in_progress/locked/completed，生产真值 'active' 落不到任何键：阶段头徽章裸出英文
   （statusText 字典明令禁止的漏译），且 .pd-stage--idle 的「非当前且未完成」判定对 active
   也为真 → 当前阶段与未解锁阶段视觉全同、.pd-stage__n 的蓝底高亮永不出现（31/117 条里程碑，
   2026-10-14 浏览器实测）。「进行中」与同列表的任务徽章同词，阶段与任务读到同一个状态词。 */
const milestoneText = (s: string) => ({ completed: '已完成', active: '进行中', locked: '未解锁' }[s] || s)
const milestoneBadge = (s: string) =>
  s === 'completed' ? 'mk-badge--ok' : s === 'active' ? 'mk-badge--info' : 'mk-badge--muted'
const taskText = (s: string) => ({ completed: '已完成', in_progress: '进行中', todo: '未开始' }[s] || s)
const taskBadge = (s: string) =>
  s === 'completed' ? 'mk-badge--ok' : s === 'in_progress' ? 'mk-badge--info' : 'mk-badge--muted'
const cognitiveText = (c?: string | null) => ({ low: '低', medium: '中', high: '高' }[String(c || '')] || String(c || ''))
const taskSub = (t: PathSubtask) => `${taskTypeText(t.taskType)} · ${t.estimatedMinutes} 分钟`
const taskSubTitle = (t: PathSubtask) => taskTypeTitle(t.taskType)

/* ===== 任务详情弹层（开合行为四件套：Esc/遮罩/焦点陷阱/滚动锁） ===== */
useOverlay(computed(() => !!taskRef.value), panelRef)
useMaskClose(maskRef, () => closeTask())
useEscape(() => !!taskRef.value, () => closeTask())

function openTask(stage: PathMilestone, task: PathSubtask) {
  taskRef.value = { stage, task }
}

/* ===== 治理动作（真实能力：下线 / 恢复 / 重试生成；成功后通知宿主刷新路径状态） ===== */
async function toggleArchive() {
  const v = d.value
  if (!v || busy.value || !props.pathId) return
  const archiving = v.status !== 'archived'
  const ok = await askConfirm({
    title: archiving ? '下线路径' : '恢复路径',
    message: archiving
      ? `确认下线「${v.title}」？\n用户端将无法继续学习该路径。`
      : restoreMessage(v.status, v.title),
    confirmText: archiving ? '下线' : '恢复',
    danger: archiving,
    /* 破坏性动作（下线）接 busy 模式（全站约定，判例 OpsContent.vue:450-467） */
    busy: archiving
  })
  if (!ok) return
  busy.value = true
  try {
    if (archiving) await adminLearningContentApi.archivePath(props.pathId)
    else await adminLearningContentApi.restorePath(props.pathId)
    /* 恢复态按真实返回值刷新：completed/failed 路径恢复后后端恒置 active，
       前端不得乐观写死（否则完成/失败态被静默抹掉，2026-10-06 审核 #55） */
    await load(true)
    toast.success(archiving ? '路径已下线' : '路径已恢复')
    emit('changed')
    if (archiving) doneConfirm()
  } catch (e) {
    toast.error(`${archiving ? '下线' : '恢复'}失败：${errMsg(e)}`)
    if (archiving) failConfirm()
  } finally {
    busy.value = false
  }
}

/** 恢复确认文案按当前状态分支（审核 #55：固定文案在 completed/failed 态不成立） */
function restoreMessage(status: string, title: string): string {
  if (status === 'completed') return `确认恢复「${title}」？\n恢复后路径重新开放，已有完成记录保留。`
  if (status === 'failed') return `确认恢复「${title}」？\n恢复后该路径重新进入学习中，可继续推进未完成阶段。`
  return `确认恢复「${title}」？恢复后用户端立即可见并继续学习该路径。`
}

/* ===== 重试生成（只服务 failed 行；与列表页 OpsContent 同口径）=====
   2026-10-22 对齐：原先对「24h 无更新」的 active 路径也开放，但重试只认虚拟会话，
   真实路径点了必 409；停滞信号已在列表页退役，这里同步收窄。 */
const canRetry = computed(() => d.value?.status === 'failed')
const retryTitle = computed(() => '该路径生成失败：系统会自动选择重建路径或补齐课程')
async function retryGeneration() {
  const v = d.value
  if (!v || busy.value || !props.pathId) return
  const ok = await askConfirm({
    title: '重试路径生成',
    message: `确认对「${v.title}」重新发起生成？\n后台异步执行，完成后路径自动更新。`,
    confirmText: '重试',
    danger: false,
    busy: true,
  })
  if (!ok) return
  busy.value = true
  try {
    const res = await adminLearningContentApi.retryGeneration(props.pathId)
    const body = res.data
    if (body?.success && body.data?.success) {
      toast.success(`已提交重试（${pathRetryTypeText(body.data.retryType)}）`)
      doneConfirm()
      await load(true)
      emit('changed')
    } else {
      toast.error(`无法重试：${body?.data?.error || body?.error || '原因未知'}`)
      failConfirm()
    }
  } catch (e) {
    toast.error(`重试失败：${errMsg(e)}`)
    failConfirm()
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.pjp { display: grid; gap: 12px; }
/* 骨架版式（形状）走 MkSkeleton；本类只管外层堆叠 */
.pd-skel { display: grid; gap: 14px; }

/* 动作行（原 hero actions 收敛成一行；弱化不与页签头抢层级） */
.pjp-acts { display: flex; justify-content: flex-end; align-items: center; gap: 8px; flex-wrap: wrap; }
/* 治理菜单遮罩：菜单开着时吃掉「点空白关菜单」的那一下，不落到下层任务行 */
.pjp-menu__scrim { position: fixed; inset: 0; z-index: var(--mk-z-menu); }

/* stagecard（原型 .stagecard：整卡描边、头浅底、体下沉任务行；2026-10-18 起常开不折叠） */
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
}
.pd-stage__n {
  width: 22px; height: 22px; border-radius: 50%;
  display: grid; place-items: center; flex: none;
  font-size: var(--mk-fs-micro); font-weight: 700;
  background: var(--mk-blue); color: var(--mk-on-fill, #ffffff);
}
.pd-stage--idle .pd-stage__n { background: var(--mk-surface-3); color: var(--mk-muted); }
/* 阶段头是分区标题而非可点控件（2026-10-18 全展开）：不给 hover/pointer 反馈，
   避免把运营读「点开会收起别的阶段」 */
.pd-stage__title {
  flex: 1; min-width: 0;
  font-size: var(--mk-fs-body);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.pd-stage__meta { color: var(--mk-muted); font-size: var(--mk-fs-micro); white-space: nowrap; }
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
/* .pd-none 仅作单测钩子保留（样式由共享 .mk-empty--line 承担，审核 #76） */

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
