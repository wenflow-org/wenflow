<template>
  <div :class="embedded ? 'be-embedded' : 'mk-page'">
    <!-- 页头（newui pagehead）：页名 + 口径副文。原型 actions 里的「导出」无真实后端能力，不加
         （文案不得暗示不存在的功能）；「新建实验」是真实能力，留在状态条原位。 -->
    <MkPageHead v-if="!embedded" title="批量实验" sub="用多组虚拟画像批量压测教学闭环与 Skill 稳定性" />
    <div v-if="!embedded" class="mk-status" :class="statusTone">
      <span class="mk-status__dot"></span>
      <span class="mk-status__meta">共 {{ experiments.length }} 个实验 · 进行中 {{ runningCount }} · 学习者 {{ learnerTotal }}</span>
      <!-- P1#23（2026-10-02 人类可读性）：状态条此前只答「多少在跑」不答「跑得好不好」——
           补失败/卡死聚合（红/琥珀），口径（已加载 runs 客户端聚合）入 title -->
      <span v-if="failedRunTotal || stalledRunTotal" class="mk-status__meta" :title="aggregateTitle">
        <template v-if="failedRunTotal"><b class="be-agg--bad">失败 {{ failedRunTotal }}</b><template v-if="stalledRunTotal"> · </template></template><template v-if="stalledRunTotal"><b class="be-agg--stall">卡死 {{ stalledRunTotal }}</b></template>
      </span>
      <span class="mk-status__actions">
        <button type="button" class="mk-status__action mk-status__action--primary" @click="openCreate">新建实验</button>
      </span>
    </div>

    <div v-if="embedded" class="mk-card__head be-embedded__head">
      <span class="mk-card__meta">批量实验：一次创建多个虚拟学习者，系统级队列实验（目标 → 路径 → 学习 → 跨日衰减）</span>
      <button type="button" class="mk-btn mk-btn--sm mk-btn--primary" @click="openCreate">新建实验</button>
    </div>

    <div class="mk-card">
      <MockSkeletonTable v-if="loading && !experiments.length" :cols="8" />
      <div v-else-if="experiments.length" class="mk-table-scroll be-list">
        <!-- 原型 .tbl：width:100% 自动布局（无 fixed/colgroup），单元格 nowrap、列宽随内容；
             长描述由下方 be-desc 截断兜底 -->
        <table class="mk-table mk-table--click">
          <thead>
            <tr>
              <th>实验</th>
              <th>状态</th>
              <th>学习者</th>
              <th>进度</th>
              <th>创建时间</th>
              <!-- P1#22（2026-10-02 人类可读性）：「running+0%+刚发起」与「卡死 30 分钟」此前视觉相同——
                   最近活动列（实验 updatedAt 与 runs updatedAt 取最大）让新鲜度可扫 -->
              <th title="实验与其全部 runs 的最近一次更新时间（相对）">最近活动</th>
              <th>负责人</th>
              <th class="mk-th--right">操作</th>
            </tr>
          </thead>
          <tbody>
            <!-- 原型 2058：整行 data-action="toast"（打开实验）→ 行点击/回车打开详情抽屉；
                 行内按钮与 ⋯ 菜单一律 stop，键盘冒泡在 openDetail 内按 target 守卫 -->
            <tr
              v-for="e in experiments"
              :key="e.id"
              tabindex="0"
              role="button"
              :aria-label="`打开实验 ${e.name} 详情`"
              @click="openDetail(e)"
              @keydown.enter="openDetail(e, $event)"
            >
              <td>
                <div class="mk-cell-main">
                  <strong>{{ e.name }}</strong>
                  <span class="mk-cell-sub be-desc" :title="e.description || ''">{{ e.description || '无描述' }}</span>
                </div>
              </td>
              <td><span class="mk-badge" :class="statusBadge(e.status)">{{ expStatusText(e.status) }}</span></td>
              <td>
                <div class="mk-cell-main">
                  <strong>{{ (e.runs || []).length }} 名</strong>
                  <!-- 手动停止后后端把 active run 写成 failed，直接显示「失败 N」会误导成故障：本地记 stoppedIds 改口「已中止」灰调 -->
                  <span class="mk-cell-sub" :class="{ 'be-cell--fail': failedRuns(e).length > 0 && !manualStopped(e) }" :title="progressTitle(e)">
                    完成 {{ doneRuns(e).length }}<template v-if="failedRuns(e).length"> · <template v-if="manualStopped(e)">已中止 {{ failedRuns(e).length }}</template><b v-else class="be-fail-num">失败 {{ failedRuns(e).length }}</b></template>
                  </span>
                </div>
              </td>
              <td>
                <div class="be-progress" :title="progressTitle(e)">
                  <span class="mk-minibar"><span class="mk-minibar__fill" :data-tone="progressTone(e)" :style="{ width: progressPct(e) + '%' }"></span></span>
                  <span class="be-progress__num">{{ progressPct(e) }}%</span>
                </div>
              </td>
              <td :title="fmtDate(e.createdAt)">{{ timeAgo(e.createdAt) }}</td>
              <!-- P1#22 最近活动：running 且超阈值无推进 → 琥珀 + title 报「N 分钟无更新，可能卡住」 -->
              <td :class="{ 'be-activity--stall': isStalled(e) }" :title="activityTitle(e)">
                {{ timeAgo(lastActivityAt(e)) }}<template v-if="isStalled(e)"> · 可能卡死</template>
              </td>
              <!-- 原型 .sub.mono 列：负责人（createdBy 详情抽屉已在用），空值显 — -->
              <td class="mono be-owner" :title="e.createdBy || ''">{{ e.createdBy || '—' }}</td>
              <td>
                <div class="mk-actions">
                  <!-- 原型操作列：文字小钮（.btn--sm 形态，破坏性动作红字钮）；行级动作另留 ⋯ 菜单 -->
                  <button type="button" class="mk-btn mk-btn--sm" @click.stop="openDetail(e)">详情</button>
                  <!-- P1#22 卡死行恢复引导（就地提示）：后端无实验级「重试」端点，恢复手段 =
                       详情抽屉内逐 run「推进」；确认无法恢复再停止。title 指路，不暗示不存在的按钮 -->
                  <button
                    v-if="e.status === 'running'"
                    type="button"
                    class="mk-btn mk-btn--sm mk-btn--danger"
                    :disabled="e.busy"
                    :title="isStalled(e)
                      ? `该实验 ${idleMinsOf(e)} 分钟无更新，可能卡住：先「详情」→ 对卡住的 run 用「推进」手动推进验证，确认无法恢复再停止`
                      : '停止实验：中断进行中的运行，实验不会继续执行'"
                    @click.stop="stop(e)"
                  >停止</button>
                  <div class="mk-menu">
                    <button type="button" class="mk-menu__btn" aria-label="更多操作" aria-haspopup="menu" :aria-expanded="openMenu === e.id" @click.stop="toggleMenu(e.id)">⋯</button>
                    <div v-if="openMenu === e.id" class="mk-menu__pop" :style="popStyle" @click.stop>
                      <button type="button" class="mk-menu__item" @click="menuDetail(e)">查看详情</button>
                      <button v-if="e.status === 'running'" type="button" class="mk-menu__item mk-menu__item--danger" @click="menuStop(e)">停止实验</button>
                    </div>
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <MkEmptyState
        v-else-if="failed"
        tone="error"
        icon="!"
        title="批量实验加载失败"
        description="无法从服务读取实验列表。"
        action-text="重试"
        action-busy-text="重试中…"
        :action-busy="loading"
        @action="load"
      />
      <!-- 空态撑满主区（2026-09-27 走查「空态利用」）：min 走全局 mk-empty--min 机制（min-height + 垂直居中），
           偏移与上限的推导见底部样式注释；嵌入 tab（embedded）不拉伸，保持原样 -->
      <MkEmptyState
        v-else
        :min="!embedded"
        title="还没有批量实验"
        description="一次创建多个虚拟学习者，系统级队列实验：目标 → 路径 → 学习 → 跨日衰减。"
        action-text="新建实验"
        @action="openCreate"
      />
    </div>

    <!-- 创建实验弹窗 -->
    <Teleport to="body">
      <div v-if="createOpen" ref="maskRef" class="mk-modal">
        <div ref="panelRef" class="mk-modal__panel mk-modal__panel--wide" role="dialog" aria-label="新建批量实验">
          <div class="mk-modal__head">
            <h3 class="mk-modal__title">新建批量实验</h3>
            <button type="button" class="mk-modal__close" aria-label="关闭" @click="createOpen = false">✕</button>
          </div>
          <div class="mk-modal__body">
            <label class="mk-field" :class="{ 'mk-field--error': errors.name }">
              <span class="mk-field__label">实验名称 <em class="mk-field__req">*</em></span>
              <input v-model="form.name" class="mk-field__input" placeholder="例如：记忆衰减基线实验" maxlength="100" />
              <span v-if="errors.name" class="mk-field__err">{{ errors.name }}</span>
            </label>
            <label class="mk-field">
              <span class="mk-field__label">描述（可选）</span>
              <textarea v-model="form.description" class="mk-field__textarea" rows="2" maxlength="500" placeholder="实验目的、变量、对照组…" />
            </label>
            <div class="mk-field">
              <span class="mk-field__label">学习者配置 <em class="mk-field__req">*</em>（最多 20 名）</span>
              <div class="be-rows">
                <div class="be-row be-row--head">
                  <span>名称</span><span>学习目标</span><span>分心程度</span><span></span>
                </div>
                <div v-for="(r, i) in form.learners" :key="i" class="be-row">
                  <input v-model="r.name" class="mk-input" placeholder="学习者名称" maxlength="64" aria-label="学习者名称" />
                  <input v-model="r.learningGoal" class="mk-input" placeholder="学习目标（可选）" maxlength="200" aria-label="学习目标" />
                  <select v-model="r.frictionBudget" class="mk-input be-budget" aria-label="分心程度">
                    <option v-for="b in budgets" :key="b.id" :value="b.id">{{ b.label }}</option>
                  </select>
                  <button type="button" class="mk-link mk-link--danger" :disabled="form.learners.length <= 1" @click="form.learners.splice(i, 1)">✕</button>
                </div>
              </div>
              <!-- 重名只提示不拦截：后端允许同名 run（同名仅影响结果辨识，不报错） -->
              <div v-if="dupLearnerNames.length" class="be-dup-hint">学习者名称重复：{{ dupLearnerNames.join('、') }}</div>
              <button type="button" class="mk-link" :disabled="form.learners.length >= 20" @click="addLearner">+ 添加学习者</button>
            </div>
            <div v-if="errorMsg" class="mk-alert" role="alert">{{ errorMsg }}</div>
          </div>
          <div class="mk-modal__foot">
            <button type="button" class="mk-btn" @click="createOpen = false">取消</button>
            <button type="button" class="mk-btn mk-btn--primary" :disabled="creating" @click="create">
              {{ creating ? '创建中…' : '创建实验' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- 实验详情抽屉 -->
    <Teleport to="body">
      <div v-if="detailOpen" ref="detailMaskRef" class="mk-drawer">
        <div class="mk-drawer__mask" @click="detailOpen = false"></div>
        <div ref="detailPanelRef" class="mk-drawer__panel mk-drawer__panel--wide" role="dialog" aria-label="实验详情">
          <!-- 头部（原型 .ovl__head：标题 + grow + 关闭钮，下边框）：状态/学习者数下沉到正文首段徽章行 -->
          <header class="mk-drawer__head">
            <div class="be-detail__title">
              <h3 class="mk-drawer__title">{{ detail?.name }}</h3>
              <span v-if="detail?.description" class="mk-drawer__sub be-detail__desc" :title="detail.description">{{ detail.description }}</span>
            </div>
            <button type="button" class="mk-drawer__close" aria-label="关闭" @click="detailOpen = false">✕</button>
          </header>
          <div class="mk-drawer__body be-detail__body">
            <!-- 首段徽章行（原型 .ovl__body 首段 pills）：状态 / 学习者数均为行上已有字段 -->
            <div v-if="detail" class="be-detail__pills">
              <span class="mk-badge" :class="statusBadge(detail.status)">{{ expStatusText(detail.status) }}</span>
              <span class="mk-badge mk-badge--muted">学习者 {{ detailRunList.length }} 名</span>
            </div>
            <!-- 事实清单（原型 dl.kv → 共享 mk-facts 栅格）：进度格嵌 minibar（同 OpsContent oc-fact-progress） -->
            <div v-if="detail" class="mk-facts">
              <div><span>创建人</span><strong :title="detail.createdBy || ''">{{ detail.createdBy || '—' }}</strong></div>
              <div><span>创建</span><strong :title="fmtDate(detail.createdAt)">{{ timeAgo(detail.createdAt) }}</strong></div>
              <div><span>更新</span><strong :title="fmtDate(detail.updatedAt)">{{ timeAgo(detail.updatedAt) }}</strong></div>
              <div><span>完成</span><strong class="mono">{{ detailDone }} / {{ detailRunList.length }}</strong></div>
              <div><span>进行中</span><strong class="mono">{{ detailActive }}</strong></div>
              <!-- P1#23（2026-10-02）：事实栅格此前无「失败」格——失败 run 只藏在运行记录行的红字里，
                   抽屉首屏扫不到；人工停止实验的 failed run 记「已中止」，不红 -->
              <div>
                <span>失败</span>
                <strong
                  class="mono"
                  :class="{ 'be-fact-fail': detailFailedCount > 0 && !detailStopped }"
                  :title="detailStopped
                    ? `failed run ${detailFailedCount} 个（人工停止产生，记为已中止，非故障）`
                    : `failed run ${detailFailedCount} 个；含卡死后判失败的 run，可在下方运行记录看 lastError`"
                >{{ detailStopped && detailFailedCount > 0 ? `${detailFailedCount}（已中止）` : detailFailedCount }}</strong>
              </div>
              <div>
                <span>进度</span>
                <strong class="be-fact-progress">
                  <span class="be-fact-progress__num">{{ detailProgress }}%</span>
                  <span class="mk-minibar be-fact-progress__bar"><span class="mk-minibar__fill" :data-tone="detailProgressTone" :style="{ width: detailProgress + '%' }"></span></span>
                </strong>
              </div>
            </div>

            <MkLoading v-if="detailLoading" inline />
            <!-- 运行记录：嵌套无边框卡（原型 .card box-shadow:none + card__head/card__body，内 feed 行） -->
            <section v-else-if="detailRuns.length" class="mk-card">
              <div class="mk-card__head">
                <h4 class="mk-card__title">运行记录</h4>
                <span class="mk-card__meta mono">{{ detailRuns.length }}</span>
              </div>
              <div class="be-runs">
                <div v-for="r in detailRuns" :key="r.id" class="be-run">
                  <div class="be-run__head">
                    <strong>{{ r.learnerName }}</strong>
                    <span class="mk-badge" :class="runStatusBadge(r.status)">{{ runStatusText(r.status) }}</span>
                    <span class="mk-badge mk-badge--muted">{{ budgetLabel(r.frictionBudget) }}</span>
                    <span class="be-run__phase mono" :title="r.phase">{{ phaseText(r.phase) }}</span>
                  </div>
                  <div class="be-run__body">
                    <span class="be-run__meta">任务 {{ r.completedTasks }}<template v-if="r.totalTasks"> / {{ r.totalTasks }}</template></span>
                    <span v-if="r.currentTask" class="be-run__meta be-run__task" :title="r.currentTask">当前：{{ r.currentTask }}</span>
                    <span v-if="r.stallCount > 0" class="be-run__meta be-run__stall">卡死 {{ r.stallCount }} 次</span>
                    <span v-if="r.lastError" class="be-run__meta be-run__error" :title="r.lastError">{{ r.lastError }}</span>
                    <span class="be-run__meta be-run__time">{{ timeAgo(r.updatedAt) }}</span>
                  </div>
                  <div class="be-run__actions">
                    <!-- 推进/衰减只对 active run 有意义：后端 advanceRun 对非 active 直接空转，前端禁用并说明原因；快照只读不受限 -->
                    <button type="button" class="mk-btn mk-btn--sm" :disabled="runBusy || !detail || r.status !== 'active'" :title="r.status === 'active' ? '推进一个阶段：快进到该运行的下一个阶段' : '该运行已结束'" @click="advance(detail!.id, r.id)">推进</button>
                    <button type="button" class="mk-btn mk-btn--sm" :disabled="runBusy || !detail || r.status !== 'active'" :title="r.status === 'active' ? '模拟跨日衰减：按衰减模型更新该运行的学习状态' : '该运行已结束'" @click="decay(detail!.id, r.id)">衰减</button>
                    <button type="button" class="mk-btn mk-btn--sm" :disabled="runBusy || !detail" title="保存当前快照（只读，不改变状态）" @click="snapshot(detail!.id, r.id)">快照</button>
                  </div>
                </div>
              </div>
            </section>
            <MkEmptyState
              v-else-if="detailError"
              tone="error"
              title="运行记录加载失败"
              description="无法从服务读取该实验的运行列表。"
              action-text="重试"
              action-busy-text="重试中…"
              :action-busy="detailLoading"
              @action="retryDetail"
              compact
            />
            <MkEmptyState
              v-else
              title="暂无运行记录"
              description="实验创建后由调度器自动推进。"
              compact
            />
          </div>
          <!-- 底部动作（原型 .ovl__foot：上边框、右对齐、常驻滚动区外；同 gc-detail__foot 判例） -->
          <footer v-if="detail" class="be-detail__foot">
            <button type="button" class="mk-btn" @click="detailOpen = false">关闭</button>
          </footer>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { timeAgo, errMsg } from './live'
import { askConfirm } from './useConfirm'
import { adminBatchExperimentsApi, type BatchExperiment, type BatchExperimentRun } from '@/api/adminApi'
import { useEscape } from './useEscape'
import { useOverlay, useMaskClose } from './useOverlay'
import { useRowMenu } from './useRowMenu'
import { useSafePolling } from '@/composables/useSafePolling'
import { toast } from '@/utils/toast'
import MockSkeletonTable from './SkeletonTable.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkLoading from '@/components/mk/MkLoading.vue'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import { statusText } from './statusText'

/** 嵌入模式：作为虚拟学习者「批量实验」tab 渲染（隐藏页面外壳/状态条） */
withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

interface ExpRow extends BatchExperiment {
  busy?: boolean
}

const experiments = ref<ExpRow[]>([])
/* 本会话内手动停止过的实验 id：后端停止时把 active run 写成 failed，若不记录会把人工终止当故障展示
   （仅前端记忆，刷新后丢失——届时实验状态已是持久化的 stopped，只是 run 级徽章口径回退） */
const stoppedIds = ref(new Set<string>())
const loading = ref(false)
const failed = ref(false)
const runBusy = ref(false)

/* 状态条基调：加载失败必须退红（P2-6，2026-09-27 走查）——此前失败时 experiments 为空、
   runningCount 归零，状态条退化成灰 muted「正常无数据」，与卡片内的错误态自相矛盾。
   口径对齐 AuditLogs.vue 的 statusTone：bad > ok > muted */
const statusTone = computed(() =>
  failed.value ? 'mk-status--bad' : runningCount.value > 0 ? 'mk-status--ok' : 'mk-status--muted'
)
const runningCount = computed(() => experiments.value.filter((e) => e.status === 'running').length)
const learnerTotal = computed(() => experiments.value.reduce((s, e) => s + (e.runs?.length || 0), 0))

/* paused：后端不产生该状态（创建默认 running、收尾写 done、停止写 stopped），分支保留纯防御 */
const statusBadge = (s: string) =>
  s === 'running' ? 'mk-badge--ok' : s === 'paused' ? 'mk-badge--warn' : s === 'done' ? 'mk-badge--info' : 'mk-badge--muted'

const manualStopped = (e: ExpRow) => stoppedIds.value.has(e.id)
const failText = (e: ExpRow) => (manualStopped(e) ? '已中止' : '失败')

const doneRuns = (e: ExpRow) => (e.runs || []).filter((r) => r.status === 'done')
const failedRuns = (e: ExpRow) => (e.runs || []).filter((r) => r.status === 'failed')
const progressPct = (e: ExpRow) => {
  const runs = e.runs || []
  if (!runs.length) return 0
  return Math.round((doneRuns(e).length / runs.length) * 100)
}
const progressTone = (e: ExpRow) => {
  const pct = progressPct(e)
  // 手动停止产生的 failed 是人工终止不是故障，进度条不标红
  if (failedRuns(e).length > 0 && !manualStopped(e)) return 'bad'
  return pct >= 100 ? 'ok' : 'warn'
}
const progressTitle = (e: ExpRow) =>
  `完成 ${doneRuns(e).length}/${e.runs?.length || 0} · ${failText(e)} ${failedRuns(e).length} · 进行中 ${(e.runs || []).filter((r) => r.status === 'active').length}`

/* P2（2026-10-02 人类可读性）：实验层 done 与 run 层 done 同名「已完成」却不同色
   （实验蓝灰 / run 绿），同屏两种语义——实验层正名「已结束」，绿色「已完成」只归 run */
const expStatusText = (s: string) => (s === 'done' ? '已结束' : statusText(s))

/* ===== P1#22 最近活动（2026-10-02 人类可读性）：异步流程页必须有新鲜度读数 ===== */
/** 卡住阈值（拍板 2026-10-02）：running 且最近活动超过 20 分钟无推进 → 琥珀「可能卡死」。
    调度器 30s 一推进，正常运行的实验 updatedAt 至少每 30s 动一次；20 分钟覆盖长任务
    （单任务常规几分钟）且远大于轮询间隔，误报率低。 */
const BE_STALL_MINUTES = 20

function tsOf(iso?: string): number {
  const t = new Date(iso || '').getTime()
  return Number.isFinite(t) ? t : 0
}

/** 最近活动时间 = max(实验 updatedAt, 全部 runs updatedAt)（数据已在手：列表接口带 runs） */
const lastActivityAt = (e: ExpRow): string => {
  let best = e.updatedAt || e.createdAt || ''
  for (const r of e.runs || []) if (tsOf(r.updatedAt) > tsOf(best)) best = r.updatedAt
  return best
}

/** 距最近活动的分钟数（时间不可知 → 0，不误报卡死） */
const idleMinsOf = (e: ExpRow): number => {
  const t = tsOf(lastActivityAt(e))
  if (!t) return 0
  return Math.max(0, Math.floor((Date.now() - t) / 60000))
}

/** 卡住嫌疑：仅 running 判定（终态实验不参与）；时间缺失不判 */
const isStalled = (e: ExpRow): boolean => e.status === 'running' && idleMinsOf(e) >= BE_STALL_MINUTES

/** 最近活动列 title：相对时间配绝对时间；卡死行给出阈值与判语 */
const activityTitle = (e: ExpRow): string => {
  const iso = lastActivityAt(e)
  const abs = iso ? fmtDate(iso) : '无记录'
  return isStalled(e)
    ? `最近活动 ${abs}：已 ${idleMinsOf(e)} 分钟无更新（阈值 ${BE_STALL_MINUTES} 分钟），可能卡住`
    : `最近活动 ${abs}`
}

/* ===== P1#23 页面级聚合（2026-10-02 人类可读性）：状态条此前只答「多少在跑」不答
   「跑得好不好」——从已加载实验的 runs 客户端聚合失败/卡死；人工停止实验的 failed run
   是人工终止不是故障，与行内口径一致（记已中止、不计入失败） */
const failedRunTotal = computed(() =>
  experiments.value.reduce((sum, e) => (manualStopped(e) ? sum : sum + failedRuns(e).length), 0)
)
const stalledRunTotal = computed(() =>
  experiments.value.reduce((sum, e) => sum + (e.runs || []).filter((r) => r.status === 'stalled').length, 0)
)
const manualStoppedCount = computed(() => experiments.value.filter((e) => manualStopped(e)).length)
const aggregateTitle = computed(() => {
  const parts = [
    `口径：当前已加载 ${experiments.value.length} 个实验的 runs 客户端聚合（随轮询刷新，非后端全量统计）`,
    `卡死 = run 状态 stalled 或 running 超 ${BE_STALL_MINUTES} 分钟无推进`,
  ]
  if (manualStoppedCount.value) {
    parts.push(`另有 ${manualStoppedCount.value} 个人工停止实验，其 failed run 记为「已中止」，未计入失败`)
  }
  return parts.join('；')
})

function fmtDate(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function load(opts: { silent?: boolean } = {}) {
  // silent：轮询后台刷新用——不动 loading/failed（避免骨架闪烁），失败不 toast（重试节奏交给轮询器退避）
  const silent = opts.silent === true
  if (!silent) {
    loading.value = true
    failed.value = false
  }
  let ok = true
  try {
    const res = await adminBatchExperimentsApi.list()
    const items = (res.data?.data ?? res.data) || []
    experiments.value = items.map((e: Record<string, unknown>) => ({
      id: String(e.id),
      name: String(e.name || ''),
      description: (e.description as string) || null,
      status: String(e.status || ''),
      createdBy: String(e.createdBy || ''),
      learnersConfig: String(e.learnersConfig || ''),
      createdAt: String(e.createdAt || ''),
      updatedAt: String(e.updatedAt || ''),
      runs: Array.isArray(e.runs) ? e.runs : [],
    })) as unknown as ExpRow[]
  } catch (e) {
    ok = false
    if (!silent) {
      failed.value = true
      toast.error(`加载失败：${errMsg(e)}`)
    }
  } finally {
    if (!silent) loading.value = false
  }
  return ok
}

/* 创建弹窗 */
const budgets = [
  { id: 'none', label: '无分心' },
  { id: 'low', label: '低' },
  { id: 'normal', label: '正常' },
  { id: 'high', label: '高' },
  { id: 'stress_test', label: '压力测试' },
]
const budgetLabel = (b: string) => budgets.find((x) => x.id === b)?.label || b

const createOpen = ref(false)
useEscape(() => createOpen.value, () => { createOpen.value = false })
const panelRef = ref<HTMLElement | null>(null)
const maskRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => createOpen.value), panelRef)
useMaskClose(maskRef, () => { createOpen.value = false })

const form = ref({
  name: '',
  description: '',
  learners: [{ name: '', learningGoal: '', frictionBudget: 'normal' as string }],
})
const errors = ref<{ name?: string }>({})
const creating = ref(false)
const errorMsg = ref('')

/* 重名即时提示（trim 后比较）：非阻断，提交照常放行 */
const dupLearnerNames = computed(() => {
  const seen = new Set<string>()
  const dups = new Set<string>()
  for (const l of form.value.learners) {
    const n = l.name.trim()
    if (!n) continue
    if (seen.has(n)) dups.add(n)
    else seen.add(n)
  }
  return [...dups]
})

function openCreate() {
  form.value = { name: '', description: '', learners: [{ name: '', learningGoal: '', frictionBudget: 'normal' }] }
  errors.value = {}
  errorMsg.value = ''
  createOpen.value = true
}

function addLearner() {
  if (form.value.learners.length >= 20) return
  form.value.learners.push({ name: '', learningGoal: '', frictionBudget: 'normal' })
}

async function create() {
  errors.value = {}
  errorMsg.value = ''
  if (!form.value.name.trim()) { errors.value.name = '请输入实验名称'; return }
  // 未填名称的行会被过滤掉——这是静默丢数据，统计被忽略行数并明确告知
  const skipped = form.value.learners.filter((l) => !l.name.trim()).length
  const learners = form.value.learners.filter((l) => l.name.trim())
  if (!learners.length) { errorMsg.value = '至少需要一个学习者配置'; return }
  if (skipped > 0) toast.info(`已忽略 ${skipped} 个未填写名称的学习者行`)
  creating.value = true
  try {
    await adminBatchExperimentsApi.create({
      name: form.value.name.trim(),
      description: form.value.description.trim() || undefined,
      learners: learners.map((l) => ({
        name: l.name.trim(),
        learningGoal: l.learningGoal.trim() || undefined,
        frictionBudget: l.frictionBudget as 'none' | 'low' | 'normal' | 'high' | 'stress_test',
      })),
    })
    createOpen.value = false
    toast.success('实验已创建，调度器将自动推进')
    void load()
  } catch (e) {
    errorMsg.value = errMsg(e)
  } finally {
    creating.value = false
  }
}

/* 操作 */
const { openMenu, toggleMenu, closeMenu, popStyle } = useRowMenu()

function menuDetail(e: ExpRow) { closeMenu(); openDetail(e) }
function menuStop(e: ExpRow) { closeMenu(); void stop(e) }

async function stop(e: ExpRow) {
  // 停止会中断正在运行的实验（不可恢复）：执行前确认
  const ok = await askConfirm({
    title: '停止实验',
    message: `确认停止实验「${e.name}」？进行中的运行将中断，实验不会继续执行。`,
    confirmText: '停止实验',
  })
  if (!ok) return
  e.busy = true
  try {
    await adminBatchExperimentsApi.stop(e.id)
    e.status = 'stopped'
    stoppedIds.value.add(e.id) // 供列表把停止产生的 failed run 显示为「已中止」
    toast.success(`实验「${e.name}」已停止`)
    void load()
  } catch (err) {
    toast.error(`停止失败：${errMsg(err)}`)
  } finally {
    e.busy = false
  }
}

/* 详情抽屉 */
const detailOpen = ref(false)
/* 详情抽屉行为四件套（2026-09-26 弹层对齐）：与上方新建弹窗同一套钩子，ref 独立避免两弹层互踩 */
const detailMaskRef = ref<HTMLElement | null>(null)
const detailPanelRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => detailOpen.value), detailPanelRef)
useMaskClose(detailMaskRef, () => { detailOpen.value = false })
useEscape(() => detailOpen.value, () => { detailOpen.value = false })
const detail = ref<BatchExperiment | null>(null)
const detailRuns = ref<BatchExperimentRun[]>([])
const detailLoading = ref(false)
/* 详情 runs 拉取失败：与列表 failed 分流——列表失败走空态错误卡，详情失败在抽屉内给可重试的错误空态。
   此前失败只 toast，detailRuns 为空让抽屉显示「暂无运行记录/实验创建后由调度器自动推进」，
   把服务端明明有 runs 的故障误导成真为空（2026-09-27 走查 P1-2） */
