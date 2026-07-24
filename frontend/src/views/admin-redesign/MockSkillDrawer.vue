<template>
  <Teleport to="body">
    <div v-if="entity" class="msk" @mousedown.self="closeSkillDrawer">
      <aside class="msk__panel" role="dialog" aria-label="详情">
        <header class="msk__head">
          <div class="msk__title">
            <span class="mk-badge" :class="stat.errors ? 'mk-badge--bad' : 'mk-badge--ok'">
              {{ stat.errors ? `${stat.errors} 次失败` : '健康' }}
            </span>
            <h3>{{ entity.name }}</h3>
            <span class="msk__id">{{ entity.id }}</span>
          </div>
          <button type="button" class="msk__close" aria-label="关闭" @click="closeSkillDrawer">✕</button>
        </header>

        <div class="msk__body">
          <p class="msk__desc">{{ entity.description }}</p>

          <div class="msk__meta">
            <template v-if="skillProfile">
              <div><span>所属</span><strong>{{ liveMeta?.agentName || skillProfile.agentName || '—' }}</strong></div>
              <div><span>类别</span><strong>{{ liveMeta?.category || skillProfile.category || '—' }}</strong></div>
              <div><span>模型</span><strong class="mono">{{ liveMeta?.model || skillProfile.promptVersion || '默认' }}</strong></div>
            </template>
            <template v-else>
              <div><span>类型</span><strong>Agent</strong></div>
              <div><span>下辖 Skill</span><strong>{{ memberSkills.length }} 个</strong></div>
              <div><span>异常 Skill</span><strong :class="{ 'is-bad-text': memberErrors > 0 }">{{ memberErrors }}</strong></div>
            </template>
          </div>

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
              <strong>{{ successRate }}</strong>
            </div>
            <div class="msk__stat">
              <span>平均耗时</span>
              <strong>{{ stat.calls ? fmtMs(stat.avgMs) : '—' }}</strong>
            </div>
          </div>

          <!-- Agent 视图：下辖 Skill 清单 -->
          <section v-if="!skillProfile && memberSkills.length" class="msk__section">
            <h4>下辖 Skill</h4>
            <div class="msk__spans">
              <button
                v-for="s in memberSkills"
                :key="s.id"
                type="button"
                class="msk__span"
                @click="openSkillDrawer(s.id)"
              >
                <span class="msk__span-dot" :class="skillStatOf(s.id).errors ? 'is-err' : skillStatOf(s.id).calls ? 'is-ok' : 'is-idle'"></span>
                <span class="msk__span-title">{{ s.name }}</span>
                <span class="msk__span-dur mono">{{ skillStatOf(s.id).calls || '—' }}</span>
                <span class="msk__span-trace mono">{{ s.id }}</span>
              </button>
            </div>
          </section>

          <section class="msk__section">
            <h4>最近调用</h4>
            <div v-if="recent.length" class="msk__spans">
              <button
                v-for="s in recent"
                :key="s.id"
                type="button"
                class="msk__span"
                @click="goTrace(s.traceId)"
              >
                <span class="msk__span-dot" :class="`is-${s.status}`"></span>
                <span class="msk__span-title">{{ s.title }}</span>
                <span class="msk__span-dur mono">{{ fmtMs(s.durationMs) }}</span>
                <span class="msk__span-trace mono">{{ s.traceId }}</span>
              </button>
            </div>
            <p v-else class="msk__none">近 60 条日志窗口内无调用（统计为全量口径）。</p>
          </section>

          <!-- 运行配置（live 可编辑：对齐生产 AgentEditor 运行时 tab） -->
          <section v-if="skillProfile && isLive" class="msk__section">
            <h4>
              运行配置
              <span class="msk__cfg-src" :class="{ 'msk__cfg-src--custom': runtimeCfg?.hasSkillOverride }">
                {{ runtimeCfg?.hasSkillOverride ? '独立配置' : '继承 Agent/平台' }}
              </span>
            </h4>
            <div v-if="runtimeCfg" class="msk__cfg">
              <label class="msk__cfg-field">
                <span>模型（留空 = 继承）</span>
                <input v-model="runtimeCfg.model" class="msk__cfg-input mono" list="msk-models" placeholder="继承" />
                <datalist id="msk-models">
                  <option v-for="m in modelOptions" :key="m" :value="m" />
                </datalist>
              </label>
              <div class="msk__cfg-row">
                <label class="msk__cfg-field">
                  <span>温度</span>
                  <input v-model.number="runtimeCfg.temperature" type="number" min="0" max="2" step="0.1" class="msk__cfg-input" />
                </label>
                <label class="msk__cfg-field">
                  <span>最大 Tokens</span>
                  <input v-model.number="runtimeCfg.maxTokens" type="number" min="32" step="32" class="msk__cfg-input" />
                </label>
                <label class="msk__cfg-field msk__cfg-field--check">
                  <span>启用</span>
                  <input v-model="runtimeCfg.enabled" type="checkbox" />
                </label>
              </div>
              <!-- 重试与超时（网关三层预算的 Skill 级覆盖） -->
              <div class="msk__cfg-row">
                <label class="msk__cfg-field">
                  <span>逻辑重试（0-2）</span>
                  <input v-model.number="runtimeCfg.maxLogicalRetries" type="number" min="0" max="2" step="1" class="msk__cfg-input" placeholder="继承平台" />
                </label>
                <label class="msk__cfg-field">
                  <span>超时秒（10-300）</span>
                  <input v-model.number="runtimeCfg.timeoutSec" type="number" min="10" max="300" step="10" class="msk__cfg-input" placeholder="继承平台" />
                </label>
                <div class="msk__cfg-budget">
                  <span>平台预算</span>
                  <em>{{ platformBudget }}</em>
                </div>
              </div>
              <div class="msk__cfg-actions">
                <button type="button" class="msk__cfg-save" :disabled="cfgBusy" @click="saveCfg">
                  {{ cfgBusy ? '保存中…' : '保存配置' }}
                </button>
                <button
                  v-if="runtimeCfg.hasSkillOverride"
                  type="button"
                  class="msk__cfg-del"
                  :disabled="cfgBusy"
                  @click="deleteCfg"
                >
                  删除独立配置
                </button>
              </div>
              <p v-if="cfgMsg" class="msk__cfg-msg" :class="{ 'msk__cfg-msg--err': cfgErr }">{{ cfgMsg }}</p>
            </div>
            <p v-else class="msk__none">配置加载中…</p>
          </section>

          <!-- 试跑（live：对齐生产 testSkill 预览） -->
          <section v-if="skillProfile && isLive" class="msk__section">
            <h4>试跑</h4>
            <textarea v-model="testInput" class="msk__test-input mono" rows="3" placeholder='{"input": "测试输入"}'></textarea>
            <div class="msk__cfg-actions">
              <button type="button" class="msk__cfg-save" :disabled="testBusy" @click="runTest">
                {{ testBusy ? '运行中…' : '运行测试' }}
              </button>
            </div>
            <pre v-if="testResult" class="msk__prompt-preview" :class="{ 'msk__prompt-preview--err': testError }">{{ testResult }}</pre>
          </section>

          <!-- 协议规则（对齐生产 AgentEditor 第 4 tab）：默认折叠，展开懒加载 -->
          <section v-if="isLive" class="msk__section">
            <button type="button" class="msk__fold" @click="toggleProtocol">
              <h4>协议规则</h4>
              <span class="msk__fold-hint">
                <span v-if="agentRules.length" class="mono">{{ agentRules.length }} 条本节点规则</span>
                {{ protocolOpen ? '收起 ▲' : '展开 ▼' }}
              </span>
            </button>
            <template v-if="protocolOpen">
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
            </template>
          </section>

          <!-- 生效 Prompt：参考内容置后，默认折叠 -->
          <section v-if="skillProfile" class="msk__section">
            <button type="button" class="msk__fold" @click="promptOpen = !promptOpen">
              <h4>{{ isLive ? '生效 Prompt' : 'Prompt 版本' }}</h4>
              <span class="msk__fold-hint">
                <span class="mono">{{ liveMeta?.promptVersion || skillProfile.promptVersion || '默认' }}</span>
                {{ promptOpen ? '收起 ▲' : '展开 ▼' }}
              </span>
            </button>
            <template v-if="promptOpen">
              <pre v-if="liveMeta?.effectivePrompt" class="msk__prompt-preview msk__prompt-preview--cap">{{ liveMeta.effectivePrompt }}</pre>
              <div class="msk__prompt">
                <span class="mono">{{ liveMeta?.promptVersion || skillProfile.promptVersion || '默认' }}</span>
                <button type="button" class="mk-link" @click="goPromptLab">去 Prompt Lab 检视 →</button>
              </div>
              <div v-if="isLive && promptVersions.length" class="msk__versions">
                <span class="msk__versions-label">历史版本</span>
                <div v-for="v in promptVersions" :key="v.id" class="msk__version-row">
                  <span class="mono">v{{ v.version }}</span>
                  <span>{{ v.status }}</span>
                  <span class="msk__version-name">{{ v.name }}</span>
                </div>
              </div>
            </template>
          </section>

          <section v-if="skillProfile && isLive" class="msk__section msk__section--actions">
            <button type="button" class="msk__primary-link" @click="goFullEditor">打开完整 Skill 编辑台 →</button>
            <p class="msk__none">版本发布、工程视图与完整预览在编辑台完成；抽屉保留运行配置与试跑。</p>
          </section>
        </div>
      </aside>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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
  dataSource
} from './mockStore'
import { liveSkillProfiles, liveExtraProfiles, liveApiConfig, errMsg, fetchProtocolView, fetchRulesOverview, type LiveProtocol, type LiveRulesOverview, type LiveRule } from './mockLive'
import { adminSkillWorkbenchApi, adminSkillsApi, adminAgentPromptsApi } from '@/api/adminApi'

