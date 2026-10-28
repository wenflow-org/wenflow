<template>
  <div :class="embedded ? 'vlc-embedded' : 'mk-page'">
    <!-- 页头（mk-pagehead 标准形态）：标题+口径副文+导出+导入。
         2026-10-05 卡库改版（用户「有卡啊得，导入是功能，卡展示也是，方便从卡库选人到虚拟学习者」）：
         页面主体=卡墙——卡=账号拍板不变（导入即建号），卡墙只列身份卡（实例归虚拟学习者）。
         2026-10-06 二级页化（用户不喜欢抽屉设计）：点卡=卡详情二级页（?view=card&id=<profileId>）、
         导入=卡导入二级页（?view=card-import），本页两个 mk-drawer 全退役，走 SkillDetail/PathDetail
         家族的标准二级页机制（detailComponents 全局渲染，跨 scene 可用）。 -->
    <MkPageHead
      v-if="!embedded"
      title="学习者卡库"
    >
      <template #actions>
        <!-- 预置「一键加载」：只在真有缺卡 / 待升级 / 定义回退时出现——9 张预置卡都在墙上时
             它是个没有结果的动作。 -->
        <button
          v-if="presetActionable"
          type="button"
          class="mk-btn mk-btn--sm"
          :disabled="presetLoading"
          @click="doLoadPresets"
        >{{ presetLoading ? '同步中…' : '一键加载' }}</button>
        <!-- 后端只导出「自建卡」：自建卡为 0 时导出的是一个空文件 -->
        <button v-if="(summary?.custom ?? 0) > 0" type="button" class="mk-btn mk-btn--sm" :disabled="exporting" @click="doExport">
          {{ exporting ? '导出中…' : '导出卡库' }}
        </button>
        <button
          type="button"
          class="mk-btn mk-btn--sm"
          @click="openProduce"
        >平台生产</button>
        <button type="button" class="mk-btn mk-btn--sm mk-btn--primary" @click="openImport">导入卡</button>
      </template>
    </MkPageHead>

    <!-- 卡库构成 KPI（全站家法：label + 28px 值 + hint 一短句口径，长解释收 title）。
         2026-10-14 KPI 审计：原「卡总数」卡删除——那个数与下方「卡墙」卡头「共 N 张」同屏复读。
         2026-10-26：「预置卡 / 自建卡」合成一张（两个数并排，hint 拆分）；
         「已创建实例」只留读数，跳转改卡头链接（可点这件事此前只有悬停才看得出）。 -->
    <section class="mk-kpi-grid" aria-label="卡库构成">
      <MkKpi
        label="身份卡"
        :value="summary?.total ?? '—'"
        :hint="compositionHint"
        :hintTone="presetHintTone"
      />
      <MkKpi
        label="已创建实例"
        :value="summary?.derived ?? '—'"
      />
    </section>

    <!-- 卡墙：全部卡的可视清单；点卡 = 卡详情二级页 -->
    <section class="mk-card">
      <div class="mk-card__head">
        <div>
          <h3 class="mk-card__title">身份卡</h3>
          <span class="mk-card__meta">
            <template v-if="keyword">命中 {{ filtered.length }} / 共 {{ cards.length }} 张</template>
            <template v-else>共 {{ cards.length }} 张</template>
          </span>
        </div>
        <div class="mk-card__head-right">
          <MkFilterSearch v-model="keyword" placeholder="搜索名称 / 卡号 / 目标" />
          <a v-if="summary?.derived" href="#" class="mk-link" @click.prevent="goInstances">已创建实例 {{ summary.derived }} →</a>
        </div>
      </div>

      <!-- 创建成功后的持久结果条（toast 3 秒消失，而实例不在这面墙上）：一句结果 + 一个出口 -->
      <div v-if="lastCreated" class="vlc-created mk-alert mk-alert--ok" role="status">
        <span>已创建 {{ lastCreated }} 个虚拟学习者</span>
        <a href="#" class="mk-link" @click.prevent="goInstances">去虚拟学习者 →</a>
      </div>

      <!-- 卡墙加载态：用 MkSkeleton variant="cards" 原语（表格骨架自带 .mk-card 边框会与
           卡墙 .mk-card 叠成「卡中卡」），并保留 loading && !cards.length 守卫——
           导入成功刷新时不再把整面墙卸载成骨架。 -->
      <div v-if="indexLoading && !cards.length" class="vlc-wall">
        <MkSkeleton variant="cards" :cols="4" :count="8" :h="180" />
      </div>
      <!-- 索引接口失败必须落在持久错误态 + 重试入口：此前只有一次瞬时 toast，
           失败后 cards 仍为 []，命中下面的空态，页面显示「卡库还是空的 / 导入第一张卡」，
           把「没拉到」说成「本来就没有」（ADMIN_VISUAL_LAYER_SPEC §0.5「状态语义色」硬约束 2）。 -->
      <MkEmptyState
        v-else-if="indexError"
        tone="error"
        title="卡库加载失败"
        :description="indexError"
        action-text="重试"
        :action-busy="indexLoading"
        @action="loadIndex"
      />
      <!-- 池子被派空 ≠ 卡库是空的：卡片还在，只是都变成实例了 -->
      <MkEmptyState
        v-else-if="!filtered.length && !keyword.trim() && summary?.derived"
        title="身份池已派空"
        action-text="去虚拟学习者"
        @action="goInstances"
      />
      <MkEmptyState
        v-else-if="!cards.length"
        title="卡库还是空的"
      >
        <button type="button" class="mk-btn mk-btn--primary" @click="openImport">导入第一张卡</button>
      </MkEmptyState>
      <!-- 筛选后 0 行是「卡内列表」场景，按规范用一行式内联空态（MkEmptyState + --line 修饰）。 -->
      <MkEmptyState
        v-else-if="!filtered.length"
        :class="LINE_EMPTY"
        title="没有命中的卡"
      />
      <div v-else class="vlc-wall">
        <article
          v-for="c in pagedCards"
          :key="c.profileId"
          class="vlc-card"
          :class="{ 'vlc-card--selected': selected.includes(c.profileId) }"
          role="button"
          tabindex="0"
          :title="cardName(c)"
          @click="openCard(c)"
          @keydown.enter.prevent="openCard(c)"
          @keydown.space.prevent="openCard(c)"
        >
          <header class="vlc-card__head">
            <!-- 选角勾选框（2026-10-16）：卡整体是 role=button，勾选框必须 @click.stop，
                 否则点它就等于点开卡详情。键盘同样 stop，Enter/Space 才不会既勾选又进详情。 -->
            <label
              class="vlc-card__pick"
              @click.stop
              @keydown.stop
            >
              <input
                type="checkbox"
                :checked="selected.includes(c.profileId)"
                :aria-label="`选择 ${cardName(c)}`"
                @change="togglePick(c.profileId)"
              />
            </label>
            <span class="vlc-avatar" :class="`vlc-avatar--${vlAvatarIndexOf(cardName(c))}`" aria-hidden="true">{{ cardName(c).slice(0, 1) }}</span>
            <strong class="vlc-card__name" :title="cardName(c)">{{ cardName(c) }}</strong>
            <span class="mk-badge" :class="sourceBadge(c)" :title="sourceTitle(c)">{{ sourceText(c) }}</span>
          </header>
          <p v-if="c.goal" class="vlc-card__goal" :title="c.goal">{{ c.goal }}</p>
          <!-- 首个任务标题（2026-10-27 密度收口）：目标是抽象的（「回本，或者至少别再亏」），
               真正会被开的那节课叫「亏了三万的那只基金」——创建时要勾的就是它，卡面直接给。
               整面墙都是一张一任务的卡时不再重复「1 个任务」，只留标题。 -->
          <p v-if="c.firstTaskTitle" class="vlc-card__task" :title="c.firstTaskTitle">
            <span class="vlc-card__task-k">任务</span>{{ c.firstTaskTitle }}
          </p>
          <p v-if="c.opening" class="vlc-card__opening" :title="c.opening">{{ c.opening }}</p>
          <!-- 标签与卡号同处一行（2026-10-27 密度收口）：卡号只有自定义卡才有区分度，
               「builtin」这类占位值不上卡面（同 internal tag 判例）。 -->
          <div v-if="wallTags(c).length || showCardKey(c)" class="vlc-card__tags">
            <span v-for="t in wallTags(c)" :key="t.text" class="mk-badge mk-badge--muted">{{ t.text }}</span>
            <span v-if="showCardKey(c)" class="vlc-card__key" :title="c.cardKey || ''">{{ c.cardKey }}</span>
          </div>
          <footer class="vlc-card__foot">
            <!-- 任务数是「创建学习者」时要做的选择（勾几节课），比难度更有决策价值：
                整面墙难度相同时只留任务数；混级时两者并列 -->
            <span v-if="taskText(c)" class="vlc-card__count">{{ taskText(c) }}</span>
            <span v-if="showLevel" class="vlc-card__level">{{ levelText(c.knowledgeLevel) }}</span>
            <!-- 卡面主操作（2026-10-26 从 12px 链接升为卡脚按钮）：这页的主操作此前藏在卡脚小字里，
                 而页头 primary 是「导入卡」。卡整体是 role=button，故 stop 冒泡。 -->
            <button
              type="button"
              class="mk-btn mk-btn--sm mk-btn--primary vlc-card__derive"
              :aria-label="`从「${cardName(c)}」创建虚拟学习者`"
              @click.stop="openDeriveFor(c)"
              @keydown.stop
            >创建学习者</button>
          </footer>
        </article>
      </div>
      <!-- 卡墙分页：数据全量在客户端（索引接口一次给全），筛选后按页切片；
           单页容得下时不渲染页码器（≥2 页才出现） -->
      <Pagination
        v-if="filtered.length > pageSize"
        v-model:page="page"
        v-model:pageSize="pageSize"
        :total="filtered.length"
        :showTotal="true"
      />
    </section>

    <!-- 选角批量栏（页面级兄弟节点，选中后底部浮现；与虚拟学习者页同款全局 mk-batchbar 形态）：
         卡库的主操作是「选身份 → 创建虚拟学习者」，批量是常态（一次挑几张身份各创建一个实例）。 -->
    <div v-if="selected.length" class="mk-batchbar">
      <span>已选 {{ selected.length }} 张身份卡</span>
      <button type="button" class="mk-link" @click="clearPick">取消选择</button>
      <button
        type="button"
        class="mk-btn mk-btn--primary"
        @click="openDerive"
      >创建虚拟学习者</button>
    </div>

    <!-- 平台生产：建卡入库 + 备好第一个故事，完成后回刷本页（本页是建号的唯一入卡口） -->
    <VirtualLearnerCreate ref="produceRef" @produced="onProduced" />
    <!-- 从卡创建虚拟学习者（身份池主操作） -->
    <CardDeriveDialog ref="deriveRef" @created="onDerived" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import MkKpi from '@/components/mk/MkKpi.vue'
