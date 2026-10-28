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
    <MkEmptyState
      v-else
      icon="◌"
      title="该路径没有关联的目标对话"
      action-text="返回列表"
      @action="closeSubPage"
    >
      <button type="button" class="mk-link pdx-alt" @click="goGoalConversations">去目标对话</button>
    </MkEmptyState>
  </div>
</template>

<script setup lang="ts">
/** 历史口径备查（原 PathDetail 详情页，2026-10-01 newui 原型落点）：
 *  - 「重规划」按钮原型有而管理侧无任何可达能力，按「宁缺勿假」未搬（2026-10-01 核查）；
 *  - 「导出」是原型假按钮，未搬。
 *  内容体（阶段全展开/任务弹层/重试生成/下线恢复）现居 PathJourneyPanel.vue。 */
import { getCurrentInstance, onMounted, ref } from 'vue'
import { subPage, openSubPage, closeSubPage } from './store'
import { errMsg } from './live'
import { adminLearningContentApi } from '@/api/adminApi'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'

const state = ref<'resolving' | 'error' | 'orphan'>('resolving')
const errorMsg = ref('')
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
    const body = (res.data?.data ?? res.data ?? null) as { conversationId?: string | null } | null
    if (!body) throw new Error('详情数据为空')
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
</style>
