<template>
  <!-- 批量新建虚拟学习者 -->
  <Teleport v-if="render" to="body">
  <!-- 遮罩关闭统一走 useMaskClose（带 busy 守卫）：不再挂 @click.self 双路径 -->
  <div v-if="batchOpen" ref="batchMaskRef" class="mk-modal">
    <div ref="batchPanelRef" class="mk-modal__panel mk-modal__panel--wide" role="dialog" aria-label="批量新建虚拟学习者">
      <div class="mk-modal__head">
        <h3 class="mk-modal__title">批量新建虚拟学习者</h3>
        <button type="button" class="mk-modal__close" aria-label="关闭" @click="closeBatch">✕</button>
      </div>
      <div class="mk-modal__body">
        <p class="mk-alert mk-alert--info vl-steps">设置人数与故事数，点击创建后立即返回——AI 会在后台为每人生成身份与故事，页面顶部状态条可查看进度。</p>
        <div class="vl-batch-config">
          <label class="mk-field vl-batch-config__count">
            <span class="mk-field__label">人数</span>
            <input v-model.number="batchFillCount" type="number" class="mk-field__input" min="1" max="20" />
          </label>
          <label class="mk-field vl-batch-config__stories">
            <span class="mk-field__label">每人故事数</span>
            <input v-model.number="batchStoryCount" type="number" class="mk-field__input" min="0" max="5" />
          </label>
          <label class="mk-field vl-batch-config__prefix">
            <span class="mk-field__label">名称前缀 <em class="vl-req-less">可选</em></span>
            <input v-model="batchPrefix" class="mk-field__input" placeholder="默认 虚拟学习者（自动编号 -01/-02…）" />
          </label>
        </div>
        <label class="mk-field">
          <span class="mk-field__label">想要哪类人群？ <em class="vl-req-less">可选，留空 AI 自由发挥</em></span>
          <textarea v-model="batchCohort" class="mk-field__textarea" rows="2" placeholder="例如：25-35 岁职场人，最近想系统补 Excel/数据分析；或 高三学生，备考压力大。AI 会据此为每人生成差异化身份" />
        </label>
        <label class="mk-field">
          <span class="mk-field__label">批次备注 <em class="vl-req-less">可选</em></span>
          <input v-model="batchNote" class="mk-field__input" placeholder="这批学习者用于什么实验 / 验收，方便以后识别" />
        </label>
        <div v-if="batchError" class="mk-alert">{{ batchError }}</div>
        <button type="button" class="mk-btn mk-btn--primary mk-btn--block" :disabled="batchCreating" @click="doBatchCreate">
          {{ batchCreating ? '创建中…' : `创建 ${batchFillCount || 0} 人 × ${batchStoryCount || 0} 故事（后台生成）` }}
        </button>
      </div>
    </div>
  </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { adminVirtualLearnersApi } from '@/api/adminApi'
import { loadLiveData, errMsg } from './live'
import { useOverlay, useMaskClose } from './useOverlay'
import { useEscape } from './useEscape'
import { useSafePolling } from '@/composables/useSafePolling'
import { toast } from '@/utils/toast'
import type { BatchTask } from './virtualLearnersTypes'

/* render=false 时不渲染 Teleport（保持与拆分前一致的 tab 条件渲染语义），后台任务状态仍常驻 */
withDefaults(defineProps<{ render?: boolean }>(), { render: true })

/* ===================== 批量新建 ===================== */
const batchOpen = ref(false)
const batchCreating = ref(false)
const batchPrefix = ref('')
const batchFillCount = ref(3)
const batchStoryCount = ref(1)
/** 人群描述（可选）：AI 据此为每人生成差异化身份；留空自由发挥 */
const batchCohort = ref('')
/** 批次备注（可选）：写入每人的 notes 字段，便于识别 */
const batchNote = ref('')
const batchError = ref('')
const batchPanelRef = ref<HTMLElement | null>(null)
const batchMaskRef = ref<HTMLElement | null>(null)
/** 弹窗统一关闭路径：创建中禁止 Esc/遮罩/✕ 误关（进度视图在此弹窗里；任务本身服务端执行不受影响） */
function closeBatch() {
  if (!batchCreating.value) batchOpen.value = false
}
useOverlay(computed(() => batchOpen.value), batchPanelRef)
useMaskClose(batchMaskRef, closeBatch)
useEscape(() => batchOpen.value, closeBatch)

/* ===== 批量创建后台任务：创建人秒回，AI 身份 + 故事后台轮询推进（不占用窗口） ===== */
/* 用 reactive（而非 ref）承载任务：父页面/RunningBar 直接读取同一对象，避免 exposed ref 类型歧义 */
const batchTask = reactive<BatchTask>({ active: false, status: 'creating', batchId: '', total: 0, created: 0, totalStories: 0, storiesDone: 0, personaLeft: 0, queue: [], failed: [], error: '', currentIdx: 0, expanded: false })