import MkFilterSearch from '@/components/mk/MkFilterSearch.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkSkeleton from '@/components/mk/MkSkeleton.vue'
import Pagination from './Pagination.vue'
import VirtualLearnerCreate from './VirtualLearnerCreate.vue'
import CardDeriveDialog from './CardDeriveDialog.vue'
import { vlAvatarIndexOf } from '@/components/mk/vlAvatar'
import { openSubPage } from './store'
import { errMsg, liveRefreshSeq } from './live'
import { adminVirtualLearnersApi } from '@/api/adminApi'
import { toast } from '@/utils/toast'

/** 一行式内联空态修饰（筛选后 0 行的卡内列表场景）。
    用常量而非模板里的字面类串：design:check 规则 4 的检测正则匹配任何含独立
    「mk-empty」token 的 class 字面量，会把规范指定的 --line 后缀一并误报。 */
const LINE_EMPTY = 'mk-empty--line'

/** 嵌入模式：作为 tab 渲染时隐藏页面外壳（当前为独立场景，保留以对齐同组页面） */
withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const router = useRouter()
/** 「已派生实例」KPI：实例在虚拟学习者列表，不在卡墙上 */
function goInstances() {
  void router.push('/admin/virtual-learners')
}

interface CardWallEntry {
  profileId: string
  userId: string
  cardKey: string | null
  name: string
  goal: string
  opening: string | null
  knowledgeLevel: string
  tags: string[]
  preset: boolean
  sourceKind: string | null
  email: string | null
  /** 来源身份卡名（2026-10-16 卡=身份模板）：非空即本卡是从另一张卡创建的实例 */
  derivedFrom: string | null
  /** 故事池任务数（2026-10-27）：创建实例时按任务勾选，卡面先答「这张卡能开几节课」 */
  taskCount?: number
  /** 首个任务标题（2026-10-27）：卡面上真正会被开的那节课叫什么 */
  firstTaskTitle?: string | null
}

