<template>
  <div :class="embedded ? 'mk-page--fill fb-embedded' : 'mk-page mk-page--fill'">
    <!-- 状态条（embedded 时由运营中心宿主承载域计数，不再渲染） -->
    <div v-if="!embedded" class="mk-status" :class="pendingCount > 0 ? 'mk-status--warn' : 'mk-status--ok'">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">反馈中心</strong>
      <span class="mk-status__sep"></span>
      <template v-if="isLive">
        <span class="mk-status__meta">总数 {{ total }}</span>
        <span class="mk-status__meta">待处理 {{ pendingCount }}</span>
        <span v-if="recent30 != null" class="mk-status__meta">近 30 天 {{ recent30 }}</span>
      </template>
      <span class="mk-status__actions">
        <button type="button" class="mk-status__action" :disabled="loading" @click="() => load(true)">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
      </span>
    </div>

    <!-- 刷新失败但仍有旧数据：轻量错误横幅（区别于首载失败全屏态） -->
    <div v-if="loadFailed && rows.length" class="mk-alert" role="alert">
      刷新失败，当前显示上次加载的数据。
      <button type="button" class="mk-link" @click="() => load(true)">重试</button>
    </div>

    <!-- 加载失败（首载无数据时优先于空态展示，含重试） -->
    <MkEmptyState
      v-if="loadFailed && !rows.length"
      title="反馈数据加载失败"
      description="反馈列表加载失败，请重试。"
      action-text="重试"
      min
      @action="() => load(true)"
    />

    <template v-else>
      <!-- 列表 -->
      <div class="mk-card mk-card--fill">
        <div class="mk-card__head">
          <div class="mk-filter">
            <!-- 2026-10-27 筛选语法对齐教学会话（M3：同页 chip 组不得一组单选一组多选）：
                 状态一组单选、标志一组多选开关（激活前缀勾），两组各有 aria-label。 -->
          <MkPillSelect
            v-model="statusFilter"
            label="状态"
            aria-label="按状态筛选"
            :options="statusSelectOptions"
            :active="!!statusFilter"
          />
          <!-- 2026-10-27 用户「需要统一调整」：低分也归维度下拉——评分是一个维度，
               常驻 chip 组退场，计数进 option 文案（同一读数只出现一处）。 -->
          <MkPillSelect
            v-model="scoreSelect"
            label="评分"
            aria-label="按评分筛选"
            :options="scoreSelectOptions"
            :active="lowOnly"
          />
            <!-- 真实/测试互斥视角由宿主运营中心的页级开关统一承载（2026-10-23 走查：
                 卡内开关与页级开关同屏并列、却只各管一半——页级动 KPI、卡内动列表）。
                 这里不再放第二枚开关，视图随 :include-test 联动。 -->
          </div>
          <span class="mk-card__head-right">
            <!-- 搜索槽位统一（2026-10-15 用户拍板全站列表页）：搜索移到右组首位 -->
            <MkFilterSearch v-model="keyword" placeholder="搜索用户 / 评论 / 任务" />
            <!-- 口径（真实/测试）由左侧开关自明，meta 只报「筛选命中 / 本页行数」这一个事实
                 （2026-10-19 用户走查「这个小文案不要」删掉前置的（真实）复读）。
                 2026-10-26 动线收口：只在真筛过（命中 < 已载入）时才出——未筛时它与分页器
                 「共 N 条」同数同源，同屏两个一样的数字。 -->
            <span v-if="filtered.length < rows.length" class="mk-card__meta" title="筛选命中条数 / 已载入条数">命中 {{ filtered.length }} / {{ rows.length }} 条</span>
          </span>
        </div>

        <div v-if="filtered.length" class="mk-table-scroll">
        <!-- 固定列宽（2026-10-22 与教学组三表同判例）：用户/评论两列在 auto 布局下按当页最长
             内容分宽，翻页整表跳动；fixed 后按表头定死，余量按权重摊开。长评论仍由
             fb- 局部 max-width 截断兜底（全文在 title） -->
        <table class="mk-table mk-table--click mk-table--fixed mk-table--nowrap fb-table">
          <thead>
            <tr>
              <th
                scope="col"
                class="mk-th--sortable fb-c-user"
                :aria-sort="fbSortState('user')"
                @click="toggleFbSort('user')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleFbSort('user')">用户<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th
                scope="col"
                class="mk-th--right mk-th--sortable fb-c-rating"
                :aria-sort="fbSortState('rating')"
                @click="toggleFbSort('rating')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleFbSort('rating')">评分<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th scope="col" class="fb-c-comment">评论</th>
              <th scope="col" class="fb-c-node">节点</th>
              <th scope="col" class="fb-c-strategy">策略</th>
              <th
                scope="col"
                class="mk-th--sortable fb-c-status"
                :aria-sort="fbSortState('status')"
                @click="toggleFbSort('status')"
              ><button type="button" class="mk-th__btn" @click.stop="toggleFbSort('status')">状态<span class="mk-th__caret" aria-hidden="true"></span></button></th>
              <th scope="col" class="fb-c-time">时间</th>
              <th scope="col" class="mk-th--right mk-c-act">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in paged" :key="r.id" class="fb-row" tabindex="0" @click="openDetail(r)" @keydown.enter="($event.target === $event.currentTarget) && openDetail(r)">
              <td>
                <div class="mk-cell-main">
                  <strong :title="r.userName">{{ r.userName }}</strong>
                  <span class="mk-cell-sub" :title="r.userEmail">{{ r.userEmail }}</span>
                </div>
              </td>
              <td class="mk-num">
                <span class="fb-rating" :class="{ 'fb-rating--low': r.rating <= 2 }">
                  <span class="mk-dots" :class="{ 'mk-dots--warn': r.rating <= 2 }" role="img" :aria-label="`评分 ${r.rating}/5`">
                    <i v-for="d in 5" :key="d" :class="{ 'is-on': d <= r.rating }"></i>
                  </span>
                  <b class="mono">{{ r.rating }}</b>
                </span>
              </td>
              <td>
                <span v-if="r.comment" class="fb-comment" :title="r.comment">{{ r.comment }}</span>
                <span v-else class="mk-na">—</span>
              </td>
              <!-- 节点是内部 agentId、策略是后端枚举：上屏走中文名，原文进 title（2026-11-02 评审：
                   此前 snake_case 原样直出，读一屏要在脑子里做一次英中对照） -->
              <td>
                <span v-if="r.agentId" class="fb-agent" :title="r.agentId">{{ agentText(r.agentId) }}</span>
                <span v-else class="mk-na">—</span>
              </td>
              <td>
                <span v-if="r.strategy" class="fb-strategy" :title="r.strategy">{{ strategyText(r.strategy) }}</span>
                <span v-else class="mk-na">—</span>
              </td>
              <td><span class="mk-badge" :class="statusBadge(r.status)">{{ statusLabel(r.status) }}</span></td>
              <td><span class="mk-cell-sub" :title="fmtDateTime(r.createdAtRaw)">{{ r.createdAt }}</span></td>
              <td>
                <div class="mk-actions">
                  <button type="button" class="mk-link" @click.stop="openDetail(r)">处理</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        </div>
        <!-- 加载态：与同单元另三张表同口径（骨架屏，非 spinner 文案）——审核 #170 -->
        <MockSkeletonTable v-else-if="loading" :cols="8" />
        <MkEmptyState
          v-else
          min
          :title="isFiltered ? '当前筛选无匹配' : '暂无反馈'"
          :description="isFiltered
            ? '当前状态 / 评分 / 关键词条件下没有反馈，可清除筛选查看全部。'
            : '还没有学员提交反馈。课后报告或消息点赞产生的反馈会出现在这里。'"
          :action-text="isFiltered ? '清除筛选' : '刷新'"
          @action="isFiltered ? clearFilters() : load(true)"
        />
        <!-- 客户端分页（统一 mk-pagination 页码器）：筛选后按页切片。
             必须在 .mk-card--fill 卡内（尾部吸底），不能挂卡外（破坏吸底契约）。 -->
        <Pagination
          v-if="filtered.length"
          v-model:page="page"
          v-model:pageSize="pageSize"
          :total="filtered.length"
          :showTotal="true"
        />
      </div>
    </template>

    <!-- 处理面板（mk-drawer 体系：暗色/4K 由全局接管） -->
    <Teleport to="body">
      <div v-if="detail" ref="maskRef" class="mk-drawer">
        <div class="mk-drawer__mask" @click="closeDetail"></div>
        <aside ref="panelRef" class="mk-drawer__panel" role="dialog" aria-label="反馈详情">
          <!-- 头部（原型 .ovl__head：标题 + grow + 关闭钮，下边框）：状态徽章下沉到正文首段徽章行 -->
          <header class="mk-drawer__head">
            <div class="mk-drawer__heading">
              <h3 class="mk-drawer__title">{{ detail.userName }} 的反馈</h3>
              <!-- 反馈 ID 是运营与研发对日志的唯一定位符：给一颗复制钮
                   （2026-11-01 外部评审：此前只能手动框选 39 个字符的 id） -->
              <span class="fb-idrow">
                <span class="mk-drawer__sub mono">{{ detail.id }}</span>
                <button
                  type="button"
                  class="fb-idrow__copy"
                  :aria-label="`复制反馈 ID ${detail.id}`"
                  title="复制反馈 ID"
                  @click="copyDetailId"
                >
                  <Copy :size="12" :stroke-width="2" aria-hidden="true" />
                </button>
              </span>
            </div>
            <button type="button" class="mk-drawer__close" aria-label="关闭" @click="closeDetail">✕</button>
          </header>
          <div class="mk-drawer__body fb-body">
            <!-- 首段徽章行（原型 .ovl__body 首段 pills）：状态 / 难度适配 / UI 类型 / 轮次（均为行上已有字段） -->
            <div class="fb-pills">
              <span class="mk-badge" :class="statusBadge(detail.status)">{{ statusLabel(detail.status) }}</span>
              <span v-if="detail.difficultyFit" class="mk-badge mk-badge--muted" :title="detail.difficultyFit">难度适配 {{ difficultyFitText(detail.difficultyFit) }}</span>
              <span v-if="detail.uiType" class="mk-badge mk-badge--muted" :title="detail.uiType">{{ uiTypeText(detail.uiType) }}</span>
              <span v-if="detail.roundNumber != null" class="mk-badge mk-badge--muted">轮次 {{ detail.roundNumber }}</span>
            </div>
            <!-- 事实清单（原型 dl.kv → 共享 mk-facts 栅格）：三维评分带点阵；id 类格单行省略、全文在 title -->
            <div class="mk-facts">
              <div><span>评分</span><span class="mk-dots" :class="{ 'mk-dots--warn': detail.rating <= 2 }" role="img" :title="`评分 1-5，5 = 最好（≤2 标琥珀）`" :aria-label="`评分 ${detail.rating}/5（1-5，5 最好）`"><i v-for="d in 5" :key="d" :class="{ 'is-on': d <= detail.rating }"></i></span><strong class="mono">{{ detail.rating }}/5</strong></div>
              <div><span>有用度</span><span class="mk-dots" role="img" :title="`有用度 1-5，5 = 最好`" :aria-label="`有用度 ${detail.helpfulness ?? '—'}/5（1-5，5 最好）`"><i v-for="d in 5" :key="d" :class="{ 'is-on': detail.helpfulness != null && d <= detail.helpfulness }"></i></span><strong class="mono">{{ detail.helpfulness != null ? `${detail.helpfulness}/5` : '—' }}</strong></div>
              <div><span>清晰度</span><span class="mk-dots" role="img" :title="`清晰度 1-5，5 = 最好`" :aria-label="`清晰度 ${detail.clarity ?? '—'}/5（1-5，5 最好）`"><i v-for="d in 5" :key="d" :class="{ 'is-on': detail.clarity != null && d <= detail.clarity }"></i></span><strong class="mono">{{ detail.clarity != null ? `${detail.clarity}/5` : '—' }}</strong></div>
              <div><span>难度</span><span class="mk-dots" role="img" :title="`难度 1-5，5 = 最难（数值高不代表好评）`" :aria-label="`难度 ${detail.difficulty ?? '—'}/5（1-5，5 最难）`"><i v-for="d in 5" :key="d" :class="{ 'is-on': detail.difficulty != null && d <= detail.difficulty }"></i></span><strong class="mono">{{ detail.difficulty != null ? `${detail.difficulty}/5` : '—' }}</strong></div>
              <div><span>节点</span><strong :title="detail.agentId || ''">{{ detail.agentId ? agentText(detail.agentId) : '—' }}</strong></div>
              <div><span>策略</span><strong :title="detail.strategy || ''">{{ detail.strategy ? strategyText(detail.strategy) : '—' }}</strong></div>
              <div><span>任务</span>
                <span class="fb-idrow">
                  <strong class="mono" :title="detail.taskId || ''">{{ detail.taskId || '—' }}</strong>
                  <button
                    v-if="detail.taskId"
                    type="button"
                    class="fb-idrow__copy"
                    :aria-label="`复制任务 ID ${detail.taskId}`"
                    title="复制任务 ID"
                    @click="copyField('任务 ID', detail.taskId)"
                  >
                    <Copy :size="12" :stroke-width="2" aria-hidden="true" />
                  </button>
                </span>
              </div>
              <div><span>会话</span>
                <span class="fb-idrow">
                  <strong class="mono" :title="detail.sessionId || ''">{{ detail.sessionId || '—' }}</strong>
                  <!-- 排查 Bad Case 要把会话 ID 贴进日志检索：截断的 id 没法手动选全 -->
                  <button
                    v-if="detail.sessionId"
                    type="button"
                    class="fb-idrow__copy"
                    :aria-label="`复制会话 ID ${detail.sessionId}`"
                    title="复制会话 ID"
                    @click="copyField('会话 ID', detail.sessionId)"
                  >
                    <Copy :size="12" :stroke-width="2" aria-hidden="true" />
                  </button>
                  <!-- 2026-11-11（困惑测试 #7）：处理反馈的下一步是看现场，会话 ID 原先只能复制。
                       复用只读会话座舱深链（与教学会话列表同一落点）。 -->
                  <button
                    v-if="detail.sessionId"
                    type="button"
                    class="mk-link"
                    @click="openSubPage('session-real', detail.sessionId)"
                  >查看会话</button>
                </span>
              </div>
              <!-- 提交时间（审核 #169）：绝对时间入事实格，相对时间留列表列（另三张表同口径） -->
              <div><span>提交时间</span><strong class="mono" :title="detail.createdAtRaw">{{ fmtDateTime(detail.createdAtRaw) }}</strong></div>
            </div>

            <section v-if="detail.comment" class="fb-section">
              <header class="mk-section__head"><h4>评论</h4></header>
              <p class="fb-text">{{ detail.comment }}</p>
            </section>
            <section v-if="detail.suggestions" class="fb-section">
              <header class="mk-section__head"><h4>建议</h4></header>
              <p class="fb-text">{{ detail.suggestions }}</p>
            </section>
            <section v-if="detail.confusionPoint" class="fb-section">
              <header class="mk-section__head"><h4>困惑点</h4></header>
              <p class="fb-text">{{ detail.confusionPoint }}</p>
            </section>
            <section v-if="detail.reasonCodes.length" class="fb-section">
              <header class="mk-section__head"><h4>原因标签</h4></header>
              <div class="fb-codes">
                <span v-for="c in detail.reasonCodes" :key="c" class="mk-badge mk-badge--muted" :title="c">{{ reasonText(c) }}</span>
              </div>
            </section>

            <section class="fb-section">
              <header class="mk-section__head"><h4>内部备注</h4></header>
              <!-- 备注随状态一起提交（含四枚按钮各自管什么）：规则收进输入框 title，
                   屏上不再留说明段——原先是响应 2026-11-02 评审「按钮组与文案随输入内容变来变去」，
                   把规则写死让主按钮文案稳定；写死的位置从屏上改到 title，规则本身不变。 -->
              <textarea v-model="noteDraft" class="fb-note" rows="3" placeholder="处理记录 / 归因 / 跟进结论" title="备注会随「标记已解决 / 标记已分流 / 忽略」一起保存，也可以点「仅保存备注」单独留存"></textarea>
            </section>
            <!-- 2026-11-11（困惑测试 #6）：三个终态的差别与后果原先全靠猜。 -->
            <p class="fb-statusnote">
              已分流 = 已确认待跟进（不转派给具体人，离开待处理数）。已解决 = 已按反馈处理完。已忽略 = 判定无需处理。三者只改运营侧状态，不影响评分与统计（统计不按状态过滤），学员侧暂不可见。
            </p>
            <!-- 处理失败的原因留在抽屉里（2026-11-11 表单审计）：此前只有 4s toast，
                 消失后用户只看到按钮恢复、状态未变，不知道该改什么。 -->
            <div v-if="saveError" class="mk-alert" role="alert">
              <span class="mk-alert__msg">{{ saveError }}</span>
            </div>
          </div>
          <!-- 底部动作（原型 .ovl__foot：取消/忽略在左、主钮最右、常驻滚动区外；同 gc-detail__foot 判例） -->
          <footer class="mk-drawer__foot">
            <!-- 2026-11-01 外部评审（二轮）：主次倒置——「分流入库」被做成了饱和蓝主按钮，
                 而真正把反馈处理完的「标记已解决」只是绿描边次级。按动作的终局性排：
                 解决 = 主按钮；分流 / 忽略 = 同款次级（2026-11-02 评审：两枚同级按钮一蓝一灰，
                 并排读起来像两种权重）。
                 按钮组固定四枚，不随备注内容增减（2026-11-02 评审）：没有待保存的备注时
                 「仅保存备注」置灰而不是消失，组内成员与顺序始终一致。 -->
            <button
              type="button"
              class="mk-btn"
              :disabled="saving || !noteDirty"
              @click="saveNoteOnly"
            >仅保存备注</button>
            <button type="button" class="mk-btn" :disabled="saving" @click="save('dismissed')">忽略</button>
            <button type="button" class="mk-btn" :disabled="saving" @click="save('triaged')">标记已分流</button>
            <button type="button" class="mk-btn mk-btn--primary" :disabled="saving" @click="save('resolved')">
              {{ saving ? '保存中…' : '标记已解决' }}
            </button>
          </footer>
        </aside>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { isLive, intent, openSubPage } from './store'