const isLive = computed(() => dataSource.value === 'live')

const skillProfile = computed(() => {
  const id = intent.skillDrawerId
  const demo = skillProfiles.find((p) => p.id === id)
  if (demo) return demo
  // live 模式：真实注册表（含外挂能力 Skill，从外挂组件页跳入时）
  if (isLive.value) {
    const live =
      liveSkillProfiles.value.find((p) => p.id === id) ||
      liveExtraProfiles.value.find((p) => p.id === id)
    if (live) {
      return { id: live.id, name: live.name, agentId: '', agentName: '', category: live.category, promptVersion: '', description: '' }
    }
  }
  return null
})
const agentProfile = computed(() => agentProfiles.find((p) => p.id === intent.skillDrawerId) || null)
const entity = computed(() => skillProfile.value || agentProfile.value)

/* live：运行配置（读写，对齐生产 SkillRuntimeConfigPane） */
interface RuntimeCfg {
  model: string
  temperature: number
  maxTokens: number
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
      temperature: Number(c.temperature ?? 0.7),
      maxTokens: Number(c.maxTokens || 2048),
      enabled: c.enabled !== false,
      hasSkillOverride: !!(c.hasSkillOverride ?? c.id),
      maxLogicalRetries: c.maxLogicalRetries != null ? Number(c.maxLogicalRetries) : null,
      timeoutSec: c.requestTimeoutMs != null ? Math.round(Number(c.requestTimeoutMs) / 1000) : null
    }
  } catch {
    // 无独立配置：以继承默认值起步，保存即创建覆盖
    runtimeCfg.value = { model: '', temperature: 0.7, maxTokens: 2048, enabled: true, hasSkillOverride: false, maxLogicalRetries: null, timeoutSec: null }
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
      temperature: runtimeCfg.value.temperature,
      maxTokens: runtimeCfg.value.maxTokens,
      enabled: runtimeCfg.value.enabled,
      maxLogicalRetries: runtimeCfg.value.maxLogicalRetries,
      requestTimeoutMs: runtimeCfg.value.timeoutSec != null ? runtimeCfg.value.timeoutSec * 1000 : null
    })
    runtimeCfg.value.hasSkillOverride = true
    cfgErr.value = false
    cfgMsg.value = '已保存（真实写入）'
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
/** 生效 Prompt 默认折叠 */
const promptOpen = ref(false)

