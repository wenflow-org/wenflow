<template>
  <div class="mr mk-page mk-page--fill">
    <header class="mk-status" :class="`mk-status--${headTone}`">
      <span class="mk-status__dot" aria-hidden="true"></span>
      <!-- 口径与术语：2026-09-28 撤掉独立折叠卡（首屏第一块是说明卡、且三句话的术语各自
           在用到的地方已有 title：到期列头 / 队列各档 / 重新观察按钮）。scope 与观察模式
           两句合并进页标题的 title，信息不落地丢失。 -->
      <strong
        class="mk-status__title"
        title="记忆层（用户级、跨 path）：到期积压 · 课内温故配额 · 概念归并审计；归并默认观察模式，只记录建议，不动 memory_traces"
      >记忆与复习观测</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__actions">
        <!-- 作用域开关收在状态条（原在「记忆层概览」卡头）：它切换的是整页口径，
             而卡片区读起来像「表格控件」。绝对值移到 KPI 区后状态条只留身份 + 作用域 + 操作。 -->
        <label class="mk-status__scope" title="切换后整页重新统计：含虚拟学习者时，用户 / 痕迹 / 到期与归并队列一并纳入仿真账号">
          <input v-model="includeVirtual" type="checkbox" @change="refreshAll" />
          包含虚拟学习者
        </label>
        <button type="button" class="mk-status__action" :disabled="loading" @click="refreshAll">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
      </span>
    </header>
    <!-- 页头 KPI 区（2026-09-28）：原「状态条散文 3 数 + 概览卡 880px 构成条 + 四张队列卡」
         三处各说一遍同一批数。现在全站页头统一为 MkKpi 卡栅格（同总览/健康中心/成本分析形态），
         页级绝对值只在这里出现一次；口径说明进各卡 title，比例条由「占痕迹 N%」副行承担。 -->
    <section class="mk-kpi-grid">
      <MkKpi
        v-for="card in overviewCards"
        :key="card.label"
        :label="card.label"
        :value="card.value"
        :hint="card.hint"
        :tone="card.tone"
        :title="card.title"
      />
    </section>

    <div class="mk-card mk-card--fill">
      <div class="mk-card__head">
        <h3 class="mk-card__title">用户列表</h3>
        <!-- 口径：totals.users 是后端全量统计，列表只取痕迹数倒序前 N 且暂无分页——
             两个数字必须同时给出，否则「页头 137 / 表下共 50」读起来像数据缺失 -->
        <span class="mk-card__meta" title="后端口径为全量有记忆痕迹用户；列表按痕迹数倒序只取前 {{ rows.length }} 名，暂无分页">共 {{ totals.users }} 位有记忆痕迹用户（展示前 {{ rows.length }}）· 按痕迹数倒序</span>
      </div>
      <p v-if="error" class="mr__error">{{ error }}</p>
      <MockSkeletonTable v-if="loading && !rows.length" :cols="5" :rows="8" />
      <MkEmptyState v-else-if="!loading && !rows.length" title="暂无记忆痕迹数据" description="当前口径内还没有用户产生记忆痕迹。等学习者开始学习并完成概念提取后，这里会按痕迹数倒序列出用户。" />
      <!-- 用户列表（2026-09-27 由 10 列密表收敛；2026-09-28 收回表头）：
           行列表没有表头，右侧两个裸数字（到期积压 / 待人工看）读者无从判断含义。
           保留「只留要动手的信号、其余计数进明细卡」这个决定，只补回表头与排序键：
           用户 | 痕迹（本表倒序键）| 到期 | 需人工看 | 操作。
           fixed 表的 colgroup 即比例契约，每列都要给宽度（ADMIN_COLUMN_WIDTH_SPEC）。 -->
      <div v-else class="mk-table-scroll">
        <table class="mk-table mk-table--click mk-table--fixed">
          <colgroup>
            <col style="width:var(--mk-col-text)" />
            <col style="width:var(--mk-col-num)" />
            <col style="width:var(--mk-col-num-wide)" />
            <col style="width:var(--mk-col-num)" />
            <col style="width:var(--mk-col-actions-wide)" />
          </colgroup>
          <thead>
            <tr>
              <th>用户</th>
              <th class="mk-num" title="该用户名下的记忆痕迹总数；本表按此列倒序">痕迹</th>
              <th class="mk-num" title="到该复习而未复习的痕迹数；条内小条 = 占该用户痕迹比例">到期</th>
              <th class="mk-num" title="像但不确定的归并候选，需人工确认，不会自动执行">需人工看</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rows"
              :key="row.userId"
              :class="{ 'mr__row--active': row.userId === selectedId }"
              @click="openDetail(row.userId)"
            >
              <td>
                <div class="mr__user">
                  <MkCellAvatar :name="row.name" :tone="row.isVirtualLearner ? 'virtual' : 'default'" />
                  <div class="mk-cell-main">
                    <strong>{{ row.name || '未命名' }}</strong>
                    <span class="mk-cell-sub">{{ shortId(row.userId) }}</span>
                  </div>
                  <MkVariantBadge v-if="row.isVirtualLearner" kind="virtual" />
                </div>
              </td>
              <td class="mk-num">{{ row.traces }}</td>
              <td class="mk-num">
                <span class="mr__due" :class="`mr__due--${dueTone(row)}`" :title="`到该复习而未复习 ${row.due} 条，占该用户痕迹 ${duePctOf(row)}%`">
                  <b>{{ row.due }}</b>
                  <span class="mr__due-bar" aria-hidden="true"><i :style="{ width: duePctOf(row) + '%' }"></i></span>
                </span>
              </td>
              <td class="mk-num">
                <span v-if="row.audit?.ambiguous" class="mr__need" :title="`${row.audit.ambiguous} 条归并候选需人工确认，不会自动执行`">{{ row.audit.ambiguous }}</span>
                <span v-else class="mk-na" title="没有待人工确认的归并候选">—</span>
              </td>
              <td class="mk-actions">
                <button type="button" class="mk-btn mk-btn--sm" @click.stop="openDetail(row.userId)">明细</button>
                <button type="button" class="mk-btn mk-btn--sm" :disabled="recomputingId === row.userId" title="对该用户手动跑一次记忆复盘，结果实时刷新；数据源为该用户全部学习路径下的记忆痕迹" @click.stop="recompute(row.userId)">{{ recomputingId === row.userId ? '观察中…' : '重新观察' }}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

    <div v-if="detail" class="mr__detail">
      <div class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">明细 · {{ detail.user.name || '未命名' }}</h3>
          <span class="mk-card__meta">
            痕迹 {{ detail.summary.traces }} · 到期 {{ detail.summary.due }} ·
            同族重复 {{ detail.summary.duplicatedFamilies }} 组 / {{ detail.summary.duplicatedTraces }} 条 ·
            从未提取 {{ detail.summary.neverExtracted }} · 有 FSRS 状态 {{ detail.summary.withFsrsState }}
          </span>
          <button type="button" class="mk-btn mk-btn--sm" @click="copyDeepLink">复制深链</button>
          <button type="button" class="mk-btn mk-btn--sm" @click="closeDetail">收起</button>
        </div>

        <!-- 温故计划整块按 detail.reviewPlan 有无渲染：reviewPlan=null 时原来只剩一个裸标题 -->
        <template v-if="detail.reviewPlan">
          <h4 class="mr__h4">课内温故计划（本节该接几个）</h4>
          <MkStatStrip :items="planKpiItems" />

          <div v-if="detail.reviewPlan?.items.length" class="mk-table-scroll">
          <table class="mk-table">
            <thead>
              <tr><th>概念</th><th class="mk-num">记忆强度</th><th>到期原因</th><th class="mk-num">负担</th><th>负担因子</th><th>来源路径</th></tr>
            </thead>
            <tbody>
              <tr v-for="item in detail.reviewPlan.items" :key="item.conceptKey">
                <td>{{ item.label }}<small class="mr__sub">{{ item.conceptKey }}</small></td>
                <td class="mk-num">
                  <span class="mr-pct" :class="{ 'mr-pct--warn': item.retention < 0.7 }" :title="`记忆强度 ${Math.round(item.retention * 100)}%，低于 70% 优先安排`">
                    <b>{{ Math.round(item.retention * 100) }}%</b>
                    <span class="mr-pct__bar" aria-hidden="true"><i :style="{ width: Math.round(item.retention * 100) + '%' }"></i></span>
                  </span>
                </td>
                <td>{{ item.reason }}</td>
                <td class="mk-num">{{ item.load }}</td>
                <td class="mr__sub">{{ item.loadFactors.join('、') || '—' }}</td>
                <td>{{ item.originPathTitle || '—' }}</td>
              </tr>
            </tbody>
          </table>
          </div>
          <p v-else class="mr__sub">当前没有需要在本节接住的记忆点。</p>

          <div v-if="detail.reviewPlan?.relearnSuggestions.length" class="mr__warn">
            <strong>建议回路径重学：</strong>
            <span v-for="item in detail.reviewPlan.relearnSuggestions" :key="item.conceptKey" class="mr__chip">
              {{ item.label }}（连续 {{ item.consecutiveAgain }} 次没接上）
            </span>
          </div>
        </template>
        <p v-else class="mr__sub">暂无温故计划：该用户名下还没有可安排的记忆痕迹。</p>

        <h4 class="mr__h4">同族重复（「过多过杂」的直接证据）</h4>
        <p v-if="!detail.duplicatedFamilies.length" class="mr__sub">没有同族重复。</p>
        <div v-else class="mk-table-scroll">
      <table class="mk-table">
          <thead><tr><th>族（归一化键）</th><th class="mk-num">条数</th><th>成员</th></tr></thead>
          <tbody>
            <tr v-for="family in detail.duplicatedFamilies" :key="family.family">
              <!-- 归一化键没有人类可读 label（后端只回 key）→ 同 负担因子 口径降为 sub，不冒充正文 -->
              <td class="mr__sub">{{ family.family }}</td>
              <td class="mk-num">{{ family.size }}</td>
              <td class="mr__sub">
                <div v-for="member in family.members" :key="member.conceptKey">
                  {{ member.conceptKey }}（提取 {{ member.extractionCount }} · 掌握 {{ Math.round(member.masteryScore * 100) }}%）
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        </div>

        <h4 class="mr__h4">到期清单预览（前 20，按记忆强度升序）</h4>
        <div v-if="detail.duePreview.length" class="mk-table-scroll">
          <table class="mk-table">
          <thead><tr><th>概念</th><th class="mk-num">记忆强度</th><th class="mk-num">掌握</th><th class="mk-num">提取次数</th><th>来源</th><th>到期时间</th></tr></thead>
          <tbody>
            <tr v-for="trace in detail.duePreview" :key="trace.conceptKey">
              <td>{{ trace.label }}</td>
              <td class="mk-num">
                <span class="mr-pct" :class="{ 'mr-pct--warn': trace.retention < 0.7 }" :title="`记忆强度 ${Math.round(trace.retention * 100)}%`">
                  <b>{{ Math.round(trace.retention * 100) }}%</b>
                  <span class="mr-pct__bar" aria-hidden="true"><i :style="{ width: Math.round(trace.retention * 100) + '%' }"></i></span>
                </span>
              </td>
              <td class="mk-num">
                <span class="mr-pct" :title="`掌握 ${Math.round(trace.masteryScore * 100)}%`">
                  <b>{{ Math.round(trace.masteryScore * 100) }}%</b>
                  <span class="mr-pct__bar mr-pct__bar--blue" aria-hidden="true"><i :style="{ width: Math.round(trace.masteryScore * 100) + '%' }"></i></span>
                </span>
              </td>
              <td class="mk-num">{{ trace.extractionCount }}</td>
              <td class="mr__sub">{{ trace.source }}</td>
              <td>{{ trace.dueAt ? new Date(trace.dueAt).toLocaleString() : '—' }}</td>
            </tr>
          </tbody>
        </table>
          </div>
        <MkEmptyState v-else title="当前没有到期点" description="该用户的记忆痕迹都还没到复习时间；到期后会按记忆强度升序列在这里（前 20 条）。" />
      </div>

      <div class="mk-card">
        <div class="mk-card__head">
          <h3 class="mk-card__title">概念归并审计</h3>
          <span class="mk-card__meta">
            <template v-if="detail.audit">{{ detail.audit.mode }} 模式 · {{ timeAgo(detail.audit.generatedAt) }}</template>
            <template v-else>尚未观察（点「重新观察」跑一次）</template>
          </span>
        </div>
        <!-- 审计计数（批E）：卡头 6 计数平摊 → 处理队列四格（与概览带同一语言） -->
        <div v-if="detail.audit" class="mr-audit-queue">
          <div class="mr-audit-queue__item">
            <b>{{ detail.audit.stats.candidates }}</b><span>候选</span>
          </div>
          <div class="mr-audit-queue__item">
            <b>{{ detail.audit.stats.proposed }}</b><span>建议</span>
          </div>
          <div class="mr-audit-queue__item" :class="{ 'mr-audit-queue__item--hot': detail.audit.stats.autoApplicable > 0 }">
            <b>{{ detail.audit.stats.autoApplicable }}</b><span>可自动</span>
          </div>
          <div class="mr-audit-queue__item" :class="{ 'mr-audit-queue__item--hot': detail.audit.stats.ambiguous > 0 }">
            <b>{{ detail.audit.stats.ambiguous }}</b><span>需人工看</span>
          </div>
          <div class="mr-audit-queue__item mr-audit-queue__item--quiet">
            <b>{{ detail.audit.stats.applied }}<i>/{{ detail.audit.stats.deleted }}</i></b><span>已执行 / 删除</span>
          </div>
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
            <button type="button" class="mk-btn mk-btn--sm" @click="selectAllApplicable">全选可自动执行</button>
            <button type="button" class="mk-btn mk-btn--sm" @click="clearSelection">清空</button>
            <button
              type="button"
              class="mk-btn mk-btn--sm mk-btn--danger-ghost"
              :disabled="busy || selectedKeys.length === 0"
              @click="applySelected"
            >执行选中（{{ selectedKeys.length }}）</button>
            <span v-if="selectedNeedsReview.length" class="mr__warn-inline">
              {{ selectedNeedsReview.length }} 条属于「需人工确认」，执行前请先看清
            </span>
          </div>
          <div v-if="detail.audit.proposals.length" class="mk-table-scroll">
          <table class="mk-table">
            <thead>
              <tr>
                <th class="mr__th-check">选择</th>
                <th>规范键</th><th>别名</th><th class="mk-num">把握度</th><th class="mk-num">词面相似</th>
                <th>可自动执行</th><th>理由</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="proposal in detail.audit.proposals" :key="proposal.canonical">
                <td>
                  <input
                    type="checkbox"
                    :checked="selected[proposal.canonical] === true"
                    :aria-label="`勾选执行归并：${proposal.canonical}${proposal.autoApplicable ? '' : '（需人工确认）'}`"
                    @change="toggleSelect(proposal.canonical, proposal.autoApplicable)"
                  />
                </td>
                <td class="mr__sub">{{ proposal.canonical }}</td>
                <td class="mr__sub">{{ proposal.aliases.join(' / ') }}</td>
                <td class="mk-num">
                  <span class="mr-pct" :title="`把握度 ${Math.round(proposal.confidence * 100)}%`">
                    <b>{{ Math.round(proposal.confidence * 100) }}%</b>
                    <span class="mr-pct__bar mr-pct__bar--blue" aria-hidden="true"><i :style="{ width: Math.round(proposal.confidence * 100) + '%' }"></i></span>
                  </span>
                </td>
                <td class="mk-num">
                  <span class="mr-pct" :class="{ 'mr-pct--warn': !proposal.autoApplicable }" :title="`词面相似 ${Math.round(proposal.lexicalSimilarity * 100)}%${proposal.autoApplicable ? '' : '（未过词面闸门）'}`">
                    <b>{{ Math.round(proposal.lexicalSimilarity * 100) }}%</b>
                    <span class="mr-pct__bar" aria-hidden="true"><i :style="{ width: Math.round(proposal.lexicalSimilarity * 100) + '%' }"></i></span>
                  </span>
                </td>
                <td>{{ proposal.autoApplicable ? '是' : '需人工确认' }}</td>
                <td class="mr__sub">{{ proposal.rationale || '—' }}</td>
              </tr>
            </tbody>
          </table>
          </div>
          <p v-else class="mr__sub">本次没有达到把握度阈值的归并建议。</p>

          <h4 class="mr__h4">需人工看（ambiguous，不会被执行）</h4>
          <div v-if="detail.audit.ambiguous.length" class="mk-table-scroll">
          <table class="mk-table">
            <thead><tr><th>A</th><th>B</th><th>理由</th></tr></thead>
            <tbody>
              <tr v-for="(item, index) in detail.audit.ambiguous" :key="`${item.a}-${item.b}-${index}`">
                <td>{{ item.a }}</td>
                <td>{{ item.b }}</td>
                <td class="mr__sub">{{ item.reason || '—' }}</td>
              </tr>
            </tbody>
          </table>
          </div>
          <p v-else class="mr__sub">没有待人工确认项。</p>

          <h4 class="mr__h4">已执行归并（可回滚 · 按次留档）</h4>
          <div v-if="rollbackableMerges.length" class="mk-table-scroll">
          <table class="mk-table">
            <thead><tr><th>规范键</th><th>别名</th><th class="mk-num">删除条数</th><th>执行时间</th><th></th></tr></thead>
            <tbody>
              <tr v-for="merge in rollbackableMerges" :key="merge.mergeId || `${merge.canonical}-${merge.appliedAt}`">
                <td class="mr__sub">{{ merge.canonical }}</td>
                <td class="mr__sub">{{ merge.aliases.join(' / ') }}</td>
                <td class="mk-num">{{ merge.deletedRows }}</td>
                <td>{{ new Date(merge.appliedAt).toLocaleString() }}</td>
                <td>
                  <button type="button" class="mk-btn mk-btn--sm" :disabled="busy" @click="rollbackOne(merge.canonical)">回滚</button>
                </td>
              </tr>
            </tbody>
          </table>
          </div>
          <p v-else class="mr__sub">没有可回滚的归并。</p>
          <p v-if="legacyWindowOnlyMerges.length" class="mr__sub">
            另有 {{ legacyWindowOnlyMerges.length }} 条早期归并：凭据只在审计窗口内（没有长期留档，页面内暂不支持回滚，如需回滚请联系管理员）——
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
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { adminMemoryReviewApi } from '@/api/adminApi'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkKpi from '@/components/mk/MkKpi.vue'
import MkStatStrip from '@/components/mk/MkStatStrip.vue'
import MkCellAvatar from '@/components/mk/MkCellAvatar.vue'
import MkVariantBadge from '@/components/mk/MkVariantBadge.vue'
import MockSkeletonTable from './SkeletonTable.vue'
import type { MkStatItem } from '@/components/mk/MkStatStrip.vue'
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