import { errMsg, timeAgo, isPageCacheFresh, markPageFetched } from './live'
import { adminFeedbackApi } from '@/api/adminApi'
import { useEscape } from './useEscape'
import { useOverlay, useMaskClose } from './useOverlay'
import { toast } from '@/utils/toast'
import Pagination from './Pagination.vue'
import MkFilterSearch from '@/components/mk/MkFilterSearch.vue'
import MkPillSelect from '@/components/mk/MkPillSelect.vue'
import { useTableSort } from './useTableSort'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MockSkeletonTable from './SkeletonTable.vue'
import { Copy } from 'lucide-vue-next'
import { copyText } from './clipboard'

/** 嵌入模式：作为运营中心「反馈」tab 渲染（仅去掉外层状态条；宿主承载域计数）。
    count 事件：反馈总数上报（宿主「反馈 N」徽章）。
    includeTest：真实/测试视角由宿主页级开关下发（v-model:include-test），
    列表数据范围与宿主 KPI 同源，不再各用一份本地状态。 */
const props = withDefaults(defineProps<{ embedded?: boolean; includeTest?: boolean }>(), { embedded: false, includeTest: false })
const emit = defineEmits<{ (e: 'count', total: number): void; (e: 'status', status: string): void }>()

type Status = 'new' | 'triaged' | 'resolved' | 'dismissed'

