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
      sub="可复用的学习者身份卡"
    >
      <template #actions>
        <!-- 预置「一键加载」：页面级动作，2026-10-20 从「预置卡」KPI 卡面挪到页头右组
             （KPI 卡只放 label + 值 + 一句口径，不放控件；按钮也不该把整张卡面撑成一个宽条）。
             预置不是「随版本自动同步」，而是「定义随代码进仓、实例需一键加载」。 -->
        <button
          type="button"
          class="mk-btn mk-btn--sm"
          :disabled="presetLoading"
          :title="presetLoadTitle"
          @click="doLoadPresets"
        >{{ presetLoading ? '同步中…' : '一键加载' }}</button>
        <button type="button" class="mk-btn mk-btn--sm" :disabled="exporting" @click="doExport">
          {{ exporting ? '导出中…' : '导出卡库' }}
        </button>
        <!-- 卡库的两个入卡口：外部导入（文档）/ 平台生产（AI 生成角色卡）。
             生产完留在本页——卡的运行进度在「虚拟学习者」看板，不把人推过去。 -->
        <button
          type="button"
          class="mk-btn mk-btn--sm"
          title="平台生产角色卡：AI 生成身份并建卡入库，同时备好第一个故事，可直接到虚拟学习者起跑"
          @click="openProduce"
        >平台生产</button>
        <button type="button" class="mk-btn mk-btn--sm mk-btn--primary" @click="openImport">导入卡</button>
      </template>
    </MkPageHead>

    <!-- 卡库构成 KPI（全站家法：label + 28px 值 + hint 一短句口径，长解释收 title）。
         2026-10-14 KPI 审计：原「卡总数」卡删除——那个数与下方「卡墙」卡头「共 N 张」同屏复读，
         且它的 hint 又把「预置 / 自建」两个数说了一遍（就是右边这两张卡）。按计数单源家法，
         列表长度交给列表卡头自报，KPI 只说列表说不出的构成拆分。
         2026-10-16 卡=身份模板后新增「已派生实例」：池子派生过几个实例。
         2026-10-24 层级收口：实例不再混在卡墙上（卡库＝身份池，实例归虚拟学习者），
         这个数只作披露，点击去实例列表。 -->
    <section class="mk-kpi-grid" aria-label="卡库构成">
      <!-- 预置卡读数（#91 的加载入口 2026-10-20 移到页头右组）。启动同步 2026-10-09 已摘除
           （空白项目零 VL 起步），实例仍需显式加载一次；卡面只报数与口径。 -->
      <MkKpi
        label="预置卡"
        :value="summary?.builtin ?? '—'"
        :hint="presetHint"
        :hintTone="presetHintTone"
        :title="presetCardTitle"
      />
      <MkKpi label="自建卡" :value="summary?.custom ?? '—'" title="卡文档导入与后台/AI 创建的卡。「导出卡库」仅导出这部分" />
      <!-- 实例不在卡墙上（卡库＝身份池）：这个数只说明池子派生过几次，点击去实例所在的列表 -->
      <MkKpi
        label="已派生实例"
        :value="summary?.derived ?? '—'"
        :clickable="true"
        title="已经从身份卡创建出来的虚拟学习者数量。创建不消耗身份卡，同一张卡可反复创建。实例不在卡墙上，点击去虚拟学习者列表"
        @click="goInstances"
      />
    </section>

    <!-- 卡墙：全部卡的可视清单（搜名称/Key/目标/标签/邮箱）；点卡 = 卡详情二级页 -->
    <section class="mk-card">
      <div class="mk-card__head">
        <div>
          <h3 class="mk-card__title">卡墙</h3>
          <!-- 计数 meta 只说独有事实（卡头计数语法）：无关键词 = 卡库总量，
               有关键词 = 命中/总量（此前第一段也用 filtered.length，与「命中 N/M」的分子复读）。
               卡总数从 KPI 卡迁来这里自报（2026-10-14），原卡上「一张卡 = …」的解释随之下沉到本行。 -->
          <span class="mk-card__meta" title="点卡查看卡详情（人设 / 故事池 / 自带资料）">
            <template v-if="keyword">命中 {{ filtered.length }} / 共 {{ cards.length }} 张</template>
            <template v-else>共 {{ cards.length }} 张</template>
          </span>
        </div>
        <div class="mk-card__head-right">
          <!-- 占位符收短到框内可完整显示（2026-10-23 走查：原 4 项在 200px 框里被切成
               「搜索名称 / 卡号 / 目标 /」的悬空斜杠）；未显示的字段进 title，搜索仍在用 -->
          <MkFilterSearch v-model="keyword" placeholder="搜索名称 / 卡号 / 目标" title="也支持按标签 / 邮箱搜索" />
        </div>
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
      <!-- 池子被派空 ≠ 卡库是空的：卡片还在，只是都变成实例了（实例不在这面墙上） -->
      <MkEmptyState
        v-else-if="!filtered.length && !keyword.trim() && summary?.derived"
        title="身份池已派空"
        description="身份卡本身都还在，它们的实例不在这面墙上；到「虚拟学习者」看实例、继续运行。"
        action-text="去虚拟学习者"
        @action="goInstances"
      />
      <MkEmptyState
        v-else-if="!cards.length"
        title="卡库还是空的"
        description="导入卡文档后，这里会以卡片墙展示身份卡。卡是身份模板：选卡创建出来的虚拟学习者不在这面墙上，在「虚拟学习者」里运行。"
      >
        <button type="button" class="mk-btn mk-btn--primary" @click="openImport">导入第一张卡</button>
      </MkEmptyState>
      <!-- 筛选后 0 行是「卡内列表」场景，按规范用一行式内联空态（MkEmptyState + --line 修饰）。 -->
      <MkEmptyState
        v-else-if="!filtered.length"
        :class="LINE_EMPTY"
        title="没有命中的卡：换个关键词试试（名称 / 卡号 / 目标 / 标签 / 邮箱）。"
      />
      <div v-else class="vlc-wall">
        <article
          v-for="c in pagedCards"
          :key="c.profileId"
          class="vlc-card"
          role="button"
          tabindex="0"
          :title="`${cardName(c)}（${c.cardKey || '无卡号'}）`"
          @click="openCard(c)"
          @keydown.enter.prevent="openCard(c)"
          @keydown.space.prevent="openCard(c)"
        >
          <header class="vlc-card__head">
            <!-- 选角勾选框（2026-10-16）：卡整体是 role=button，勾选框必须 @click.stop，
                 否则点它就等于点开卡详情。键盘同样 stop，Enter/Space 才不会既勾选又进详情。 -->
            <label
              class="vlc-card__pick"
              :title="`勾选「${cardName(c)}」，在页面底部批量创建虚拟学习者`"
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
          <div v-if="showCardKey(c)" class="vlc-card__key">{{ c.cardKey }}</div>
          <p class="vlc-card__goal" :title="c.goal">{{ c.goal }}</p>
          <p v-if="c.opening" class="vlc-card__opening" :title="c.opening">{{ c.opening }}</p>
          <div v-if="c.tags.length" class="vlc-card__tags">
            <!-- 2026-10-12 外部批评采纳：hash 指纹（46 字符）原样整串铺满卡宽、被 CSS 腰斩且
                 无处看全值——显示截为 hash: + 前 8 位（够核对），完整值进 title；其余标签原样。
                 2026-10-24：版本标签移出标签流（见卡尾固定槽）。 -->
            <span v-for="t in wallTags(c)" :key="t" class="mk-badge mk-badge--muted" :title="t">{{ tagText(t) }}</span>
            <span v-if="c.tags.length > 3" class="vlc-card__more" :title="c.tags.join(' · ')">+{{ c.tags.length - 3 }}</span>
          </div>
          <footer class="vlc-card__foot">
            <span class="vlc-card__level" :title="`知识水平：${c.knowledgeLevel}`">{{ levelText(c.knowledgeLevel) }}</span>
            <span v-if="versionTagOf(c)" class="vlc-card__version" :title="`版本 ${versionTagOf(c)}`">{{ versionTagOf(c) }}</span>
            <span class="vlc-card__acts">
              <!-- 单卡创建入口（2026-10-18 用户走查「从卡库想创建一个虚拟学习者，为什么没有流程」）：
                   此前只有卡头那个无标签勾选框能到创建面板，运营读作「没有流程」。卡内放一枚动作，
                   勾选框留给批量；卡整体是 role=button，故 stop 冒泡（点它不进详情）。
                   文案 2026-10-19 用户「两个操作按钮文案再优化一下」：原「派生」是内部说法，
                   与本页批量栏、弹窗标题的「创建虚拟学习者」是同一动作两个词——统一说「创建」。 -->
              <button
                type="button"
                class="mk-link vlc-card__derive"
                :aria-label="`从「${cardName(c)}」创建虚拟学习者`"
                title="从这张身份卡创建 1 个虚拟学习者，下一步挑要带走的故事"
                @click.stop="openDeriveFor(c)"
                @keydown.stop
              >创建学习者</button>
              <!-- 卡整体可点即进详情，这里只是明面提示（2026-10-19 用户建议「让新人知道是有
                   二级页面的」）；文案与全站行内操作一致用「详情」，不再写「看详情 →」 -->
              <span class="vlc-card__go" title="详情：这张身份卡的完整档案（人设、已备故事、来源）">详情</span>
            </span>
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
        title="每张选中的身份卡创建 1 个虚拟学习者，任务在下一步挑"
        @click="openDerive"
      >创建虚拟学习者</button>
    </div>

    <!-- 平台生产（同一份表单的 library 语境）：建卡入库 + 备好第一个故事，完成后回刷本页 -->
    <VirtualLearnerCreate ref="produceRef" context="library" @produced="onProduced" />
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
import { errMsg } from './live'
import { adminVirtualLearnersApi } from '@/api/adminApi'
import { toast } from '@/utils/toast'
import { shortHashTag } from '@/utils/shortHash'

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
    return [c.name, c.cardKey, c.goal, c.opening, c.email, ...c.tags]
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
/** 定义侧快照（只读副信息）：拿不到就退回静态提示，不影响按钮可用 */
const presetSummary = ref<PresetOverviewSummary | null>(null)

