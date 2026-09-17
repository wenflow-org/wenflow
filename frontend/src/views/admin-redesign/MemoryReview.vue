<template>
  <div class="mr">
    <header class="mk-status" :class="`mk-status--${headTone}`">
      <span class="mk-status__dot" aria-hidden="true"></span>
      <strong class="mk-status__title">记忆与复习观测</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">用户 {{ totals.users }} · 记忆痕迹 {{ totals.traces }} · 当前到期 {{ totals.due }}</span>
      <span class="mk-status__actions">
        <button type="button" class="mk-status__action" :disabled="loading" @click="loadOverview">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
      </span>
    </header>
    <p class="mr__lead">
      记忆层（用户级、跨 path）：到期积压、课内温故配额、概念归并审计。
      归并默认<strong>观察模式</strong>——只记录建议，不动 memory_traces。
    </p>
    <!-- R1：筛选控件不得进状态条，独立成筛选行 -->
    <div class="mr__filter">
      <label class="mr__toggle">
        <input v-model="includeVirtual" type="checkbox" @change="loadOverview" />
        包含虚拟学习者
      </label>
    </div>

    <div class="mr__kpis">
      <MkKpi label="用户" :value="totals.users" compact />
      <MkKpi label="记忆痕迹" :value="totals.traces" compact />
      <MkKpi label="当前到期" :value="totals.due" :tone="totals.due > 0 ? 'warn' : ''" compact />
      <MkKpi label="待归并建议" :value="totals.proposed" compact hint="模型给出的同义合并建议" />
      <MkKpi label="可自动执行" :value="totals.autoApplicable" compact hint="把握度 + 词面闸门都过" />
      <MkKpi label="需人工看" :value="totals.ambiguous" tone="warn" compact hint="像但不确定，不会被执行" />
      <MkKpi label="已执行 / 已删除" :value="`${totals.applied} / ${totals.deleted}`" compact />
    </div>

    <div class="mk-card">
      <div class="mk-card__head">
        <strong>用户列表</strong>
        <span class="mk-card__meta">按痕迹数倒序 · 前 {{ rows.length }} 个用户</span>
      </div>
      <p v-if="error" class="mr__error">{{ error }}</p>
      <MkEmptyState v-if="!loading && !rows.length" title="暂无记忆痕迹数据" />
      <table v-else class="mr__table">
        <thead>
          <tr>
            <th>用户</th>
            <th class="mr__num">痕迹</th>
            <th class="mr__num">到期</th>
            <th class="mr__num">建议</th>
            <th class="mr__num">可自动</th>
            <th class="mr__num">需人工看</th>
            <th class="mr__num">已执行/删除</th>
            <th class="mr__num">可回滚</th>
            <th>最近观察</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.userId"
            :class="{ 'mr__row--active': row.userId === selectedId }"
          >
            <td>
              <strong>{{ row.name || '未命名' }}</strong>
              <small class="mr__sub">{{ shortId(row.userId) }}</small>
              <span v-if="row.isVirtualLearner" class="mr__tag">虚拟</span>
            </td>
            <td class="mr__num">{{ row.traces }}</td>
            <td class="mr__num" :class="{ 'mr__num--warn': row.due > 6 }">{{ row.due }}</td>
            <td class="mr__num">{{ row.audit?.proposed ?? '—' }}</td>
            <td class="mr__num">{{ row.audit?.autoApplicable ?? '—' }}</td>
            <td class="mr__num">{{ row.audit?.ambiguous ?? '—' }}</td>
            <td class="mr__num">{{ row.audit ? `${row.audit.applied}/${row.audit.deleted}` : '—' }}</td>
            <td class="mr__num">{{ rollbackableCount(row) }}</td>
            <td>{{ row.audit ? `${row.audit.mode} · ${timeAgo(row.audit.generatedAt)}` : '未观察' }}</td>
            <td class="mr__actions">
              <button type="button" class="mr__btn" @click="openDetail(row.userId)">明细</button>
              <button type="button" class="mr__btn" :disabled="busy" @click="recompute(row.userId)">重新观察</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="detail" class="mr__detail">
      <div class="mk-card">
        <div class="mk-card__head">
          <strong>明细 · {{ detail.user.name || '未命名' }}</strong>
          <span class="mk-card__meta">
            痕迹 {{ detail.summary.traces }} · 到期 {{ detail.summary.due }} ·
            同族重复 {{ detail.summary.duplicatedFamilies }} 组 / {{ detail.summary.duplicatedTraces }} 条 ·
            从未提取 {{ detail.summary.neverExtracted }} · 有 FSRS 状态 {{ detail.summary.withFsrsState }}
          </span>
          <button type="button" class="mr__btn" @click="copyDeepLink">复制深链</button>
          <button type="button" class="mr__btn" @click="closeDetail">收起</button>
        </div>

        <h4 class="mr__h4">课内温故计划（本节该接几个）</h4>
        <div v-if="detail.reviewPlan" class="mr__kpis mr__kpis--tight">
          <MkKpi label="负担预算" :value="detail.reviewPlan.budget" compact hint="负担单位，动态校准" />
          <MkKpi label="已占用" :value="detail.reviewPlan.usedLoad" compact />
          <MkKpi label="本节接几个" :value="detail.reviewPlan.items.length" compact />
          <MkKpi label="排队中" :value="detail.reviewPlan.backlogCount" :tone="detail.reviewPlan.backlogCount > 15 ? 'warn' : ''" compact />
          <MkKpi
            label="检索成功率"
            :value="detail.reviewPlan.successRate === null ? '—' : `${Math.round(detail.reviewPlan.successRate * 100)}%`"
            compact
            hint="<70% 收缩预算 / >90% 扩张"
          />
          <MkKpi label="需回路径重学" :value="detail.reviewPlan.relearnSuggestions.length" tone="warn" compact hint="连续没接上，已退出队列" />
          <MkKpi
            label="今日额度"
            :value="`${detail.reviewPlan.daily?.usedLoad ?? 0}/${detail.reviewPlan.daily?.limitLoad ?? '—'}`"
            :tone="(detail.reviewPlan.daily?.remainingLoad ?? 1) <= 0 ? 'warn' : ''"
            compact
            hint="跨会话共享，用完顺延到明天"
          />
          <MkKpi label="明日预计" :value="detail.reviewPlan.tomorrowCount ?? 0" compact hint="首页明日预告" />
        </div>

        <table v-if="detail.reviewPlan?.items.length" class="mr__table">
          <thead>
            <tr><th>概念</th><th class="mr__num">记忆强度</th><th>到期原因</th><th class="mr__num">负担</th><th>负担因子</th><th>来源路径</th></tr>
          </thead>
          <tbody>
            <tr v-for="item in detail.reviewPlan.items" :key="item.conceptKey">
              <td>{{ item.label }}<small class="mr__sub">{{ item.conceptKey }}</small></td>
              <td class="mr__num">{{ Math.round(item.retention * 100) }}%</td>
              <td>{{ item.reason }}</td>
              <td class="mr__num">{{ item.load }}</td>
              <td class="mr__sub">{{ item.loadFactors.join('、') || '—' }}</td>
              <td>{{ item.originPathTitle || '—' }}</td>
            </tr>
          </tbody>
        </table>

        <div v-if="detail.reviewPlan?.relearnSuggestions.length" class="mr__warn">
          <strong>建议回路径重学：</strong>
          <span v-for="item in detail.reviewPlan.relearnSuggestions" :key="item.conceptKey" class="mr__chip">
            {{ item.label }}（连续 {{ item.consecutiveAgain }} 次没接上）
          </span>
        </div>

        <h4 class="mr__h4">同族重复（「过多过杂」的直接证据）</h4>
        <p v-if="!detail.duplicatedFamilies.length" class="mr__sub">没有同族重复。</p>
        <table v-else class="mr__table">
          <thead><tr><th>族（归一化键）</th><th class="mr__num">条数</th><th>成员</th></tr></thead>
          <tbody>
            <tr v-for="family in detail.duplicatedFamilies" :key="family.family">
              <td>{{ family.family }}</td>
              <td class="mr__num">{{ family.size }}</td>
              <td class="mr__sub">
                <div v-for="member in family.members" :key="member.conceptKey">
                  {{ member.conceptKey }}（提取 {{ member.extractionCount }} · 掌握 {{ Math.round(member.masteryScore * 100) }}%）
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        <h4 class="mr__h4">到期清单预览（前 20，按记忆强度升序）</h4>
        <table v-if="detail.duePreview.length" class="mr__table">
          <thead><tr><th>概念</th><th class="mr__num">记忆强度</th><th class="mr__num">掌握</th><th class="mr__num">提取次数</th><th>来源</th><th>到期时间</th></tr></thead>
          <tbody>
            <tr v-for="trace in detail.duePreview" :key="trace.conceptKey">
              <td>{{ trace.label }}</td>
              <td class="mr__num" :class="{ 'mr__num--warn': trace.retention < 0.7 }">{{ Math.round(trace.retention * 100) }}%</td>
              <td class="mr__num">{{ Math.round(trace.masteryScore * 100) }}%</td>
              <td class="mr__num">{{ trace.extractionCount }}</td>
              <td class="mr__sub">{{ trace.source }}</td>
              <td>{{ trace.dueAt ? new Date(trace.dueAt).toLocaleString() : '—' }}</td>
            </tr>
          </tbody>
        </table>
        <MkEmptyState v-else title="当前没有到期点" />
      </div>

      <div class="mk-card">
        <div class="mk-card__head">
          <strong>概念归并审计</strong>
          <span class="mk-card__meta">
            <template v-if="detail.audit">
              {{ detail.audit.mode }} 模式 · {{ timeAgo(detail.audit.generatedAt) }} ·
              候选 {{ detail.audit.stats.candidates }} · 建议 {{ detail.audit.stats.proposed }} ·
              可自动 {{ detail.audit.stats.autoApplicable }} · 已执行 {{ detail.audit.stats.applied }} / 删除 {{ detail.audit.stats.deleted }}
            </template>
            <template v-else>尚未观察（点「重新观察」跑一次）</template>
          </span>
        </div>

        <template v-if="detail.audit">
          <h4 class="mr__h4">
            归并建议（canonical ← aliases）
            <span class="mr__sub-inline">
              勾选后执行；默认只勾选「可自动执行」的（把握度 + 词面闸门都过）。
              执行会改动该用户的 memory_traces，但会留整行前后快照，可回滚。
            </span>
          </h4>
          <div v-if="detail.audit.proposals.length" class="mr__bulk">
            <button type="button" class="mr__btn" @click="selectAllApplicable">全选可自动执行</button>
            <button type="button" class="mr__btn" @click="clearSelection">清空</button>
            <button
              type="button"
              class="mr__btn mr__btn--danger"
              :disabled="busy || selectedKeys.length === 0"
              @click="applySelected"
            >执行选中（{{ selectedKeys.length }}）</button>
            <span v-if="selectedNeedsReview.length" class="mr__warn-inline">
              {{ selectedNeedsReview.length }} 条属于「需人工确认」，执行前请先看清
            </span>
          </div>
          <table v-if="detail.audit.proposals.length" class="mr__table">
            <thead>
              <tr>
                <th></th>
                <th>规范键</th><th>别名</th><th class="mr__num">把握度</th><th class="mr__num">词面相似</th>
                <th>可自动执行</th><th>理由</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="proposal in detail.audit.proposals" :key="proposal.canonical">
                <td>
                  <input
                    type="checkbox"
                    :checked="selected[proposal.canonical] === true"
                    :data-auto="proposal.autoApplicable ? '1' : '0'"
                    @change="toggleSelect(proposal.canonical, proposal.autoApplicable)"
                  />
                </td>
                <td>{{ proposal.canonical }}</td>
                <td class="mr__sub">{{ proposal.aliases.join(' / ') }}</td>
                <td class="mr__num">{{ Math.round(proposal.confidence * 100) }}%</td>
                <td class="mr__num" :class="{ 'mr__num--warn': !proposal.autoApplicable }">{{ Math.round(proposal.lexicalSimilarity * 100) }}%</td>
                <td>{{ proposal.autoApplicable ? '是' : '需人工确认' }}</td>
                <td class="mr__sub">{{ proposal.rationale || '—' }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="mr__sub">本次没有达到把握度阈值的归并建议。</p>

          <h4 class="mr__h4">需人工看（ambiguous，不会被执行）</h4>
          <table v-if="detail.audit.ambiguous.length" class="mr__table">
            <thead><tr><th>A</th><th>B</th><th>理由</th></tr></thead>
            <tbody>
              <tr v-for="(item, index) in detail.audit.ambiguous" :key="`${item.a}-${item.b}-${index}`">
                <td>{{ item.a }}</td>
                <td>{{ item.b }}</td>
                <td class="mr__sub">{{ item.reason || '—' }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="mr__sub">没有待人工确认项。</p>

          <h4 class="mr__h4">已执行归并（可回滚 · 按次留档）</h4>
          <table v-if="rollbackableMerges.length" class="mr__table">
            <thead><tr><th>规范键</th><th>别名</th><th class="mr__num">删除条数</th><th>执行时间</th><th></th></tr></thead>
            <tbody>
              <tr v-for="merge in rollbackableMerges" :key="merge.mergeId || `${merge.canonical}-${merge.appliedAt}`">
                <td>{{ merge.canonical }}</td>
                <td class="mr__sub">{{ merge.aliases.join(' / ') }}</td>
                <td class="mr__num">{{ merge.deletedRows }}</td>
                <td>{{ new Date(merge.appliedAt).toLocaleString() }}</td>
                <td>
                  <button type="button" class="mr__btn" :disabled="busy" @click="rollbackOne(merge.canonical)">回滚</button>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-else class="mr__sub">没有可回滚的归并。</p>
          <p v-if="legacyWindowOnlyMerges.length" class="mr__sub">
            另有 {{ legacyWindowOnlyMerges.length }} 条早期归并：凭据只在审计窗口内（仍可回滚，但没有长期留档）——
            {{ legacyWindowOnlyMerges.map((m) => m.canonical).slice(0, 3).join('、') }}
          </p>
          <p v-if="rolledBackMerges.length" class="mr__sub">
            已回滚 {{ rolledBackMerges.length }} 条（保留凭据痕迹，不再重复回滚）：
            {{ rolledBackMerges.map((m) => m.canonical).slice(0, 3).join('、') }}
          </p>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { adminMemoryReviewApi } from '@/api/adminApi'
import MkKpi from './MkKpi.vue'
import MkEmptyState from './MkEmptyState.vue'
import { askConfirm } from './useConfirm'
import { toast } from '@/utils/toast'
import { errMsg, shortId, timeAgo } from './live'

interface AuditUserSummary {
  mode: string
  generatedAt: string
  candidates: number
  proposed: number
  autoApplicable: number
  ambiguous: number
  drops: number
  applied: number
  deleted: number
}

interface OverviewRow {
  userId: string
  name: string | null
  email: string | null
  isVirtualLearner: boolean
  traces: number
  due: number
  audit: AuditUserSummary | null
  /** 按次留档的归并凭据计数（权威；审计滚动窗口之外的历史归并也计入） */
  merges?: { rollbackable: number; rolledBack: number }
}

interface AppliedMergeView {
  mergeId: string | null
  canonical: string
  aliases: string[]
  appliedAt: string
  rolledBackAt: string | null
  deletedRows: number
}

const rollbackableCount = (row: OverviewRow) => {
  const merges = row.merges
  if (!merges) return '—'
  return merges.rolledBack > 0 ? `${merges.rollbackable}（已回滚 ${merges.rolledBack}）` : String(merges.rollbackable)
}

const rollbackableMerges = computed<AppliedMergeView[]>(() => detail.value?.appliedMerges?.rollbackable ?? [])
const rolledBackMerges = computed<AppliedMergeView[]>(() => detail.value?.appliedMerges?.rolledBack ?? [])
const legacyWindowOnlyMerges = computed<AppliedMergeView[]>(() => detail.value?.appliedMerges?.legacyWindowOnly ?? [])

const loading = ref(false)
const busy = ref(false)
const error = ref('')
const includeVirtual = ref(false)
const rows = ref<OverviewRow[]>([])
/** 页头状态档（R2）：到期积压 > 0 = 需关注且运营可行动；未加载 = 无数据（不猜） */
const headTone = computed(() => (loading.value || !totals.value.users ? 'muted' : totals.value.due > 0 ? 'warn' : 'ok'))
const totals = ref({
  users: 0,
  traces: 0,
  due: 0,
  usersWithAudit: 0,
  proposed: 0,
  autoApplicable: 0,
  ambiguous: 0,
  applied: 0,
  deleted: 0
})
const selectedId = ref('')// detail.appliedMerges = 按次留档的归并凭据视图（rollbackable / rolledBack / legacyWindowOnly）
const detail = ref<any>(null)
const route = useRoute()
const router = useRouter()
/** 勾选状态（key = 规范键）；默认只勾「可自动执行」的 */
const selected = ref<Record<string, boolean>>({})

const selectedKeys = computed(() => Object.keys(selected.value).filter((key) => selected.value[key]))
const selectedNeedsReview = computed(() => {
  const proposals = detail.value?.audit?.proposals ?? []
  return selectedKeys.value.filter((key) => {
    const proposal = proposals.find((item: any) => item.canonical === key)
    return proposal && !proposal.autoApplicable
  })
})

function resetSelection(audit: any) {
  const next: Record<string, boolean> = {}
  for (const proposal of audit?.proposals ?? []) next[proposal.canonical] = !!proposal.autoApplicable
  selected.value = next
}

function toggleSelect(canonical: string, _auto: boolean) {
  selected.value = { ...selected.value, [canonical]: !selected.value[canonical] }
}

function selectAllApplicable() {
  const next: Record<string, boolean> = {}
  for (const proposal of detail.value?.audit?.proposals ?? []) next[proposal.canonical] = !!proposal.autoApplicable
  selected.value = next
}

function clearSelection() {
  selected.value = {}
}

async function applySelected() {
  const keys = selectedKeys.value
  if (!keys.length) return
  const needsReview = selectedNeedsReview.value.length
  const ok = await askConfirm({
    title: '执行概念归并',
    message: needsReview > 0
      ? `将执行 ${keys.length} 条归并（其中 ${needsReview} 条属于「需人工确认」），会删除该用户的重复记忆痕迹。执行后可回滚，但请先确认这些确实是同一个概念。`
      : `将执行 ${keys.length} 条归并，会删除该用户的重复记忆痕迹（保留并字段后的那条）。执行后可回滚。`,
    confirmText: '执行归并',
    danger: true,
  })
  if (!ok) return
  busy.value = true
  error.value = ''
  try {
    const res: any = await adminMemoryReviewApi.apply(selectedId.value, keys, { includeNeedsReview: needsReview > 0 })
    const body = res.data?.data ?? res.data ?? {}
    toast.success(`已执行 ${body.applied ?? 0} 条归并${body.skipped?.length ? `，跳过 ${body.skipped.length} 条` : ''}`)
    await openDetail(selectedId.value)
    await loadOverview()
  } catch (e) {
    error.value = errMsg(e)
  } finally {
    busy.value = false
  }
}

async function rollbackOne(canonical: string) {
  const ok = await askConfirm({
    title: '回滚归并',
    message: `将「${canonical}」还原成合并前状态：胜出者恢复原字段，被删除的重复痕迹按快照重建。`,
    confirmText: '回滚',
    danger: true,
  })
  if (!ok) return
  busy.value = true
  error.value = ''
  try {
    const res: any = await adminMemoryReviewApi.rollback(selectedId.value, [canonical])
    const body = res.data?.data ?? res.data ?? {}
    toast.success(body.rolledBack ? '已回滚' : '未找到可回滚的记录')
    await openDetail(selectedId.value)
    await loadOverview()
  } catch (e) {
    error.value = errMsg(e)
  } finally {
    busy.value = false
  }
}

async function loadOverview() {
  loading.value = true
  error.value = ''
  try {
    const res: any = await adminMemoryReviewApi.overview({ limit: 50, includeVirtual: includeVirtual.value })
    const body = res.data?.data ?? res.data ?? {}
    rows.value = Array.isArray(body.users) ? body.users : []
    totals.value = { ...totals.value, ...(body.totals || {}) }
  } catch (e) {
    error.value = errMsg(e)
  } finally {
    loading.value = false
  }
}

async function openDetail(userId: string) {
  selectedId.value = userId
  busy.value = true
  error.value = ''
  try {
    const res: any = await adminMemoryReviewApi.detail(userId)
    detail.value = res.data?.data ?? res.data ?? null
    resetSelection(detail.value?.audit)
    // 双向深链：选中即写进 URL，页面可收藏/分享（进来时靠 route.query.userId 落位）
    if (route.query.userId !== userId) {
      router.replace({ query: { ...route.query, userId } })
    }
  } catch (e) {
    error.value = errMsg(e)
    // 坏深链（用户不存在/被删除）→ 清掉参数，避免地址栏一直挂着一个打不开的 id
    detail.value = null
    if (route.query.userId) {
      const next = { ...route.query }
      delete next.userId
      router.replace({ query: next })
    }
  } finally {
    busy.value = false
  }
}

/** 收起明细：同时清掉 URL 上的 userId（否则刷新又会弹回来） */
function closeDetail() {
  detail.value = null
  selectedId.value = ''
  if (route.query.userId) {
    const next = { ...route.query }
    delete next.userId
    router.replace({ query: next })
  }
}

/** 复制当前学习者的深链（供运维贴到工单/IM，不必手拼 URL） */
async function copyDeepLink() {
  const userId = selectedId.value || String(route.query.userId || '')
  if (!userId) return
  const link = `${window.location.origin}${route.path}?userId=${encodeURIComponent(userId)}`
  try {
    await navigator.clipboard.writeText(link)
    toast.success('深链已复制')
  } catch {
    // 剪贴板不可用（非安全上下文等）→ 至少把链接展示出来，不让操作静默失败
    toast.error(link)
  }
}

async function recompute(userId: string) {
  busy.value = true
  error.value = ''
  try {
    await adminMemoryReviewApi.recompute(userId)
    await openDetail(userId)
    await loadOverview()
  } catch (e) {
    error.value = errMsg(e)
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  await loadOverview()
  // 深链：/admin/memory-review?userId=xxx 直接落到该用户明细（供学习者详情等入口跳转）
  const queryUserId = route.query.userId
  if (typeof queryUserId === 'string' && queryUserId) {
    await openDetail(queryUserId)
  }
})
</script>

<style scoped>
.mr { display: grid; gap: 14px; }
.mr__lead { margin: 4px 0 0; font-size: 12px; color: var(--mk-muted, #5b6577); max-width: 720px; line-height: 1.6; }
.mr__filter { display: flex; align-items: center; gap: 12px; margin-top: 6px; }
.mr__toggle { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--mk-muted, #5b6577); }
.mr__kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.mr__kpis--tight { margin-bottom: 10px; }
.mr__h4 { margin: 14px 0 6px; font-size: 13px; font-weight: 700; color: var(--mk-ink); }
.mr__table { width: 100%; border-collapse: collapse; font-size: 12px; }
.mr__table th, .mr__table td { padding: 7px 8px; border-bottom: 1px solid var(--mk-line); text-align: left; vertical-align: top; }
.mr__table th { font-weight: 700; color: var(--mk-faint, #5f6f8c); white-space: nowrap; }
.mr__num { text-align: right; font-variant-numeric: tabular-nums; }
.mr__num--warn { color: var(--mk-amber); font-weight: 700; }
.mr__sub { display: block; color: var(--mk-muted, #5b6577); font-size: 11px; }
.mr__tag { margin-left: 6px; padding: 1px 6px; border-radius: 999px; background: var(--mk-blue-bg); color: var(--mk-accent-deep); font-size: 10px; }
.mr__row--active { background: var(--mk-blue-bg); }
.mr__actions { display: flex; gap: 6px; }
.mr__btn { padding: 3px 9px; border: 1px solid var(--mk-line); border-radius: 7px; background: var(--mk-surface); font-size: 12px; cursor: pointer; }
.mr__btn:disabled { opacity: 0.5; cursor: not-allowed; }
.mr__error { margin: 6px 0; color: var(--mk-red-strong); font-size: 12px; }
.mr__warn { margin-top: 8px; padding: 8px 10px; border-radius: 9px; border: 1px solid rgba(217, 119, 6, 0.3); background: rgba(217, 119, 6, 0.06); font-size: 12px; }
.mr__chip { display: inline-block; margin-left: 8px; }
.mr__detail { display: grid; gap: 14px; }
.mr__sub-inline { margin-left: 8px; font-weight: 400; color: var(--mk-muted, #5b6577); font-size: 11px; }
.mr__bulk { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 6px 0 10px; }
.mr__warn-inline { color: var(--mk-amber); font-size: 11px; }
.mr__btn--danger { border-color: rgba(185, 28, 28, 0.35); color: var(--mk-red-strong); }
</style>