interface Row {
  id: string
  userName: string
  userEmail: string
  rating: number
  comment: string
  agentId: string
  strategy: string
  uiType: string
  taskId: string
  sessionId: string
  status: Status
  createdAt: string
  /** 原始 ISO（mapRow 里被覆写成相对时间文案前先留底）：行 title / 抽屉事实格里给绝对值（审核 #169） */
  createdAtRaw: string
}

interface Detail extends Row {
  helpfulness: number | null
  clarity: number | null
  difficulty: number | null
  difficultyFit: string
  roundNumber: number | null
  suggestions: string
  confusionPoint: string
  reasonCodes: string[]
  internalNote: string
}

const loading = ref(false)
/** live 拉取失败 → 行内错误态（区别于真正无数据的空态） */
const loadFailed = ref(false)
const saving = ref(false)
/** 处理动作的失败原因：常驻抽屉（不只 toast），让用户知道下一步该做什么 */
const saveError = ref('')
const rows = ref<Row[]>([])
const total = ref(0)
const pendingCount = ref(0)
const recent30 = ref<number | null>(null)

/** 宿主域计数徽章（embedded 才消费）：只报「待处理」——角标位天然被读作待办量，
    此前报总数（含已解决/已忽略），与运营待办的「待处理反馈」不同源。 */