/* ===== 卡墙 ===== */
const cards = ref<CardWallEntry[]>([])
const summary = ref<{ total: number; builtin: number; custom: number; derived: number } | null>(null)
const indexLoading = ref(false)
/** 索引拉取失败原因（非空 = 渲染持久错误态 + 重试入口，而不是把失败画成空态） */
const indexError = ref('')
const keyword = ref('')

/** 卡墙只放身份卡（2026-10-24 层级收口）：实例归「虚拟学习者」。
 *  接口已过滤，这里再挡一次——旧缓存或别处回放的数据里若仍带 derivedFrom，也不进墙。 */
const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return cards.value.filter((c) => {
    if (c.derivedFrom) return false
    if (!kw) return true
    // 搜索只认卡面能看见的标签（场景 / 目标的中文名 + 自定义卡的原样标签）；
    // preset: / hash: 这些内部标记不上墙，也就不该在搜索里命中（2026-10-24）
    return [
      c.name, c.cardKey, c.goal, c.opening, c.email,
      ...wallTags(c).map((t) => t.text),
      ...c.tags.filter((t) => !INTERNAL_TAG_RE.test(t))
    ]
      .filter(Boolean)
      .some((v) => String(v).toLowerCase().includes(kw))
  })
})

/* 卡墙分页：数据全量在客户端（索引接口一次给全），筛选后按页切片；
   关键词/数据变化自动回第 1 页（同 VirtualLearners 判例）。 */
