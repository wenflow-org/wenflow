<template>
  <!-- ===== 路径深链适配层（2026-10-12 拍板） =====
       路径不再有独立详情页：路径内容长在会话座舱（?view=session-real）的 Path 阶段页签里
       （PathJourneyPanel）。本组件只负责把「只有路径 id」的入口解析成「目标对话 id + 落点
       Path 页签」，就地换开座舱：
         ?view=path&id=lp_x  →  ?view=session-real&id=gc_x&stage=path
       反查走详情接口的 conversationId（goal_conversations.learningPathId 最新一条）。
       解析失败（无关联对话/接口失败）给明确空态，不静默、不假开。 -->
  <div class="mk-page pdx">
    <MkEmptyState
      v-if="state === 'resolving'"
      icon="◌"
      title="正在打开该路径所在的学习会话…"
    />
    <MkEmptyState
      v-else-if="state === 'error'"
      icon="◌"
      tone="error"
      title="路径打开失败"
      :description="errorMsg"
      action-text="重试"
      @action="resolve"
    />
    <!-- 无关联对话的路径（学习端直接生成的那种）：空态照旧，但**不能只剩一个裸 id**——
         2026-11-01 外部评审 P1：运营进来只看到「学习路径 / lp_1793…」+ 一句空态，
         无法确认这是谁的哪条路径、是否还在生成。路径基础信息接口已经带回来了，直接摆出来。 -->
    <section v-else class="mk-card pdx-orphan">
      <div class="mk-card__head">
        <h3 class="mk-card__title">{{ pathInfo?.title || '未命名路径' }}</h3>
        <span class="mk-card__meta">{{ pathInfo?.subject || '—' }}</span>
      </div>
      <MkRowList>
        <MkRow title="所属用户" :time="pathInfo?.userLabel || '—'" />
        <MkRow title="路径状态" :time="pathStatusText" />
        <MkRow title="里程碑 / 任务" :time="`${pathInfo?.milestones ?? 0} 个 · ${pathInfo?.tasks ?? 0} 条`" />
        <!-- 2026-11-01 外部评审 P2：原先把 lp_… 裸 ID 平铺在正文行里、且无一键复制。
             内部分诊不靠读 ID，改成次级信息：短式展示 + 悬停看全 + 复制按钮。 -->
        <MkRow title="路径 ID">
          <template #trail>
            <span class="pdx-id" :title="pathId">{{ shortPathId }}</span>
            <button type="button" class="mk-link pdx-copy" :aria-label="`复制路径 ID`" @click="copyPathId">复制</button>
          </template>
        </MkRow>
      </MkRowList>
      <!-- 2026-11-02 文案清理：删第二句「路径内容仍可在学习者详情里查看。」——纯指路（去另一个
           页面看），本卡下方已有「返回列表」「去目标对话」两个出口；只留状态事实一句。 -->
      <div class="pdx-orphan__note">
        该路径没有关联的目标对话，因此没有可跳转的学习会话座舱。
      </div>
      <div class="pdx-orphan__acts">
        <button type="button" class="mk-btn mk-btn--primary" @click="closeSubPage">返回列表</button>
        <button type="button" class="mk-link pdx-alt" @click="goGoalConversations">去目标对话</button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
/** 历史口径备查（原 PathDetail 详情页，2026-10-01 newui 原型落点）：
 *  - 「重规划」按钮原型有而管理侧无任何可达能力，按「宁缺勿假」未搬（2026-10-01 核查）；
 *  - 「导出」是原型假按钮，未搬。
 *  内容体（阶段全展开/任务弹层/重试生成/下线恢复）现居 PathJourneyPanel.vue。 */
import { computed, getCurrentInstance, onMounted, ref } from 'vue'
import { subPage, openSubPage, closeSubPage, setSubPageLabel } from './store'
import { errMsg } from './live'
import { adminLearningContentApi } from '@/api/adminApi'
import { copyText } from './clipboard'
import { toast } from '@/utils/toast'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkRowList from '@/components/mk/MkRowList.vue'
import MkRow from '@/components/mk/MkRow.vue'

type PathInfo = { title: string; subject: string; userLabel: string; milestones: number; tasks: number; status: string }

