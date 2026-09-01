<template>
  <Teleport to="body">
    <div v-if="entity" ref="maskRef" class="msk">      <aside ref="panelRef" class="msk__panel" role="dialog" aria-label="详情">
        <!-- 头部：身份区（阶段色 + 类别图标 + 状态 chips） -->
        <header class="msk__head" :style="{ '--hue': tone.hue, '--soft': tone.soft }">
          <div class="msk__id-row">
            <span class="msk__icon" aria-hidden="true">
              <svg v-if="iconKey === 'analysis'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
                <circle cx="7" cy="7" r="4.2" />
                <path d="M10.2 10.2 13.8 13.8" />
              </svg>
              <svg v-else-if="iconKey === 'generation'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round">
                <path d="M8 1.6 9.7 6.1 14.4 8 9.7 9.9 8 14.4 6.3 9.9 1.6 8 6.3 6.1Z" />
              </svg>
              <svg v-else-if="iconKey === 'teaching'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3.2 3h9.6A1.7 1.7 0 0 1 14.5 4.7v4.6a1.7 1.7 0 0 1-1.7 1.7H8L4.9 13v-2H3.2A1.7 1.7 0 0 1 1.5 9.3V4.7A1.7 1.7 0 0 1 3.2 3Z" />
              </svg>
              <svg v-else-if="iconKey === 'simulation'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
                <path d="M6.2 2h3.6M7 2v4.2L3.6 12A1.6 1.6 0 0 0 5 14.2h6A1.6 1.6 0 0 0 12.4 12L9 6.2V2" />
                <path d="M5.4 10.5h5.2" />
              </svg>
              <svg v-else-if="iconKey === 'agent'" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 1.8 14.2 5.2 8 8.6 1.8 5.2Z" />
                <path d="m2.6 8.2 5.4 3 5.4-3M2.6 11l5.4 3 5.4-3" />
              </svg>
              <svg v-else viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
                <path d="M8 1.8 13.8 5v6L8 14.2 2.2 11V5Z" />
                <path d="M8 8 13.8 5M8 8 2.2 5M8 8v6.2" />
              </svg>
            </span>
            <div class="msk__titlebox">
              <h3 class="msk__name">{{ entity.name }}</h3>
              <span class="msk__id mono">{{ entity.id }}</span>
            </div>
            <button type="button" class="msk__close" aria-label="关闭" @click="closeSkillDrawer">✕</button>
          </div>
          <div class="msk__chips">
            <span class="mk-badge" :class="stat.errors ? 'mk-badge--bad' : 'mk-badge--ok'">
              {{ stat.errors ? `${stat.errors} 次失败` : '健康' }}
            </span>
            <template v-if="skillProfile">
              <span class="mk-badge mk-badge--muted">{{ categoryLabel }}</span>
              <span class="mk-badge mk-badge--muted">{{ liveMeta?.agentName || skillProfile.agentName || '—' }}</span>
            </template>
          </div>
          <p v-if="entity.description" class="msk__desc" :title="entity.description">{{ entity.description }}</p>
        </header>

        <!-- 页签：概览 / Prompt（只读速览；编辑统一在 Prompt 设计页） -->
        <nav class="mk-pills msk__tabs" aria-label="详情页签">
          <button
            v-for="t in visibleTabs"
            :key="t.key"
            type="button"
            class="mk-pill"
            :class="{ 'mk-pill--active': activeTab === t.key }"
            @click="activeTab = t.key"
          >
            {{ t.label }}
            <span v-if="t.badge" class="msk__tab-badge" :class="t.badgeCls">{{ t.badge }}</span>
          </button>
        </nav>

        <div class="msk__body">
          <!-- ========== 概览（只读） ========== -->
          <template v-if="activeTab === 'overview'">
          <!-- 指标条 -->
          <div class="msk__stats">
            <div class="msk__stat">
              <span>调用</span>
              <strong>{{ stat.calls || '—' }}</strong>
            </div>
            <div class="msk__stat">
              <span>失败</span>
              <strong :class="{ 'is-bad': stat.errors > 0 }">{{ stat.calls ? stat.errors : '—' }}</strong>
            </div>
            <div class="msk__stat">
              <span>成功率</span>
              <strong :class="`is-${rateTone}`">{{ successRate }}</strong>
            </div>
            <div class="msk__stat">
              <span>平均耗时</span>
              <strong>{{ stat.calls ? fmtMs(stat.avgMs) : '—' }}</strong>
            </div>
          </div>
          <p v-if="skillProfile && statsSourceNote" class="msk__note">{{ statsSourceNote }}</p>

          <!-- 生效模型（skill 模式）：所属/类别已进头部 chips -->
          <div v-if="skillProfile" class="msk__kv">
            <span>生效模型</span>
            <strong class="mono">{{ liveMeta?.model || skillProfile.promptVersion || '默认' }}</strong>
            <em v-if="liveMeta?.modelSource" class="msk__src">{{ liveMeta.modelSource }}</em>
          </div>

          <section class="msk__section">
            <header class="msk__sec-head">
              <h4>最近调用</h4>
              <span v-if="recent.length" class="msk__sec-meta mono">{{ recent.length }}</span>
            </header>
            <div v-if="recent.length" class="msk__list">
              <button
                v-for="s in recent"
                :key="s.id"
                type="button"
                class="msk__row"
                @click="goTrace(s.traceId)"
              >
                <span class="msk__dot" :class="`is-${s.status}`" :title="statusDotLabel(s.status)" :aria-label="statusDotLabel(s.status)"></span>
                <span class="msk__row-title">{{ s.title }}</span>
                <span class="msk__row-num mono">{{ fmtMs(s.durationMs) }}</span>
                <span class="msk__row-id mono">{{ s.traceId }}</span>
              </button>
            </div>
            <p v-else class="msk__none">近 60 条日志窗口内无调用（统计为全量口径）。</p>
          </section>
          </template>

          <!-- ========== Prompt（只读：生效内容 + 设计页跳转） ========== -->
          <template v-if="activeTab === 'prompt'">
          <section v-if="skillProfile" class="msk__section">
            <header class="msk__sec-head">
              <h4>生效 Prompt</h4>
              <span class="msk__sec-meta">
                <span class="mono">{{ liveMeta?.promptVersion || skillProfile.promptVersion || '默认' }}</span>
              </span>
            </header>
            <pre v-if="liveMeta?.effectivePrompt" class="msk__code msk__code--cap">{{ liveMeta.effectivePrompt }}</pre>
            <div class="msk__prompt">
              <span class="mono">{{ liveMeta?.promptVersion || skillProfile.promptVersion || '默认' }}</span>
              <button type="button" class="mk-link" @click="goPromptLab">编辑协议 / 发布 →</button>
            </div>
          </section>

          <section v-if="skillProfile" class="msk__section msk__section--actions">
            <button type="button" class="msk__primary-link" @click="goFullEditor">打开 Prompt 设计页 →</button>
            <p class="msk__none">设计页统一承接：协议（core 编辑/发布）、版本、试跑、运行时与工程视图；抽屉仅保留只读速览。</p>
          </section>
          </template>
        </div>
      </aside>
    </div>
    <div v-else-if="intent.skillDrawerId" class="msk__notfound">
      <strong>未找到 Skill「{{ intent.skillDrawerId }}」</strong>
      <span>它可能未注册或 ID 有误。</span>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  intent,
  skillStatOf,
  recentSpansOf,
  openTrace,
  closeSkillDrawer,
  AGENT_TONES
} from './store'
import { liveSkillProfiles, liveExtraProfiles } from './live'
import { adminSkillWorkbenchApi, adminSkillsApi } from '@/api/adminApi'
import { useEscape } from './useEscape'
import { useOverlay, useMaskClose } from './useOverlay'