/* 卡面副行只留口径（2026-10-19 用户走查「hint 在报读数」）：原副行报「定义 N 条 · 已加载 M」
   等计数读数，计数随长释进卡 title。例外是「定义回退」——那是人工要看的异常档，副行留着它
   （读数可降级、告警不隐藏，与三态纪律同一条）。 */
const presetHint = computed(() => {
  const s = presetSummary.value
  if (!s) return '平台预置（需一键加载）'
  if (s.rolledBack) return `定义回退 ${s.rolledBack} 张 · 需人工确认`
  return ''
})
/** 预置卡 title：静态说明 + 当期计数（原计数读数的落点） */
const presetCardTitle = computed(() => {
  const base = '加载只新建缺卡并按版本更新已有卡，不删除卡'
  const s = presetSummary.value
  if (!s) return base
  const parts = [`定义 ${s.definitions} 条`, `已加载 ${s.loaded}`]
  if (s.missing) parts.push(`待加载 ${s.missing}`)
  if (s.upgradable) parts.push(`待升级 ${s.upgradable}`)
  if (s.rolledBack) parts.push(`定义回退 ${s.rolledBack}`)
  return `${base}（当前 ${parts.join(' · ')}）`
})
/** 定义回退（实例版本高于定义）是人工要看的异常档：琥珀脚注（不阻断，只是要人看一眼） */
const presetHintTone = computed<'warn' | ''>(() => ((presetSummary.value?.rolledBack ?? 0) > 0 ? 'warn' : ''))
const presetLoadTitle = computed(() => {
  const s = presetSummary.value
  const base = '从仓库预置定义加载平台预置到卡库：新建缺的卡，按版本更新已有卡的定义，故事与记忆保留，卡不会被删'
  if (!s) return base
  return `${base}（当前 定义 ${s.definitions} 条 / 已加载 ${s.loaded}）`
})

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
   表单复用 VirtualLearnerCreate 的 library 语境；生产 = 建卡入库 + 备好第一个故事。
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
  if (c.preset) return '平台预置角色（卡库内「一键加载」同步）'
  if (c.sourceKind === 'web') return '来源：网络采集卡'
  if (c.sourceKind === 'synthetic') return '来源：合成生成卡'
  return '后台手动 / AI 创建'
}
function levelText(level: string): string {
  const map: Record<string, string> = { beginner: '入门', intermediate: '进阶', advanced: '高阶' }
  return map[level] || level || '—'
}