const detailError = ref(false)

/* 抽屉事实区口径：优先用详情接口拉回的 runs（推进/衰减后是权威值），
   加载中/失败时回落列表行上已有的 runs——打开即有数据，不空屏（同 OpsContent 判例） */
const detailRunList = computed<BatchExperimentRun[]>(() =>
  detailRuns.value.length ? detailRuns.value : detail.value?.runs || []
)
const detailDone = computed(() => detailRunList.value.filter((r) => r.status === 'done').length)
const detailActive = computed(() => detailRunList.value.filter((r) => r.status === 'active').length)
/* P1#23 抽屉「失败」格：与列表口径一致（人工停止 → 已中止，不红） */
const detailFailedCount = computed(() => detailRunList.value.filter((r) => r.status === 'failed').length)
const detailStopped = computed(() => !!(detail.value && stoppedIds.value.has(detail.value.id)))
const detailProgress = computed(() =>
  detailRunList.value.length ? Math.round((detailDone.value / detailRunList.value.length) * 100) : 0
)
/* 手动停止产生的 failed 是人工终止不是故障：进度条不标红（与列表 progressTone 同口径） */
const detailProgressTone = computed(() => {
  const failed = detailRunList.value.filter((r) => r.status === 'failed').length
  if (failed > 0 && !(detail.value && stoppedIds.value.has(detail.value.id))) return 'bad'
  return detailProgress.value >= 100 ? 'ok' : 'warn'
})

