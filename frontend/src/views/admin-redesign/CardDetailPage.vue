<template>
  <!-- 卡详情二级页（2026-10-06 抽屉退役：用户不喜欢抽屉设计，按 SkillDetail/PathDetail 家族判例
       改标准二级页 ?view=card&id=<profileId>）。卡=身份模板：本页只呈现静态卡片内容与
       「创建虚拟学习者」；运行 / 记忆属于创建出来的实例，不在卡库开运行入口
       （2026-10-24 用户「卡不是静态的吗」）。 -->
  <div v-if="d" class="mk-page cd">
    <!-- 页头不再挂「平台预置角色（卡库内「一键加载」同步）」副文（2026-11-02 文案清理）：
         同一句就是右侧「预置」来源徽章的悬停释（sourceTitle），屏上再说一遍属复述；
         「卡库内『一键加载』同步」还是隔空指路。徽章留释，副文撤。 -->
    <MkDetailHero :avatar="d.name.slice(0, 1)" :title="d.name">
      <template #pills>
        <span class="mk-badge" :class="sourceBadge(d)" :title="sourceTitle(d)">{{ sourceText(d) }}</span>
        <span class="mk-badge mk-badge--muted">{{ levelText(d.knowledgeLevel) }}</span>
        <!-- 徽标行只放运营读得懂的标签：preset: / hash: / vN 这类内部标记改到「概览 · 标识」
             一行里带全值展示（2026-11-02 评审 R18，卡墙 2026-10-24 已同规则） -->
        <span v-for="t in visibleTags.slice(0, 4)" :key="t" class="mk-badge mk-badge--muted" :title="t">{{ t }}</span>
        <span v-if="visibleTags.length > 4" class="mk-badge mk-badge--muted" :title="visibleTags.join(' · ')">+{{ visibleTags.length - 4 }}</span>
      </template>
      <template #actions>
        <button
          type="button"
          class="mk-btn mk-btn--primary"
          @click="openDerive"
        >创建虚拟学习者</button>
      </template>
    </MkDetailHero>

    <!-- 来源（2026-10-16 卡=身份模板）：本页是从另一张身份卡派生出来的实例。
         给回模板的入口——运营常要从同一张身份卡再派生一个实例。
         2026-11-02 评审 R12：句子里只留「身份卡」一个称呼——此前「本卡…该身份卡…身份卡」
         混着写，读者分不清哪个是当前对象、哪个是来源。 -->
    <section v-if="d.derivedFrom" class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">身份来源</h3>
      </div>
      <div class="cd-pad">
        <p class="cd-bg">
          <!-- 句中的跳转是「跑一个动作」而不是「去一个地址」（goTemplate 走 openSubPage，
               要一并设面包屑链，RouterLink 给不了），所以用 button.mk-link —— 与全站
               「链接样式的动作按钮」同一写法，不再写 href="#" 那种假地址（2026-11-02）。 -->
          由身份卡「<button
            type="button"
            class="mk-link"
            @click="goTemplate(d.derivedFrom!.profileId)"
          >{{ d.derivedFrom.name }}</button>」派生，故事池一并沿用。派生不消耗身份卡，可以重复派生。
        </p>
      </div>
    </section>

    <!-- 概览事实栅格（mk-facts 原语：div>span+strong 契约）。
         「已创建 N 个实例」落在本卡卡头：KPI 只说「已创建 2」，卡墙上任何一张卡都不显示是哪张建的。 -->
    <section class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">概览</h3>
        <div class="mk-card__head-right">
          <!-- 「builtin」是预置卡的占位卡号（卡墙 2026-10-27 判例），不是运营能用的卡号，
               不在概览卡头当读数展示（2026-11-02 评审 R17） -->
          <span v-if="cardKeyText" class="mk-card__meta mono">{{ cardKeyText }}</span>
          <!-- 「已创建 N 个实例」原本是枚带箭头的入口，点进虚拟学习者列表（2026-11-02 用户
               「无意义跳转」）：那个列表不区分来源、也不筛，落地后与侧栏直达无异，入口兑现不了
               「看这张卡建的实例」这个承诺，去掉箭头与跳转，只留读数本身。 -->
          <span v-if="derivedCount > 0" class="mk-card__meta">已创建 {{ derivedCount }} 个实例</span>
        </div>
      </div>
      <div class="cd-pad">
        <div class="mk-facts mk-facts--rows">
          <div><span>学习目标</span><strong>{{ d.goal || '—' }}</strong></div>
          <div><span>账号</span><strong class="mono">{{ d.email || '—' }}</strong></div>
          <div><span>创建时间</span><strong>{{ fmtDate(d.createdAt) }}</strong></div>
          <div><span>来源</span><strong>
            <template v-if="d.sourceRef"><a :href="d.sourceRef" target="_blank" rel="noopener" class="mk-link">{{ d.sourceRef }}</a></template>
            <template v-else>{{ sourceText(d) }}</template>
          </strong></div>
          <!-- 内部标识留在这里给核对（2026-11-02 评审 R18）：徽标行不摊给所有人看，
               但版本与内容指纹要能读全值，不能被省略号截断 -->
          <div v-if="internalTags.length">
            <span>标识</span>
            <strong><span class="cd-ident">{{ internalTags.join(' · ') }}</span></strong>
          </div>
        </div>
      </div>
    </section>

    <!-- 人设 -->
    <section class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">人设</h3>
        <span v-if="d.personaFacts.length" class="mk-card__meta">{{ d.personaFacts.length }} 个字段</span>
      </div>
      <div class="cd-pad cd-sec">
        <p v-if="backgroundLead" class="cd-bg">{{ backgroundLead }}</p>
        <div v-if="d.personaFacts.length" class="mk-facts mk-facts--rows">
          <div v-for="f in d.personaFacts" :key="f.label"><span>{{ f.label }}</span><strong>{{ personaValue(f.label, f.value) }}</strong></div>
        </div>
        <p v-if="!d.background && !d.personaFacts.length" class="mk-empty--line">这张卡没有人设字段（可能是批次运行产物，仅有账号与目标）。</p>
      </div>
    </section>

    <!-- 故事池 -->
    <section class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">故事池</h3>
        <span class="mk-card__meta">{{ d.stories.length }} 个</span>
      </div>
      <div class="cd-pad cd-sec">
        <article v-for="(s, i) in d.stories" :key="i" class="cd-story">
          <div class="cd-story__title">{{ s.title || `故事 ${i + 1}` }}</div>
          <p v-if="s.opening" class="cd-story__opening">「{{ s.opening }}」</p>
          <ul v-if="s.followUps.length" class="cd-story__hooks">
            <li v-for="(h, hi) in s.followUps" :key="hi">{{ h }}</li>
          </ul>
          <div class="cd-story__meta">
            <span v-if="s.domain" class="mk-badge mk-badge--muted">{{ s.domain }}</span>
            <span v-if="s.intentType" class="mk-badge mk-badge--muted">意图 {{ s.intentType }}</span>
            <span v-if="s.schoolAnchor" class="mk-badge mk-badge--muted">{{ s.schoolAnchor }}</span>
            <template v-for="(v, k) in s.budget" :key="k">
              <span v-if="v != null && v !== ''" class="mk-badge mk-badge--muted">{{ budgetLabel(String(k)) }} {{ v }}</span>
            </template>
          </div>
        </article>
        <p v-if="!d.stories.length" class="mk-empty--line">无故事池（该学习者可能由运行产生，无随卡故事）。</p>
      </div>
    </section>

    <!-- 自带资料 + 备注 -->
    <section v-if="d.materials.length || d.notes" class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">资料与备注</h3>
        <span v-if="d.materials.length" class="mk-card__meta">{{ d.materials.length }} 份随卡资料</span>
      </div>
      <div class="cd-pad cd-sec">
        <div v-if="d.materials.length" class="cd-mats">
          <span v-for="m in d.materials" :key="m.title" class="mk-badge mk-badge--muted">{{ materialIcon(m.kind) }} {{ m.title }}</span>
        </div>
        <p v-if="d.notes" class="cd-bg">{{ d.notes }}</p>
      </div>
    </section>

    <!-- 从卡派生虚拟学习者（与卡墙同一子组件；本页是单卡语境，恒只带这一张卡） -->
    <CardDeriveDialog ref="deriveRef" @created="onDerived" />
  </div>
  <div v-else class="mk-page">
    <div v-if="loading" class="cd-pad cd-sec">
      <MkSkeleton variant="identity" />
      <MkSkeleton variant="rows" :count="3" />
    </div>
    <MkEmptyState
      v-else
      tone="error"
      title="卡不存在或已删除"
      action-text="重试"
      :action-busy="loading"
      action-busy-text="重试中…"
      @action="load()"
    >
      <!-- 顶栏刷新已覆盖本页，但详情取数失败时页内仍要有一个就地重试（失败不得只能离开） -->
      <button type="button" class="mk-btn mk-btn--ghost" @click="closeSubPage()">返回学习者卡库</button>
    </MkEmptyState>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import MkDetailHero from '@/components/mk/MkDetailHero.vue'