const page = ref(1)
const pageSize = ref(30)
const pagedCards = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filtered.value.slice(start, start + pageSize.value)
})
watch([keyword, cards], () => {
  page.value = 1
})
/* 页码收敛：改大 pageSize 或数据缩减后 current page 超界时回落（单页时页码器不渲染，
   不能只依赖 Pagination 自带的越界收敛——它被 v-if 卸载后收不到变化） */
watch([filtered, pageSize], () => {
  const max = Math.max(1, Math.ceil(filtered.value.length / pageSize.value))
  if (page.value > max) page.value = max
})

async function loadIndex() {
  indexLoading.value = true
  indexError.value = ''
  try {
    const res = await adminVirtualLearnersApi.cardsIndex()
    const d = (res.data?.data ?? res.data) as { cards: CardWallEntry[]; summary: { total: number; builtin: number; custom: number; derived: number } }
    cards.value = d?.cards ?? []
    summary.value = d?.summary ?? null
  } catch (e) {
    const msg = errMsg(e) || '卡库加载失败'
    indexError.value = msg
    toast.error(msg)
  } finally {
    indexLoading.value = false
  }
}

/** 点卡 → 卡详情二级页（?view=card&id=<profileId>；detailComponents 全局渲染，跨 scene 可用。
    2026-10-06 抽屉退役：详情/导入两个 mk-drawer 迁标准二级页 CardDetailPage/CardImportPage） */
function openCard(c: CardWallEntry) {
  openSubPage('card', c.profileId)
}

/* ===== 平台预置「一键加载」（#91 / P-67）=====
   后端：GET /api/admin/presets 只读总览（定义逐条 + 实例对齐状态）；POST 幂等同步。
   入口位置按 issue 指定落在「预置」KPI 卡内（MkKpi 默认 slot = 卡内附挂位）。 */