/** 轮询后端批量任务进度（服务端队列：刷新/切页不影响执行） */
async function batchTaskStep() {
  const task = batchTask
  if (!task.active || task.status !== 'running') return
  if (!task.batchId) return
  try {
    const res = await adminVirtualLearnersApi.batchCreateJob(task.batchId)
    const d = res.data?.data ?? res.data ?? {}
    if (!d || typeof d !== 'object') return
    task.total = Number(d.total ?? task.total)
    task.created = Number(d.created ?? task.created)
    task.totalStories = Number(d.totalStories ?? task.totalStories)
    task.storiesDone = Number(d.storiesDone ?? 0)
    task.personaLeft = Number(d.personaLeft ?? 0)
    const failed = Array.isArray(d.failed) ? d.failed : []
    task.failed = failed as BatchTask['failed']
    const st = String(d.status || 'running')
    if (st === 'done') {
      task.status = 'done'
      task.error = ''
      if (task.totalStories > 0) toast.success(`批量创建完成：${task.created} 人 · 生成 ${task.storiesDone} 个故事`)
      else toast.success(`批量创建完成：${task.created} 人（未生成故事）`)
    } else if (st === 'error') {
      task.status = 'error'
      task.error = String(d.error || `${failed.length} 项生成失败（可重试）`)
    }
  } catch (e) {
    console.error('批量任务轮询失败:', e)
    throw e // 让 useSafePolling 退避/断路器处理
  }
}

/** 重试失败项（后端队列重试） */
async function retryBatchTask() {
  const task = batchTask
  if (!task.active || task.status !== 'error') return
  if (!task.batchId) return
  try {
    await adminVirtualLearnersApi.batchCreateRetry(task.batchId)
    task.failed = []
    task.error = ''
    task.status = 'running'
    toast.info('已重试失败项')
  } catch (e) {
    toast.error(`重试失败：${errMsg(e)}`)
  }
}

async function doBatchCreate() {
  const count = Math.max(1, Math.min(20, Math.round(Number(batchFillCount.value)) || 3))
  const stories = Math.max(0, Math.min(5, Math.round(Number(batchStoryCount.value)) || 0))
  const prefix = batchPrefix.value.trim() || '虚拟学习者'
  batchError.value = ''
  batchCreating.value = true
  try {
    const rows = Array.from({ length: count }, (_, i) => ({
      name: `${prefix}-${String(i + 1).padStart(2, '0')}`,
      storyCount: stories
    }))
    const res = await adminVirtualLearnersApi.batchCreateLearners({
      rows,
      ...(batchCohort.value.trim() ? { cohort: batchCohort.value.trim() } : {}),
      ...(batchNote.value.trim() ? { note: batchNote.value.trim() } : {})
    })
    const d = res.data?.data ?? res.data ?? {}
    const batchId = String(d.batchId || '')
    const created = Number(d.created ?? 0)
    const totalStories = Number(d.totalStories ?? 0)
    batchCreating.value = false
    batchOpen.value = false
    if (!batchId || created <= 0) {
      toast.error('批量创建失败，请检查后重试')
      return
    }
    toast.success(`已创建 ${created} 个虚拟学习者，后台开始生成身份与故事（服务端队列，刷新/切页不受影响）`)
    void loadLiveData()
    Object.assign(batchTask, {
      active: true,
      status: 'running',
      batchId,
      total: created,
      created,
      totalStories,
      storiesDone: 0,
      personaLeft: created,
      queue: [],
      failed: [],
      error: '',
      currentIdx: 0,
      expanded: true
    })
    startBatchPolling()
  } catch (e) {
    batchCreating.value = false
    toast.error(`批量创建失败：${errMsg(e)}`)
  }
}

/* 批量后台任务轮询：复用 useSafePolling 范式（页面隐藏跳过、失败退避、断路器） */
const batchPolling = useSafePolling(() => batchTaskStep(), {
  interval: 2000,
  maxBackoff: 10000,
  circuitBreakerThreshold: 5,
  skipWhenHidden: true,
  immediate: true
})
function startBatchPolling() { batchPolling.start() }

/* 父页面触发/联动入口 */
function open() { batchOpen.value = true }
function retry() { void retryBatchTask() }
function dismiss() { batchTask.active = false }
function toggleDetail() { batchTask.expanded = !batchTask.expanded }
defineExpose({ open, task: batchTask, retry, dismiss, toggleDetail })
</script>

<style scoped>
/* ===== 批量新建配置区 ===== */
.vl-batch-config { display: flex; gap: 14px; align-items: flex-end; margin-bottom: 12px; flex-wrap: wrap; }
.vl-batch-config .mk-field { margin-bottom: 0; }
.vl-batch-config__count { width: 100px; }
.vl-batch-config__stories { width: 120px; }
.vl-batch-config__prefix { flex: 1; min-width: 200px; }
.vl-req-less { font-style: normal; font-weight: 400; color: var(--mk-faint, #94a3b8); font-size: var(--mk-fs-micro); }

/* 弹窗内步骤/结果提示：mk-alert 形态，此处只留边距（本组件独立复制一份） */
.vl-steps {
  margin: 0 0 4px;
  padding: 8px 10px;
  border-radius: 10px;
  background: #f4f7fc;
  color: var(--mk-muted, #5b6577);
  font-size: var(--mk-fs-micro);
  line-height: 1.5;
}
@media (min-width: 2000px) {
  .vl-steps { font-size: var(--mk-fs-micro); padding: 9px 12px; }
}
@media (min-width: 2800px) {
  .vl-steps { font-size: var(--mk-fs-micro); padding: 11px 14px; }
}
@media (min-width: 3600px) {
  .vl-steps { font-size: var(--mk-fs-body); padding: 13px 16px; }
}
</style>