import CardDeriveDialog from './CardDeriveDialog.vue'
import MkSkeleton from '@/components/mk/MkSkeleton.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import { subPage, closeSubPage, openSubPage, setSubPageLabel } from './store'
import { adminVirtualLearnersApi } from '@/api/adminApi'
import { errMsg, liveRefreshSeq } from './live'
import { toast } from '@/utils/toast'
import { isInternalTag, isPlaceholderCardKey } from './cardTags'

/* 文案单源（R6 复读单源化）：hero 副文与来源徽章悬停释共用一份 */
const PRESET_SYNC_NOTE = '平台预置角色（卡库内「一键加载」同步）'

interface CardDetail {
  profileId: string
  userId: string
  cardKey: string | null
  name: string
  goal: string
  knowledgeLevel: string
  tags: string[]
  preset: boolean
  sourceKind: string | null
  sourceRef: string | null
  email: string | null
  notes: string | null
  createdAt: string
  personaFacts: Array<{ label: string; value: string }>
  nickname: string | null
  nameHint: string | null
  background: string | null
  stories: Array<{
    title: string | null
    opening: string | null
    followUps: string[]
    domain: string | null
    intentType: string | null
    schoolAnchor: string | null
    budget: Record<string, unknown>
  }>
  materials: Array<{ kind: string; title: string }>
  derivedFrom: { profileId: string; cardKey: string | null; name: string } | null
}