useEscape(() => !!intent.skillDrawerId, closeSkillDrawer)

const panelRef = ref<HTMLElement | null>(null)
const maskRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => !!intent.skillDrawerId), panelRef)
useMaskClose(maskRef, closeSkillDrawer)

const router = useRouter()

const skillProfile = computed(() => {
  const id = intent.skillDrawerId
  // 只认真实注册表（含外挂能力 Skill）：查不到即「未找到」，不静默回退
  const live =
    liveSkillProfiles.value.find((p) => p.id === id) ||
    liveExtraProfiles.value.find((p) => p.id === id)
  if (live) {
    return { id: live.id, name: live.name, agentId: '', agentName: '', category: live.category, promptVersion: '', description: '' }
  }
  return null
})
const entity = computed(() => skillProfile.value)

/* 身份色：与 Agent 拓扑同套阶段色（按所属 Agent 取色） */
const tone = computed(() => {
  const key = skillProfile.value ? skillProfile.value.agentId : intent.skillDrawerId
  return AGENT_TONES[key || ''] || { hue: 'var(--mk-blue, #2c63d0)', soft: 'rgba(44, 99, 208, 0.1)' }
})

/** 头部图标：skill 按类别，agent 用层叠形 */
const iconKey = computed(() => {
  if (!skillProfile.value) return 'agent'
  const c = skillProfile.value.category
  return ['analysis', 'generation', 'teaching', 'simulation'].includes(c) ? c : 'default'
})