/** 明细响应类型（P3 量力补齐）：只声明模板/脚本实际读取的字段，后端多余字段不声明 */
interface ReviewPlanItem {
  conceptKey: string
  label: string
  retention: number
  reason?: string
  load: number
  loadFactors: string[]
  originPathTitle?: string | null
  consecutiveAgain?: number
}

interface ReviewDetail {
  user: { name: string | null }
  summary: {
    traces: number
    due: number
    duplicatedFamilies: number
    duplicatedTraces: number
    neverExtracted: number
    withFsrsState: number
  }
  reviewPlan: {
    budget: number
    usedLoad: number
    backlogCount: number
    successRate: number | null
    items: ReviewPlanItem[]
    relearnSuggestions: ReviewPlanItem[]
    daily?: { usedLoad?: number; limitLoad?: number; remainingLoad?: number } | null
    tomorrowCount?: number | null
  } | null
  audit: {
    mode: string
    generatedAt: string
    stats: { candidates: number; proposed: number; autoApplicable: number; ambiguous: number; applied: number; deleted: number }
    proposals: Array<{ canonical: string; aliases: string[]; confidence: number; lexicalSimilarity: number; autoApplicable: boolean; rationale?: string | null }>
    ambiguous: Array<{ a: string; b: string; reason?: string | null }>
  } | null
  appliedMerges?: {
    rollbackable: AppliedMergeView[]
    rolledBack: AppliedMergeView[]
    legacyWindowOnly: AppliedMergeView[]
  }
  duplicatedFamilies: Array<{ family: string; size: number; members: Array<{ conceptKey: string; extractionCount: number; masteryScore: number }> }>
  duePreview: Array<{ conceptKey: string; label: string; retention: number; masteryScore: number; extractionCount: number; source?: string | null; dueAt?: string | null }>
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

/* ---- 页头 KPI 区（2026-09-28 收口后的派生） ---- */
const duePct = computed(() => (totals.value.traces ? Math.round((totals.value.due / totals.value.traces) * 100) : 0));

interface OverviewCard {
  label: string
  value: string | number
  hint: string
  title: string
  tone?: 'ok' | 'warn' | 'bad' | ''
}

/** 页级绝对值单一来源：用户 / 痕迹 / 到期 / 归并队列都只在 KPI 区出现一次（原状态条散文与
 *  概览卡 legend 各重说一遍）。到期与需人工看是运营可行动项，>0 才抬琥珀；其余保持中性墨色。 */
const overviewCards = computed<OverviewCard[]>(() => {
  const t = totals.value;
  return [
    {
      label: '用户',
      value: t.users,
      hint: '有记忆痕迹',
      title: '后端口径为全量有记忆痕迹用户；是否含虚拟学习者随状态条开关'
    },
    {
      label: '记忆痕迹',
      value: t.traces,
      hint: '跨全部学习路径',
      title: '记忆层痕迹总数（用户级、跨该用户全部 path）'
    },
    {
      label: '当前到期',
      value: t.due,
      hint: t.traces ? `占痕迹 ${duePct.value}%` : '暂无痕迹',
      tone: t.due > 0 ? 'warn' : '',
      title: `到该复习而未复习 ${t.due} 条，占全部痕迹 ${duePct.value}%`
    },
    {
      label: '需人工看',
      value: t.ambiguous,
      hint: '归并候选 · 不自动执行',
      tone: t.ambiguous > 0 ? 'warn' : '',
      title: '像但不确定的归并候选，需人工确认，不会自动执行'
    },
    {
      label: '待归并建议',
      value: t.proposed,
      hint: `可自动 ${t.autoApplicable} · 已执行 ${t.applied}/${t.deleted}`,
      title: '模型给出的同义候选；「可自动」= 把握度 + 词面闸门都过；「已执行 / 删除」留快照可回滚'
    }
  ];
});

/** 到期压力档：0=安静；占痕迹 ≥50% 或绝对数 ≥12 = 重压（红）；其余 = 提醒（琥珀） */
function dueTone(row: OverviewRow): 'none' | 'warn' | 'high' {
  if (!row.due) return 'none';
  const pct = row.traces ? (row.due / row.traces) * 100 : 100;
  return pct >= 50 || row.due >= 12 ? 'high' : 'warn';
}
function duePctOf(row: OverviewRow): number {
  return row.traces ? Math.min(Math.round((row.due / row.traces) * 100), 100) : row.due ? 100 : 0;
}
/** 明细 · 课内温故计划 KPI 条（MkStatStrip，与虚拟学习者页头同一组件；hint 收进 title） */
const planKpiItems = computed<MkStatItem[]>(() => {
  const plan = detail.value?.reviewPlan
  if (!plan) return []
  return [
    { key: 'budget', label: '负担预算', value: plan.budget, title: '负担单位，动态校准' },
    { key: 'used', label: '已占用', value: plan.usedLoad },
    { key: 'items', label: '本节接几个', value: plan.items.length },
    { key: 'backlog', label: '排队中', value: plan.backlogCount, tone: plan.backlogCount > 15 ? 'warn' : '' },
    {
      key: 'success',
      label: '检索成功率',
      value: plan.successRate === null ? '—' : `${Math.round(plan.successRate * 100)}%`,
      title: '<70% 收缩预算 / >90% 扩张'
    },
    { key: 'relearn', label: '需回路径重学', value: plan.relearnSuggestions.length, tone: 'warn', title: '连续没接上，已退出队列' },
    {
      key: 'daily',
      label: '今日额度',
      value: `${plan.daily?.usedLoad ?? 0}/${plan.daily?.limitLoad ?? '—'}`,
      tone: (plan.daily?.remainingLoad ?? 1) <= 0 ? 'warn' : '',
      title: '跨会话共享，用完顺延到明天'
    },
    { key: 'tomorrow', label: '明日预计', value: plan.tomorrowCount ?? 0, title: '首页明日预告' }
  ]
})
const selectedId = ref('')// detail.appliedMerges = 按次留档的归并凭据视图（rollbackable / rolledBack / legacyWindowOnly）
const detail = ref<ReviewDetail | null>(null)
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

function resetSelection(audit?: ReviewDetail['audit']) {
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
      : `将执行 ${keys.length} 条归并，会删除该用户的重复记忆痕迹（保留合并字段后的那条）。执行后可回滚。`,
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

/* last-wins 代际号（P2）：快速点行 / 切「包含虚拟学习者」时，旧响应不得覆盖新状态 */
let overviewSeq = 0
let detailSeq = 0

async function loadOverview() {
  const seq = ++overviewSeq
  loading.value = true
  error.value = ''
  try {
    const res: any = await adminMemoryReviewApi.overview({ limit: 50, includeVirtual: includeVirtual.value })
    if (seq !== overviewSeq) return // 已有更新的概览请求在途/完成：丢弃过期响应
    const body = res.data?.data ?? res.data ?? {}
    rows.value = Array.isArray(body.users) ? body.users : []
    totals.value = { ...totals.value, ...(body.totals || {}) }
  } catch (e) {
    if (seq !== overviewSeq) return
    error.value = errMsg(e)
  } finally {
    // 只有最新一代才能收 loading，否则会把在途新请求的骨架屏提前打断
    if (seq === overviewSeq) loading.value = false
  }
}

async function openDetail(userId: string) {
  const seq = ++detailSeq
  selectedId.value = userId
  busy.value = true
  error.value = ''
  try {
    const res: any = await adminMemoryReviewApi.detail(userId)
    if (seq !== detailSeq) return // 用户已点了另一行：丢弃本次过期明细
    detail.value = res.data?.data ?? res.data ?? null
    resetSelection(detail.value?.audit)
    // 双向深链：选中即写进 URL，页面可收藏/分享（进来时靠 route.query.userId 落位）
    if (route.query.userId !== userId) {
      router.replace({ query: { ...route.query, userId } })
    }
  } catch (e) {
    if (seq !== detailSeq) return
    error.value = errMsg(e)
    // 坏深链（用户不存在/被删除）→ 清掉参数，避免地址栏一直挂着一个打不开的 id
    detail.value = null
    if (route.query.userId) {
      const next = { ...route.query }
      delete next.userId
      router.replace({ query: next })
    }
  } finally {
    if (seq === detailSeq) busy.value = false
  }
}

/** 页头刷新：概览必刷；已选明细一并刷，避免上下两块数据口径不同步 */
async function refreshAll() {
  await loadOverview()
  if (selectedId.value) await openDetail(selectedId.value)
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

/** 行内「重新观察」进行中标记：只转该行按钮文案，不锁整页 */
const recomputingId = ref('')

async function recompute(userId: string) {
  busy.value = true
  recomputingId.value = userId
  error.value = ''
  try {
    await adminMemoryReviewApi.recompute(userId)
    await openDetail(userId)
    await loadOverview()
    toast.success('已完成一次记忆复盘')
  } catch (e) {
    error.value = errMsg(e)
  } finally {
    busy.value = false
    recomputingId.value = ''
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
.mr { display: flex; flex-direction: column; }

/* ===== 用户列表（2026-09-28：表头回归——行列表没有表头，右侧裸数字无从解读）===== */
/* 身份格：头像 + 名称/shortId + 虚拟徽章；名称溢出由 .mk-cell-main 统一截断 */
.mr__user { display: flex; align-items: center; gap: 9px; min-width: 0; }
.mr__user .mk-cell-main { min-width: 0; flex: 1; }

/* 到期压力条：数字在上、比例条在下；右对齐与同列的数字表头对齐 */
.mr__due { display: grid; gap: 3px; justify-items: end; }
.mr__due b { font-variant-numeric: tabular-nums; font-weight: 700; }
.mr__due--none b { color: var(--mk-faint); font-weight: 400; }
.mr__due--warn b { color: var(--mk-amber); }
.mr__due--high b { color: var(--mk-red-strong); }
.mr__due-bar { display: block; width: 64px; height: 4px; border-radius: var(--mk-radius-pill); background: var(--mk-surface-2); overflow: hidden; }
.mr__due-bar i { display: block; height: 100%; border-radius: var(--mk-radius-pill); background: var(--mk-amber); }
.mr__due--none .mr__due-bar i { background: var(--mk-faint); opacity: 0.35; }
.mr__due--high .mr__due-bar i { background: var(--mk-red-fill); }

/* 需人工看：>0 抬成琥珀胶囊；0 压成安静破折号 */
.mr__need {
  display: inline-block; min-width: 22px; text-align: center;
  padding: 1px 8px; border-radius: var(--mk-radius-pill);
  background: color-mix(in srgb, var(--mk-amber) 14%, transparent);
  color: var(--mk-amber); font-weight: 700; font-variant-numeric: tabular-nums;
}

.mr__h4 { margin: 14px 0 6px; font-size: var(--mk-fs-body); font-weight: 700; color: var(--mk-ink); }
/* 归并表勾选列表头：收窄，别把「选择」撑成正文列宽 */
.mr__th-check { width: 40px; }
.mr__sub { display: block; color: var(--mk-muted, #5b6577); font-size: var(--mk-fs-micro); }
.mr__row--active { background: var(--mk-blue-bg); }
.mr__error { margin: 6px 0; color: var(--mk-red-strong); font-size: var(--mk-fs-micro); }
/* 琥珀改走 --mk-amber color-mix：暗色主题自动适配（原 rgba(217,119,6) 是写死的浅色语义） */
.mr__warn { margin-top: 8px; padding: 8px 10px; border-radius: var(--mk-radius-xl); border: 1px solid color-mix(in srgb, var(--mk-amber) 30%, transparent); background: color-mix(in srgb, var(--mk-amber) 6%, transparent); font-size: var(--mk-fs-micro); }
.mr__chip { display: inline-block; margin-left: 8px; }
.mr__detail { display: grid; gap: 14px; }
/* 明细区百分比列（批E）：数字+色阶条，与概览带/用户表同一语言 */
.mr-pct { display: grid; gap: 2px; justify-items: start; }
.mr-pct b { font-variant-numeric: tabular-nums; font-weight: 700; }
.mr-pct__bar { display: block; width: 52px; height: 4px; border-radius: var(--mk-radius-pill); background: var(--mk-surface-2); overflow: hidden; }
.mr-pct__bar i { display: block; height: 100%; border-radius: var(--mk-radius-pill); background: var(--mk-green); }
.mr-pct__bar--blue i { background: var(--mk-blue); }
.mr-pct--warn .mr-pct__bar i { background: var(--mk-amber); }
.mr-pct--warn b { color: var(--mk-amber); }
/* 审计处理队列（批E）：复用概览带队列格语言 */
/* auto-fit：窄屏不挤成 5 等份，宽屏不浪费（原固定 repeat(5) 在窄屏下每格 <100px） */
.mr-audit-queue { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; padding: 10px 16px 4px; }
.mr-audit-queue__item { display: grid; gap: 1px; padding: 8px 11px; border-radius: var(--mk-radius-lg); background: var(--mk-surface-2); }
.mr-audit-queue__item--hot { background: color-mix(in srgb, var(--mk-amber) 10%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--mk-amber) 32%, transparent); }
.mr-audit-queue__item--hot b { color: var(--mk-amber); }
.mr-audit-queue__item--quiet { background: transparent; }
.mr-audit-queue__item b { font-size: 18px; font-weight: 800; color: var(--mk-ink); font-variant-numeric: tabular-nums; }
.mr-audit-queue__item b i { font-style: normal; font-size: 12px; font-weight: 600; color: var(--mk-faint); }
.mr-audit-queue__item span { font-size: 11px; color: var(--mk-muted); }
.mr__sub-inline { margin-left: 8px; font-weight: 400; color: var(--mk-muted, #5b6577); font-size: var(--mk-fs-micro); }
.mr__bulk { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 6px 0 10px; }
.mr__warn-inline { color: var(--mk-amber); font-size: var(--mk-fs-micro); }
</style>
