<template>
  <div class="mr mk-page mk-page--fill">
    <header class="mk-status" :class="`mk-status--${headTone}`">
      <span class="mk-status__dot" aria-hidden="true"></span>
      <strong class="mk-status__title">记忆与复习观测</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">用户 {{ totals.users }} · 记忆痕迹 {{ totals.traces }} · <b :class="{ 'mr__meta-due': totals.due > 0 }">当前到期 {{ totals.due }}</b></span>
      <span class="mk-status__actions">
        <button type="button" class="mk-status__action" :disabled="loading" @click="loadOverview">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
      </span>
    </header>
    <!-- 口径与术语：默认折叠的引导带（mk-card + mk-section__summary，与 HealthCenter
         「本页看什么?」同形态）——引导文字常驻会挤掉首屏的 KPI 与表格，全站渐进披露统一为默认收起 -->
    <section class="mk-card">
      <details>
        <summary class="mk-card__head mk-section__summary">
          <h3 class="mk-card__title">口径与术语</h3>
          <span class="mk-card__meta">记忆层统计范围 · 观察模式 · 到期/建议/重新观察怎么读</span>
        </summary>
        <div class="mr-guide__body">
          <p><b>记忆层（用户级、跨 path）</b>：到期积压 · 课内温故配额 · 概念归并审计；归并默认<b>观察模式</b>，只记录建议，不动 memory_traces。</p>
          <p><b>到期 / 建议</b>：「到期」是到该复习而未复习的痕迹数；「建议」是系统给出的归并候选，需人工确认后才会执行。</p>
          <p><b>重新观察</b>：对该用户手动跑一次记忆复盘，结果实时刷新；数据源为该用户全部学习路径下的记忆痕迹。</p>
        </div>
      </details>
    </section>

    <!-- 概览卡（2026-09-26 重设计）：平摊 7 数字 → 一个比例叙事 + 一行处理队列。
         上半：记忆痕迹里「健康 vs 到期」的构成条——到期占比是这页真正的警报线；
         下半：归并处理队列按「要动手的程度」从左到右排列，已执行记录退为安静档。 -->
    <div class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">记忆层概览</h3>
        <label class="mr__toggle" title="切换后整页重新统计">
          <input v-model="includeVirtual" type="checkbox" @change="loadOverview" />
          包含虚拟学习者
        </label>
      </div>
      <div class="mr-summary">
        <div class="mr-summary__chart">
          <div
            class="mr-summary__ratio"
            role="img"
            :aria-label="`记忆痕迹 ${totals.traces} 条，其中到期 ${totals.due} 条，占 ${duePct}%`"
          >
            <i class="mr-summary__seg mr-summary__seg--ok" :style="{ width: okPct + '%' }"></i>
            <i class="mr-summary__seg mr-summary__seg--due" :style="{ width: duePct + '%' }"></i>
          </div>
          <div class="mr-summary__legend">
            <span><i class="mr-summary__dot mr-summary__dot--ok" aria-hidden="true"></i>健康 <b>{{ okTraces }}</b></span>
            <span><i class="mr-summary__dot mr-summary__dot--due" aria-hidden="true"></i>到期 <b>{{ totals.due }}</b><template v-if="totals.traces"> · 占 {{ duePct }}%</template></span>
            <span class="mr-summary__cap">覆盖 {{ totals.users }} 位用户</span>
          </div>
        </div>
        <div class="mr-summary__queue">
          <div class="mr-queue" :class="{ 'mr-queue--warn': totals.ambiguous > 0 }">
            <b class="mr-queue__num">{{ totals.ambiguous }}</b>
            <span class="mr-queue__label">需人工看<small>像但不确定，不会自动执行</small></span>
          </div>
          <div class="mr-queue">
            <b class="mr-queue__num">{{ totals.autoApplicable }}</b>
            <span class="mr-queue__label">可自动执行<small>把握度 + 词面闸门都过</small></span>
          </div>
          <div class="mr-queue">
            <b class="mr-queue__num">{{ totals.proposed }}</b>
            <span class="mr-queue__label">待归并建议<small>模型给出的同义候选</small></span>
          </div>
          <div class="mr-queue mr-queue--quiet">
            <b class="mr-queue__num">{{ totals.applied }}<i>/ {{ totals.deleted }}</i></b>
            <span class="mr-queue__label">已执行 / 删除<small>留快照，可回滚</small></span>
          </div>
        </div>
      </div>
    </div>

    <div class="mk-card mk-card--fill">
      <div class="mk-card__head">
        <h3 class="mk-card__title">用户列表</h3>
        <span class="mk-card__meta">共 {{ rows.length }} 位有痕迹用户 · 按痕迹数倒序</span>
      </div>
      <p v-if="error" class="mr__error">{{ error }}</p>
      <MockSkeletonTable v-if="loading && !rows.length" :cols="6" :rows="8" />
      <MkEmptyState v-else-if="!loading && !rows.length" title="暂无记忆痕迹数据" />
      <div v-else class="mk-table-scroll">
      <table class="mk-table mk-table--click mk-table--fixed">
        <!-- 本表曾漏写 colgroup：mk-table--fixed 下没有列宽声明 = 10 列等分 118px，
             于是 2 位数的数字列白占 118px、文本列被挤到换行（行高 108px、操作按钮折成两行）。
             fixed 表必须每列都给宽度（ADMIN_PAGE_TEMPLATES §表格）。 -->
        <colgroup>
          <col style="width:var(--mk-col-text)">
          <col style="width:var(--mk-col-num)">
          <col style="width:var(--mk-col-num)">
          <col style="width:var(--mk-col-num)">
          <col style="width:var(--mk-col-num)">
          <col style="width:var(--mk-col-num)">
          <col style="width:var(--mk-col-num-wide)">
          <col style="width:var(--mk-col-num)">
          <col style="width:var(--mk-col-text-sm)">
          <col style="width:var(--mk-col-actions-wide)">
        </colgroup>
        <thead>
          <tr>
            <th>用户</th>
            <th class="mk-num">痕迹</th>
            <th class="mk-num" title="到该复习而未复习的痕迹数，条内小条 = 占该用户痕迹比例">到期</th>
            <th class="mk-num">建议</th>
            <th class="mk-num">可自动</th>
            <th class="mk-num">需人工看</th>
            <th class="mk-num">已执行/删除</th>
            <th class="mk-num">可回滚</th>
            <th>最近观察</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.userId"
            class="mk-table--rowclick"
            :class="{ 'mr__row--active': row.userId === selectedId }"
            @click="openDetail(row.userId)"
          >
            <td>
              <div class="mr__user">
                <i class="mr__ava" :class="{ 'mr__ava--virtual': row.isVirtualLearner }" aria-hidden="true">{{ (row.name || '未')[0] }}</i>
                <span class="mr__user-main">
                  <strong>{{ row.name || '未命名' }}</strong>
                  <small class="mr__sub">{{ shortId(row.userId) }}</small>
                </span>
                <span v-if="row.isVirtualLearner" class="mk-badge mk-badge--sm mk-badge--virtual" title="虚拟学习者（仿真数据，可再生成）">虚拟</span>
              </div>
            </td>
            <td class="mk-num">{{ row.traces }}</td>
            <td class="mk-num">
              <!-- 到期压力条：数字 + 占该用户痕迹的比例，重压用户扫一眼可见 -->
              <div class="mr__due" :class="`mr__due--${dueTone(row)}`">
                <b>{{ row.due }}</b>
                <span class="mr__due-bar" aria-hidden="true"><i :style="{ width: duePctOf(row) + '%' }"></i></span>
              </div>
            </td>
            <td class="mk-num">{{ row.audit?.proposed ?? '—' }}</td>
            <td class="mk-num">{{ row.audit?.autoApplicable ?? '—' }}</td>
            <td class="mk-num">
              <span v-if="row.audit?.ambiguous" class="mr__need">{{ row.audit.ambiguous }}</span>
              <span v-else class="mr__none">—</span>
            </td>
            <td class="mk-num">{{ row.audit ? `${row.audit.applied}/${row.audit.deleted}` : '—' }}</td>
            <td class="mk-num" :class="{ 'mr__none': !row.merges?.rollbackable }">{{ rollbackableCount(row) }}</td>
            <td>
              <span class="mr__obs" :class="`mr__obs--${obsTone(row)}`">
                <i class="mr__obs-dot" aria-hidden="true"></i>
                <template v-if="row.audit">{{ row.audit.mode }} · {{ timeAgo(row.audit.generatedAt) }}</template>
                <template v-else>未观察</template>
              </span>
            </td>
            <td class="mr__actions">
              <button type="button" class="mk-btn mk-btn--sm" @click.stop="openDetail(row.userId)">明细</button>
              <button type="button" class="mk-btn mk-btn--sm" :disabled="busy" @click.stop="recompute(row.userId)">重新观察</button>
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

        <h4 class="mr__h4">课内温故计划（本节该接几个）</h4>
        <MkStatStrip v-if="detail.reviewPlan" :items="planKpiItems" />

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

        <div v-if="detail.reviewPlan?.relearnSuggestions.length" class="mr__warn">
          <strong>建议回路径重学：</strong>
          <span v-for="item in detail.reviewPlan.relearnSuggestions" :key="item.conceptKey" class="mr__chip">
            {{ item.label }}（连续 {{ item.consecutiveAgain }} 次没接上）
          </span>
        </div>

        <h4 class="mr__h4">同族重复（「过多过杂」的直接证据）</h4>
        <p v-if="!detail.duplicatedFamilies.length" class="mr__sub">没有同族重复。</p>
        <div v-else class="mk-table-scroll">
      <table class="mk-table">
          <thead><tr><th>族（归一化键）</th><th class="mk-num">条数</th><th>成员</th></tr></thead>
          <tbody>
            <tr v-for="family in detail.duplicatedFamilies" :key="family.family">
              <td>{{ family.family }}</td>
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
        <MkEmptyState v-else title="当前没有到期点" />
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
            <b>{{ detail.audit.stats.applied }}<i>/ {{ detail.audit.stats.deleted }}</i></b><span>已执行 / 删除</span>
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
                <th></th>
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
                    :data-auto="proposal.autoApplicable ? '1' : '0'"
                    @change="toggleSelect(proposal.canonical, proposal.autoApplicable)"
                  />
                </td>
                <td>{{ proposal.canonical }}</td>
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
                <td>{{ merge.canonical }}</td>
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
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { adminMemoryReviewApi } from '@/api/adminApi'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkStatStrip from '@/components/mk/MkStatStrip.vue'
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

