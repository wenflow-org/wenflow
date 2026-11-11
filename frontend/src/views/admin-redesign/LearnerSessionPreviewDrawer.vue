<template>
  <!-- 课堂只读预览抽屉（2026-11-11 学习者详情评审 P1）：
       行点击不再整页跳到课堂监控，先在本抽屉里看这节课的只读对话记录与单课总结；
       需要完整监控时再由抽屉头部的「展开全屏监控」进入原课堂页。
       数据复用 /admin/session-console/:id（与 SessionCockpit 同一只读端点），打开时才请求。 -->
  <div v-if="open" class="mk-drawer">
    <div ref="maskRef" class="mk-drawer__mask"></div>
    <aside
      ref="panelRef"
      class="mk-drawer__panel ld-sess-drawer"
      role="dialog"
      aria-modal="true"
      :aria-label="dialogLabel"
    >
      <header class="mk-drawer__head">
        <div class="mk-drawer__heading">
          <h3 class="mk-drawer__title" :title="title">{{ title }}</h3>
          <span class="mk-drawer__sub">{{ subText }}</span>
        </div>
        <div class="ld-sess-drawer__actions">
          <button type="button" class="mk-btn mk-btn--sm" @click="emit('expand')">展开全屏监控</button>
          <button type="button" class="mk-drawer__close" aria-label="关闭" @click="emit('close')">✕</button>
        </div>
      </header>

      <div class="mk-drawer__body ld-sess-drawer__body">
        <MkLoading v-if="loading" min text="读取课堂记录…" />
        <MkEmptyState
          v-else-if="error"
          tone="error"
          title="课堂记录读取失败"
          :description="error"
          action-text="重试"
          @action="load"
        />
        <template v-else>
          <section v-if="goalDescription" class="ld-sess-block">
            <h4 class="ld-sess-block__h">学习目标</h4>
            <p class="ld-sess-block__text">{{ goalDescription }}</p>
          </section>

          <section class="ld-sess-block">
            <div class="ld-sess-block__head">
              <h4 class="ld-sess-block__h">单课总结</h4>
              <span v-if="wrapupStatus" class="mk-badge" :class="wrapupStatus === 'complete' ? 'mk-badge--ok' : 'mk-badge--warn'">
                {{ wrapupStatus === 'complete' ? '总结完整' : '降级总结' }}
              </span>
            </div>
            <template v-if="summaryBlocks.length">
              <div v-for="b in summaryBlocks" :key="b.label" class="ld-sess-sum">
                <span class="ld-sess-sum__label">{{ b.label }}</span>
                <p class="ld-sess-sum__text">{{ b.text }}</p>
              </div>
              <ul v-if="takeaways.length" class="ld-sess-takeaways">
                <li v-for="(t, i) in takeaways" :key="i">{{ t }}</li>
              </ul>
            </template>
            <p v-else class="ld-sess-empty">
              {{ '该课堂暂无总结' }}
              <span class="ld-sess-empty__hint">课堂完成并生成课后总结后，这里会出现主题、知识与评估摘要。</span>
            </p>
          </section>

          <section class="ld-sess-block">
            <div class="ld-sess-block__head">
              <h4 class="ld-sess-block__h">对话记录</h4>
              <span class="mk-card__meta">{{ messages.length }} 条</span>
            </div>
            <div v-if="messages.length" class="ld-sess-msgs">
              <div v-for="(m, i) in messages" :key="i" class="ld-sess-msg" :class="`is-${m.role}`">
                <span class="ld-sess-msg__role">{{ m.role === 'assistant' ? '老师' : '学员' }}</span>
                <p class="ld-sess-msg__text">{{ m.content }}</p>
                <span v-if="m.time" class="ld-sess-msg__time">{{ fmtTime(m.time) }}</span>
              </div>
            </div>
            <p v-else class="ld-sess-empty">
              {{ '该课堂暂未记录可展示消息' }}
              <span class="ld-sess-empty__hint">课堂消息会在教学回合结束后出现。</span>
            </p>
          </section>
        </template>
      </div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { adminVirtualLearnersApi } from '@/api/adminApi'
import { statusText } from './statusText'
import { buildLessonWrapup } from './cockpitWrapup'
import { asRecord, firstText } from './cockpitFormat'
import MkLoading from '@/components/mk/MkLoading.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import { useOverlay, useMaskClose } from './useOverlay'
import { useEscape } from './useEscape'

const props = defineProps<{
  open: boolean
  sessionId: string
}>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'expand'): void }>()

interface ConsoleMessage {
  role: string
  content: string
  time: string | null
}

const payload = ref<Record<string, unknown> | null>(null)
const loading = ref(false)
const error = ref('')
const maskRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
let loadSeq = 0

const teaching = computed(() => asRecord(payload.value?.teaching))
const goal = computed(() => asRecord(payload.value?.goal))
const kind = computed(() => firstText(payload.value?.kind))
const goalDescription = computed(() => (kind.value === 'goal' ? firstText(goal.value.description) : ''))