const d = ref<CardDetail | null>(null)
const loading = ref(true)
/** 本卡派生出的实例数（列表接口每行的 profile.derivedFrom.profileId 指向来源卡） */
const derivedCount = ref(0)
const profileId = computed(() => (subPage.value?.view === 'card' ? subPage.value.id || '' : ''))

async function loadDerivedCount(pid: string) {
  try {
    const res = await adminVirtualLearnersApi.getVirtualLearners({ limit: 1000 })
    const body = res.data?.data ?? res.data ?? {}
    const items = Array.isArray(body.profiles) ? body.profiles : Array.isArray(body.items) ? body.items : []
    derivedCount.value = items.filter((it: Record<string, unknown>) => {
      const p = (it.profile || {}) as Record<string, unknown>
      const df = (p.derivedFrom || {}) as Record<string, unknown>
      return String(df.profileId || '') === pid
    }).length
  } catch {
    /* 读数为空不是错误态：保持 0，页面其余部分照常可用 */
    derivedCount.value = 0
  }
}

async function load() {
  const pid = profileId.value
  if (!pid) return
  loading.value = true
  try {
    const res = await adminVirtualLearnersApi.cardsDetail(pid)
    d.value = (res.data?.data ?? res.data) as CardDetail
    // 深链/刷新/从卡墙进入时 subPage 只有 id（面包屑退化成裸 ID），加载出名字后回填。
    // id 守卫：慢响应返回时用户可能已切到别的实体详情，不能把别家的面包屑改名。
    if (d.value?.name && subPage.value?.id === pid) setSubPageLabel(d.value.name)
    void loadDerivedCount(pid)
  } catch (e) {
    toast.error(errMsg(e) || '卡详情加载失败')
  } finally {
    loading.value = false
  }
}

/** 回派生来源的身份卡（本卡是实例时才有入口；label 用视图名，避免「同名卡 / 同名卡」） */
function goTemplate(profileId: string) {
  openSubPage('card', profileId, { from: { view: 'card', id: profileId, label: '身份卡' } })
}

/* 人设首段与「背景」字段取的是同一份原文：有背景字段时不再先铺一遍无字段名的长段落，
   否则同一段话在 22 个字段里出现两次（2026-11-02 评审 R10） */
const backgroundLead = computed(() => {
  const bg = (d.value?.background || '').trim()
  if (!bg) return ''
  return (d.value?.personaFacts || []).some((f) => f.label === '背景') ? '' : bg
})
/** 徽标行只放运营标签，内部标记（preset: / hash: / vN）改到概览「标识」一行全值展示 */
const visibleTags = computed(() => (d.value?.tags || []).filter((t) => !isInternalTag(t)))
const internalTags = computed(() => (d.value?.tags || []).filter((t) => isInternalTag(t)))
/** 占位卡号（builtin）与内部 id 不进概览卡头（卡墙 2026-10-27 同判例） */
const cardKeyText = computed(() => {
  const c = d.value
  const key = (c?.cardKey || '').trim()
  if (!key || isPlaceholderCardKey(key)) return ''
  if (key === c?.profileId || key === c?.userId) return ''
  return key
})
function sourceText(c: Pick<CardDetail, 'preset' | 'sourceKind' | 'derivedFrom'>): string {
  /* 派生卡不是卡墙上的身份卡，也不该读成「自建」——它有自己的来源身份卡（2026-11-02 评审 R11） */
  if (c.derivedFrom) return '派生'
  if (c.preset) return '预置'
  if (c.sourceKind === 'web') return 'web'
  if (c.sourceKind === 'synthetic') return '合成'
  return '自建'
}
function sourceBadge(c: Pick<CardDetail, 'preset' | 'sourceKind' | 'derivedFrom'>): string {
  if (c.derivedFrom) return 'mk-badge--muted'
  if (c.preset) return 'mk-badge--info'
  if (c.sourceKind === 'web') return 'mk-badge--ok'
  return 'mk-badge--muted'
}
function sourceTitle(c: Pick<CardDetail, 'preset' | 'sourceKind' | 'derivedFrom'>): string {
  if (c.derivedFrom) return `来源：由身份卡「${c.derivedFrom.name}」派生`
  if (c.preset) return PRESET_SYNC_NOTE
  if (c.sourceKind === 'web') return '来源：网络采集卡'
  if (c.sourceKind === 'synthetic') return '来源：合成生成卡'
  return '后台手动 / AI 创建'
}
function levelText(level: string): string {
  const map: Record<string, string> = { beginner: '入门', intermediate: '进阶', advanced: '高阶' }
  return map[level] || level || '—'
}
/** 人设字段的枚举值 → 运营词（后端原样下发 reading / necessity / minimal / high；
    2026-10-23 走查「卡片详情人设表在写英文码」，同页等级/预算都已中文化，这里补齐） */