/** 页头 KPI 条（MkStatStrip，与虚拟学习者等页同一组件；hint 收进 title 悬停） */

/* ---- 概览带（2026-09-26 重设计）的三组派生 ---- */
const duePct = computed(() => (totals.value.traces ? Math.round((totals.value.due / totals.value.traces) * 100) : 0));
const okPct = computed(() => 100 - duePct.value);
const okTraces = computed(() => Math.max(totals.value.traces - totals.value.due, 0));

/** 到期压力档：0=安静；占痕迹 ≥50% 或绝对数 ≥12 = 重压（红）；其余 = 提醒（琥珀） */
function dueTone(row: OverviewRow): 'none' | 'warn' | 'high' {
  if (!row.due) return 'none';
  const pct = row.traces ? (row.due / row.traces) * 100 : 100;
  return pct >= 50 || row.due >= 12 ? 'high' : 'warn';
}
function duePctOf(row: OverviewRow): number {
  return row.traces ? Math.min(Math.round((row.due / row.traces) * 100), 100) : row.due ? 100 : 0;
}
/** 最近观察的新鲜度：24h 内=新鲜（绿点）；从未观察=最弱档 */
function obsTone(row: OverviewRow): 'fresh' | 'stale' | 'never' {
  if (!row.audit) return 'never';
  const ageMs = Date.now() - new Date(row.audit.generatedAt).getTime();
  return ageMs < 24 * 3600_000 ? 'fresh' : 'stale';
}

