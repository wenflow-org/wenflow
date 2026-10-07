<template>
  <!-- 一键回收卡死：dryRun 先展示清单再确认执行（复用 reclaim-stale dryRun 语义） -->
  <Teleport v-if="render" to="body">
  <div v-if="state.open" ref="reclaimMaskRef" class="mk-modal">
    <div ref="reclaimPanelRef" class="mk-modal__panel" role="dialog" :aria-label="state.profileIds ? '批量清理卡死会话' : '一键回收卡死会话'">
      <div class="mk-modal__head">
        <h3 class="mk-modal__title">{{ state.profileIds ? `批量清理卡死会话（选中 ${state.profileIds.length} 人）` : '一键回收卡死会话' }}</h3>
        <button type="button" class="mk-modal__close" aria-label="关闭" @click="state.open = false">✕</button>
      </div>
      <div class="mk-modal__body">
        <p class="mk-alert mk-alert--info">
          将把{{ state.profileIds ? '选中虚拟人' : '全部' }}超过回收阈值（{{ reclaimThresholdLabel }}）无写入、且无活跃租约的会话标记为失败（failed, reason=stale）。只改状态，不删除任何数据。
        </p>
        <p v-if="state.loading" class="mk-alert mk-alert--info">正在扫描可回收会话…</p>
        <template v-else>
          <!-- B8-F4-2 同源同数：候选数（与页头角标同一口径，= scanned - 暂停）与明细读同一份干跑结果——
               可回收的列上面，被豁免的（hold/租约/在途/代际）逐条列下面并注明原因，
               不再出现「按钮 35 / 弹窗 0」两套数字 -->
          <p v-if="candidateCount > 0" class="vl-reclaim-summary">
            扫描到 <b>{{ candidateCount }}</b> 个超阈值卡死候选会话{{ state.profileIds ? '（选中虚拟人口径）' : '（与页头角标同源）' }}：可回收 <b>{{ state.reclaimable.length }}</b> 个<template v-if="protectedSkipped.length">，豁免 <b>{{ protectedSkipped.length }}</b> 个（{{ skippedBreakdown }}）</template>。
          </p>
          <p v-if="scanTruncated" class="vl-reclaim-footnote">
            单次扫描上限 {{ state.batchLimit }} 个，可能还有未列出的候选；回收后可再次扫描。
          </p>
          <!-- 空态走共享 MkEmptyState（原型 .empty：图标/标题/下一步，index.html 287-289），带「关闭」CTA；
               原先的 mk-alert--ok 只有一句状态文案、没有下一步 -->
          <MkEmptyState
            v-if="!candidateCount"
            title="没有可回收的卡死会话"
            description="当前没有超过回收阈值的卡死候选会话，无需清理。"
            action-text="关闭"
            compact
            @action="state.open = false"
          />
          <div v-if="state.reclaimable.length" class="vl-reclaim-list">
            <div v-for="r in state.reclaimable" :key="r.id" class="vl-reclaim-item">
              <code class="vl-reclaim-id">{{ r.id.slice(0, 14) }}…</code>
              <span class="mk-badge mk-badge--muted">{{ r.currentStage }}</span>
              <span class="vl-reclaim-stale">{{ fmtStale(r.staleMs) }}</span>
            </div>
          </div>
          <p v-else-if="candidateCount > 0" class="mk-alert mk-alert--info">
            本轮没有可回收的会话：{{ candidateCount }} 个候选全部处于豁免保护（{{ skippedBreakdown }}），无需清理。
          </p>
          <p v-if="pausedSkipped.length" class="vl-reclaim-footnote">
            另有 {{ pausedSkipped.length }} 个管理员暂停会话按口径不计入卡死。
          </p>
          <template v-if="protectedSkipped.length">
            <p class="vl-reclaim-skipped-title">以下候选本轮不会回收（豁免保护）：</p>
            <div class="vl-reclaim-list">
              <div v-for="r in protectedSkipped" :key="r.id" class="vl-reclaim-item vl-reclaim-item--skipped">
                <code class="vl-reclaim-id">{{ r.id.slice(0, 14) }}…</code>
                <span class="mk-badge mk-badge--muted">{{ r.currentStage }}</span>
                <span class="mk-badge">{{ skipReasonLabel(r.skipReason) }}</span>
                <span class="vl-reclaim-stale vl-reclaim-stale--skipped">{{ fmtStale(r.staleMs) }}</span>
              </div>
            </div>
          </template>
        </template>
      </div>
      <div class="mk-modal__foot">
        <button type="button" class="mk-btn" @click="state.open = false">取消</button>
        <!-- 判例「确认弹层=取消+危险主钮右对齐」：回收=把会话批量标记失败（同原型 openBreakConfirm 中断会话的危险钮语气） -->
        <button type="button" class="mk-btn mk-btn--danger" :disabled="state.busy || !state.reclaimable.length" @click="confirmReclaim">
          {{ state.busy ? '回收中…' : `确认回收 ${state.reclaimable.length} 个会话` }}
        </button>
      </div>
    </div>
  </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { adminVirtualLearnersApi } from '@/api/adminApi'