const categoryLabel = computed(() => liveMeta.value?.category || skillProfile.value?.category || '—')

/** 成功率色阶：无数据灰、零失败绿、≥95 琥珀、其余红 */
const rateTone = computed(() => {
  if (!stat.value.calls) return 'na'
  if (stat.value.errors === 0) return 'ok'
  const r = ((stat.value.calls - stat.value.errors) / stat.value.calls) * 100
  return r >= 95 ? 'warn' : 'bad'
})

/* 页签：概览（只读）/ Prompt（只读 + 设计页跳转）；编辑能力已收敛到设计页 */
type DrawerTab = 'overview' | 'prompt'
const activeTab = ref<DrawerTab>('overview')
const visibleTabs = computed<Array<{ key: DrawerTab; label: string; badge?: string; badgeCls?: string }>>(() => {
  const tabs: Array<{ key: DrawerTab; label: string; badge?: string; badgeCls?: string }> = [
    // 概览 badge：Agent 视图显示下辖 Skill 数；Skill 视图不挂 badge（失败数已由头部徽章 + 指标条展示）
    {
      key: 'overview',
      label: '概览',
      badge: undefined,
      badgeCls: undefined
    }
  ]
  if (skillProfile.value) tabs.push({ key: 'prompt', label: 'Prompt' })
  return tabs
})

interface LiveMeta {
  agentName: string
  category: string
  model: string
  modelSource: string
  promptVersion: string
  effectivePrompt: string
  llmTemperature: number | null
  llmMaxTokens: number | null
  statsSource: string
  statsRange: string
}
const liveMeta = ref<LiveMeta | null>(null)
const metaLoading = ref(false)

const statsSourceNote = computed(() => {
  if (!liveMeta.value?.statsSource) return ''
  const src =
    liveMeta.value.statsSource === 'prompt_call_logs'
      ? 'Prompt 调用日志'
      : liveMeta.value.statsSource === 'agent_call_logs'
        ? 'Skill 执行日志'
        : '无调用'
  const range = liveMeta.value.statsRange === 'all' ? '全量' : liveMeta.value.statsRange
  return `统计口径：${src} · ${range}（与列表/拓扑统一）`
})

watch(
  () => intent.skillDrawerId,
  async (id) => {
    liveMeta.value = null
    metaLoading.value = true
    activeTab.value = 'overview'
    if (!id || !skillProfile.value) { metaLoading.value = false; return }
    try {
      const [metaRes, promptRes] = await Promise.all([
        adminSkillWorkbenchApi.getMeta(id).catch(() => null),
        adminSkillsApi.getEffectiveSkillPrompt(id).catch(() => null)
      ])
      const meta = metaRes?.data?.data ?? metaRes?.data ?? {}
      const promptBody = promptRes?.data?.data ?? promptRes?.data ?? {}
      const modelCfg = (meta.modelConfig || {}) as Record<string, unknown>
      const llmRequest = (modelCfg.llmRequest || {}) as Record<string, unknown>
      const parent = (meta.parentAgent || {}) as Record<string, unknown>
      const skill = (meta.skill || {}) as Record<string, unknown>
      const stats = (meta.stats || {}) as Record<string, unknown>
      // effective-prompt 的 prompt 是对象：{id, version, name, systemPrompt}
      const prompt = (promptBody.prompt || {}) as Record<string, unknown>
      const version = prompt.version ? `v${String(prompt.version)}` : ''
      const promptName = prompt.name ? String(prompt.name) : ''
      const llmModel = llmRequest.model != null ? String(llmRequest.model) : modelCfg.model ? String(modelCfg.model) : ''
      liveMeta.value = {
        agentName: String(parent.name || parent.id || ''),
        category: String(skill.category || skillProfile.value?.category || ''),
        model: llmModel || (modelCfg.tier ? `档位 ${String(modelCfg.tier)}` : ''),
        modelSource: String(llmRequest.source || modelCfg.source || ''),
        promptVersion: [version, promptName].filter(Boolean).join(' · '),
        effectivePrompt: String(prompt.systemPrompt || '').slice(0, 1200),
        llmTemperature: llmRequest.temperature != null ? Number(llmRequest.temperature) : null,
        llmMaxTokens: llmRequest.maxTokens != null ? Number(llmRequest.maxTokens) : null,
        statsSource: String(stats.source || ''),
        statsRange: String(stats.range || 'all')
      }
    } catch {
      liveMeta.value = null
    } finally {
      metaLoading.value = false
    }
  },
  { immediate: true }
)