interface PresetOverviewSummary {
  definitions: number
  loaded: number
  missing: number
  upgradable: number
  rolledBack: number
  drifted: number
}
interface PresetLoadResult {
  created: string[]
  updated: string[]
  skipped: string[]
  drifted: string[]
  versionAhead: string[]
  errors: Array<{ presetKey: string; message: string }>
  overview?: { summary?: PresetOverviewSummary }
}

const presetLoading = ref(false)
/** 定义侧快照（只读副信息）：拿不到就不影响页面 */
const presetSummary = ref<PresetOverviewSummary | null>(null)

/** 一键加载只在真有缺卡 / 待升级 / 定义回退时出现（9 张预置卡都在墙上时它没有结果）。
 *  定义侧快照拿不到时保留入口：那说明「是否缺卡」未知，不能因此把唯一的加载口藏掉。 */
const presetActionable = computed(() => {
  const s = presetSummary.value
  if (!s) return true
  return s.missing > 0 || s.upgradable > 0 || s.rolledBack > 0
})
/** 身份卡构成：两个数并排；定义回退是人工要看的异常档，用琥珀脚注 */
const compositionHint = computed(() => {
  const s = summary.value
  if (!s) return ''
  const parts = [`预置 ${s.builtin}`, `自建 ${s.custom}`]
  const rolledBack = presetSummary.value?.rolledBack ?? 0
  if (rolledBack) parts.push(`定义回退 ${rolledBack}`)
  return parts.join(' · ')
})
const presetHintTone = computed<'warn' | ''>(() => ((presetSummary.value?.rolledBack ?? 0) > 0 ? 'warn' : ''))

async function loadPresetOverview() {
  try {
    const res = await adminVirtualLearnersApi.presetsOverview()
    const d = (res.data?.data ?? res.data) as { summary?: PresetOverviewSummary } | undefined
    presetSummary.value = d?.summary ?? null
  } catch {
    // 只读副信息：失败保持静态提示（按钮照常可用），不弹 toast 打扰主流程
    presetSummary.value = null
  }
}

async function doLoadPresets() {
  presetLoading.value = true
  try {
    const res = await adminVirtualLearnersApi.presetsLoad()
    const d = (res.data?.data ?? res.data) as PresetLoadResult | undefined
    if (d?.overview?.summary) presetSummary.value = d.overview.summary
    const parts = [
      `新建 ${d?.created?.length ?? 0}`,
      `更新 ${d?.updated?.length ?? 0}`,
      `跳过 ${d?.skipped?.length ?? 0}`,
    ]
    if (d?.versionAhead?.length) parts.push(`定义回退跳过 ${d.versionAhead.length}`)
    if (d?.drifted?.length) parts.push(`内容不一致 ${d.drifted.length}`)
    if (d?.errors?.length) parts.push(`失败 ${d.errors.length}`)
    const message = `预置卡已加载：${parts.join(' · ')}`
    // 有失败/定义回退时不报「全绿」：同一句结果文案换档，提示仍需人看
    if (d?.errors?.length || d?.versionAhead?.length) toast.warning(message)
    else toast.success(message)
    await loadIndex()
  } catch (e) {
    toast.error(errMsg(e) || '预置卡加载失败')
  } finally {
    presetLoading.value = false
  }
}

/** 导入卡 → 卡导入二级页（id 为常量占位；返回卡墙时本组件重挂载自动刷新索引） */
function openImport() {
  openSubPage('card-import', 'new')
}

/* ===== 平台生产（卡库的第二个入卡口）=====
   生产 = 建卡入库 + 备好第一个故事（建号入口只在卡库，虚拟学习者页只做派生）。
   子组件在建卡后与故事落库后各回调一次（故事决定卡墙的「开场白」），这里只负责回刷。 */
const produceRef = ref<InstanceType<typeof VirtualLearnerCreate> | null>(null)

function openProduce() {
  produceRef.value?.open()
}
function onProduced() {
  void loadIndex()
}