const title = computed(() => {
  if (kind.value === 'goal') return goalDescription.value || '目标对话记录'
  return firstText(teaching.value.taskTitle, teaching.value.topic) || '课堂记录'
})

const messages = computed<ConsoleMessage[]>(() => {
  const conversations = asRecord(payload.value?.conversations)
  const raw = kind.value === 'goal'
    ? asRecord(conversations.goal).messages
    : (teaching.value.messages ?? asRecord(conversations.learning).messages)
  return Array.isArray(raw)
    ? raw
        .map((m) => asRecord(m))
        .filter((m) => typeof m.content === 'string' && String(m.content).trim())
        .map((m) => ({
          role: String(m.role || 'user') === 'assistant' ? 'assistant' : 'user',
          content: String(m.content).trim(),
          time: typeof m.time === 'string' ? m.time : null,
        }))
    : []
})

const wrapup = computed(() => asRecord(teaching.value.wrapup))
const wrapupStatus = computed(() => firstText(wrapup.value.status))
const lessonWrapup = computed(() => buildLessonWrapup({ wrapup: wrapup.value }))
const summaryBlocks = computed(() => {
  const w = lessonWrapup.value
  if (!w) return []
  return [
    { label: '主题摘要', text: w.topicSummary },
    { label: '知识总结', text: w.knowledgeSummary },
    { label: '学习评估', text: w.learningEvaluation },
    { label: '练习建议', text: w.practiceAdvice },
  ].filter((b) => b.text)
})
const takeaways = computed(() => {
  const w = lessonWrapup.value
  if (!w) return []
  return [...w.keyTakeaways, ...w.actionPlan].filter(Boolean)
})

const subText = computed(() => {
  if (loading.value) return '正在读取只读记录'
  const status = statusText(firstText(teaching.value.status, goal.value.status))
  const start = fmtTime(firstText(teaching.value.startTime, payload.value?.createdAt as string))
  return [status, start].filter(Boolean).join(' · ') || '只读预览'
})
const dialogLabel = computed(() => `${title.value} 只读预览`)

/** 全站时间口径 YYYY-MM-DD HH:mm。不复用 cockpitFormat.formatTime：它出 2026/11/10 18:00:00，
 *  与本页其余时间（学习者详情的绝对时间 title）不一致。 */
function fmtTime(value?: string | null): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

async function load() {
  const id = props.sessionId
  if (!id) return
  const seq = ++loadSeq
  loading.value = true
  error.value = ''
  try {
    const res = await adminVirtualLearnersApi.getRealSessionConsole(id)
    if (seq !== loadSeq) return
    payload.value = asRecord(res?.data?.data ?? res?.data)
  } catch (e) {
    if (seq !== loadSeq) return
    payload.value = null
    error.value = e instanceof Error && e.message ? e.message : '课堂记录读取失败，请重试'
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

watch(
  () => [props.open, props.sessionId] as const,
  ([open, id]) => {
    if (!open || !id) return
    if (payload.value && firstText(payload.value.sessionId) === id) return
    void load()
  },
  { immediate: true }
)

useEscape(() => props.open, () => emit('close'))
useOverlay(computed(() => props.open), panelRef)
useMaskClose(maskRef, () => emit('close'))
</script>

<style scoped>
/* 宽屏抽屉：占视口约 58%（1280 宽实测 ~742px），窄屏由 mk-drawer 的 ≤720px 规则接管满宽 */
.ld-sess-drawer { width: clamp(560px, 58vw, 1040px); }
.ld-sess-drawer .mk-drawer__title { overflow-wrap: anywhere; }
.ld-sess-drawer__actions { display: flex; align-items: center; gap: 8px; flex: none; }
.ld-sess-drawer__body { display: grid; gap: 18px; align-content: start; }

.ld-sess-block { display: grid; gap: 8px; min-width: 0; }
.ld-sess-block__head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.ld-sess-block__h {
  margin: 0;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--mk-line);
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--mk-ink);
  opacity: 0.88;
}
.ld-sess-block__head .ld-sess-block__h { flex: 1 1 auto; }
.ld-sess-block__text { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-muted); line-height: 1.7; }

.ld-sess-sum { display: grid; gap: 2px; }
.ld-sess-sum__label { font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-faint); }
.ld-sess-sum__text { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-muted); line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; }
.ld-sess-empty { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.ld-sess-empty__hint { display: block; margin-top: 2px; color: var(--mk-faint); line-height: 1.6; }
.ld-sess-takeaways { margin: 0; padding-left: 18px; display: grid; gap: 4px; font-size: var(--mk-fs-micro); color: var(--mk-muted); line-height: 1.6; }

.ld-sess-msgs { display: grid; gap: 10px; }
.ld-sess-msg {
  display: grid;
  gap: 3px;
  padding: 9px 11px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-lg);
  background: var(--mk-surface);
  min-width: 0;
}
.ld-sess-msg.is-user { background: var(--mk-surface-2); }
.ld-sess-msg__role { font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-faint); }
.ld-sess-msg__text { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-ink); line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; }
.ld-sess-msg__time { font-size: var(--mk-fs-micro); color: var(--mk-faint); }
</style>