watch([pendingCount, total], ([pending]) => {
  emit('count', pending)
}, { immediate: true })
const keyword = ref('')
const statusFilter = ref('')
const lowOnly = ref(false)
/* 真实/测试互斥视角（2026-10-10 拍板方言）：默认真实——后端列表口径同步改为仅真实。
   2026-10-23 起由宿主页级开关下发（见 props），本组件不再保留第二份本地状态；
   切换仍强制重拉（绕过页缓存）。 */
const scopeProp = computed(() => props.includeTest ?? false)
watch(scopeProp, () => {
  void load(true)
})
const detail = ref<Detail | null>(null)
const noteDraft = ref('')
/** 备注是否有未保存的改动：只用来决定「仅保存备注」可不可点（按钮常驻，避免组内按钮增减） */
const noteDirty = computed(() => !!detail.value && noteDraft.value.trim() !== (detail.value.internalNote || ''))
/** 抽屉统一关闭路径：提交中（saving）禁止 Esc/遮罩/✕ 误关——请求仍在跑却失去上下文。
    ✕/遮罩/Esc 全部指向本函数（与 Confirm.vue busy 拦截同款）。 */
function closeDetail() {
  if (!saving.value) detail.value = null
}
/** 复制反馈 ID：成功/失败都给 toast（失败时把 id 一起打出来，手动可复制） */
async function copyDetailId() {
  const id = detail.value?.id
  if (!id) return
  const ok = await copyText(id)
  if (ok) toast.success('已复制反馈 ID')
  else toast.error(`复制失败，请手动复制：${id}`)
}
useEscape(() => !!detail.value, closeDetail)
const panelRef = ref<HTMLElement | null>(null)
const maskRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => !!detail.value), panelRef)
useMaskClose(maskRef, closeDetail)

