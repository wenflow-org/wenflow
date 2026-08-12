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
            <template v-else>
              <span class="mk-badge mk-badge--muted">Agent</span>
              <span class="mk-badge mk-badge--muted">{{ memberSkills.length }} Skill<template v-if="memberErrors"> · {{ memberErrors }} 异常</template></span>
            </template>
          </div>
          <p v-if="entity.description" class="msk__desc" :title="entity.description">{{ entity.description }}</p>
        </header>

        <!-- 页签：概览 / 运行 / Prompt / 协议（统一 mk-pills） -->
        <nav class="mk-pills msk__tabs" aria-label="详情页签">
          <button
            v-for="t in visibleTabs"
            :key="t.key"
            type="button"
            class="mk-pill"
            :class="{ 'mk-pill--active': activeTab === t.key }"
            @click="activateTab(t.key)"
          >
            {{ t.label }}
            <span v-if="t.badge" class="msk__tab-badge" :class="t.badgeCls">{{ t.badge }}</span>
          </button>
        </nav>

        <div class="msk__body">
          <!-- ========== 概览 ========== -->
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
          <p v-if="skillProfile && isLive && statsSourceNote" class="msk__note">{{ statsSourceNote }}</p>

          <!-- 生效模型（skill 模式）：所属/类别已进头部 chips -->
          <div v-if="skillProfile" class="msk__kv">
            <span>生效模型</span>
            <strong class="mono">{{ liveMeta?.model || skillProfile.promptVersion || '默认' }}</strong>
            <em v-if="liveMeta?.modelSource" class="msk__src">{{ liveMeta.modelSource }}</em>
          </div>

          <!-- Agent 视图：下辖 Skill 清单 -->
          <section v-if="!skillProfile && memberSkills.length" class="msk__section">
            <header class="msk__sec-head">
              <h4>下辖 Skill</h4>
              <span class="msk__sec-meta mono">{{ memberSkills.length }}</span>
            </header>
            <div class="msk__list">
              <button
                v-for="s in memberSkills"
                :key="s.id"
                type="button"
                class="msk__row"
                @click="openSkillDrawer(s.id)"
              >
                <span
                  class="msk__dot"
                  :class="skillStatOf(s.id).errors ? 'is-err' : skillStatOf(s.id).calls ? 'is-ok' : 'is-idle'"
                  :title="memberDotLabel(s.id)"
                  :aria-label="memberDotLabel(s.id)"
                ></span>
                <span class="msk__row-title">{{ s.name }}</span>
                <span class="msk__row-num mono">{{ skillStatOf(s.id).calls || '—' }}</span>
                <span class="msk__row-id mono">{{ s.id }}</span>
              </button>
            </div>
          </section>

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

          <!-- ========== 运行（配置 + 试跑） ========== -->
          <template v-if="activeTab === 'run'">
          <!-- 运行配置（live 可编辑：对齐生产 AgentEditor 运行时 tab） -->
          <section v-if="skillProfile && isLive" class="msk__section">
            <header class="msk__sec-head">
              <h4>运行配置</h4>
              <span class="msk__src-chip" :class="{ 'msk__src-chip--custom': runtimeCfg?.hasSkillOverride }">
                {{ runtimeCfg?.hasSkillOverride ? '独立配置' : '继承 Agent/平台' }}
              </span>
            </header>
            <div v-if="runtimeCfg" class="msk__card">
              <label class="msk__field">
                <span>模型（留空 = 继承）</span>
                <input v-model="runtimeCfg.model" class="msk__input mono" list="msk-models" placeholder="继承" />
                <datalist id="msk-models">
                  <option v-for="m in modelOptions" :key="m" :value="m" />
                </datalist>
              </label>
              <label class="msk__field msk__field--check">
                <input v-model="runtimeCfg.enabled" type="checkbox" />
                <span>启用路由覆盖</span>
              </label>
              <p v-if="effectiveLlmNote" class="msk__effective">{{ effectiveLlmNote }}</p>
              <!-- 重试与超时（网关三层预算的 Skill 级覆盖） -->
              <div class="msk__field-grid">
                <label class="msk__field">
                  <span>逻辑重试（0-2）</span>
                  <input v-model.number="runtimeCfg.maxLogicalRetries" type="number" min="0" max="2" step="1" class="msk__input" placeholder="继承平台" />
                </label>
                <label class="msk__field">
                  <span>超时秒（10-300）</span>
                  <input v-model.number="runtimeCfg.timeoutSec" type="number" min="10" max="300" step="10" class="msk__input" placeholder="继承平台" />
                </label>
              </div>
              <p class="msk__budget">平台预算 <em class="mono">{{ platformBudget }}</em></p>
              <div class="msk__actions">
                <button type="button" class="mk-btn mk-btn--primary" :disabled="cfgBusy" @click="saveCfg">
                  {{ cfgBusy ? '保存中…' : '保存配置' }}
                </button>
                <button
                  v-if="runtimeCfg.hasSkillOverride"
                  type="button"
                  class="mk-btn msk__btn-danger"
                  :disabled="cfgBusy"
                  @click="deleteCfg"
                >
                  删除独立配置
                </button>
              </div>
              <p v-if="cfgMsg" class="msk__msg" :class="{ 'msk__msg--err': cfgErr }">{{ cfgMsg }}</p>
            </div>
            <p v-else class="msk__none">{{ cfgErr ? cfgMsg : '配置加载中…' }}</p>
          </section>

          <!-- 试跑（live：对齐生产 testSkill 预览） -->
          <section v-if="skillProfile && isLive" class="msk__section">
            <header class="msk__sec-head">
              <h4>试跑</h4>
            </header>
            <textarea v-model="testInput" class="msk__test-input mono" rows="3" placeholder='{"input": "测试输入"}'></textarea>
            <div class="msk__actions">
              <button type="button" class="mk-btn mk-btn--primary" :disabled="testBusy" @click="runTest">
                {{ testBusy ? '运行中…' : '运行测试' }}
              </button>
            </div>
            <pre v-if="testResult" class="msk__code" :class="{ 'msk__code--err': testError }">{{ testResult }}</pre>
          </section>
          </template>

          <!-- ========== Prompt ========== -->
          <template v-if="activeTab === 'prompt'">
          <section v-if="skillProfile" class="msk__section">
            <header class="msk__sec-head">
              <h4>{{ isLive ? '生效 Prompt' : 'Prompt 版本' }}</h4>
              <span class="msk__sec-meta">
                <span class="mono">{{ liveMeta?.promptVersion || skillProfile.promptVersion || '默认' }}</span>
              </span>
            </header>
            <pre v-if="liveMeta?.effectivePrompt" class="msk__code msk__code--cap">{{ liveMeta.effectivePrompt }}</pre>
            <div class="msk__prompt">
              <span class="mono">{{ liveMeta?.promptVersion || skillProfile.promptVersion || '默认' }}</span>
              <button type="button" class="mk-link" @click="goPromptLab">编辑协议 / 发布 →</button>
            </div>
            <div v-if="isLive && promptVersions.length" class="msk__versions">
              <span class="msk__versions-label">历史版本（可与生效版对比）</span>
              <p v-if="versionMsg" class="msk__versions-msg" :class="{ 'is-err': versionErr }">{{ versionMsg }}</p>
              <div v-for="v in promptVersions" :key="v.id" class="msk__version-row">
                <span class="msk__version-tag mono">v{{ v.version }}</span>
                <span class="msk__version-status">
                  <span class="mk-badge" :class="v.status === 'ACTIVE' ? 'mk-badge--ok' : 'mk-badge--muted'">
                    {{ v.status }}
                  </span>
                </span>
                <span class="msk__version-name" :title="v.name">{{ v.name }}</span>
                <span class="msk__version-ops">
                  <button
                    v-if="v.status !== 'ACTIVE'"
                    type="button"
                    class="msk__op"
                    :disabled="versionBusy === v.id"
                    @click="compareWithActive(v)"
                  >
                    {{ compareLoading === v.id ? '…' : '对比' }}
                  </button>
                  <span v-if="v.status === 'ACTIVE'" class="msk__op is-active">当前生效</span>
                </span>
              </div>

              <!-- 与生效版对比结果 -->
              <div v-if="compareResult" class="msk__diff">
                <div class="msk__diff-head">
                  <span class="mono">{{ compareResult.aLabel }} ↔ {{ compareResult.bLabel }}</span>
                  <span class="msk__diff-count" :class="{ 'is-clean': compareResult.changedLines === 0 }">
                    {{ compareResult.changedLines ? `${compareResult.changedLines} 行变更` : '内容一致' }}
                  </span>
                  <button type="button" class="msk__op" @click="compareResult = null">收起</button>
                </div>
                <div class="msk__diff-body mono">
                  <template v-for="(grp, gi) in compareResult.groups" :key="gi">
                    <div v-if="grp.gap" class="msk__diff-gap">…</div>
                    <div
                      v-for="(line, li) in grp.lines"
                      :key="li"
                      class="msk__diff-line"
                      :class="`is-${line.type}`"
                    >
                      <span class="msk__diff-no">{{ line.no }}</span>
                      <span class="msk__diff-text">{{ line.text }}</span>
                    </div>
                  </template>
                </div>
              </div>
            </div>
          </section>

          <section v-if="skillProfile && isLive" class="msk__section msk__section--actions">
            <button type="button" class="msk__primary-link" @click="goFullEditor">打开 Prompt 设计页 →</button>
            <p class="msk__none">设计页统一承接：协议（core 编辑/发布）、Prompt 检视、试跑、运行时与工程视图；抽屉保留只读速览。</p>
          </section>
          </template>

          <!-- ========== 协议 ========== -->
          <template v-if="activeTab === 'rules'">
          <section class="msk__section">
            <header class="msk__sec-head">
              <h4>协议规则</h4>
              <span v-if="agentRules.length" class="msk__sec-meta mono">{{ agentRules.length }} 条</span>
            </header>
            <p v-if="protocolLoading" class="msk__none">加载协议与规则…</p>
            <template v-else>
              <!-- 本节点规则 -->
              <div v-if="agentRules.length" class="msk__rules">
                <div v-for="r in agentRules" :key="r.ruleId + r.text.slice(0, 8)" class="msk__rule">
                  <span class="msk__rule-id mono">{{ r.ruleId }}</span>
                  <span class="msk__rule-text">{{ r.text }}</span>
                </div>
              </div>
              <p v-else class="msk__none">本节点没有登记规则。</p>
              <p v-if="conflictNote" class="msk__conflict">⚠ {{ conflictNote }}</p>
              <!-- 协议视图 -->
              <div v-if="protocols.length" class="msk__protocols">
                <div v-for="p in protocols" :key="p.id" class="msk__protocol">
                  <div class="msk__protocol-head">
                    <strong>{{ p.title }}</strong>
                    <span class="mk-badge mk-badge--muted">{{ p.statusLabel }}</span>
                  </div>
                  <p>{{ p.summary }}</p>
                  <span class="msk__protocol-sites mono">{{ p.callSites }}</span>
                </div>
              </div>
            </template>
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
  skillProfiles,
  agentProfiles,
  skillsOfAgent,
  skillStatOf,
  recentSpansOf,
  openTrace,
  openSkillDrawer,
  closeSkillDrawer,
  dataSource,
  AGENT_TONES
} from './store'
import { liveSkillProfiles, liveExtraProfiles, liveApiConfig, errMsg, fetchProtocolView, fetchRulesOverview, type LiveProtocol, type LiveRulesOverview, type LiveRule } from './live'
import { adminSkillWorkbenchApi, adminSkillsApi, adminAgentPromptsApi } from '@/api/adminApi'
import { askConfirm } from './useConfirm'
import { useEscape } from './useEscape'
import { useOverlay, useMaskClose } from './useOverlay'