const state = ref<'resolving' | 'error' | 'orphan'>('resolving')
const errorMsg = ref('')
const pathInfo = ref<PathInfo | null>(null)
const pathId = computed(() => subPage.value?.id || '')
/** 路径 ID 的短式展示：保留可辨认的头尾，中间省略（完整值在 title 与「复制」里） */
const shortPathId = computed(() => {
  const id = pathId.value
  return id.length > 18 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id || '—'
})
async function copyPathId() {
  const ok = await copyText(pathId.value)
  ok ? toast.success('路径 ID 已复制') : toast.error('复制失败，请手动选中复制')
}
const PATH_STATUS_TEXT: Record<string, string> = {
  active: '学习中', generating: '生成中', failed: '生成失败', archived: '已下线', completed: '已完成',
}
const pathStatusText = computed(() => PATH_STATUS_TEXT[pathInfo.value?.status || ''] || pathInfo.value?.status || '—')
/* 无 Router 上下文（单测直挂）时不注入，避免 useRouter 打警告 */
const router = getCurrentInstance()?.appContext.config.globalProperties.$router as
  | { push: (to: string) => Promise<unknown> }
  | undefined

/** 孤儿路径的第二个出口：回链路起点（目标对话）重新确认这条学习目标 */
function goGoalConversations() {
  if (router) void router.push('/admin/goal-conversations')
}

async function resolve() {
  const pid = subPage.value?.id || ''
  if (!pid) return
  state.value = 'resolving'
  errorMsg.value = ''
  try {
    const res = await adminLearningContentApi.getPathDetail(pid)
    const body = (res.data?.data ?? res.data ?? null) as
      | {
          conversationId?: string | null
          title?: string
          name?: string
          subject?: string
          status?: string
          totalMilestones?: number
          /* 详情接口不带 totalTasks：任务数分散在各里程碑的 tasks/subtasks 里 */
          milestones?: Array<{ tasks?: unknown[]; subtasks?: unknown[] }>
          /* 归属用户走 users 关系字段（详情接口没有 user / userName） */
          users?: { name?: string | null; email?: string | null } | null
        }
      | null
    if (!body) throw new Error('详情数据为空')
    const title = String(body.title || body.name || '').trim()
    pathInfo.value = {
      title,
      subject: String(body.subject || ''),
      userLabel: String(body.users?.name || body.users?.email || ''),
      milestones: Number(body.totalMilestones || body.milestones?.length || 0),
      tasks: (body.milestones || []).reduce((n, m) => n + ((m.tasks || m.subtasks || []).length), 0),
      status: String(body.status || ''),
    }
    /* 面包屑：深链进来时 label 就是那个裸 id，解析出真名后就地替换（与座舱同一手法） */
    if (title && subPage.value?.id === pid && (!subPage.value.label || subPage.value.label === pid)) {
      setSubPageLabel(title)
    }
    const conversationId = typeof body.conversationId === 'string' ? body.conversationId : ''
    if (!conversationId) {
      state.value = 'orphan'
      return
    }
    // 带上来源记忆与落点页签，就地换成座舱（id 变化触发 URL 同步与座舱重挂载）
    openSubPage('session-real', conversationId, {
      stage: 'path',
      from: subPage.value?.from,
    })
  } catch (e) {
    state.value = 'error'
    errorMsg.value = errMsg(e)
  }
}

onMounted(() => { void resolve() })
</script>

<style scoped>
.pdx { align-content: start; }
/* 空态里的第二出口：主按钮已是「返回列表」，这条是并列的文字出口 */
.pdx-alt { margin-top: 2px; }
.pdx-orphan__note { padding: 12px 16px 0; color: var(--mk-muted); font-size: 12.5px; }
.pdx-orphan__acts { display: flex; align-items: center; gap: 12px; padding: 12px 16px 16px; }
/* 路径 ID 次级信息区（2026-11-01 外部评审 P2）：等宽 + 弱色，避免与业务字段抢视线 */
.pdx-id { font-family: var(--mk-mono); color: var(--mk-muted); }
.pdx-copy { margin-left: 8px; }
</style>