/* 协议规则：折叠区，首次展开时懒加载 */
const protocolOpen = ref(false)
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
  const prefixes = new Set(agentRules.value.map((r) => r.prefix))
  const hit = rulesOverview.value.conflictPrefixes.filter((p) => prefixes.has(p))
  if (hit.length) return `前缀冲突：${hit.join('、')} 与其他节点的规则撞号，建议改名归并`
  return rulesOverview.value.conflictPrefixCount > 0 ? '' : ''
})

function agentRulesReset() {
  // 换节点时保留缓存（rulesOverview/protocols 是全局数据），仅重置展开态
}

async function toggleProtocol() {
  protocolOpen.value = !protocolOpen.value
  if (!protocolOpen.value || protocols.value.length || protocolLoading.value) return
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
  promptVersion: string
  effectivePrompt: string
}
const liveMeta = ref<LiveMeta | null>(null)
const promptVersions = ref<Array<{ id: string; version: string | number; status: string; name: string }>>([])

watch(
  () => intent.skillDrawerId,
  async (id) => {
    liveMeta.value = null
    runtimeCfg.value = null
    cfgMsg.value = ''
    testResult.value = ''
    promptOpen.value = false
    protocolOpen.value = false
    promptVersions.value = []
    agentRulesReset()
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
      const parent = (meta.parentAgent || {}) as Record<string, unknown>
      const skill = (meta.skill || {}) as Record<string, unknown>
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
      liveMeta.value = {
        agentName: String(parent.name || parent.id || ''),
        category: String(skill.category || skillProfile.value?.category || ''),
        model: modelCfg.model ? String(modelCfg.model) : modelCfg.tier ? `档位 ${String(modelCfg.tier)}` : '',
        promptVersion: [version, promptName].filter(Boolean).join(' · '),
        effectivePrompt: String(prompt.systemPrompt || '').slice(0, 1200)
      }
      const vBody = versionsRes?.data?.data ?? versionsRes?.data ?? []
      const vItems = Array.isArray(vBody) ? vBody : vBody.items || vBody.versions || []
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
  closeSkillDrawer()
  intent.scene = 'prompt-lab'
}

function goFullEditor() {
  const id = skillProfile.value?.id
  if (!id) return
  closeSkillDrawer()
  window.open(`/admin/skills/${encodeURIComponent(id)}`, '_blank')
}
</script>

<style scoped>
.msk {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(15, 23, 42, 0.36);
  display: flex;
  justify-content: flex-end;
}
.msk__panel {
  width: min(440px, 100vw);
  height: 100%;
  background: #fff;
  box-shadow: -16px 0 48px rgba(15, 23, 42, 0.18);
  display: grid;
  grid-template-rows: auto 1fr;
  animation: msk-in 0.2s ease;
}
@keyframes msk-in {
  from { transform: translateX(30px); opacity: 0; }
}

.msk__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 16px 18px;
  border-bottom: 1px solid #e1e8f2;
}
.msk__title { display: grid; gap: 6px; justify-items: start; }
.msk__title h3 { margin: 0; font-size: 18px; }
.msk__id { font-family: 'JetBrains Mono', monospace; font-size: 11.5px; color: #8492ab; }
.msk__close {
  border: 0;
  background: #f0f2f5;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  cursor: pointer;
  color: #5b6577;
  font-size: 13px;
}

.msk__body { padding: 16px 18px; display: grid; gap: 16px; align-content: start; overflow-y: auto; }
.msk__desc { margin: 0; color: #5b6577; font-size: 13px; line-height: 1.6; }

.msk__meta {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.msk__meta > div { display: grid; gap: 2px; }
.msk__meta span { font-size: 11px; color: #8492ab; font-weight: 600; }
.msk__meta strong { font-size: 12.5px; }

.msk__stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.msk__stat {
  display: grid;
  gap: 2px;
  padding: 10px;
  border: 1px solid #e1e8f2;
  border-radius: 10px;
  text-align: center;
}
.msk__stat span { font-size: 10.5px; color: #8492ab; font-weight: 600; }
.msk__stat strong { font-size: 16px; font-variant-numeric: tabular-nums; }
.msk__stat strong.is-bad { color: #dc2626; }

.msk__section { display: grid; gap: 8px; }
.msk__section h4 {
  margin: 0;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #8492ab;
}

.msk__spans { display: grid; gap: 4px; }
.msk__span {
  display: grid;
  grid-template-columns: 10px 1fr auto auto;
  gap: 10px;
  align-items: center;
  padding: 8px 10px;
  border: 1px solid #e1e8f2;
  border-radius: 8px;
  background: #fff;
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.msk__span:hover { border-color: rgba(52, 120, 246, 0.35); }
.msk__span-dot { width: 8px; height: 8px; border-radius: 50%; }
.msk__span-dot.is-ok { background: #15803d; }
.msk__span-dot.is-warn { background: #b45309; }
.msk__span-dot.is-err { background: #dc2626; }
.msk__span-dot.is-idle { background: #c3cede; }
.is-bad-text { color: #dc2626; }
.msk__span-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.msk__span-dur { color: #5b6577; font-size: 11px; }
.msk__span-trace { color: #b45309; font-size: 11px; }
.mono { font-family: 'JetBrains Mono', monospace; }
.msk__none { margin: 0; color: #8492ab; font-size: 12.5px; }

/* 运行配置 */
.msk__cfg-src { font-size: 10px; font-weight: 700; color: #8492ab; text-transform: none; letter-spacing: 0; }
.msk__cfg-src--custom { color: var(--mk-blue, #3478f6); }
.msk__cfg { display: grid; gap: 10px; }
.msk__cfg-row { display: grid; grid-template-columns: 1fr 1fr auto; gap: 10px; }
.msk__cfg-field { display: grid; gap: 4px; }
.msk__cfg-field span { font-size: 11px; color: #8492ab; font-weight: 600; }
.msk__cfg-field--check { align-content: end; justify-items: start; }
.msk__cfg-field--check input { width: 16px; height: 16px; }
.msk__cfg-input {
  padding: 7px 10px;
  border: 1px solid #e1e8f2;
  border-radius: 8px;
  font: inherit;
  font-size: 12px;
  color: #1a2a44;
  background: #fff;
  width: 100%;
}
.msk__cfg-input:focus { outline: none; border-color: #3478f6; }
.msk__cfg-actions { display: flex; gap: 8px; align-items: center; }
.msk__cfg-save {
  padding: 7px 14px;
  border-radius: 8px;
  border: 0;
  background: #3478f6;
  color: #fff;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.msk__cfg-save:disabled { opacity: 0.6; cursor: not-allowed; }
.msk__cfg-del {
  padding: 7px 12px;
  border-radius: 8px;
  border: 1px solid rgba(220, 38, 38, 0.35);
  background: transparent;
  color: #dc2626;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.msk__cfg-msg { margin: 0; font-size: 12px; color: #15803d; font-weight: 600; }
.msk__cfg-msg--err { color: #dc2626; }
.msk__cfg-budget {
  display: grid;
  gap: 3px;
  align-content: end;
  padding-bottom: 2px;
}
.msk__cfg-budget span { font-size: 10.5px; color: #8492ab; font-weight: 700; }
.msk__cfg-budget em { font-style: normal; font-size: 10.5px; color: #5b6577; font-family: 'JetBrains Mono', monospace; }
.msk__test-input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #e1e8f2;
  border-radius: 8px;
  font-size: 11px;
  resize: vertical;
}
.msk__prompt-preview--err { color: #fca5a5; }

/* 生效 Prompt 折叠 */
.msk__fold {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  border: 0;
  background: transparent;
  padding: 0;
  font: inherit;
  cursor: pointer;
  text-align: left;
}
.msk__fold h4 { margin: 0; }
.msk__fold-hint {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: #8492ab;
  font-weight: 600;
}
.msk__prompt-preview--cap { max-height: 140px; }

/* 协议规则 */
.msk__rules { display: grid; gap: 6px; }
.msk__rule {
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding: 7px 10px;
  border: 1px solid #e1e8f2;
  border-radius: 8px;
  font-size: 12px;
}
.msk__rule-id { color: #8d6bff; font-size: 10.5px; font-weight: 700; white-space: nowrap; }
.msk__rule-text { color: #263950; line-height: 1.55; }
.msk__conflict {
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: #fff7ed;
  border: 1px solid rgba(180, 83, 9, 0.3);
  color: #b45309;
  font-size: 11.5px;
  font-weight: 600;
}
.msk__protocols { display: grid; gap: 6px; margin-top: 4px; }
.msk__protocol {
  border: 1px dashed #e1e8f2;
  border-radius: 8px;
  padding: 8px 10px;
  display: grid;
  gap: 4px;
}
.msk__protocol-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.msk__protocol-head strong { font-size: 12px; }
.msk__protocol p { margin: 0; font-size: 11.5px; color: #5b6577; line-height: 1.6; }
.msk__protocol-sites { font-size: 10px; color: #8492ab; word-break: break-all; }

.msk__prompt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border: 1px dashed #e1e8f2;
  border-radius: 8px;
}
.msk__prompt-preview {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: #0d1420;
  color: #8ba3c7;
  font: 10.5px/1.6 'JetBrains Mono', monospace;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 180px;
  overflow-y: auto;
}
.mk-link {
  border: 0;
  background: transparent;
  color: #3478f6;
  font: inherit;
  font-weight: 700;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.msk__versions {
  display: grid;
  gap: 4px;
  margin-top: 8px;
}
.msk__versions-label {
  font-size: 11px;
  font-weight: 700;
  color: #8492ab;
}
.msk__version-row {
  display: grid;
  grid-template-columns: 48px 72px 1fr;
  gap: 8px;
  font-size: 11px;
  color: #5b6577;
  padding: 4px 0;
  border-bottom: 1px solid #f0f2f5;
}
.msk__version-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.msk__section--actions {
  padding-top: 4px;
}
.msk__primary-link {
  border: 1px solid rgba(52, 120, 246, 0.35);
  background: #eef5ff;
  color: #3478f6;
  font: inherit;
  font-weight: 700;
  font-size: 12.5px;
  padding: 9px 12px;
  border-radius: 8px;
  cursor: pointer;
  width: 100%;
  text-align: left;
}
.msk__primary-link:hover {
  background: #e0edff;
}
</style>