/** 明细 · 课内温故计划 KPI 条（同上，走共享组件） */
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
.mr { display: flex; flex-direction: column; }
/* 状态条里的到期数 >0 时抬琥珀（headTone 已把状态点转琥珀，数字跟随） */
.mr__meta-due { color: var(--mk-amber); font-weight: 700; font-variant-numeric: tabular-nums; }
.mr__toggle { display: inline-flex; align-items: center; gap: 6px; font-size: var(--mk-fs-micro); color: var(--mk-muted, #5b6577); margin-left: auto; white-space: nowrap; }
/* 折叠引导带正文：与 HealthCenter .hc-guide__body 同款刻度（页面 scoped 只做容器布局） */
.mr-guide__body { padding: 10px 14px 12px; display: grid; gap: 6px; }
.mr-guide__body p { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-muted); line-height: 1.6; }
.mr-guide__body b { color: var(--mk-ink); font-weight: 700; }

/* ===== 概览带（2026-09-26 重设计）：比例叙事 + 处理队列 ===== */
.mr-summary { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 22px; padding: 14px 16px 16px; align-items: center; }
.mr-summary__ratio {
  display: flex; height: 14px; border-radius: var(--mk-radius-pill); overflow: hidden;
  background: var(--mk-surface-2);
}
.mr-summary__seg { display: block; height: 100%; }
.mr-summary__seg--ok { background: var(--mk-green); opacity: 0.55; }
.mr-summary__seg--due { background: var(--mk-amber); }
.mr-summary__legend { display: flex; align-items: baseline; gap: 16px; margin-top: 8px; font-size: var(--mk-fs-micro); color: var(--mk-muted); flex-wrap: wrap; }
.mr-summary__legend b { color: var(--mk-ink); font-variant-numeric: tabular-nums; font-weight: 700; }
.mr-summary__dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; vertical-align: 1px; }
.mr-summary__dot--ok { background: var(--mk-green); opacity: 0.55; }
.mr-summary__dot--due { background: var(--mk-amber); }
.mr-summary__cap { margin-left: auto; color: var(--mk-faint); }
.mr-summary__queue { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.mr-queue {
  display: grid; gap: 2px; justify-items: start;
  padding: 9px 12px; border-radius: var(--mk-radius-lg);
  background: var(--mk-surface-2);
}
/* 需人工看 > 0：琥珀描边提示——这是队列里唯一必须人动手的档 */
.mr-queue--warn { background: color-mix(in srgb, var(--mk-amber) 10%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--mk-amber) 32%, transparent); }
.mr-queue__num { font-size: 21px; font-weight: 800; line-height: 1.15; color: var(--mk-ink); font-variant-numeric: tabular-nums; }
.mr-queue--warn .mr-queue__num { color: var(--mk-amber); }
.mr-queue--quiet .mr-queue__num { color: var(--mk-faint); }
.mr-queue__num i { font-style: normal; font-size: 13px; font-weight: 600; color: var(--mk-faint); }
.mr-queue__label { font-size: var(--mk-fs-micro); font-weight: 600; color: var(--mk-muted); display: grid; }
.mr-queue__label small { font-weight: 400; color: var(--mk-faint); font-size: 11px; line-height: 1.4; }