import { loadLiveData, errMsg, liveVirtualRunStats } from './live'
import { useEscape } from './useEscape'
import { useOverlay, useMaskClose } from './useOverlay'
import { toast } from '@/utils/toast'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import type { ReclaimPreviewItem, ReclaimSkippedItem } from './virtualLearnersTypes'

const emit = defineEmits<{ (e: 'done'): void }>()
/* render=false 时不渲染 Teleport（保持与拆分前一致的 tab 条件渲染语义），弹窗状态仍常驻 */
withDefaults(defineProps<{ render?: boolean }>(), { render: true })

/* ===== A2 一键回收 / 批量清理卡死：dryRun 清单 → 确认 → dryRun=false 落地 ===== */
/* 回收阈值从 /stats 的 reclaimThresholdMs 派生（此前硬编码「24 小时」，服务端调阈值后文案会失真）；
   stats 未拉到或为 0 时回退 24 小时 */
const reclaimThresholdLabel = computed(() => {
  const ms = liveVirtualRunStats.value.reclaimThresholdMs
  if (!ms || ms <= 0) return '24 小时'
  const hours = ms / 3600000
  return Number.isInteger(hours) ? `${hours} 小时` : `${hours.toFixed(1)} 小时`
})
/* 用 reactive 暴露 busy/清单，父页面状态条可读取同一对象（:disabled / 文案）。
   B8-F4-2：preview 拆成 scanned/reclaimable/skipped——弹窗必须能逐条列出被豁免的候选，
   与页头角标（超阈值候选数）同源同数，不再出现「按钮 35 / 弹窗 0」。 */
const state = reactive({
  open: false,
  busy: false,
  loading: false,
  /** 超阈值候选总数（= 干跑 scanned，与页头角标同一批候选） */
  scanned: 0,
  /** 本轮可回收（确认后落地）的会话 */
  reclaimable: [] as ReclaimPreviewItem[],
  /** 本轮被豁免（hold/租约/暂停/在途/代际）的候选，带原因 */
  skipped: [] as ReclaimSkippedItem[],
  /** 单次扫描上限（后端 RECLAIM_BATCH_SIZE）；scanned 达到它说明还有未扫到的候选 */
  batchLimit: 0,
  profileIds: undefined as string[] | undefined
})
const reclaimPanelRef = ref<HTMLElement | null>(null)
const reclaimMaskRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => state.open), reclaimPanelRef)
useMaskClose(reclaimMaskRef, () => { if (!state.busy) state.open = false })
useEscape(() => state.open, () => { if (!state.busy) state.open = false })

/** 豁免原因 → 运营可读标签（与后端 skipReason 枚举一一对应） */
const SKIP_REASON_LABEL: Record<string, string> = {
  'live-generation': '本代进程写入过',
  'active-lease': '活跃租约',
  held: '外部 hold',
  paused: '管理员暂停',
  'active-autopilot': '自动运行中'
}
function skipReasonLabel(reason: string): string {
  return SKIP_REASON_LABEL[reason] ?? reason
}
/** 暂停会话按既有口径不算卡死（列表/stats 的 staleCount 同样排除）：
 *  角标同源数 = scanned - pausedSkipped，暂停只在脚注说明，不混进豁免清单 */
const pausedSkipped = computed(() => state.skipped.filter((s) => s.skipReason === 'paused'))
const protectedSkipped = computed(() => state.skipped.filter((s) => s.skipReason !== 'paused'))
/** 卡死候选数（与页头角标同源同数）；旧后端无 scanned 时按「可回收 + 豁免」兜底 */
const candidateCount = computed(() => Math.max(0, state.scanned - pausedSkipped.value.length))
/** 扫描触顶（batchLimit 命中）：本次清单非全集，需提示可再扫一轮 */
const scanTruncated = computed(() => state.batchLimit > 0 && state.scanned >= state.batchLimit)
/** 豁免原因分项计数文案（如「外部 hold 35」），零项不出现 */
const skippedBreakdown = computed(() => {
  const counts = new Map<string, number>()
  for (const s of protectedSkipped.value) {
    const label = skipReasonLabel(s.skipReason)
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts.entries()].map(([label, n]) => `${label} ${n}`).join(' · ')
})