const statusPills = computed(() => {
  const all = rows.value
  return [
    { id: 'new', label: '待处理', count: all.filter((r) => r.status === 'new').length },
    { id: 'triaged', label: '已分流', count: all.filter((r) => r.status === 'triaged').length },
    { id: 'resolved', label: '已解决', count: all.filter((r) => r.status === 'resolved').length },
    { id: 'dismissed', label: '已忽略', count: all.filter((r) => r.status === 'dismissed').length }
  ]
})
/** 卡头「状态」下拉：计数取当前已载入行 */
const statusSelectOptions = computed(() => [
  /* 「全部状态」→「全部」（2026-11-09 走查）：MkPillSelect 触发器把 label（状态）与选中项并排渲染，
     选项再写「全部状态」就是「状态 全部状态」——同一句话说了两遍。 */
  { value: '', label: '全部' },
  ...statusPills.value.map((p) => ({ value: p.id, label: `${p.label}（${p.count}）` }))
])

/** 低分（≤2）条数：供「仅低分」pill 计数 */
const lowCount = computed(() => rows.value.filter((r) => r.rating <= 2).length)
/** 评分维度（2026-10-27 统一）：低分从常驻 chip 迁入下拉，计数只在 option 文案里。 */
const scoreSelect = computed<string>({
  get: () => (lowOnly.value ? 'low' : ''),
  set: (v) => { lowOnly.value = v === 'low' }
})
const scoreSelectOptions = computed(() => [
  { value: '', label: '全部评分' },
  { value: 'low', label: `低分 ≤2（${lowCount.value}）` }
])

const statusLabel = (s: string) =>
  ({ new: '待处理', triaged: '已分流', resolved: '已解决', dismissed: '已忽略' })[s] || s || '—'
const statusBadge = (s: string) =>
  s === 'resolved' ? 'mk-badge--ok' : s === 'new' ? 'mk-badge--warn' : s === 'triaged' ? 'mk-badge--info' : 'mk-badge--muted'

/* ---------- 反馈域枚举 → 中文展示 ----------
   与 statusText.ts 同策略：未收录的值原样返回（不丢排障信息），原文一律进 title。
   节点 / 策略 / 难度适配 / UI 类型 / 原因标签此前把这些 snake_case 与内部 id 直接印在
   中文界面上。表是反馈域私有枚举，先放本页；若其它页面也要读，再并入 statusText.ts。 */
const NODE_TEXT: Record<string, string> = {
  // agentId；名字对齐后端 agent-manifest（teaching-agent 的注册名是「教学 Agent」）
  'teaching-agent': '教学 Agent',
  'ai-teaching-agent': '教学 Agent',
  'ai-teaching': '教学 Agent',
  'goal-conversation': '目标对话',
  'goal-conversation-agent': '目标对话',
  'path-planning': '路径规划',
  'learner-model-agent': '学习记录'
}
/* 教学策略枚举单源 = 后端 pedagogy.config / teaching-strategy-selector 的 8 类；
   末两条是早期与演示数据里的策略名，出现时也要读得懂 */
const STRATEGY_TEXT: Record<string, string> = {
  explain: '讲解',
  demonstrate: '示范',
  scaffold: '引导',
  drill: '练习',
  diagnose: '诊断',
  feedback: '反馈',
  motivate: '激励',
  reflect: '反思',
  socratic: '启发提问',
  direct: '直接讲解'
}
const DIFFICULTY_FIT_TEXT: Record<string, string> = {
  too_easy: '偏简单',
  appropriate: '合适',
  // 旧数据里写作 fit（与 Learning 侧的 difficulty-change 映射并存），与 appropriate 同义
  fit: '合适',
  too_hard: '偏难'
}
/* uiType = 采集这条反馈的界面；后端写入值带 v1 版本后缀 */
const UI_TYPE_TEXT: Record<string, string> = {
  'session-report-v1': '课后报告',
  'message-thumbs-v1': '消息点赞',
  lesson: '课堂',
  summary: '总结',
  review: '复习'
}
/* 原因标签：单源 = 学习者端 SessionFeedbackPanel 的 reasonOptions（大写枚举）；后端该字段
   是自由字符串数组，历史与演示数据里另有小写自由值，一并收录 */