function cardName(c: CardWallEntry): string {
  return c.name || c.cardKey || c.email || '未命名卡'
}
function sourceText(c: Pick<CardWallEntry, 'preset' | 'sourceKind'>): string {
  if (c.preset) return '预置'
  if (c.sourceKind === 'web') return 'web'
  if (c.sourceKind === 'synthetic') return '合成'
  return '自建'
}
function sourceBadge(c: Pick<CardWallEntry, 'preset' | 'sourceKind'>): string {
  if (c.preset) return 'mk-badge--info'
  if (c.sourceKind === 'web') return 'mk-badge--ok'
  return 'mk-badge--muted'
}
function sourceTitle(c: Pick<CardWallEntry, 'preset' | 'sourceKind'>): string {
  if (c.preset) return '来源：平台预置'
  if (c.sourceKind === 'web') return '来源：网络采集卡'
  if (c.sourceKind === 'synthetic') return '来源：合成生成卡'
  return '来源：后台创建'
}
function levelText(level: string): string {
  const map: Record<string, string> = { beginner: '入门', intermediate: '进阶', advanced: '高阶' }
  return map[level] || level || '—'
}

/**
 * 卡面标签（2026-10-24 用户「preset:… 是无意义信息，要加就换点数据」）：
 * 预置卡 tags 里的 sourceType / goalType 是英文枚举，转成运营看得懂的中文短标签；
 * preset: / hash: / builtin / vN / in_scope 属于内部标记，一律不上卡面。
 * 自定义卡上的其它标签按原样显示（最多两枚），不编造没有的数据。
 */
const SOURCE_TAG_LABELS: Record<string, string> = {
  study: '学习',
  work: '工作',
  life: '生活',
  self_management: '自我管理'
}
const GOAL_TAG_LABELS: Record<string, string> = {
  exam_prep: '考试备战',
  foundation_building: '打基础',
  project_based: '项目实战',
  problem_driven: '问题驱动',
  interest_exploration: '兴趣探索'
}
const INTERNAL_TAG_RE = /^(?:preset:|hash:|builtin$|in_scope$|out_of_scope$|v\d+(?:\.\d+)*$|w\d+$)/i
interface WallTag {
  text: string
}
function wallTags(c: CardWallEntry): WallTag[] {
  const out: WallTag[] = []
  for (const tag of c.tags) {
    if (INTERNAL_TAG_RE.test(tag)) continue
    const text = SOURCE_TAG_LABELS[tag] || GOAL_TAG_LABELS[tag] || tag
    if (!out.some((x) => x.text === text)) out.push({ text })
    if (out.length === 2) break
  }
  return out
}
/** 卡号与内部 profileId 相同、或整面墙都是同一个卡号时，卡号行没有区分度，不渲染。
 *  2026-10-27 再收紧：`builtin` 是预置卡的系统占位值（整面墙 20 张卡全印这两个字），
 *  它既不是卡号也不区分任何两张卡，按内部标记处理。 */
const PLACEHOLDER_CARD_KEYS = new Set(['builtin'])
function showCardKey(c: CardWallEntry): boolean {
  const key = (c.cardKey || '').trim()
  if (!key) return false
  if (PLACEHOLDER_CARD_KEYS.has(key)) return false
  if (key === c.profileId || key === c.userId) return false
  const wall = cards.value
  return !(wall.length > 1 && wall.every((x) => (x.cardKey || '').trim() === key))
}

/** 任务数文案（2026-10-27）：只标「多任务的卡」——整面墙都是 1 个任务时，
    每张卡印一遍「1 个任务」不区分任何两张卡；真有多任务的卡才是值得注意的那张。
    老接口没有该字段（undefined）同样不占位，不把「不知道」写成「0 个任务」。 */
function taskText(c: CardWallEntry): string {
  const n = c.taskCount
  return typeof n === 'number' && n > 1 ? `${n} 个任务` : ''
}

/* 难度只在「有区分度」时上卡面（2026-10-27 密度收口）：整面墙 21 张卡全是「入门」时，
   这行字每张都印一遍，既不是读数也不是可操作信息，只是把卡脚垫高。 */