/** 标签显示文本（2026-10-12 外部批评采纳）：hash 散键指纹整串 46 字符，卡内既不折行也无处
    看全值（CSS 腰斩）。显示取 `hash:` + 前 8 位十六进制（够核对），完整值走 title。
    2026-10-14 #16：抽到 @/utils/shortHash 单源，卡详情 hero 同口径复用。 */
const tagText = shortHashTag

/* ===== 卡面去重与版本槽位（2026-10-24 视觉修复） =====
   版本标签（v4 这类）原先混在 flex-wrap 的标签流里，换行后落在 hash 徽标旁，位置随卡宽漂移。
   现把它提到卡尾固定槽位，标签流只放内容标签。 */
const VERSION_TAG_RE = /^v\d+(?:\.\d+)*$/i
function versionTagOf(c: CardWallEntry): string {
  return c.tags.find((t) => VERSION_TAG_RE.test(t)) || ''
}
function wallTags(c: CardWallEntry): string[] {
  return c.tags.filter((t) => !VERSION_TAG_RE.test(t)).slice(0, 3)
}
/** 卡号与内部 profileId 相同、或整面墙都是同一个卡号时，卡号行没有区分度，不渲染 */
function showCardKey(c: CardWallEntry): boolean {
  const key = (c.cardKey || '').trim()
  if (!key) return false
  if (key === c.profileId || key === c.userId) return false
  const wall = cards.value
  return !(wall.length > 1 && wall.every((x) => (x.cardKey || '').trim() === key))
}

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