function mapRun(r: Record<string, unknown>): BatchExperimentRun {
  return {
    id: String(r.id),
    experimentId: String(r.experimentId || ''),
    learnerName: String(r.learnerName || ''),
    frictionBudget: String(r.frictionBudget || ''),
    phase: String(r.phase || ''),
    status: String(r.status || ''),
    completedTasks: Number(r.completedTasks || 0),
    totalTasks: r.totalTasks != null ? Number(r.totalTasks) : null,
    currentTask: (r.currentTask as string) || null,
    stallCount: Number(r.stallCount || 0),
    lastError: (r.lastError as string) || null,
    updatedAt: String(r.updatedAt || ''),
    createdAt: String(r.createdAt || ''),
  }
}

/** 只增量刷新 runs：保持 detail 对象与滚动位置——整抽屉重拉（重建 detail）会让标题/内容闪空、滚动复位 */
async function refreshDetailRuns(experimentId: string) {
  const res = await adminBatchExperimentsApi.detail(experimentId)
  const d = res.data?.data ?? res.data
  detailRuns.value = (d?.runs || []).map(mapRun)
}

async function openDetail(e: ExpRow, ev?: Event) {
  // 行内按钮/⋯ 菜单上回车会冒泡到行：仅当事件源就是行本身时才继续（判例 ExecLogs.toggleRowOpen）
  if (ev && ev.target !== ev.currentTarget) return
  detail.value = e
  detailOpen.value = true
  detailLoading.value = true
  detailError.value = false
  detailRuns.value = []
  try {
    await refreshDetailRuns(e.id)
  } catch (err) {
    detailError.value = true
    toast.error(`加载详情失败：${errMsg(err)}`)
  } finally {
    detailLoading.value = false
  }
}