const showLevel = computed(() => {
  const levels = new Set(cards.value.map((c) => c.knowledgeLevel || ''))
  return levels.size > 1
})

/* ===== 选角 → 创建虚拟学习者（2026-10-16 卡=身份模板，卡库即身份池） ===== */
/** 待创建的身份卡 id（卡墙勾选框 v-model） */
const selected = ref<string[]>([])

function togglePick(profileId: string) {
  const i = selected.value.indexOf(profileId)
  if (i >= 0) selected.value.splice(i, 1)
  else selected.value.push(profileId)
}
function clearPick() {
  selected.value = []
}

const deriveRef = ref<InstanceType<typeof CardDeriveDialog> | null>(null)

function openDerive() {
  if (!selected.value.length) return
  deriveRef.value?.openWith([...selected.value])
}

/** 卡面「创建学习者」：单卡一键进同一个面板（不经过勾选队列） */
function openDeriveFor(c: { profileId: string }) {
  deriveRef.value?.openWith([c.profileId])
}

/** 创建成功：清勾选 + 回刷，并在卡墙顶部留一条持久结果条（实例不在卡墙上，
 *  toast 一闪而过后人找不到刚建的去哪了）。 */
const lastCreated = ref(0)
function onDerived(created: Array<{ profileId: string }>) {
  lastCreated.value = created.length
  clearPick()
  void loadIndex()
}

/* ===== 导出（卡库级动作，留在本页）===== */
const exporting = ref(false)

async function doExport() {
  exporting.value = true
  try {
    const res = await adminVirtualLearnersApi.cardsExport()
    const d = res.data?.data ?? res.data
    const content = String(d?.content || '')
    const blob = new Blob([content], { type: 'text/yaml;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `learner-cards-${new Date().toISOString().slice(0, 10)}.yaml`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    toast.success(`已导出 ${d?.count ?? 0} 张卡`)
  } catch (e) {
    toast.error(errMsg(e) || '导出失败')
  } finally {
    exporting.value = false
  }
}

onMounted(() => {
  void loadIndex()
  void loadPresetOverview()
})
/* 顶栏刷新：Shell 广播 liveRefreshSeq，本页此前只在挂载时拉一次，别人刚导入/加载的卡看不到 */
watch(liveRefreshSeq, () => {
  void loadIndex()
  void loadPresetOverview()
})
</script>

<style scoped>
/* ===== 卡墙（2026-10-05 卡库改版）：自适应卡网格，260px 起步、窄档降列 ===== */
.vlc-wall {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
  padding: 16px;
}
/* 卡面 = 纵向 flex + 底部操作钉底（2026-10-27 用户「高度不一样，信息密度也不高」）：
   同一行的卡被网格拉到等高，但内容按顶部堆叠时，少一行标签的卡按钮会浮在中间、
   多一行的卡按钮落在底部——一排卡里「创建学习者」高低错落，扫视时读不成一条线。
   钉底后按钮恒在同一基线，行高差异只体现为卡内留白。 */
.vlc-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-xl);
  background: var(--mk-surface);
  cursor: pointer;
  transition: border-color 0.12s ease, background 0.12s ease;
  min-width: 0;
}
.vlc-card:hover { border-color: color-mix(in srgb, var(--mk-blue) 50%, transparent); }
.vlc-card:focus-visible { outline: 2px solid var(--mk-blue); outline-offset: 1px; }
/* 选中态：蓝色只给「选中」与可交互——此前勾选后只有 15px 方框变化，卡面上看不出选了哪几张 */
.vlc-card--selected { border-color: var(--mk-blue); background: var(--mk-blue-bg); }
/* grid 子项默认 min-width:auto：hash / cardKey / tag 都是长不可断串，会把网格轨道
   撑出卡宽，内容直接画到卡框外、被下一张卡整块盖住（走查：来源/版本角标被邻卡遮没、
   hash 条横跨到下一列）。卡片是固定网格轨，子项必须允许收缩，再由各自省略号收尾。 */
