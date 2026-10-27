<template>
  <!-- 按创建时间清理（2026-10-10）：按创建时间筛选 + 保留名单豁免 → 干跑预览 → 分批（≤100/批）调
       batch-delete 落地。与 VirtualLearnerReclaim 同族交互（Teleport 模态 / 预览清单 / busy 互斥），
       但判定在客户端算（创建时间与 tags 都在列表行里），删除走服务端既有批量端点。 -->
  <Teleport v-if="render" to="body">
  <div v-if="state.open" ref="maskRef" class="mk-modal">
    <div ref="panelRef" class="mk-modal__panel" role="dialog" aria-label="按创建时间清理">
      <div class="mk-modal__head">
        <h3 class="mk-modal__title">按创建时间清理</h3>
        <button type="button" class="mk-modal__close" aria-label="关闭" @click="state.open = false">✕</button>
      </div>
      <div class="mk-modal__body">
        <p class="mk-alert mk-alert--info">
          将删除创建时间早于保留期的虚拟学习者，其会话、教学记录、学习数据一并清除，不可恢复。
          进行中的账号与保留名单命中的账号自动豁免。
        </p>
        <div class="vl-cleanup-criteria">
          <label class="vl-cleanup-field">
            <span>保留最近</span>
            <MkSelect
              v-model="state.keepDays"
              :options="KEEP_DAY_OPTIONS"
              :disabled="state.busy"
              aria-label="保留最近"
              block
            />
          </label>
          <label class="vl-cleanup-field vl-cleanup-field--grow">
            <span>保留名单（每行一个画像标签）</span>
            <textarea v-model="state.keepTagsText" rows="3" :disabled="state.busy" placeholder="rw-acad5-31&#10;preset:nurse-career-transition"></textarea>
          </label>
        </div>
        <template v-if="candidates.length">
          <p class="vl-cleanup-summary">
            将删除 <b>{{ candidates.length }}</b> 人（合计会话 {{ totalSessions }}）。
            豁免 <b>{{ exempted }}</b> 人<template v-if="exemptRunning">（进行中 {{ exemptRunning }}）</template><template v-if="exemptKeepTags">（保留名单 {{ exemptKeepTags }}）</template><template v-if="exemptNoDate">（创建时间缺失 {{ exemptNoDate }}）</template>。
          </p>
          <div class="vl-cleanup-list">
            <div v-for="s in previewRows" :key="s.id" class="vl-cleanup-item">
              <span class="vl-cleanup-name">{{ s.name }}</span>
              <span class="mk-badge mk-badge--muted">{{ s.created }}</span>
              <span class="vl-cleanup-meta">会话 {{ s.sessions }}</span>
            </div>
            <p v-if="candidates.length > previewRows.length" class="vl-cleanup-footnote">
              仅列前 {{ previewRows.length }} 条，其余 {{ candidates.length - previewRows.length }} 人同样删除。
            </p>
          </div>
        </template>
        <MkEmptyState
          v-else
          title="没有符合条件的账号"
          compact
        />
        <p v-if="state.progress" class="vl-cleanup-footnote">{{ state.progress }}</p>
      </div>
      <div class="mk-modal__foot">
        <button type="button" class="mk-btn" :disabled="state.busy" @click="state.open = false">取消</button>
        <button
          type="button"
          class="mk-btn mk-btn--danger"
          :disabled="!candidates.length || state.busy"
          @click="confirmCleanup"
        >
          {{ state.busy ? '删除中…' : `删除 ${candidates.length} 人` }}
        </button>
      </div>
    </div>
  </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, reactive, ref, toRef } from 'vue'
import { adminVirtualLearnersApi } from '@/api/adminApi'
import { loadLiveData, errMsg } from './live'
import { askConfirm, doneConfirm, failConfirm } from './useConfirm'
import { toast } from '@/utils/toast'
import { useEscape } from './useEscape'
import { useMaskClose, useOverlay } from './useOverlay'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkSelect from '@/components/mk/MkSelect.vue'
import type { VirtualLearnerRow as Sample } from './virtualLearnersTypes'

/** 保留期档位（天）：建号在此窗口内的账号一律不动 */
const KEEP_DAY_OPTIONS = [
  { value: 1, label: '1 天' },
  { value: 3, label: '3 天' },
  { value: 7, label: '7 天' },
  { value: 14, label: '14 天' },
  { value: 30, label: '30 天' }
]

const props = withDefaults(defineProps<{
  /** 全量行数据（liveVirtuals 映射后；判定建号时间与 tags 都在行里） */
  samples: Sample[]
  render?: boolean
}>(), { render: true })
const emit = defineEmits<{ (e: 'done'): void }>()

const state = reactive({
  open: false,
  busy: false,
  /** 保留期（天）：建号在此窗口内的账号一律不动 */
  keepDays: 3,
  /** 保留名单文本：每行一个画像 tag（persona id / cohort key） */
  keepTagsText: '',
  /** 分批删除进度文案（空 = 未在执行） */
  progress: ''
})

const maskRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const openRef = toRef(state, 'open')

function close(): void {
  state.open = false
}