const REASON_TEXT: Record<string, string> = {
  inaccurate_content: '内容不准确',
  unclear_explanation: '解释不清',
  pace_mismatch: '节奏不合适',
  difficulty_mismatch: '难度不合适',
  checkpoint_issue: '理解检查有问题',
  other: '其他',
  content_unclear: '内容不清',
  pace_too_fast: '节奏太快',
  too_fast: '节奏太快',
  need_examples: '需要示例'
}

function dictText(dict: Record<string, string>, raw: string | null | undefined): string {
  const v = String(raw || '')
  return dict[v.toLowerCase()] || v
}
const agentText = (v: string) => dictText(NODE_TEXT, v)
const strategyText = (v: string) => dictText(STRATEGY_TEXT, v)
const difficultyFitText = (v: string) => dictText(DIFFICULTY_FIT_TEXT, v)
const uiTypeText = (v: string) => dictText(UI_TYPE_TEXT, v)
const reasonText = (v: string) => dictText(REASON_TEXT, v)

/** 绝对时间（反馈列表/抽屉只有相对时间，无法回溯核对；审核 #169）：YYYY-MM-DD HH:mm */
function fmtDateTime(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function mapRow(f: Record<string, unknown>): Row {
  const u = (f.user as Record<string, unknown>) || {}
  return {
    id: String(f.id),
    userName: String(u.name || f.userId || '—'),
    userEmail: String(u.email || ''),
    rating: Number(f.rating || 0),
    comment: String(f.comment || ''),
    agentId: String(f.agentId || ''),
    strategy: String(f.strategy || ''),
    uiType: String(f.uiType || ''),
    taskId: String(f.taskId || ''),
    sessionId: String(f.sessionId || ''),
    status: (f.status as Status) || 'new',
    /* 列表显示相对时间；原始 ISO 留底供 title 与抽屉事实格查绝对值（审核 #169） */
    createdAt: timeAgo(String(f.createdAt || '')),
    createdAtRaw: String(f.createdAt || '')
  }
}

/* 客户端排序：数据全量在客户端（全量拉取）→ 排序诚实；默认保持服务端顺序。 */
const {
  toggle: toggleFbSort, sortState: fbSortState, sortRows: sortFbRows,
} = useTableSort<Row>({
  accessors: {
    user: (r) => r.userName,
    rating: (r) => r.rating,
    status: (r) => r.status
  },
  storageKey: 'wf_feedback_sort'
})

const filtered = computed(() => {
  const k = keyword.value.trim().toLowerCase()
  return sortFbRows(rows.value.filter((r) => {
    if (statusFilter.value && r.status !== statusFilter.value) return false
    if (lowOnly.value && r.rating > 2) return false
    if (!k) return true
    return `${r.userName} ${r.userEmail} ${r.comment} ${r.taskId}`.toLowerCase().includes(k)
  }))
})

const isFiltered = computed(() => !!keyword.value.trim() || !!statusFilter.value || lowOnly.value)
function clearFilters() {
  keyword.value = ''
  statusFilter.value = ''
  lowOnly.value = false
}

/* 状态筛选 ↔ URL（?status=）（F5-3 审核）：URL → 筛选由本组件读取（刷新/后退/复制链接
   复原「待处理」预筛）；筛选 → URL 交由宿主统一写（emit('status')，见 OpsHub.onFeedbackStatus）——
   本组件自写会合并尚未落地的旧 route.query.tab，把宿主在途的 ?tab= replace 覆盖掉（实测竞态：
   地址栏最终停在旧页签值 + status=new，内容与地址脱节）。单测可无 router 挂载，访问保持可选 */
const route = useRoute()
const FB_STATUS_VALUES = ['new', 'triaged', 'resolved', 'dismissed'] as const
watch(
  () => route?.query?.status,
  (s) => {
    const v = typeof s === 'string' && (FB_STATUS_VALUES as readonly string[]).includes(s) ? s : ''
    if (v !== statusFilter.value) statusFilter.value = v
  },
  { immediate: true }
)
watch(statusFilter, (v) => emit('status', v))

/* 长列表分批渲染：每批 15 行 */
/* 客户端分页（P2：替代「加载更多」——统一 mk-pagination 页码器）：
   数据全量在客户端（live 拉取），筛选后按页切片；
   筛选/数据变化自动回第 1 页（watch filtered） */
const page = ref(1)
const pageSize = ref(15)
const paged = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})
watch(filtered, () => {
  page.value = 1
})

async function load(force?: boolean) {
  if (loading.value) return
  if (!force && isPageCacheFresh('feedback') && rows.value.length) return
  loading.value = true
  loadFailed.value = false
  try {
    const scope = { includeTest: props.includeTest || undefined, testOnly: props.includeTest || undefined }
    const [listRes, newRes, trendRes] = await Promise.all([
      adminFeedbackApi.list({ limit: 1000, ...scope }),
      adminFeedbackApi.list({ limit: 1, status: 'new', ...scope }).catch(() => null),
      adminFeedbackApi.getTrend(30).catch(() => null)
    ])
    const body = listRes.data?.data ?? listRes.data ?? []
    rows.value = (Array.isArray(body) ? body : body.items || []).map(mapRow)
    total.value = Number(listRes.data?.pagination?.total ?? rows.value.length)
    pendingCount.value = Number(newRes?.data?.pagination?.total ?? rows.value.filter((r) => r.status === 'new').length)
    const trend = trendRes?.data?.data ?? trendRes?.data
    recent30.value = Array.isArray(trend) ? trend.reduce((s: number, d: Record<string, unknown>) => s + Number(d.count || d.total || 0), 0) : null
  } catch (e) {
    loadFailed.value = true
    toast.error(`加载失败：${errMsg(e)}`)
  } finally {
    loading.value = false
    markPageFetched('feedback')
  }
}