/** 创建成功：清勾选 + 回刷（实例不在卡墙上，刷新只更新 KPI 的「已派生实例」与勾选状态） */
function onDerived() {
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
  // 预置定义快照（只读，失败静默）：用于「预置」卡脚注的 定义/已加载/待升级 计数
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
.vlc-card {
  display: grid;
  gap: 6px;
  align-content: start;
  padding: 14px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-xl);
  background: var(--mk-surface);
  cursor: pointer;
  transition: border-color 0.12s ease, background 0.12s ease;
  min-width: 0;
}
.vlc-card:hover { border-color: color-mix(in srgb, var(--mk-blue) 50%, transparent); }
.vlc-card:focus-visible { outline: 2px solid var(--mk-blue); outline-offset: 1px; }
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
.vlc-card__goal {
  margin: 0;
  font-size: var(--mk-fs-micro);
  color: var(--mk-ink);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  min-height: 2.9em;
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
/* 单个 chip 可能就是一整串 preset:…+hash:…，必须能在卡宽内收缩并省略，
   否则超出卡宽后画到邻卡上（走查：标签/hash 被邻卡切断且无省略号） */
.vlc-card__tags { display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; }
.vlc-card__tags .mk-badge {
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vlc-card__more { font-size: var(--mk-fs-micro); color: var(--mk-faint); }
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
  justify-content: space-between;
  gap: 8px;
  margin-top: 2px;
}
.vlc-card__level { font-size: var(--mk-fs-micro); color: var(--mk-muted); }
/* 版本徽标固定槽位（2026-10-24）：紧贴知识水平、独立不换行，不再随标签流换行漂移；
   margin-right:auto 把动作组压回右缘 */
.vlc-card__version {
  flex: none;
  margin-right: auto;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--mk-surface-3);
  color: var(--mk-muted);
  font-family: var(--mk-mono);
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  white-space: nowrap;
}
/* 页脚动作组：创建学习者（低频但此前无处可寻）与详情并排，右对齐 */
.vlc-card__acts { display: inline-flex; align-items: center; gap: 10px; }
.vlc-card__derive { font-size: var(--mk-fs-micro); font-weight: 700; }
.vlc-card__go { font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-blue); white-space: nowrap; }
</style>
