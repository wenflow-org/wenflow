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
        <p class="mk-alert mk-alert--info vl-steps">
          将把{{ state.profileIds ? '选中虚拟人' : '全部' }}超过回收阈值（{{ reclaimThresholdLabel }}）无写入、且无活跃租约的会话标记为失败（failed, reason=stale）。只改状态，不删除任何数据。
        </p>
        <p v-if="state.loading" class="mk-alert mk-alert--info vl-steps">正在扫描可回收会话…</p>
        <p v-else-if="!state.preview.length" class="mk-alert mk-alert--ok vl-steps">没有可回收的卡死会话。</p>
        <div v-else class="vl-reclaim-list">
          <div v-for="r in state.preview" :key="r.id" class="vl-reclaim-item">
            <code class="vl-reclaim-id">{{ r.id.slice(0, 14) }}…</code>
            <span class="mk-badge mk-badge--muted">{{ r.currentStage }}</span>
            <span class="vl-reclaim-stale">{{ fmtStale(r.staleMs) }}</span>
          </div>
        </div>
      </div>
      <div class="mk-modal__foot">
        <button type="button" class="mk-btn" @click="state.open = false">取消</button>
        <button type="button" class="mk-btn mk-btn--primary" :disabled="state.busy || !state.preview.length" @click="confirmReclaim">
          {{ state.busy ? '回收中…' : `确认回收 ${state.preview.length} 个会话` }}
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
import { useEscape } from './useEscape'
import { useOverlay, useMaskClose } from './useOverlay'
import { toast } from '@/utils/toast'
import type { ReclaimPreviewItem } from './virtualLearnersTypes'

const emit = defineEmits<{ (e: 'done'): void }>()
/* render=false 时不渲染 Teleport（保持与拆分前一致的 tab 条件渲染语义），弹窗状态仍常驻 */
withDefaults(defineProps<{ render?: boolean }>(), { render: true })

/* ===== A2 一键回收 / 批量清理卡死：dryRun 清单 → 确认 → dryRun=false 落地 ===== */
const reclaimThresholdLabel = '24 小时'
/* 用 reactive 暴露 busy/清单，父页面状态条可读取同一对象（:disabled / 文案） */
const state = reactive({
  open: false,
  busy: false,
  loading: false,
  preview: [] as ReclaimPreviewItem[],
  profileIds: undefined as string[] | undefined
})
const reclaimPanelRef = ref<HTMLElement | null>(null)
const reclaimMaskRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => state.open), reclaimPanelRef)
useMaskClose(reclaimMaskRef, () => { if (!state.busy) state.open = false })
useEscape(() => state.open, () => { if (!state.busy) state.open = false })

/** 父页面触发：dryRun 拉取清单后打开弹窗（不传 profileIds 即全局口径） */
async function open(profileIds?: string[]) {
  state.profileIds = profileIds?.length ? [...profileIds] : undefined
  state.open = true
  state.loading = true
  state.busy = true
  state.preview = []
  try {
    const res = await adminVirtualLearnersApi.reclaimStaleVirtualSessions({
      dryRun: true,
      ...(state.profileIds ? { profileIds: state.profileIds } : {})
    })
    const d = res.data?.data ?? {}
    state.preview = Array.isArray(d.sessions) ? (d.sessions as ReclaimPreviewItem[]) : []
  } catch (e) {
    toast.error(`扫描卡死会话失败：${errMsg(e)}`)
    state.open = false
  } finally {
    state.loading = false
    state.busy = false
  }
}

async function confirmReclaim() {
  if (!state.preview.length || state.busy) return
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
/* 一键回收清单 */
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
  border-radius: 10px;
  background: #fafbfd;
  border: 1px solid #e8ecf2;
  font-size: var(--mk-fs-12);
}
.vl-reclaim-id { font-size: var(--mk-fs-11); color: var(--mk-muted, #5b6577); }
.vl-reclaim-stale { margin-left: auto; color: var(--mk-red, #dc2626); font-weight: 700; white-space: nowrap; }

/* 弹窗内步骤/结果提示：mk-alert 形态，此处只留边距（本组件独立复制一份） */
.vl-steps {
  margin: 0 0 4px;
  padding: 8px 10px;
  border-radius: 10px;
  background: #f4f7fc;
  color: var(--mk-muted, #5b6577);
  font-size: var(--mk-fs-12);
  line-height: 1.5;
}

@media (min-width: 2000px) {
  .vl-steps { font-size: var(--mk-fs-13); padding: 9px 12px; }
  .vl-reclaim-item { font-size: 13.5px; padding: 8px 12px; }
  .vl-reclaim-id { font-size: var(--mk-fs-12_5); }
}
@media (min-width: 2800px) {
  .vl-steps { font-size: 15.5px; padding: 11px 14px; }
  .vl-reclaim-item { font-size: 15.5px; padding: 9px 14px; }
  .vl-reclaim-id { font-size: 14.5px; }
}
@media (min-width: 3600px) {
  .vl-steps { font-size: var(--mk-fs-18); padding: 13px 16px; }
  .vl-reclaim-item { font-size: var(--mk-fs-18); padding: 11px 16px; }
  .vl-reclaim-id { font-size: 17px; }
}

/* 暗色模式：回收清单（硬编码浅底） */
html[data-theme='dark'] {
  .vl-reclaim-item { background: #19191a; border-color: #2a2b2d; }
}
</style>