/** 状态点可访问性文本 */
const statusDotLabel = (s: string) => (s === 'ok' ? '成功' : s === 'err' ? '失败' : '超时')

const stat = computed(() => {
  if (skillProfile.value) return skillStatOf(skillProfile.value.id)
  return { calls: 0, errors: 0, avgMs: 0, lastAt: '从未' }
})

const recent = computed(() => (entity.value ? recentSpansOf(entity.value.id) : []))

const successRate = computed(() => {
  if (!stat.value.calls) return '—'
  const r = ((stat.value.calls - stat.value.errors) / stat.value.calls) * 100
  return `${r.toFixed(1)}%`
})

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`)

// 抽屉是覆盖层：跳瀑布前先收起，保证动线连贯
function goTrace(traceId: string) {
  closeSkillDrawer()
  openTrace(traceId)
}

function goPromptLab() {
  const id = intent.skillDrawerId
  closeSkillDrawer()
  void router.push(`/admin/skills/${encodeURIComponent(id)}?tab=protocol`)
}

/** 二级 Prompt 设计页（/admin/skills/:id，Skill 级编辑台） */
function goFullEditor() {
  const id = intent.skillDrawerId
  closeSkillDrawer()
  void router.push(`/admin/skills/${encodeURIComponent(id)}`)
}
</script>

<style scoped>
/* ========== 遮罩与面板 ========== */
.msk {
  position: fixed;
  inset: 0;
  z-index: var(--mk-z-drawer);
  background: rgba(15, 23, 42, 0.36);
  display: flex;
  justify-content: flex-end;
}
.msk__panel {
  width: min(520px, 100vw);
  height: 100%;
  background: #fff;
  box-shadow: var(--mk-shadow-drawer);
  display: grid;
  grid-template-rows: auto auto 1fr;
  animation: msk-in 0.2s ease;
}


@keyframes msk-in {
  from { transform: translateX(30px); opacity: 0; }
}

/* ========== 页签（统一 mk-pills 分段控件） ========== */
.msk__tabs {
  margin: 0 14px;
  width: fit-content;
  padding: 3px;
}
.msk__tab-badge {
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  display: inline-grid;
  place-items: center;
  font-size: 12.5px;
  font-weight: 800;
  background: #eef2fa;
  color: var(--mk-faint);
  margin-left: 3px;
}
.msk__tab-badge.is-bad { background: var(--mk-red-bg); color: var(--mk-red); }
.mk-pill--active .msk__tab-badge { background: #dbe9ff; color: var(--mk-accent-deep); }

/* ========== 头部身份区 ========== */
.msk__head {
  padding: 16px 18px 14px;
  border-bottom: 1px solid var(--mk-line);
  background: linear-gradient(180deg, var(--soft, rgba(44, 99, 208, 0.06)), rgba(255, 255, 255, 0) 90%);
  display: grid;
  gap: 10px;
}
.msk__id-row {
  display: flex;
  align-items: flex-start;
  gap: 11px;
}
.msk__icon {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: var(--soft);
  color: var(--hue);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.msk__icon svg { width: 19px; height: 19px; }
.msk__titlebox { min-width: 0; flex: 1; padding-top: 1px; }
.msk__name {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #16233c;
  line-height: 1.3;
}
.msk__id {
  display: block;
  margin-top: 2px;
  font-size: 12.5px;
  color: var(--mk-faint);
  word-break: break-all;
}
.msk__close {
  border: 0;
  background: var(--mk-close-bg, #f0f2f5);
  width: 30px;
  height: 30px;
  border-radius: 8px;
  cursor: pointer;
  color: var(--mk-muted);
  font-size: 13px;
  flex-shrink: 0;
  transition: background 0.15s ease;
}
.msk__close:hover { background: #e6eaf2; }

.msk__chips {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding-left: 49px;
}
.msk__desc {
  margin: 0;
  padding-left: 49px;
  color: #5b6577;
  font-size: 12.5px;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ========== 正文 ========== */
.msk__body {
  padding: 14px 18px 20px;
  display: grid;
  gap: 16px;
  align-content: start;
  overflow-y: auto;
}

/* 指标条 */
.msk__stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  overflow: hidden;
  box-shadow: var(--mk-shadow-sm);
}
.msk__stat {
  display: grid;
  gap: 2px;
  padding: 10px 12px 11px;
}
.msk__stat + .msk__stat { border-left: 1px solid #eef2f8; }
.msk__stat span { font-size: 12px; color: var(--mk-faint); font-weight: 600; }
.msk__stat strong {
  font-family: var(--mk-mono);
  font-size: 16px;
  font-weight: 600;
  color: #1a2a44;
  font-variant-numeric: tabular-nums;
}
.msk__stat strong.is-bad { color: var(--mk-red); }
.msk__stat strong.is-ok { color: var(--mk-green); }
.msk__stat strong.is-warn { color: var(--mk-amber); }
.msk__stat strong.is-na { color: var(--mk-faint); }
.msk__note { margin: -8px 0 0; font-size: 12.5px; color: var(--mk-faint); }

/* 生效模型 kv 行 */
.msk__kv {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 8px 12px;
  border: 1px dashed var(--mk-line);
  border-radius: 10px;
}
.msk__kv span { font-size: 12px; color: var(--mk-faint); font-weight: 600; }
.msk__kv strong { font-size: 12px; color: #1a2a44; font-weight: 600; }
.msk__src {
  margin-left: auto;
  font-size: 12.5px;
  font-style: normal;
  font-weight: 600;
  color: var(--mk-faint);
}

/* 小节系统 */
.msk__section { display: grid; gap: 8px; }
.msk__sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.msk__sec-head h4 {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mk-faint);
}
.msk__sec-meta {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  color: var(--mk-faint);
  font-weight: 600;
}

/* 行列表（下辖 Skill / 最近调用） */
.msk__list { display: grid; gap: 4px; }
.msk__row {
  display: grid;
  grid-template-columns: 8px 1fr auto auto;
  gap: 10px;
  align-items: center;
  padding: 8px 10px;
  border: 1px solid #e6ecf6;
  border-radius: 9px;
  background: #fff;
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.12s ease, background 0.12s ease;
}
.msk__row:hover { border-color: rgba(44, 99, 208, 0.35); background: #f8fbff; }
.msk__dot { width: 7px; height: 7px; border-radius: 50%; }
.msk__dot.is-ok { background: var(--mk-green); }
.msk__dot.is-warn { background: var(--mk-amber); }
.msk__dot.is-err { background: var(--mk-red); }
.msk__dot.is-idle { background: #c3cede; }
.msk__row-title {
  font-weight: 500;
  color: #223252;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.msk__row-num { color: #5b6577; font-size: 12.5px; font-variant-numeric: tabular-nums; }
.msk__row-id {
  color: var(--mk-faint);
  font-size: 12.5px;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.msk__none { margin: 0; color: var(--mk-faint); font-size: 12px; }
.msk__notfound {
  width: min(520px, 100vw);
  height: 100%;
  margin-left: auto;
  background: var(--mk-surface);
  display: grid;
  place-content: center;
  gap: 8px;
  text-align: center;
  padding: 24px;
}
.msk__notfound strong { font-size: 14px; color: var(--mk-ink); }
.msk__notfound span { font-size: 12.5px; color: var(--mk-faint); }

/* 代码井（Prompt 预览） */
.msk__code {
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--mk-code-bg, #101826);
  border: 1px solid var(--mk-code-border, #1c2a40);
  color: var(--mk-code-fg, #9db8dc);
  font: 12px/1.65 var(--mk-mono);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 180px;
  overflow-y: auto;
}
.msk__code--cap { max-height: 140px; }

/* Prompt 版本行 + 设计页跳转 */
.msk__prompt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px 12px;
  border: 1px dashed var(--mk-line);
  border-radius: 9px;
  font-size: 12.5px;
  color: #5b6577;
}
.mk-link {
  border: 0;
  background: transparent;
  color: var(--mk-blue, #2c63d0);
  font: inherit;
  font-weight: 700;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

/* 底部主操作 */
.msk__section--actions { padding-top: 2px; }
.msk__primary-link {
  border: 1px solid rgba(44, 99, 208, 0.35);
  background: #eef5ff;
  color: var(--mk-blue, #2c63d0);
  font: inherit;
  font-weight: 700;
  font-size: 12.5px;
  padding: 10px 12px;
  border-radius: 10px;
  cursor: pointer;
  width: 100%;
  text-align: left;
}
.msk__primary-link:hover { background: #e0edff; }


/* 4K：抽屉加宽 + 字号跟随壳层放大（原 460px + 10px 是全站最小） */
@media (min-width: 2000px) {
  .msk__panel { width: min(600px, 100vw); }
  .msk__head { padding: 20px 24px; }
  .msk__name { font-size: 19px; }
  .msk__id { font-size: 12.5px; }
  .msk__body { padding: 20px 24px; }
  .msk__close { width: 34px; height: 34px; font-size: 16px; }
  .msk__chip { font-size: 12.5px; }
  .msk__tab-badge { font-size: 12px; }
  .msk__stat span { font-size: 12px; }
  .msk__stat strong { font-size: 18px; }
  .msk__row { font-size: 14px; }
  .msk__row-id { font-size: 12.5px; }
  .msk__row-num { font-size: 12.5px; }
  .msk__note { font-size: 12.5px; }
  .msk__sec-head h4 { font-size: 13px; }
  .msk__sec-meta { font-size: 12.5px; }
  .msk__kv span { font-size: 13px; }
  .msk__code { font-size: 12.5px; }
  .msk__prompt { font-size: 13.5px; }
}
@media (min-width: 2800px) {
  .msk__panel { width: min(760px, 100vw); }
  .msk__head { padding: 24px 30px; }
  .msk__name { font-size: 23px; }
  .msk__id { font-size: 15px; }
  .msk__body { padding: 24px 30px; }
  .msk__close { width: 40px; height: 40px; font-size: 19px; }
  .msk__chip { font-size: 15px; }
  .msk__tab-badge { font-size: 14px; }
  .msk__stat span { font-size: 14px; }
  .msk__stat strong { font-size: 22px; }
  .msk__row { font-size: 16.5px; }
  .msk__row-id { font-size: 15px; }
  .msk__row-num { font-size: 15px; }
  .msk__note { font-size: 15px; }
  .msk__sec-head h4 { font-size: 15.5px; }
  .msk__sec-meta { font-size: 15px; }
  .msk__kv span { font-size: 15.5px; }
  .msk__code { font-size: 15px; }
  .msk__prompt { font-size: 16px; }
}
@media (min-width: 3600px) {
  /* 4K（抽屉 Teleport 到 body，无 zoom）：面板再加宽、字号继续放大 */
  .msk__panel { width: min(890px, 100vw); }
  .msk__head { padding: 28px 36px; }
  .msk__name { font-size: 27px; }
  .msk__id { font-size: 17.5px; }
  .msk__body { padding: 28px 36px; }
  .msk__close { width: 47px; height: 47px; font-size: 22px; }
  .msk__chip { font-size: 17.5px; }
  .msk__tab-badge { font-size: 16.5px; }
  .msk__stat span { font-size: 16.5px; }
  .msk__stat strong { font-size: 26px; }
  .msk__row { font-size: 19.5px; }
  .msk__row-id { font-size: 17.5px; }
  .msk__row-num { font-size: 17.5px; }
  .msk__note { font-size: 17.5px; }
  .msk__sec-head h4 { font-size: 18px; }
  .msk__sec-meta { font-size: 17.5px; }
  .msk__kv span { font-size: 18px; }
  .msk__code { font-size: 17.5px; }
  .msk__prompt { font-size: 18.5px; }
}

/* ================= 暗色模式（D1 补完）：Skill 抽屉 ================= */
html[data-theme='dark'] {
  .msk__panel, .msk__head, .msk__body { background: #17202f; border-color: #232f45; }
  .msk__tab-badge, .msk__badge { background: #253049; }
  .mk-pill--active .msk__tab-badge { background: rgba(91, 141, 239, 0.22); color: #9db8f5; }
  .msk__close:hover { background: #2c3a55; }
  .msk__row:hover { background: #1b2740; }
  .msk__primary-link:hover { background: rgba(91, 141, 239, 0.14); }
  .msk__section { background: #141c2b; }
  /* 文字色补漏：统计数字/kv 值硬编码 #1a2a44，暗色下不可见 */
  .msk__stat strong,
  .msk__kv strong { color: var(--mk-ink, #e6edf7); }
}
</style>