async function openDetail(r: Row) {
  detail.value = {
    ...r,
    helpfulness: null,
    clarity: null,
    difficulty: null,
    difficultyFit: '',
    roundNumber: null,
    suggestions: '',
    confusionPoint: '',
    reasonCodes: [],
    internalNote: ''
  }
  noteDraft.value = ''
  saveError.value = ''
  try {
    const res = await adminFeedbackApi.getDetail(r.id)
    const f = (res.data?.data ?? res.data ?? {}) as Record<string, unknown>
    detail.value = {
      ...detail.value!,
      helpfulness: f.helpfulness != null ? Number(f.helpfulness) : null,
      clarity: f.clarity != null ? Number(f.clarity) : null,
      difficulty: f.difficulty != null ? Number(f.difficulty) : null,
      difficultyFit: String(f.difficultyFit || ''),
      roundNumber: f.roundNumber != null ? Number(f.roundNumber) : null,
      suggestions: String(f.suggestions || ''),
      confusionPoint: String(f.confusionPoint || ''),
      reasonCodes: Array.isArray(f.reasonCodes) ? (f.reasonCodes as string[]) : [],
      internalNote: String(f.internalNote || '')
    }
    noteDraft.value = detail.value.internalNote
  } catch (e) {
    toast.error(`详情加载失败：${errMsg(e)}`)
  }
}

async function copyField(label: string, text: string) {
  const ok = await copyText(text)
  if (ok) toast.success(`已复制${label}`)
  else toast.error(`复制失败，请手动复制：${text}`)
}

/** 只保存内部备注、不改处理状态（后端同一支 PUT，状态原样回传） */
async function saveNoteOnly() {
  const d = detail.value
  if (!d || saving.value) return
  saving.value = true
  saveError.value = ''
  try {
    await adminFeedbackApi.update(d.id, { status: d.status, internalNote: noteDraft.value.trim() || null })
    d.internalNote = noteDraft.value.trim()
    toast.success('备注已保存（处理状态未变）')
  } catch (e) {
    saveError.value = `备注保存失败：${errMsg(e)}。可重试，或先复制备注内容再关闭。`
    toast.error(`保存失败：${errMsg(e)}`)
  } finally {
    saving.value = false
  }
}

async function save(status: Status) {
  const d = detail.value
  if (!d || saving.value) return
  saving.value = true
  saveError.value = ''
  try {
    await adminFeedbackApi.update(d.id, { status, internalNote: noteDraft.value.trim() || null })
    d.status = status
    d.internalNote = noteDraft.value.trim()
    const row = rows.value.find((x) => x.id === d.id)
    if (row) row.status = status
    if (status === 'resolved' || status === 'dismissed') detail.value = null
    pendingCount.value = rows.value.filter((x) => x.status === 'new').length
    toast.success(`已标记为${statusLabel(status)}`)
  } catch (e) {
    saveError.value = `处理失败：${errMsg(e)}。状态未改变，可重试。`
    toast.error(`保存失败：${errMsg(e)}`)
  } finally {
    saving.value = false
  }
}

/** 宿主刷新联动（运营中心宿主「刷新」按钮 → 强制重拉） */
defineExpose({ refresh: () => { void load(true) } })

onMounted(() => {
  /* 深链：运营中心「待处理反馈」→ 预筛待处理（消费后清空，避免菜单直达被残留污染；
     与 GoalConversations 消费 intent.statusFilter==='failed' 同构） */
  if (intent.statusFilter === 'new') {
    statusFilter.value = 'new'
    intent.statusFilter = ''
  }
  void load()
})
</script>

<style scoped>
/* 固定列宽（2026-10-22 与教学组三表同判例）：用户/评论两列在 auto 布局下按当页最长
   内容分宽，翻页整表跳动；fixed 后按表头定死，余量按权重摊开。宽度按 1280 校准，1200 无横滚。 */
.fb-c-user { width: 170px; }
.fb-c-rating { width: 76px; }
.fb-c-comment { width: 220px; }
.fb-c-node { width: 120px; }
/* 策略列显示中文（最长「启发提问 / 直接讲解」4 字），60px 只放得下 2 字 + 省略号 */
.fb-c-strategy { width: 84px; }
.fb-c-status { width: 84px; }
.fb-c-time { width: 80px; }
/* fixed 档列宽即契约：评论格 320px 上限会顶出本列，改成随列收缩 + 省略号 */
.fb-table .fb-comment { max-width: 100%; }