/** 抽屉内「重试」：重开同一实验的详情（detailError 复位、loading 态由 openDetail 接管） */
function retryDetail() {
  if (detail.value) void openDetail(detail.value)
}

/* 运行态文案统一走全局字典单源：stalled（卡死）已收录、done 统一「已完成」
   （原私写映射漏收 stalled——若有人误改走通用表会英文直出；done 曾写「完成」） */
const runStatusText = (s: string) => statusText(s)
const runStatusBadge = (s: string) =>
  s === 'done' ? 'mk-badge--ok' : s === 'failed' ? 'mk-badge--bad' : s === 'stalled' ? 'mk-badge--warn' : 'mk-badge--info'

/* run 阶段（phase）英文裸枚举 → 白话（P2-3，2026-09-27 走查）：setup/goal/path/learn/
   learn-done/decay/done 按调度器推进链路翻译；未知值原样兜底（后端新增阶段时不至于消失）。
   写法对齐 PromptEval.vue 的 stageText */
const PHASE_TEXT: Record<string, string> = {
  setup: '初始化',
  goal: '目标阶段',
  path: '路径阶段',
  learn: '学习中',
  'learn-done': '学习完成',
  decay: '跨日衰减',
  done: '完成',
}
const phaseText = (p: string): string => {
  if (!p) return '—'
  return PHASE_TEXT[p] || p
}