/* ===== 用户表行设计 ===== */
.mr__user { display: flex; align-items: center; gap: 9px; min-width: 0; }
.mr__ava {
  width: 28px; height: 28px; border-radius: 50%; flex: none;
  display: grid; place-items: center;
  font-style: normal; font-size: 12px; font-weight: 800;
  background: color-mix(in srgb, var(--mk-blue) 12%, transparent);
  color: var(--mk-accent-deep);
}
.mr__ava--virtual { background: color-mix(in srgb, var(--mk-purple) 14%, transparent); color: var(--mk-purple); }
.mr__user-main { display: grid; min-width: 0; }
.mr__user-main strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 到期压力条：数字在上、比例条在下（列宽 --mk-col-num 内） */
.mr__due { display: grid; gap: 3px; justify-items: start; }
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
.mr__none { color: var(--mk-faint); }

/* 最近观察：新鲜度点（24h 绿 / 更早灰 / 从未最弱） */
.mr__obs { display: inline-flex; align-items: center; gap: 6px; font-size: var(--mk-fs-micro); color: var(--mk-muted); white-space: nowrap; }
.mr__obs-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--mk-faint); flex: none; }
.mr__obs--fresh .mr__obs-dot { background: var(--mk-green); }
.mr__obs--fresh { color: var(--mk-ink); }
.mr__obs--never { color: var(--mk-faint); }

.mr__h4 { margin: 14px 0 6px; font-size: var(--mk-fs-body); font-weight: 700; color: var(--mk-ink); }
.mr__num { text-align: right; font-variant-numeric: tabular-nums; }
.mr__num--warn { color: var(--mk-amber); font-weight: 700; }
.mr__sub { display: block; color: var(--mk-muted, #5b6577); font-size: var(--mk-fs-micro); }
.mr__row--active { background: var(--mk-blue-bg); }
.mr__actions { display: flex; gap: 6px; justify-content: flex-end; white-space: nowrap; }
.mr__error { margin: 6px 0; color: var(--mk-red-strong); font-size: var(--mk-fs-micro); }
.mr__warn { margin-top: 8px; padding: 8px 10px; border-radius: var(--mk-radius-xl); border: 1px solid rgba(217, 119, 6, 0.3); background: rgba(217, 119, 6, 0.06); font-size: var(--mk-fs-micro); }
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
.mr-audit-queue { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; padding: 10px 16px 4px; }
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

@media (max-width: 1440px) {
  .mr-summary { grid-template-columns: minmax(0, 1fr); }
}
</style>
