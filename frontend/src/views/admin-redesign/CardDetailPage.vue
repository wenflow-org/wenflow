<template>
  <!-- 卡详情二级页（2026-10-06 抽屉退役：用户不喜欢抽屉设计，按 SkillDetail/PathDetail 家族判例
       改标准二级页 ?view=card&id=<profileId>）。卡=账号拍板不变：本页是卡的全字段可视面，
       「到虚拟学习者」= openSubPage('virtual', profileId) 切到画像二级页（看运行态）。 -->
  <div v-if="d" class="mk-page cd">
    <MkDetailHero :avatar="d.name.slice(0, 1)" :title="d.name" :sub="heroSubText">
      <template #pills>
        <span class="mk-badge" :class="sourceBadge(d)" :title="sourceTitle(d)">{{ sourceText(d) }}</span>
        <span class="mk-badge mk-badge--muted" :title="`知识水平：${d.knowledgeLevel}`">{{ levelText(d.knowledgeLevel) }}</span>
        <span v-for="t in d.tags.slice(0, 4)" :key="t" class="mk-badge mk-badge--muted">{{ t }}</span>
        <span v-if="d.tags.length > 4" class="mk-badge mk-badge--muted" :title="d.tags.join(' · ')">+{{ d.tags.length - 4 }}</span>
      </template>
      <template #actions>
        <button type="button" class="mk-btn" :disabled="loading" @click="load">{{ loading ? '刷新中…' : '刷新' }}</button>
        <button type="button" class="mk-btn mk-btn--primary" @click="goLearner">到虚拟学习者 →</button>
      </template>
    </MkDetailHero>

    <!-- 概览事实栅格（mk-facts 原语：div>span+strong 契约） -->
    <section class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">概览</h3>
        <span class="mk-card__meta mono">{{ d.cardKey || '（无 cardKey）' }}</span>
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
        <p v-if="d.background" class="cd-bg">{{ d.background }}</p>
        <div v-if="d.personaFacts.length" class="mk-facts mk-facts--rows">
          <div v-for="f in d.personaFacts" :key="f.label"><span>{{ f.label }}</span><strong>{{ f.value }}</strong></div>
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
        <p v-if="!d.stories.length" class="mk-empty--line">无故事池（该学习者可能是运行产物，无卡式故事）。</p>
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
          <span v-for="m in d.materials" :key="m.title" class="mk-badge mk-badge--muted" :title="`类型：${m.kind}`">{{ materialIcon(m.kind) }} {{ m.title }}</span>
        </div>
        <p v-if="d.notes" class="cd-bg">{{ d.notes }}</p>
      </div>
    </section>
  </div>
  <div v-else class="mk-page">
    <div v-if="loading" class="cd-pad cd-sec">
      <MkSkeleton variant="identity" />
      <MkSkeleton variant="rows" :count="3" />
    </div>
    <MkEmptyState v-else tone="error" title="卡不存在或已删除" description="卡墙数据可能已刷新，返回卡库重试。">
      <button type="button" class="mk-btn" @click="closeSubPage()">返回卡墙</button>
    </MkEmptyState>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import MkDetailHero from '@/components/mk/MkDetailHero.vue'
import MkSkeleton from '@/components/mk/MkSkeleton.vue'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import { subPage, closeSubPage, openSubPage } from './store'
import { adminVirtualLearnersApi } from '@/api/adminApi'
import { errMsg } from './live'
import { toast } from '@/utils/toast'

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
}

const d = ref<CardDetail | null>(null)
const loading = ref(true)
const profileId = computed(() => (subPage.value?.view === 'card' ? subPage.value.id || '' : ''))

async function load() {
  if (!profileId.value) return
  loading.value = true
  try {
    const res = await adminVirtualLearnersApi.cardsDetail(profileId.value)
    d.value = (res.data?.data ?? res.data) as CardDetail
  } catch (e) {
    toast.error(errMsg(e) || '卡详情加载失败')
  } finally {
    loading.value = false
  }
}

/** 「到虚拟学习者」：切画像二级页（id=profileId，findProfileDetail 按 profile 主键查） */
function goLearner() {
  openSubPage('virtual', d.value?.profileId || '')
}

const heroSubText = computed(() => {
  return d.value?.preset ? '仓库预置角色 · 部署时幂等同步' : '学习者卡 · 导入即用'
});
function sourceText(c: Pick<CardDetail, 'preset' | 'sourceKind'>): string {
  if (c.preset) return '预置'
  if (c.sourceKind === 'web') return 'web'
  if (c.sourceKind === 'synthetic') return '合成'
  return '自建'
}
function sourceBadge(c: Pick<CardDetail, 'preset' | 'sourceKind'>): string {
  if (c.preset) return 'mk-badge--info'
  if (c.sourceKind === 'web') return 'mk-badge--ok'
  return 'mk-badge--muted'
}
function sourceTitle(c: Pick<CardDetail, 'preset' | 'sourceKind'>): string {
  if (c.preset) return '仓库预置角色（部署时按 presetKey 幂等同步）'
  if (c.sourceKind === 'web') return '来源：网络采集卡'
  if (c.sourceKind === 'synthetic') return '来源：合成生成卡'
  return '后台手动 / AI 创建'
}
function levelText(level: string): string {
  const map: Record<string, string> = { beginner: '入门', intermediate: '进阶', advanced: '高阶' }
  return map[level] || level || '—'
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

onMounted(load)
</script>

<style scoped>
.cd-pad { padding: 16px; }
.cd-sec { display: grid; gap: 10px; }
.cd-bg { margin: 0; font-size: var(--mk-fs-body); line-height: 1.6; color: var(--mk-ink); white-space: pre-wrap; }
.cd-story { display: grid; gap: 6px; padding: 12px 14px; border: 1px solid var(--mk-line); border-radius: var(--mk-radius-lg); background: var(--mk-surface-2); }
.cd-story__title { font-size: var(--mk-fs-body); font-weight: 700; color: var(--mk-ink); }
.cd-story__opening { margin: 0; font-size: var(--mk-fs-body); line-height: 1.6; color: var(--mk-ink); }
.cd-story__hooks { margin: 0; padding-left: 18px; display: grid; gap: 2px; }
.cd-story__hooks li { font-size: var(--mk-fs-micro); line-height: 1.5; color: var(--mk-muted); }
.cd-story__meta { display: flex; flex-wrap: wrap; gap: 4px; }
.cd-mats { display: flex; flex-wrap: wrap; gap: 4px; }
.mono { font-family: var(--mk-mono); }
</style>