async function advance(experimentId: string, runId: string) {
  // 会直接改变虚拟学习者阶段状态：执行前确认
  const ok = await askConfirm({
    title: '推进实验',
    message: '确认将该运行推进一个阶段？会立即改变虚拟学习者的阶段状态。',
    confirmText: '推进',
    danger: false,
  })
  if (!ok) return
  runBusy.value = true
  try {
    await adminBatchExperimentsApi.advanceRun(experimentId, runId)
    toast.success('已推进一个阶段')
    await refreshDetailRuns(experimentId) // 原位刷新 runs，不动 detail（避免抽屉闪空/滚动复位）
  } catch (e) {
    toast.error(`推进失败：${errMsg(e)}`)
  } finally {
    runBusy.value = false
  }
}

async function decay(experimentId: string, runId: string) {
  // 按衰减模型改写学习状态：执行前确认
  const ok = await askConfirm({
    title: '模拟跨日衰减',
    message: '确认模拟跨日衰减？会按衰减模型更新该运行的学习状态（KTL/LF 等）。',
    confirmText: '模拟衰减',
    danger: false,
  })
  if (!ok) return
  runBusy.value = true
  try {
    await adminBatchExperimentsApi.decayRun(experimentId, runId)
    toast.success('已模拟跨日衰减')
    await refreshDetailRuns(experimentId) // 原位刷新 runs，不动 detail
  } catch (e) {
    toast.error(`衰减失败：${errMsg(e)}`)
  } finally {
    runBusy.value = false
  }
}