useEscape(() => !!intent.skillDrawerId, closeSkillDrawer)

const panelRef = ref<HTMLElement | null>(null)
const maskRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => !!intent.skillDrawerId), panelRef)
useMaskClose(maskRef, closeSkillDrawer)

const router = useRouter()

const isLive = computed(() => dataSource.value === 'live')

const skillProfile = computed(() => {
  const id = intent.skillDrawerId
  // live 模式只认真实注册表（含外挂能力 Skill）：查不到即「未找到」，不静默回退 demo 档案
  if (isLive.value) {
    const live =
      liveSkillProfiles.value.find((p) => p.id === id) ||
      liveExtraProfiles.value.find((p) => p.id === id)
    if (live) {
      return { id: live.id, name: live.name, agentId: '', agentName: '', category: live.category, promptVersion: '', description: '' }
    }
    return null
  }
  return skillProfiles.find((p) => p.id === id) || null
})
const agentProfile = computed(() => agentProfiles.find((p) => p.id === intent.skillDrawerId) || null)
const entity = computed(() => skillProfile.value || agentProfile.value)

/* 身份色：与 Agent 拓扑同套阶段色（按所属 Agent 取色） */
const tone = computed(() => {
  const key = skillProfile.value ? skillProfile.value.agentId : intent.skillDrawerId
  return AGENT_TONES[key || ''] || { hue: '#2c63d0', soft: 'rgba(44, 99, 208, 0.1)' }
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

/* live：运行配置（读写，对齐生产 SkillRuntimeConfigPane） */
interface RuntimeCfg {
  model: string
  enabled: boolean
  hasSkillOverride: boolean
  maxLogicalRetries: number | null
  timeoutSec: number | null
}
const runtimeCfg = ref<RuntimeCfg | null>(null)
const cfgBusy = ref(false)
const cfgMsg = ref('')
const cfgErr = ref(false)

/** 平台预算（来自 workbench meta 的 reliability，只读展示） */
const platformReliability = ref<{ maxUpstreamAttempts?: number; maxTransportRetries?: number; maxLogicalRetries?: number; timeoutMs?: number } | null>(null)
const platformBudget = computed(() => {
  const r = platformReliability.value
  if (!r) return '—'
  const timeoutSec = r.timeoutMs ? Math.round(r.timeoutMs / 1000) : null
  return `上游 ×${r.maxUpstreamAttempts ?? '—'} · 传输 ×${r.maxTransportRetries ?? '—'} · 逻辑 ×${r.maxLogicalRetries ?? '—'}${timeoutSec ? ` · ${timeoutSec}s` : ''}`
})

const modelOptions = computed(() => liveApiConfig.value?.availableModels || [])

async function loadRuntimeCfg(id: string) {
  runtimeCfg.value = null
  try {
    const res = await adminSkillsApi.getSkillModelConfig(id)
    const c = res.data?.data ?? res.data ?? {}
    runtimeCfg.value = {
      model: c.model || '',
      enabled: c.enabled !== false,
      hasSkillOverride: !!(c.hasSkillOverride ?? c.id),
      maxLogicalRetries: c.maxLogicalRetries != null ? Number(c.maxLogicalRetries) : null,
      timeoutSec: c.requestTimeoutMs != null ? Math.round(Number(c.requestTimeoutMs) / 1000) : null
    }
  } catch (e) {
    const status = (e as { response?: { status?: number } })?.response?.status
    if (status === 404) {
      // 无独立配置：以继承默认值起步，保存即创建覆盖
      runtimeCfg.value = { model: '', enabled: true, hasSkillOverride: false, maxLogicalRetries: null, timeoutSec: null }
    } else {
      // 其他错误：提示用户，保持空态
      cfgErr.value = true
      cfgMsg.value = `配置加载失败：${errMsg(e)}`
    }
  }
}

async function saveCfg() {
  const id = intent.skillDrawerId
  if (!id || !runtimeCfg.value || cfgBusy.value) return
  cfgBusy.value = true
  cfgMsg.value = ''
  try {
    await adminSkillsApi.updateSkillModelConfig(id, {
      model: runtimeCfg.value.model || null,
      enabled: runtimeCfg.value.enabled,
      maxLogicalRetries: runtimeCfg.value.maxLogicalRetries,
      requestTimeoutMs: runtimeCfg.value.timeoutSec != null ? runtimeCfg.value.timeoutSec * 1000 : null
    })
    runtimeCfg.value.hasSkillOverride = true
    cfgErr.value = false
    cfgMsg.value = '已保存路由/可靠性（T/maxTokens 由 ACTIVE Prompt 管理）'
  } catch (e) {
    cfgErr.value = true
    cfgMsg.value = `保存失败：${errMsg(e)}`
  } finally {
    cfgBusy.value = false
  }
}

async function deleteCfg() {
  const id = intent.skillDrawerId
  if (!id || cfgBusy.value) return
  const ok = await askConfirm({
    title: '删除独立配置',
    message: '确定删除该 Skill 的独立运行配置吗？\n删除后将回退为继承 Agent / 平台默认。',
    confirmText: '删除'
  })
  if (!ok) return
  cfgBusy.value = true
  cfgMsg.value = ''
  try {
    await adminSkillsApi.deleteSkillModelConfig(id)
    await loadRuntimeCfg(id)
    cfgErr.value = false
    cfgMsg.value = '已删除独立配置，回退为继承'
  } catch (e) {
    cfgErr.value = true
    cfgMsg.value = `删除失败：${errMsg(e)}`
  } finally {
    cfgBusy.value = false
  }
}

/* live：试跑（对齐生产 testSkill） */
const testInput = ref('{\n  "input": "用一句话介绍你自己"\n}')
const testBusy = ref(false)
const testResult = ref('')
const testError = ref(false)

/* 页签：概览（健康）/ 运行（配置+试跑）/ Prompt（版本与生效内容）/ 协议 */
type DrawerTab = 'overview' | 'run' | 'prompt' | 'rules'
const activeTab = ref<DrawerTab>('overview')
const visibleTabs = computed<Array<{ key: DrawerTab; label: string; badge?: string; badgeCls?: string }>>(() => {
  const tabs: Array<{ key: DrawerTab; label: string; badge?: string; badgeCls?: string }> = [
    // 概览 badge：Agent 视图显示下辖 Skill 数；Skill 视图不挂 badge（失败数已由头部徽章 + 指标条展示）
    {
      key: 'overview',
      label: '概览',
      badge: !skillProfile.value && memberSkills.value.length ? String(memberSkills.value.length) : undefined,
      badgeCls: undefined
    }
  ]
  if (skillProfile.value && isLive.value) tabs.push({ key: 'run', label: '运行' })
  if (skillProfile.value) tabs.push({ key: 'prompt', label: 'Prompt' })
  if (isLive.value) tabs.push({ key: 'rules', label: '协议' })
  return tabs
})

function activateTab(key: DrawerTab) {
  activeTab.value = key
  if (key === 'rules') void ensureProtocolLoaded()
}

/* 协议规则：rules 页签首次激活时懒加载 */
const protocolLoading = ref(false)
const protocols = ref<LiveProtocol[]>([])
const rulesOverview = ref<LiveRulesOverview | null>(null)

const agentRules = computed(() => {
  if (!rulesOverview.value || !intent.skillDrawerId) return [] as LiveRule[]
  const full = `skill:${intent.skillDrawerId}`
  return rulesOverview.value.rules.filter((r) => r.agentId === full || r.agentId === intent.skillDrawerId)
})

const conflictNote = computed(() => {
  if (!rulesOverview.value) return ''
  // live.ts 的 conflictPrefixes 为 { prefix, agentIds }[]（每项带归属 Agent 列表）
  const prefixes = new Set(agentRules.value.map((r) => r.prefix))
  const hit = rulesOverview.value.conflictPrefixes.filter((p) => prefixes.has(p.prefix))
  if (!hit.length) return ''
  return `前缀冲突：${hit.map((p) => p.prefix).join('、')} 与其他节点的规则撞号，建议改名归并`
})

async function ensureProtocolLoaded() {
  if (protocols.value.length || protocolLoading.value) return
  protocolLoading.value = true
  try {
    const [pv, ro] = await Promise.all([fetchProtocolView(), fetchRulesOverview()])
    protocols.value = pv
    rulesOverview.value = ro
  } catch {
    protocols.value = []
  } finally {
    protocolLoading.value = false
  }
}

async function runTest() {
  const id = intent.skillDrawerId
  if (!id || testBusy.value) return
  testBusy.value = true
  testResult.value = ''
  testError.value = false
  try {
    let payload: unknown = {}
    try {
      payload = JSON.parse(testInput.value || '{}')
    } catch {
      payload = { input: testInput.value }
    }
    const res = await adminSkillsApi.testSkill(id, payload)
    const d = res.data?.data ?? res.data ?? {}
    testResult.value = typeof d === 'string' ? d : JSON.stringify(d.output ?? d.result ?? d, null, 2).slice(0, 2000)
  } catch (e) {
    testError.value = true
    testResult.value = `运行失败：${errMsg(e)}`
  } finally {
    testBusy.value = false
  }
}
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
const promptVersions = ref<Array<{ id: string; version: string | number; status: string; name: string }>>([])

/* Prompt 版本管理（发布/删除/与生效版对比） */
const versionBusy = ref('')
const compareLoading = ref('')
const versionMsg = ref('')
const versionErr = ref(false)
interface DiffLine { type: 'added' | 'removed'; no: number | string; text: string }
interface DiffGroup { gap: boolean; lines: DiffLine[] }
const compareResult = ref<{ aLabel: string; bLabel: string; changedLines: number; groups: DiffGroup[] } | null>(null)

/** 与当前 ACTIVE 版本做行级对比：modified 拆成删+增两行，连续变更分组，长同文段折叠为 … */
async function compareWithActive(v: { id: string; version: string | number; name: string }) {
  const active = promptVersions.value.find((x) => x.status === 'ACTIVE')
  if (!active) {
    versionMsg.value = '当前没有生效版本可作对比基准'
    versionErr.value = true
    return
  }
  if (compareLoading.value) return
  compareLoading.value = v.id
  versionMsg.value = ''
  versionErr.value = false
  try {
    const res = await adminAgentPromptsApi.comparePrompts(active.id, v.id)
    const d = res.data?.data ?? res.data ?? {}
    const diffs = (d.diffs || []) as Array<Record<string, unknown>>
    const groups: DiffGroup[] = []
    let current: DiffLine[] = []
    const flush = () => {
      if (current.length) {
        groups.push({ gap: groups.length > 0, lines: current })
        current = []
      }
    }
    for (const row of diffs) {
      const type = String(row.type)
      if (type === 'same') {
        flush()
        continue
      }
      if (type === 'added') {
        current.push({ type: 'added', no: Number(row.bLine || 0), text: String(row.bText ?? '') })
      } else if (type === 'removed') {
        current.push({ type: 'removed', no: Number(row.aLine || 0), text: String(row.aText ?? '') })
      } else if (type === 'modified') {
        current.push({ type: 'removed', no: Number(row.aLine || 0), text: String(row.aText ?? '') })
        current.push({ type: 'added', no: Number(row.bLine || 0), text: String(row.bText ?? '') })
      }
      if (current.length >= 240) {
        flush()
        break
      }
    }
    flush()
    compareResult.value = {
      aLabel: `v${active.version}（生效）`,
      bLabel: `v${v.version}`,
      changedLines: Number(d.changedLines || 0),
      groups
    }
  } catch (e) {
    versionMsg.value = `对比失败：${errMsg(e)}`
    versionErr.value = true
  } finally {
    compareLoading.value = ''
  }
}

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

const effectiveLlmNote = computed(() => {
  const m = liveMeta.value
  if (!m) return ''
  const t = m.llmTemperature != null ? m.llmTemperature : '—'
  const tok = m.llmMaxTokens != null ? m.llmMaxTokens : '—'
  const src =
    m.modelSource === 'active-prompt'
      ? 'ACTIVE Prompt（File-as-Truth）'
      : m.modelSource === 'route'
        ? '路由回退'
        : '未解析'
  return `生成参数（只读）：model=${m.model || '—'} · T=${t} · maxTokens=${tok} · 来源=${src}。改 T/maxTokens 请编辑 prompts/*.md 后同步，不在此表写入。`
})

watch(
  () => intent.skillDrawerId,
  async (id) => {
    liveMeta.value = null
    runtimeCfg.value = null
    platformReliability.value = null
    cfgMsg.value = ''
    testResult.value = ''
    activeTab.value = 'overview'
    promptVersions.value = []
    compareResult.value = null
    versionMsg.value = ''
    versionErr.value = false
    versionBusy.value = ''
    if (!id || !isLive.value || !skillProfile.value) return
    void loadRuntimeCfg(id)
    try {
      const [metaRes, promptRes, versionsRes] = await Promise.all([
        adminSkillWorkbenchApi.getMeta(id).catch(() => null),
        adminSkillsApi.getEffectiveSkillPrompt(id).catch(() => null),
        adminAgentPromptsApi.getPromptVersions({ agentId: id }).catch(() => null)
      ])
      const meta = metaRes?.data?.data ?? metaRes?.data ?? {}
      const promptBody = promptRes?.data?.data ?? promptRes?.data ?? {}
      const modelCfg = (meta.modelConfig || {}) as Record<string, unknown>
      const llmRequest = (modelCfg.llmRequest || {}) as Record<string, unknown>
      const parent = (meta.parentAgent || {}) as Record<string, unknown>
      const skill = (meta.skill || {}) as Record<string, unknown>
      const stats = (meta.stats || {}) as Record<string, unknown>
      // 平台重试预算（workbench meta reliability，只读展示）
      const rel = (modelCfg.reliability || {}) as Record<string, unknown>
      platformReliability.value = {
        maxUpstreamAttempts: rel.maxUpstreamAttempts != null ? Number(rel.maxUpstreamAttempts) : undefined,
        maxTransportRetries: rel.maxTransportRetries != null ? Number(rel.maxTransportRetries) : undefined,
        maxLogicalRetries: rel.maxLogicalRetries != null ? Number(rel.maxLogicalRetries) : undefined,
        timeoutMs: modelCfg.timeoutMs != null ? Number(modelCfg.timeoutMs) : undefined
      }
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
      const vBody = versionsRes?.data?.data ?? versionsRes?.data ?? []
      const vItems = Array.isArray(vBody) ? vBody : vBody.list || vBody.items || vBody.versions || []
      promptVersions.value = vItems.slice(0, 8).map((v: Record<string, unknown>) => ({
        id: String(v.id || ''),
        version: (v.version as string | number) ?? '—',
        status: String(v.status || '—'),
        name: String(v.name || '')
      }))
    } catch {
      liveMeta.value = null
    }
  },
  { immediate: true }
)

const memberSkills = computed(() => (agentProfile.value ? skillsOfAgent(agentProfile.value.id) : []))
const memberErrors = computed(() => memberSkills.value.filter((s) => skillStatOf(s.id).errors > 0).length)

/** 状态点可访问性文本 */
const memberDotLabel = (id: string) => {
  const st = skillStatOf(id)
  return st.errors ? '该 Skill 有失败' : st.calls ? '正常' : '无调用'
}
const statusDotLabel = (s: string) => (s === 'ok' ? '成功' : s === 'err' ? '失败' : '超时')

const stat = computed(() => {
  if (skillProfile.value) return skillStatOf(skillProfile.value.id)
  // Agent：聚合下辖 Skill 的统计
  const members = memberSkills.value.map((s) => skillStatOf(s.id))
  const calls = members.reduce((a, m) => a + m.calls, 0)
  const errors = members.reduce((a, m) => a + m.errors, 0)
  const avgMs = calls ? Math.round(members.reduce((a, m) => a + m.avgMs * m.calls, 0) / calls) : 0
  return { calls, errors, avgMs, lastAt: calls ? '刚刚' : '从未' }
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
  background: rgba(240, 242, 245, 0.8);
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
.msk__sec-head--btn {
  width: 100%;
  border: 0;
  background: transparent;
  padding: 2px 0;
  font: inherit;
  cursor: pointer;
  text-align: left;
  border-radius: 6px;
}
.msk__sec-head--btn:hover h4 { color: #5b6577; }
.msk__sec-meta {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  color: var(--mk-faint);
  font-weight: 600;
}
.msk__chev {
  width: 9px;
  height: 9px;
  transition: transform 0.15s ease;
}
.msk__chev.is-open { transform: rotate(90deg); }
.msk__src-chip {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--mk-faint);
  padding: 2px 8px;
  border-radius: 999px;
  background: #f0f2f5;
}
.msk__src-chip--custom { color: #1f57cc; background: #eff6ff; }

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
  background: #fff;
  display: grid;
  place-content: center;
  gap: 8px;
  text-align: center;
  padding: 24px;
}
.msk__notfound strong { font-size: 14px; color: #223252; }
.msk__notfound span { font-size: 12.5px; color: var(--mk-faint); }

/* 运行配置卡片 */
.msk__card {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  background: #f8fafd;
}
.msk__field { display: grid; gap: 4px; }
.msk__field > span { font-size: 12px; color: var(--mk-faint); font-weight: 600; }
.msk__field--check {
  display: flex;
  align-items: center;
  gap: 8px;
}
.msk__field--check span { font-size: 12px; color: #5b6577; font-weight: 600; }
.msk__field--check input { width: 15px; height: 15px; accent-color: #2c63d0; }
.msk__field-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.msk__input {
  padding: 7px 10px;
  border: 1px solid #dbe3ef;
  border-radius: 8px;
  font: inherit;
  font-size: 12px;
  color: #1a2a44;
  background: #fff;
  width: 100%;
}
.msk__input:focus { outline: none; border-color: #2c63d0; }
.msk__effective {
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: #eef4fc;
  border: 1px solid #dbe7f6;
  font-size: 12px;
  color: #5b6577;
  line-height: 1.5;
}
.msk__budget {
  margin: 0;
  font-size: 12.5px;
  color: var(--mk-faint);
  font-weight: 600;
}
.msk__budget em { font-style: normal; font-weight: 400; color: #5b6577; }
.msk__actions { display: flex; gap: 8px; align-items: center; }
/* 危险色修饰（复用 mk-btn 基础；实心红与确认对话框 danger 一致） */
.msk__btn-danger {
  border: 1px solid var(--mk-red);
  background: var(--mk-red);
  color: #fff;
}
.msk__btn-danger:hover { background: var(--mk-red-strong); border-color: var(--mk-red-strong); }
.msk__msg { margin: 0; font-size: 12.5px; color: var(--mk-green); font-weight: 600; }
.msk__msg--err { color: var(--mk-red); }

/* 试跑 */
.msk__test-input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--mk-line);
  border-radius: 9px;
  font-size: 12px;
  resize: vertical;
  line-height: 1.55;
}
.msk__test-input:focus { outline: none; border-color: #2c63d0; }

/* 代码井（Prompt 预览 / 试跑输出） */
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
.msk__code--err { color: #fca5a5; border-color: rgba(220, 38, 38, 0.4); }

/* 协议规则 */
.msk__rules { display: grid; gap: 6px; }
.msk__rule {
  display: grid;
  gap: 3px;
  padding: 7px 10px 7px 12px;
  border-left: 2px solid color-mix(in srgb, var(--mk-purple, #8d6bff) 45%, transparent);
  background: #faf9ff;
  border-radius: 0 8px 8px 0;
  font-size: 12px;
}
.msk__rule-id { color: #7c3aed; font-size: 12.5px; font-weight: 700; white-space: nowrap; }
.msk__rule-text { color: #263950; line-height: 1.55; }
.msk__conflict {
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: #fff7ed;
  border: 1px solid rgba(180, 83, 9, 0.3);
  color: var(--mk-amber);
  font-size: 12.5px;
  font-weight: 600;
}
.msk__protocols { display: grid; gap: 6px; margin-top: 4px; }
.msk__protocol {
  border: 1px solid #e6ecf6;
  border-radius: 10px;
  padding: 9px 12px;
  display: grid;
  gap: 4px;
}
.msk__protocol-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.msk__protocol-head strong { font-size: 12px; font-weight: 600; color: #223252; }
.msk__protocol p { margin: 0; font-size: 12.5px; color: #5b6577; line-height: 1.6; }
.msk__protocol-sites { font-size: 12.5px; color: var(--mk-faint); word-break: break-all; }

/* Prompt 版本 */
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
  color: #2c63d0;
  font: inherit;
  font-weight: 700;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.msk__versions {
  display: grid;
  gap: 2px;
  margin-top: 4px;
}
.msk__versions-label {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--mk-faint);
  padding-bottom: 2px;
}
.msk__version-row {
  display: grid;
  grid-template-columns: 44px 64px 1fr auto;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  color: #5b6577;
  padding: 4px 0;
  border-bottom: 1px solid #f0f2f5;
}
.msk__version-row:last-child { border-bottom: none; }
.msk__version-tag {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 5px;
  background: #eef2fa;
  color: #41516e;
  font-size: 12.5px;
  width: fit-content;
}
.msk__version-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.msk__version-ops { display: flex; gap: 4px; }
.msk__op {
  border: 0;
  background: transparent;
  color: #2c63d0;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  padding: 2px 5px;
  border-radius: 5px;
  white-space: nowrap;
}
.msk__op:hover { background: #eff6ff; }
.msk__op:disabled { opacity: 0.5; cursor: not-allowed; }
.msk__op.is-active { color: var(--mk-green); cursor: default; }
.msk__op.is-active:hover { background: transparent; }
.msk__op--danger { color: var(--mk-red); }
.msk__op--danger:hover { background: var(--mk-red-bg); }
.msk__versions-msg { margin: 0; font-size: 12px; color: var(--mk-green); font-weight: 600; }
.msk__versions-msg.is-err { color: var(--mk-red); }

/* 版本对比 */
.msk__diff {
  margin-top: 8px;
  border: 1px solid var(--mk-line);
  border-radius: 10px;
  overflow: hidden;
}
.msk__diff-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  background: #f8fafd;
  border-bottom: 1px solid #eef2f8;
  font-size: 12.5px;
  color: #5b6577;
}
.msk__diff-head .mono { font-size: 12.5px; }
.msk__diff-count { font-weight: 700; color: var(--mk-amber); }
.msk__diff-count.is-clean { color: var(--mk-green); }
.msk__diff-head .msk__op { margin-left: auto; }
.msk__diff-body {
  max-height: 260px;
  overflow-y: auto;
  padding: 6px 0;
  font-size: 12.5px;
  line-height: 1.6;
}
.msk__diff-line {
  display: grid;
  grid-template-columns: 34px 1fr;
  gap: 8px;
  padding: 1px 10px;
}
.msk__diff-line.is-added { background: var(--mk-green-bg); }
.msk__diff-line.is-added .msk__diff-text { color: var(--mk-green); }
.msk__diff-line.is-added .msk__diff-no::after { content: '+'; color: var(--mk-green); margin-left: 3px; }
.msk__diff-line.is-removed { background: var(--mk-red-bg); }
.msk__diff-line.is-removed .msk__diff-text { color: var(--mk-red-strong); }
.msk__diff-line.is-removed .msk__diff-no::after { content: '−'; color: var(--mk-red-strong); margin-left: 3px; }
.msk__diff-no { color: var(--mk-faint); text-align: right; user-select: none; }
.msk__diff-text { white-space: pre-wrap; word-break: break-word; color: #41516e; }
.msk__diff-gap {
  padding: 2px 10px;
  color: #c3cede;
  user-select: none;
}

/* 底部主操作 */
.msk__section--actions { padding-top: 2px; }
.msk__primary-link {
  border: 1px solid rgba(44, 99, 208, 0.35);
  background: #eef5ff;
  color: #2c63d0;
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
  .msk__field > span { font-size: 13px; }
  .msk__input { font-size: 14px; }
  .msk__code { font-size: 12.5px; }
  .msk__msg { font-size: 13.5px; }
  .msk__rule { font-size: 14px; }
  .msk__rule-id { font-size: 12.5px; }
  .msk__conflict { font-size: 13.5px; }
  .msk__protocol p { font-size: 13.5px; }
  .msk__protocol-sites { font-size: 12.5px; }
  .msk__prompt { font-size: 13.5px; }
  .msk__budget { font-size: 12.5px; }
  .msk__version-tag { font-size: 12px; }
  .msk__version-row { font-size: 13px; }
  .msk__versions-label { font-size: 12.5px; }
  .msk__versions-msg { font-size: 13px; }
  .msk__op { font-size: 13px; }
  .msk__diff-head { font-size: 12.5px; }
  .msk__diff-body { font-size: 12.5px; }
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
  .msk__field > span { font-size: 15.5px; }
  .msk__input { font-size: 16.5px; }
  .msk__code { font-size: 15px; }
  .msk__msg { font-size: 16px; }
  .msk__rule { font-size: 16.5px; }
  .msk__rule-id { font-size: 15px; }
  .msk__conflict { font-size: 16px; }
  .msk__protocol p { font-size: 16px; }
  .msk__protocol-sites { font-size: 15px; }
  .msk__prompt { font-size: 16px; }
  .msk__budget { font-size: 15px; }
  .msk__version-tag { font-size: 14px; }
  .msk__version-row { font-size: 15.5px; }
  .msk__versions-label { font-size: 15px; }
  .msk__versions-msg { font-size: 15.5px; }
  .msk__op { font-size: 15.5px; }
  .msk__diff-head { font-size: 15px; }
  .msk__diff-body { font-size: 15px; }
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
  .msk__field > span { font-size: 18px; }
  .msk__input { font-size: 19.5px; }
  .msk__code { font-size: 17.5px; }
  .msk__msg { font-size: 18.5px; }
  .msk__rule { font-size: 19.5px; }
  .msk__rule-id { font-size: 17.5px; }
  .msk__conflict { font-size: 18.5px; }
  .msk__protocol p { font-size: 18.5px; }
  .msk__protocol-sites { font-size: 17.5px; }
  .msk__prompt { font-size: 18.5px; }
  .msk__budget { font-size: 17.5px; }
  .msk__version-tag { font-size: 16.5px; }
  .msk__version-row { font-size: 18px; }
  .msk__versions-label { font-size: 17.5px; }
  .msk__versions-msg { font-size: 18px; }
  .msk__op { font-size: 18px; }
  .msk__diff-head { font-size: 17.5px; }
  .msk__diff-body { font-size: 17.5px; }
}
</style>