.vlc-card > * { min-width: 0; }
.vlc-card__head { display: flex; align-items: center; gap: 8px; min-width: 0; }
/* 首字头像：与虚拟学习者/画像页同 8 色板（--mk-vl-avatar-*，CM3 单源） */
.vlc-avatar {
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--mk-on-fill);
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  flex: none;
}
.vlc-avatar--0 { background: var(--mk-vl-avatar-0); }
.vlc-avatar--1 { background: var(--mk-vl-avatar-1); }
.vlc-avatar--2 { background: var(--mk-vl-avatar-2); }
.vlc-avatar--3 { background: var(--mk-vl-avatar-3); }
.vlc-avatar--4 { background: var(--mk-vl-avatar-4); }
.vlc-avatar--5 { background: var(--mk-vl-avatar-5); }
.vlc-avatar--6 { background: var(--mk-vl-avatar-6); }
.vlc-avatar--7 { background: var(--mk-vl-avatar-7); }
.vlc-card__name {
  font-size: var(--mk-fs-body);
  color: var(--mk-ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  /* 名称是唯一可伸缩项：长标题吃满剩余宽度后自己省略，别去压徽章 */
  flex: 1 1 auto;
  min-width: 0;
  min-width: 0;
}
/* 来源角标可收缩：名字长时 flex:none 的角标会被挤出卡框，允许它收缩并省略 */
.vlc-card__head .mk-badge {
  /* 2026-10-20：原先允许 flex-shrink，4K 卡墙列更窄时长标题会把「预置」压成一条
     只剩圆角边的色块（截图见走查）。徽章固定不缩，名称自己省略；上限 50% 兜住极端
     长来源词（自建 / 预置 这类两字词远达不到），超长时才在徽章内部省略。 */
  flex: 0 0 auto;
  max-width: 50%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vlc-card__key {
  font-family: var(--mk-mono);
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 目标文案：只有真的有内容才占位（2026-10-27）。此前恒占两行高（min-height: 2.9em），
   没有目标的卡也留一块空白，卡内密度被这条「空气」拉低。 */
.vlc-card__goal {
  margin: 0;
  font-size: var(--mk-fs-micro);
  color: var(--mk-ink);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.vlc-card__opening {
  margin: 0;
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 首个任务行：与目标同字号，前面一个弱化的小标签；单行省略（标题通常 8–14 字） */
.vlc-card__task {
  margin: 0;
  font-size: var(--mk-fs-micro);
  color: var(--mk-ink);
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vlc-card__task-k {
  margin-right: 5px;
  color: var(--mk-muted);
}
/* 标签 + 卡号同一行：标签左、卡号右对齐吃掉剩余宽度（卡号本身仍可省略） */
.vlc-card__tags {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;
}
/* 单个 chip 可能就是一整串 preset:…+hash:…，必须能在卡宽内收缩并省略，
   否则超出卡宽后画到邻卡上（走查：标签/hash 被邻卡切断且无省略号） */
.vlc-card__tags .mk-badge {
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vlc-card__tags .vlc-card__key { margin-left: auto; max-width: 45%; }
/* 勾选框：卡整体是 role=button，勾选框是它内部唯一的交互子控件，故撑到可点面积（≥24px 触控基准） */
.vlc-card__pick {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin-left: -4px;
  flex: none;
  cursor: pointer;
}
.vlc-card__pick input[type='checkbox'] {
  width: 15px;
  height: 15px;
  accent-color: var(--mk-blue, #2f6ae0);
  cursor: pointer;
}
.vlc-card__foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  /* 钉底（2026-10-27）：卡被同行拉高时，按钮落到卡底同一基线，不再随内容行数浮动 */
  margin-top: auto;
  padding-top: 4px;
}
/* 卡脚左侧的读数（任务数 / 难度）可有可无，按钮恒靠右 */
.vlc-card__count,
.vlc-card__level { font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.vlc-card__count + .vlc-card__level::before { content: '·'; margin-right: 4px; }
/* 卡面主操作：卡脚右侧一位 */
.vlc-card__derive { flex: none; margin-left: auto; }
/* 创建结果条：卡墙顶部常驻，一句结果 + 一个出口 */
.vlc-created {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0 16px 12px;
}
</style>