async function snapshot(experimentId: string, runId: string) {
  runBusy.value = true
  try {
    await adminBatchExperimentsApi.snapshotRun(experimentId, runId)
    toast.success('快照已生成')
    await refreshDetailRuns(experimentId) // 原位刷新 runs，不动 detail
  } catch (e) {
    toast.error(`快照失败：${errMsg(e)}`)
  } finally {
    runBusy.value = false
  }
}

load()

/* 轮询（2026-09-27）：后端调度器每 30s 推进 run，此前页面只在挂载时拉一次，运行中数据必然陈旧。
   触发条件：列表有运行中实验，或详情抽屉开着且其中有 active run——抽屉打开时只增量刷该实验的 runs，
   不整表重拉（整表重拉会让表格重渲染、抽屉背后的行跳动）。useSafePolling 自带 document.hidden
   暂停与失败退避，20s 间隔对齐调度粒度（30s）留出余量。 */
const poll = useSafePolling(
  async () => {
    if (detailOpen.value && detail.value) {
      await refreshDetailRuns(detail.value.id)
      return
    }
    // silent 失败返回 false 时抛错，让轮询器计入退避/断路器，而不是当成功白转
    const ok = await load({ silent: true })
    if (!ok) throw new Error('batch experiment list refresh failed')
  },
  { interval: 20000, immediate: false, skipWhenHidden: true },
)
const shouldPoll = computed(
  () =>
    runningCount.value > 0 ||
    (detailOpen.value &&
      (detailRuns.value.some((r) => r.status === 'active') ||
        experiments.value.some((e) => e.id === detail.value?.id && e.status === 'running'))),
)
watch(shouldPoll, (on) => (on ? poll.start() : poll.stop()), { immediate: true })
</script>