useEscape(() => openRef.value, close)
useOverlay(openRef, panelRef)
useMaskClose(maskRef, close)

const keepTagSet = computed(() => new Set(
  state.keepTagsText.split(/[\n,，;；\s]+/).map((s) => s.trim()).filter(Boolean)
))

/** 判定在客户端算：建号早于保留期、非进行中、不命中保留名单 → 候选 */
const candidates = computed(() => {
  const cutoff = Date.now() - state.keepDays * 86_400_000
  const tags = keepTagSet.value
  return props.samples.filter((s) => {
    if (s.runningCount > 0) return false
    if ((s.tags || []).some((t) => tags.has(t))) return false
    const created = Date.parse(s.createdAt || '')
    if (!Number.isFinite(created)) return false
    return created < cutoff
  })
})

/** 豁免分组计数（口径在 hint/摘要里逐项披露，运营知道谁被保住了、为什么） */
const exemptRunning = computed(() => props.samples.filter((s) => s.runningCount > 0).length)
const exemptKeepTags = computed(() => props.samples.filter((s) =>
  s.runningCount === 0 && (s.tags || []).some((t) => keepTagSet.value.has(t))
).length)
const exemptNoDate = computed(() => props.samples.filter((s) => {
  if (s.runningCount > 0) return false
  if ((s.tags || []).some((t) => keepTagSet.value.has(t))) return false
  return !Number.isFinite(Date.parse(s.createdAt || ''))
}).length)
const exempted = computed(() => props.samples.length - candidates.value.length)
const totalSessions = computed(() => candidates.value.reduce((a, s) => a + Number(s.sessions || 0), 0))
const previewRows = computed(() => candidates.value.slice(0, 30))

function open() {
  state.open = true
  state.busy = false
  state.progress = ''
}

/** 确认后分批落地：服务端单批上限 100（batch-delete 校验），循环直至删完；
 *  任一批失败即停（剩余账号保留，重开向导可对剩余再跑——幂等：已删 id 归 skipped）。 */
async function confirmCleanup() {
  const ids = candidates.value.map((s) => s.id)
  if (!ids.length || state.busy) return
  const ok = await askConfirm({
    title: '按创建时间清理',
    message: `确认删除 ${ids.length} 个虚拟学习者？\n将一并删除其全部会话、教学记录、学习数据，不可撤销。`,
    confirmText: `删除 ${ids.length} 人`
  })
  if (!ok) return
  state.busy = true
  let deleted = 0
  let failed = 0
  try {
    const CHUNK = 100
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK)
      state.progress = `第 ${Math.floor(i / CHUNK) + 1}/${Math.ceil(ids.length / CHUNK)} 批（已删 ${deleted}）…`
      try {
        const res = await adminVirtualLearnersApi.batchDeleteVirtualLearners(chunk)
        const d = res.data?.data ?? {}
        deleted += (d.deleted || []).length
        failed += (d.errors || []).length
        if ((d.errors || []).length > 0) {
          toast.error(`第 ${Math.floor(i / CHUNK) + 1} 批有 ${(d.errors || []).length} 人删除失败，已停止后续批次`)
          break
        }
      } catch (e) {
        failed += chunk.length
        toast.error(`批次请求失败：${errMsg(e)}`)
        break
      }
    }
    if (deleted > 0) toast.success(`已删除 ${deleted} 个账号${failed > 0 ? `，${failed} 人失败可重开向导重试` : ''}`)
    else if (failed === 0) toast.info('没有可删除的账号')
    state.open = false
    emit('done')
    void loadLiveData()
    doneConfirm()
  } catch (e) {
    toast.error(`清理失败：${errMsg(e)}`)
    failConfirm()
  } finally {
    state.busy = false
    state.progress = ''
  }
}

defineExpose({ open, state })
</script>

<style scoped>
.vl-cleanup-criteria {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin: 10px 0 0;
}
.vl-cleanup-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted, #5b6577);
}
.vl-cleanup-field--grow { flex: 1 1 240px; }
.vl-cleanup-field textarea {
  font-size: var(--mk-fs-micro);
  color: var(--mk-ink);
  background: var(--mk-surface-2);
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-md);
  padding: 6px 8px;
}
.vl-cleanup-field textarea { resize: vertical; min-height: 56px; }
.vl-cleanup-summary { margin: 10px 0 0; font-size: var(--mk-fs-micro); color: var(--mk-ink); }
.vl-cleanup-summary b { font-weight: 700; }
.vl-cleanup-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 220px;
  overflow-y: auto;
  margin-top: 8px;
}
.vl-cleanup-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-radius: var(--mk-radius-xl);
  background: var(--mk-surface-2);
  border: 1px solid var(--mk-line);
  font-size: var(--mk-fs-micro);
}
.vl-cleanup-name { font-weight: 600; color: var(--mk-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.vl-cleanup-meta { margin-left: auto; color: var(--mk-muted, #5b6577); white-space: nowrap; }
.vl-cleanup-footnote { margin: 8px 0 0; font-size: var(--mk-fs-micro); color: var(--mk-muted, #5b6577); }

@media (min-width: 2000px) {
  .vl-cleanup-item { padding: 8px 12px; }
}
</style>