const PERSONA_ENUM_ZH: Record<string, Record<string, string>> = {
  学习风格: { reading: '阅读型', video: '视频型', practice: '实践型', project: '项目型', quiz: '测验型', study: '系统学习', mixed: '混合型' },
  动机类型: { necessity: '必要型', interest: '兴趣型', curiosity: '好奇型', 'external-pressure': '外部压力', career: '职业目标', achievement: '成就型', 'problem-solving': '问题驱动' },
  可用时间: { minimal: '碎片时间', moderate: '适中', abundant: '充裕', short: '短', long: '长' },
  技术熟练度: { high: '高', medium: '中', low: '低' },
  数字素养: { high: '高', medium: '中', low: '低' },
  认知负荷容忍: { high: '高', medium: '中', low: '低' },
  认知风格: { intuitive: '直觉型', logical: '逻辑型', visual: '视觉型', practical: '实践型', mixed: '混合型' }
}
function personaValue(label: string, value: string): string {
  return PERSONA_ENUM_ZH[label]?.[value] || value
}
function budgetLabel(k: string): string {
  const map: Record<string, string> = { dailyMinutes: '每日', horizonDays: '周期(天)', expectedHours: '预期(时)', weeklyHours: '每周(时)' }
  return map[k] || k
}
function materialIcon(kind: string): string {
  const map: Record<string, string> = { book: '书', course: '课', syllabus: '纲', note: '记' }
  return map[kind] || '记'
}
function fmtDate(iso: string): string {
  if (!iso) return '—'
  const t = new Date(iso)
  return Number.isNaN(t.getTime()) ? '—' : t.toLocaleString()
}

/* ===== 派生（从这张卡创建虚拟学习者）=====
   成功后回刷本卡：派生不消耗身份卡，运营常会连着造几个实例。 */
const deriveRef = ref<InstanceType<typeof CardDeriveDialog> | null>(null)
function openDerive() {
  const pid = d.value?.profileId
  if (!pid) return
  deriveRef.value?.openWith([pid])
}
function onDerived() {
  void load()
}

onMounted(load)
/* 顶栏刷新：与旧 hero 刷新钮同一入口 */
watch(liveRefreshSeq, () => { void load() })
</script>

<style scoped>
.cd-pad { padding: 16px; }
.cd-sec { display: grid; gap: 10px; }
.cd-bg { margin: 0; font-size: var(--mk-fs-body); line-height: 1.6; color: var(--mk-ink); white-space: pre-wrap; }
.cd-story { display: grid; gap: 6px; min-width: 0; padding: 12px 14px; border: 1px solid var(--mk-line); border-radius: var(--mk-radius-lg); background: var(--mk-surface-2); }
.cd-story__title { font-size: var(--mk-fs-body); font-weight: 700; color: var(--mk-ink); }
.cd-story__opening { margin: 0; font-size: var(--mk-fs-body); line-height: 1.6; color: var(--mk-ink); }
.cd-story__hooks { margin: 0; padding-left: 18px; display: grid; gap: 2px; }
.cd-story__hooks li { font-size: var(--mk-fs-micro); line-height: 1.5; color: var(--mk-muted); }
/* min-width:0 让 flex/grid 子项可收缩；徽章全局 nowrap 且无上限，长 domain 会在 349px 容器里撑到 483px 溢出。 */
.cd-story__meta { display: flex; flex-wrap: wrap; gap: 4px; min-width: 0; }
.cd-story__meta :deep(.mk-badge) { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cd-mats { display: flex; flex-wrap: wrap; gap: 4px; }
/* 标识行：hash 是 64 位十六进制长串，必须在行内折行，不能被右侧裁掉 */
.cd-ident { font-family: var(--mk-mono); word-break: break-all; }
.mono { font-family: var(--mk-mono); }
</style>