<style scoped>
/* 表格（原型 .tbl）：自动布局下单元格 nowrap；实验描述是自由文本，max-width 截断兜底 */
.be-list .mk-table td { white-space: nowrap; }
.be-desc { display: block; max-width: 260px; }
/* 负责人列（原型 .sub mono）：muted 色 + mono 字形（mono 走全局 .mono），空值由模板显 — */
.be-owner { color: var(--mk-muted); }
.be-progress { display: flex; align-items: center; gap: 8px; min-width: 140px; }
/* 学习者列：失败数红色强调（失败有值时突出，无失败保持副行灰） */
.be-fail-num { color: var(--mk-red); font-weight: 700; }
.be-cell--fail { color: var(--mk-red); }
/* P1#23 状态条聚合：失败红 / 卡死琥珀（与行内 be-fail-num、be-run__stall 同色系，跨行同语义同色） */
.be-agg--bad { color: var(--mk-red); font-weight: 700; }
.be-agg--stall { color: var(--mk-amber); font-weight: 700; }
/* P1#22 最近活动列：卡死嫌疑琥珀（资源停滞非故障，不用红） */
.be-activity--stall { color: var(--mk-amber); font-weight: 700; }
/* P1#23 抽屉失败格：非人工停止的失败 run 红字 */
.be-fact-fail { color: var(--mk-red); }
.be-progress .mk-minibar { flex: 1; }
.be-progress__num { font-family: var(--mk-mono); font-size: var(--mk-fs-micro); color: var(--mk-muted); white-space: nowrap; }

