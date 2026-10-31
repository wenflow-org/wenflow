<template>
  <!-- ===== 路径深链适配层（2026-10-12 拍板） =====
       路径不再有独立详情页：路径内容长在会话座舱（?view=session-real）的 Path 阶段页签里
       （PathJourneyPanel）。本组件只负责把「只有路径 id」的入口解析成「目标对话 id + 落点
       Path 页签」，就地换开座舱：
         ?view=path&id=lp_x  →  ?view=session-real&id=gc_x&stage=path
       反查走详情接口的 conversationId（goal_conversations.learningPathId 最新一条）。
       孤儿路径（conversationId=null，M-2，2026-10-29 夜审）不再落死空态：路径自身内容
       （阶段/任务）照常渲染，页头注明未关联对话的事实；面包屑由 PathJourneyPanel 回写路径名。 -->
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
    <template v-else>
      <header class="pdx-head">
        <div class="pdx-head__main">
          <div class="pdx-head__row">
            <h2 class="pdx-head__title" :title="orphanTitle">{{ orphanTitle || '未命名路径' }}</h2>
            <span v-if="orphanStatus" class="mk-badge" :class="statusBadge(orphanStatus)">{{ statusText(orphanStatus) }}</span>
          </div>
          <p class="pdx-head__note">该路径未关联目标对话（可能由快速生成创建）。以下为路径内容：阶段与任务。</p>
        </div>
        <!-- 治理动作（下线/恢复、重试生成）由 PathJourneyPanel 传送到这里（与座舱同款落点） -->
        <span class="pdx-head__acts" data-path-acts></span>
      </header>
      <div class="mk-card pdx-card">
        <div class="pdx-cardbody">
          <PathJourneyPanel :path-id="pathId" />
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
/** 历史口径备查（原 PathDetail 详情页，2026-10-01 newui 原型落点）：
 *  - 「重规划」按钮原型有而管理侧无任何可达能力，按「宁缺勿假」未搬（2026-10-01 核查）；
 *  - 「导出」是原型假按钮，未搬。
 *  内容体（阶段全展开/任务弹层/重试生成/下线恢复）现居 PathJourneyPanel.vue。 */
import { computed, onMounted, ref } from 'vue'
import { subPage, openSubPage, setSubPageLabel } from './store'
import { errMsg } from './live'
import { adminLearningContentApi } from '@/api/adminApi'
import { statusText, statusBadge } from './opsShared'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import PathJourneyPanel from './PathJourneyPanel.vue'

const state = ref<'resolving' | 'error' | 'orphan'>('resolving')
const errorMsg = ref('')
/** 孤儿路径的页头元信息（resolve 已抓到的详情行；内容体由 PathJourneyPanel 自取） */
const orphanTitle = ref('')
const orphanStatus = ref('')
const pathId = computed(() => subPage.value?.id || '')

async function resolve() {
  const pid = subPage.value?.id || ''
  if (!pid) return
  state.value = 'resolving'
  errorMsg.value = ''
  try {
    const res = await adminLearningContentApi.getPathDetail(pid)
    const body = (res.data?.data ?? res.data ?? null) as { conversationId?: string | null; title?: string | null; status?: string | null } | null
    if (!body) throw new Error('详情数据为空')
    const conversationId = typeof body.conversationId === 'string' ? body.conversationId : ''
    if (!conversationId) {
      // 孤儿路径：就地渲染路径自身内容（M-2），面包屑先回写真名（面板加载完成前不露裸 id）
      orphanTitle.value = String(body.title || '')
      orphanStatus.value = String(body.status || '')
      if (orphanTitle.value && subPage.value && !subPage.value.label) setSubPageLabel(orphanTitle.value)
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
/* 孤儿路径页头：标题 + 状态徽章 + 一句事实说明，右缘留治理动作传送落点 */
.pdx-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.pdx-head__main { min-width: 0; }
.pdx-head__row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.pdx-head__title {
  margin: 0;
  font-size: var(--mk-fs-emphasis);
  color: var(--mk-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.pdx-head__note { margin: 4px 0 0; font-size: var(--mk-fs-micro); color: var(--mk-muted); line-height: 1.5; }
.pdx-head__acts { flex: none; }
/* 内容卡与页头留一档呼吸（座舱里同面板包在 mk-card 的 cp-cardbody 内） */
.pdx-cardbody { padding: 16px; }
</style>