/** 父页面触发：dryRun 拉取清单后打开弹窗（不传 profileIds 即全局口径） */
async function open(profileIds?: string[]) {
  state.profileIds = profileIds?.length ? [...profileIds] : undefined
  state.open = true
  state.loading = true
  state.busy = true
  state.scanned = 0
  state.batchLimit = 0
  state.reclaimable = []
  state.skipped = []
  try {
    const res = await adminVirtualLearnersApi.reclaimStaleVirtualSessions({
      dryRun: true,
      ...(state.profileIds ? { profileIds: state.profileIds } : {})
    })
    const d = res.data?.data ?? {}
    state.reclaimable = Array.isArray(d.sessions) ? (d.sessions as ReclaimPreviewItem[]) : []
    state.skipped = Array.isArray(d.skippedSessions) ? (d.skippedSessions as ReclaimSkippedItem[]) : []
    state.scanned = Number(d.scanned ?? (state.reclaimable.length + state.skipped.length))
    state.batchLimit = Number(d.batchLimit ?? 0)
  } catch (e) {
    toast.error(`扫描卡死会话失败：${errMsg(e)}`)
    state.open = false
  } finally {
    state.loading = false
    state.busy = false
  }
}

async function confirmReclaim() {
  if (!state.reclaimable.length || state.busy) return
  state.busy = true
  try {
    const res = await adminVirtualLearnersApi.reclaimStaleVirtualSessions({
      dryRun: false,
      ...(state.profileIds ? { profileIds: state.profileIds } : {})
    })
    const d = res.data?.data ?? {}
    toast.success(`已回收 ${Number(d.reclaimed ?? 0)} 个卡死会话（活跃租约跳过 ${Number(d.skippedActiveLease ?? 0)}）`)
    state.open = false
    emit('done')
    void loadLiveData()
  } catch (e) {
    toast.error(`回收失败：${errMsg(e)}`)
  } finally {
    state.busy = false
  }
}

function fmtStale(ms: number) {
  const mins = Math.max(1, Math.round(ms / 60000))
  if (mins < 60) return `${mins} 分钟无写入`
  return `${(mins / 60).toFixed(1)} 小时无写入`
}

defineExpose({ open, state })
</script>

<style scoped>
/* 一键回收清单：色值走 token（暗色自适应，原 #fafbfd/#e8ecf2 + 暗色补丁删除） */
.vl-reclaim-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 240px;
  overflow-y: auto;
  margin-top: 8px;
}
.vl-reclaim-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-radius: var(--mk-radius-xl);
  background: var(--mk-surface-2);
  border: 1px solid var(--mk-line);
  font-size: var(--mk-fs-micro);
}
.vl-reclaim-id { font-size: var(--mk-fs-micro); color: var(--mk-muted, #5b6577); }
.vl-reclaim-stale { margin-left: auto; color: var(--mk-red, #dc2626); font-weight: 700; white-space: nowrap; }

/* B8-F4-2 同源同数：候选/可回收/豁免摘要行 + 豁免清单（弱化配色，与可回收项区分） */
.vl-reclaim-summary { margin: 4px 0 0; font-size: var(--mk-fs-micro); color: var(--mk-ink); }
.vl-reclaim-summary b { font-weight: 700; }
.vl-reclaim-skipped-title { margin: 12px 0 0; font-size: var(--mk-fs-micro); color: var(--mk-muted, #5b6577); }
.vl-reclaim-footnote { margin: 8px 0 0; font-size: var(--mk-fs-micro); color: var(--mk-muted, #5b6577); }
.vl-reclaim-item--skipped { opacity: 0.82; }
.vl-reclaim-stale--skipped { color: var(--mk-muted, #5b6577); font-weight: 400; }

/* 步骤/清单提示已换全局 .mk-alert mk-alert--info/--ok（原 .vl-steps 覆写删除） */

@media (min-width: 2000px) {
  .vl-reclaim-item { padding: 8px 12px; }
}
@media (min-width: 2800px) {
  .vl-reclaim-item { padding: 9px 14px; }
}
@media (min-width: 3600px) {
  .vl-reclaim-item { padding: 11px 16px; }
}
</style>