.be-rows { display: grid; gap: 6px; }
.be-row { display: grid; grid-template-columns: 1.2fr 1.6fr 0.9fr 28px; gap: 8px; align-items: center; }
.be-row--head { font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-faint); letter-spacing: 0.04em; }
.be-row--head span:last-child { visibility: hidden; }
.be-budget { height: 34px; }
/* 创建弹窗：学习者重名即时提示（非阻断，后端允许同名 run，仅影响辨识） */
.be-dup-hint { font-size: var(--mk-fs-micro); color: var(--mk-amber); }


/* 详情抽屉（原型 openLearner 三段式）：头部标题 + 正文首段 pills/事实栅格 + 嵌套卡 + 常驻 foot */
.be-detail__title { display: grid; gap: 6px; min-width: 0; }
.be-detail__desc { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.be-detail__body { display: grid; gap: 16px; align-content: start; }
/* 首段徽章行（原型 .ovl__body 首段 pills）：状态 / 学习者数 */
.be-detail__pills { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
/* 事实栅格走共享原语 .mk-facts；进度格嵌 minibar（原型 kv 的 dd 嵌 meterrow，同 OpsContent oc-fact-progress） */
.be-fact-progress { display: grid; gap: 4px; align-items: start; }
.be-fact-progress__num { font-family: var(--mk-mono); font-variant-numeric: tabular-nums; }
.be-fact-progress__bar { width: 72px; }
/* 底部动作条（原型 .ovl__foot：上边框、右对齐、常驻滚动区外；同 gc-detail__foot 判例） */
.be-detail__foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--mk-line);
}
/* 运行记录：嵌套无边框卡内的 feed 行（原型 .card box-shadow:none 内 ranklist，行间发丝线分隔） */
.be-runs { display: grid; }
.be-run { padding: 12px 16px; display: grid; gap: 8px; }
.be-run + .be-run { border-top: 1px solid var(--mk-line); }
.be-run__head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.be-run__head strong { font-size: var(--mk-fs-body); }
.be-run__phase { margin-left: auto; font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.be-run__body { display: flex; gap: 12px; flex-wrap: wrap; font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.be-run__task { max-width: 380px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.be-run__stall { color: var(--mk-amber); }
.be-run__error { color: var(--mk-red); max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.be-run__time { margin-left: auto; }
.be-run__actions { display: flex; gap: 6px; }

/* 空态撑满主区剩余高度（2026-09-27 走查「空态利用」：无实验时空态卡只占视口顶部约 200px，
   下方约 70% 视口是空白画布，与全站「空态应利用主区高度」取向不符）。
   走全局 mk-empty--min 机制（模板 min prop 提供 min-height + place-content: center 垂直居中），
   此处只按本页壳层覆盖偏移变量 --mk-empty-min-h（mk-primitives.css 预留的页面覆盖口）。
   150px 推导（1920×1080、无 zoom；本页挂在 AdminConsole 壳层 .mshell__content 内滚动）：
     面包屑 .mshell__crumb        ~32（上下 7px 内边距 + 12px 微字号行高 ~18 + 1px 下边框）
     页面 padding-top              16（.mk-page 的 --mk-space-4）
     状态条 .mk-status             48（min-height，本页带「新建实验」按钮即撑满该高度）
     状态条与卡片间距              16（.mk-page 的 grid gap = --mk-space-4）
     页面 padding-bottom           20（.mk-page 的 --mk-space-5）
     卡片上下边框                   2
   合计 ≈134，留 ~16px 余量取整 150。加载骨架/错误态/表格分支不带 mk-empty--min，不受影响。
   上限用 min(..., 1200px) 而非 max-height：CSS 里 min-height 优先于 max-height，
   超长竖屏下直接写 max-height 会被 min 顶掉不生效，min() 才能真正收口；
   1080p 下 min 930px < 1200px，上限不参与。zoom：--vp-zoom 变量只存在于用户侧
   v2.css（.v2-page），admin 语境没有；admin zoom 写在 body.admin-route .ac 上且仅
   ≥2800px（1.15）/≥3600px（1.3）生效，并有 .ac/.mshell min-height ÷zoom 换算机制
   （admin-theme.css），与全局 mk-empty--min 默认口径一致，视口高度直写 100dvh 即可。 */
.mk-card > .mk-empty--min {
  --mk-empty-min-h: min(calc(100dvh - 150px), 1200px);
}

@media (min-width: 2000px) {
  .be-run { padding: 14px 16px; }
  .be-run__head strong { font-size: var(--mk-fs-body); }
  .be-run__body { font-size: var(--mk-fs-micro); }
  .be-progress__num { font-size: var(--mk-fs-micro); }
}
@media (min-width: 2800px) {
  .be-run { padding: 16px 19px; }
  .be-run__head strong { font-size: var(--mk-fs-body); }
  .be-run__body { font-size: var(--mk-fs-micro); }
  .be-progress__num { font-size: var(--mk-fs-micro); }
}
@media (min-width: 3600px) {
  .be-run { padding: 19px 22px; }
  .be-run__head strong { font-size: var(--mk-fs-emphasis); }
  .be-run__body { font-size: var(--mk-fs-emphasis); }
  .be-progress__num { font-size: var(--mk-fs-body); }
}
</style>
