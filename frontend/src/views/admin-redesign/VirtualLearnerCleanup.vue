<template>
  <!-- 按创建时间清理（2026-10-10）：按创建时间筛选 + 保留名单豁免 → 干跑预览 → 分批（≤100/批）调
       batch-delete 落地。与 VirtualLearnerReclaim 同族交互（Teleport 模态 / 预览清单 / busy 互斥）。
       2026-11-09：候选改由服务端按**实例全集**算（GET /cleanup/candidates）——此前判定在客户端对
       当前载入页的行做，列表一次最多 1000 行，超出的同龄实例被静默漏删（向导报 3 人，库里还有几百）。 -->
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
          进行中的账号与保留名单命中的账号自动豁免。候选按<b>全库实例</b>统计，不只是当前页。
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
        <p v-if="state.loading" class="vl-cleanup-footnote">正在统计候选…</p>
        <p v-else-if="state.loadError" class="vl-cleanup-footnote vl-cleanup-footnote--error">
          候选读取失败：{{ state.loadError }}（重开向导重试。不会基于半份数据删除）
        </p>
        <template v-else-if="candidates.length">
          <p class="vl-cleanup-summary">
            将删除 <b>{{ candidates.length }}</b> 人（合计会话 {{ totalSessions }}）。
            豁免 <b>{{ exempted }}</b> 人<template v-if="exemptRunning">（进行中 {{ exemptRunning }}）</template><template v-if="exemptKeepTags">（保留名单 {{ exemptKeepTags }}）</template><template v-if="exemptWithinWindow">（保留期内 {{ exemptWithinWindow }}）</template>。
          </p>
          <div class="vl-cleanup-list">
            <div v-for="s in previewRows" :key="s.id" class="vl-cleanup-item">
              <span class="vl-cleanup-name">{{ s.name }}</span>
              <span class="mk-badge mk-badge--muted" :title="`创建于 ${fmtDateTime(s.createdAt)}`">{{ timeAgo(s.createdAt) }}</span>
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
          :disabled="!candidates.length || state.busy || state.loading || !!state.loadError"
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
import { computed, reactive, ref, toRef, watch } from 'vue'
import { adminVirtualLearnersApi } from '@/api/adminApi'
import { loadLiveData, errMsg, timeAgo } from './live'
import { askConfirm, doneConfirm, failConfirm } from './useConfirm'
import { toast } from '@/utils/toast'
import { useEscape } from './useEscape'
import { useMaskClose, useOverlay } from './useOverlay'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkSelect from '@/components/mk/MkSelect.vue'

/** 保留期档位（天）：建号在此窗口内的账号一律不动 */
const KEEP_DAY_OPTIONS = [
  { value: 1, label: '1 天' },
  { value: 3, label: '3 天' },
  { value: 7, label: '7 天' },
  { value: 14, label: '14 天' },
  { value: 30, label: '30 天' }
]

/** 服务端候选行（GET /cleanup/candidates）：已按年龄与运行态筛过，保留名单仍在前端过滤 */
interface CleanupCandidate {
  id: string
  name: string
  createdAt: string
  sessions: number
  tags: string[]
}

withDefaults(defineProps<{ render?: boolean }>(), { render: true })
const emit = defineEmits<{ (e: 'done'): void }>()

const state = reactive({
  open: false,
  busy: false,
  /** 保留期（天）：建号在此窗口内的账号一律不动 */
  keepDays: 3,
  /** 保留名单文本：每行一个画像 tag（persona id / cohort key） */
  keepTagsText: '',
  /** 分批删除进度文案（空 = 未在执行） */
  progress: '',
  /** 候选加载阶段：loading 中或失败时禁止删除（不基于半份数据动手） */
  loading: false,
  loadError: ''
})

/** 服务端返回的候选与豁免口径（分母 = 实例总数，不再是当前载入页行数） */
const serverCandidates = ref<CleanupCandidate[]>([])
const serverExempt = ref({ running: 0, withinKeepWindow: 0 })
const serverTotal = ref(0)

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

/** 最终删除名单 = 服务端候选（已排除在跑/在保留期内）− 保留名单命中 */
const candidates = computed(() => serverCandidates.value.filter(
  (s) => !(s.tags || []).some((t) => keepTagSet.value.has(t))
))

/** 豁免分组计数（口径在摘要里逐项披露，运营知道谁被保住了、为什么）：
    进行中 / 保留期内 来自服务端；保留名单命中数在前端按当前候选集算。 */
const exemptRunning = computed(() => serverExempt.value.running)
const exemptWithinWindow = computed(() => serverExempt.value.withinKeepWindow)
const exemptKeepTags = computed(() => serverCandidates.value.filter(
  (s) => (s.tags || []).some((t) => keepTagSet.value.has(t))
).length)
const exempted = computed(() => serverTotal.value - candidates.value.length)
const totalSessions = computed(() => candidates.value.reduce((a, s) => a + Number(s.sessions || 0), 0))
const previewRows = computed(() => candidates.value.slice(0, 30))

/** 绝对时间（预览行悬停）：相对时间一律配绝对时间 */
function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  if (!iso || Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 拉候选（服务端全量）：打开向导与改保留期时各拉一次；失败即禁删并如实说明 */
async function loadCandidates(): Promise<void> {
  state.loading = true
  state.loadError = ''
  try {
    const res = await adminVirtualLearnersApi.getVirtualLearnerCleanupCandidates({ keepDays: state.keepDays })
    const d = res.data?.data ?? {}
    serverCandidates.value = Array.isArray(d.candidates) ? (d.candidates as CleanupCandidate[]) : []
    serverExempt.value = {
      running: Number(d.exempt?.running || 0),
      withinKeepWindow: Number(d.exempt?.withinKeepWindow || 0)
    }
    serverTotal.value = Number(d.total || 0)
  } catch (e) {
    serverCandidates.value = []
    state.loadError = errMsg(e)
  } finally {
    state.loading = false
  }
}

watch(() => state.keepDays, () => {
  if (state.open && !state.busy) void loadCandidates()
})

function open() {
  state.open = true
  state.busy = false
  state.progress = ''
  serverCandidates.value = []
  serverExempt.value = { running: 0, withinKeepWindow: 0 }
  serverTotal.value = 0
  void loadCandidates()
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