/* 嵌入模式（运营中心宿主 flex 列内）：占满剩余高度，表格区内滚（对齐 oc-embedded 先例） */
.fb-embedded { flex: 1; min-height: 0; overflow: hidden; }
/* 抽屉头部的反馈 ID 行：id + 复制钮，id 过长时自身省略，钮不跟着被挤 */
.fb-idrow { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.fb-idrow .mk-drawer__sub { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 事实格里的 ID 行：值包进 .fb-idrow 后不再是 .mk-facts 的直接子 strong，全局
   `.mk-facts > div > strong` 的单行省略契约落不到它身上——87 字符的会话 ID 会按连字符/
   下划线折行，把整格撑高。这里对包裹层内的 strong 补齐同一份契约（字号/字色一并带回来，
   否则它会按父级字号渲染，和同排事实格不一致）；复制钮 flex: none，不被挤压。 */
.mk-facts .fb-idrow > strong {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--mk-fs-micro);
  color: var(--mk-ink);
}
.fb-idrow__copy {
  flex: none;
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: var(--mk-radius-sm);
  background: transparent;
  color: var(--mk-faint);
  cursor: pointer;
}
.fb-idrow__copy:hover { color: var(--mk-ink); border-color: var(--mk-line); background: var(--mk-hover-surface); }
.fb-idrow__copy:focus-visible { outline: 2px solid var(--mk-blue); outline-offset: 1px; }
.fb-row { cursor: pointer; }
.fb-rating { font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.fb-rating b { font-size: var(--mk-fs-micro); color: var(--mk-ink); }
.fb-rating--low, .fb-rating--low b { color: var(--mk-red); }
.fb-comment {
  display: inline-block;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
  color: var(--mk-muted);
}
.fb-agent {
  display: inline-block;
  /* fixed 档列宽即上限：160px 上限会顶出 120px 的节点列，改成随列收缩（同 .fb-comment 判例）；
     另补 white-space: nowrap——只有 overflow + text-overflow 时省略号不会出现，只是硬裁 */
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
}
.fb-strategy {
  display: inline-block;
  /* 同上：200px 上限会顶出策略列，省略号改为按单元格宽度收 */
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
}

/* 处理面板：mk-drawer 体系（遮罩/面板/头/体/关闭按钮由全局类提供；
   fb- 仅保留内容区布局与覆盖层内细节样式） */
/* 抽屉让出顶栏高度（2026-11-02 评审：抽屉从窗口最顶端铺开，把页面搜索、
   帮助/通知、当前账号整条顶栏盖住）。顶栏是全局常驻控件，浮层不该遮住它：
   只在反馈抽屉这一处收口，避免改动全站 mk-drawer（其它页另有走查）。 */
/* 56px = 壳层顶栏 .mshell__top 的高度（Shell.vue，该处亦为字面值）：顶栏高度在本仓库
   没有 token，两处都按同一字面量写；此处跟随，不另造一个只有本组件用的 token。 */
/* 比全局 .mk-drawer 的 inset:0 高一档特异性，确保不被后注入的全局样式覆盖 */
.mk-drawer.mk-drawer { top: 56px; }
/* 2026-11-04 走查：≤560 时壳层顶栏因面包屑换行改为两行、高 72px（Shell.vue 同判例），
   此处跟随同一字面量；否则抽屉仍从 56px 起，正好盖住次行的面包屑。 */
@media (max-width: 560px) {
  .mk-drawer.mk-drawer { top: 72px; }
}
/* 抽屉内容区：mk-drawer__body 提供滚动/内边距，此处补纵向排布（原型 .ovl__body grid gap16） */
.fb-body { display: grid; gap: 16px; align-content: start; }
/* 三个终态语义（2026-11-11 困惑测试 #6）：与备注框同档的低调说明，不抢按钮主次 */
.fb-statusnote { margin: 0; font-size: var(--mk-fs-micro); line-height: 1.65; color: var(--mk-muted); }
/* 首段徽章行（原型 .ovl__body 首段 pills）：状态 / 难度适配 / UI 类型 / 轮次 */
.fb-pills { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }

/* 事实栅格走共享原语 .mk-facts（原 .fb-facts 私有三列栅格 + 4K 阶梯已并进原语层） */

.fb-section { display: grid; gap: 8px; }
.fb-text { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-ink); line-height: 1.7; white-space: pre-wrap; }
/* 原因标签：胶囊走共享 mk-badge--muted（原自搓 .fb-code 已并入原语） */
.fb-codes { display: flex; gap: 6px; flex-wrap: wrap; }
.fb-note {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-xl);
  background: var(--mk-surface);
  font: inherit;
  font-size: var(--mk-fs-micro);
  color: var(--mk-ink);
  resize: vertical;
  line-height: 1.6;
}
.fb-note:focus { outline: none; border-color: var(--mk-blue); }

/* 4K：内容区字号跟随壳层放大（面板宽度/头/体由 mk-drawer 全局档接管） */
@media (min-width: 2000px) {
  .fb-text { font-size: var(--mk-fs-body); }
  .fb-note { font-size: var(--mk-fs-body); }
}
@media (min-width: 2800px) {
  .fb-text { font-size: var(--mk-fs-body); }
  .fb-note { font-size: var(--mk-fs-body); }
}
/* 3600+（zoom 1.3 档）：抽屉在 2800 基础上再放大一档 */
@media (min-width: 3600px) {
  .fb-text { font-size: var(--mk-fs-emphasis); }
  .fb-note { font-size: var(--mk-fs-emphasis); }
}

/* 暗色模式（D1 补完）：fb- 内容区细节（面板底色/头/体已由 mk-drawer 全局接管） */
html[data-theme='dark'] {
  /* 审核 #166：#19191a 是硬编码第二真源；改引 --mk-surface-2（暗色档 #27282c，比卡面
     #202124 亮一档，与同单元其它「卡内次级面」同源）。 */
  .fb-note { background: var(--mk-surface-2); border-color: var(--mk-line); color: var(--mk-ink); }
  .fb-note:focus { border-color: var(--mk-blue); }
}
</style>
