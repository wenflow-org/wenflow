<template>
  <Teleport to="body">
    <div v-if="entity" class="mk-drawer">
      <div ref="maskRef" class="mk-drawer__mask" @click="closeSkillDrawer"></div>
      <aside ref="panelRef" class="mk-drawer__panel msk__panel" role="dialog" aria-label="详情">
        <!-- 头部：身份区（阶段色 + 类别图标 + 状态 chips） -->
        <header class="mk-drawer__head msk__head" :style="{ '--hue': tone.hue, '--soft': tone.soft }">
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
              <h3 class="mk-drawer__title">{{ entity.name }}</h3>
              <span class="mk-drawer__sub msk__id mono">{{ entity.id }}</span>
            </div>
            <button type="button" class="mk-drawer__close" aria-label="关闭" @click="closeSkillDrawer">✕</button>
          </div>
          <div class="msk__chips">
            <!-- 健康三分态与列表 healthLabel 对齐：异常 / 空闲（0 调用）/ 健康；
                 calls=0 曾恒显绿色「健康」，把从未调用说成运行良好 -->
            <span class="mk-badge" :class="healthBadge.cls" :title="healthBadge.title">{{ healthBadge.text }}</span>
            <template v-if="skillProfile">
              <span class="mk-badge mk-badge--muted">{{ categoryLabel }}</span>
              <span class="mk-badge mk-badge--muted">{{ liveMeta?.agentName || skillProfile.agentName || '—' }}</span>
            </template>
          </div>
          <p v-if="entity.description" class="msk__desc" :title="entity.description">{{ entity.description }}</p>
        </header>

        <!-- 页签：概览 / Prompt / 模型配置 / 模型测试
             （只读速览；prompt 编辑统一在 Prompt 设计页，模型路由配置与探测允许抽屉内联） -->
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

        <div class="mk-drawer__body msk__body">
          <!-- ========== 概览（只读） ========== -->
          <template v-if="activeTab === 'overview'">          <!-- 指标条 -->
          <div class="msk__stats">
            <div class="msk__stat">
              <span>调用</span>
              <!-- 0 与未知必须分开：calls===0 显 0（下方有「暂无调用记录」说明），
                   只有数据缺失才显示 — -->
              <strong>{{ stat.calls }}</strong>
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
          <p v-if="!stat.calls" class="msk__note">该工具暂无调用记录，指标将在首次调用后生成。</p>
          <p v-if="skillProfile && statsSourceNote" class="msk__note">{{ statsSourceNote }}</p>

          <!-- 生效模型（skill 模式）：所属/类别已进头部 chips -->
          <div v-if="skillProfile" class="msk__kv">
            <span>生效模型</span>
            <strong class="mono">{{ liveMeta?.model || skillProfile.promptVersion || '默认' }}</strong>
            <em v-if="liveMeta?.modelSource" class="msk__src">{{ liveMeta.modelSource }}</em>
          </div>

          <section class="msk__section">
            <header class="mk-section__head">
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
                <!-- traceId 从裸列降级为 title：人话行只留标题/耗时，traceId 供跳转排查悬停/复制 -->
                <span class="msk__row-title" :title="`traceId：${s.traceId}`">{{ s.title }}</span>
                <span class="msk__row-num mono">{{ fmtMs(s.durationMs) }}</span>
              </button>
            </div>
            <p v-else class="msk__none">近 60 条日志窗口内无调用（统计为全量口径）。</p>
          </section>
          </template>

          <!-- ========== Prompt（只读：生效内容 + 设计页跳转） ========== -->
          <template v-if="activeTab === 'prompt'">
          <section v-if="skillProfile" class="msk__section">
            <header class="mk-section__head">
              <h4>生效 Prompt</h4>
              <span class="msk__sec-meta">
                <!-- meta 接口失败不再静默显示「默认」；加载中如实呈现（metaLoading 此前只赋值从未消费） -->
                <MkLoading v-if="metaLoading" text="生效版本加载中…" inline />
                <span v-else-if="metaFailed" title="生效版本 / Prompt 接口获取失败，版本信息不可用">版本获取失败</span>
                <span v-else class="mono">{{ liveMeta?.promptVersion || skillProfile.promptVersion || '默认' }}</span>
              </span>
            </header>
            <pre v-if="liveMeta?.effectivePrompt" class="msk__code msk__code--cap">{{ liveMeta.effectivePrompt }}</pre>
            <!-- 长提示词截断提示：抽屉只做只读速览，完整内容在设计页 -->
            <p v-if="promptTruncated" class="msk__none">已截断：仅显示前 1200 字（共 {{ liveMeta?.effectivePromptLen }} 字），完整内容请到设计页查看。</p>
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

          <!-- ========== 模型配置（抽屉内联表单，与 msk 风格统一；保存落库） ========== -->
          <template v-if="activeTab === 'runtime'">
          <section v-if="skillProfile" class="msk__section">
            <header class="mk-section__head">
              <h4>模型配置</h4>
              <span class="msk__sec-meta">{{ rtForm.enabled ? '独立路由' : '继承上层 / 平台默认' }}</span>
            </header>

            <!-- 独立配置开关 -->
            <label class="mt-row mt-row--check">
              <input v-model="rtForm.enabled" type="checkbox" />
              <span>独立配置<em>关闭 = 继承 Agent / 平台默认</em></span>
            </label>

            <!-- 模型与思考档 -->
            <div class="mt-fields">
              <label class="mt-field">
                <span>模型层级</span>
                <select v-model="rtForm.tier" class="mk-input" :disabled="!rtForm.enabled">
                  <option value="chat">chat</option>
                  <option value="reasoning">reasoning</option>
                </select>
              </label>
              <label class="mt-field">
                <span>模型<em class="mt-hint">Prompt 声明 model 时不生效</em></span>
                <input v-model="rtForm.model" class="mk-input mono" :disabled="!rtForm.enabled" placeholder="留空继承默认" spellcheck="false" title="仅当该 Skill 的 ACTIVE Prompt 未声明 model 时生效；生成参数（含 model）以 ACTIVE Prompt 为准" />
              </label>
              <label class="mt-field">
                <span>思考模式</span>
                <select v-model="rtForm.thinkingMode" class="mk-input" :disabled="!rtForm.enabled">
                  <option value="default">跟随继承值 / 模型默认</option>
                  <option value="enabled">开启</option>
                  <option value="disabled">关闭</option>
                </select>
              </label>
              <label class="mt-field">
                <span>思考强度</span>
                <select v-model="rtForm.reasoningEffort" class="mk-input" :disabled="!rtForm.enabled || rtForm.thinkingMode === 'disabled'">
                  <option value="default">跟随继承值 / 模型默认</option>
                  <option value="low">low</option>
                  <option value="high">high</option>
                  <option value="max">max</option>
                </select>
              </label>
            </div>

            <!-- 超时 -->
            <div class="mt-fields">
              <label class="mt-field">
                <span>请求超时（ms）</span>
                <input v-model.number="rtForm.requestTimeoutMs" type="number" min="10000" max="300000" step="10000" class="mk-input" :disabled="!rtForm.enabled" placeholder="继承" />
              </label>
            </div>

            <!-- 状态与操作 -->
            <p v-if="rtMsg" class="mt-rt-msg" :class="{ 'is-err': rtErr }">{{ rtMsg }}</p>
            <div class="mt-actions">
              <button type="button" class="mk-btn mt-btn--danger" :disabled="rtSaving" @click="resetRuntimeConfig">恢复默认</button>
              <button type="button" class="mk-btn" :disabled="rtSaving" @click="loadRuntimeConfig">刷新</button>
              <button type="button" class="mk-btn mk-btn--primary mk-btn--sm" :disabled="rtSaving" @click="saveRuntimeConfig">
                {{ rtSaving ? '保存中…' : '保存配置' }}
              </button>
            </div>
          </section>

          <p class="msk__none">说明：这里配置的是路由（endpoint / model / 超时 / 思考档），不改 prompt 内容。其中 model 仅当该 Skill 的 ACTIVE Prompt 未声明 model 时生效（生成参数以 ACTIVE Prompt 为准）；endpoint / 超时 / 思考档不受影响，可在「模型测试」tab 验证延迟。</p>
          </template>

          <!-- ========== 模型测试（只读探测：指定思考档直发上游，不落库不改配置） ========== -->
          <template v-if="activeTab === 'model-test'">
          <section v-if="skillProfile" class="msk__section">
            <header class="mk-section__head">
              <h4>模型测试</h4>
              <span class="msk__sec-meta">直发上游 · 不落库</span>
            </header>

            <!-- 档位选择：初始跟随当前生效配置，可临时覆盖 -->
            <div class="mt-fields">
              <label class="mt-field">
                <span>思考模式</span>
                <select v-model="probeForm.thinkingMode" class="mk-input">
                  <option value="default">跟随配置（{{ cfgThinkingLabel }}）</option>
                  <option value="enabled">开启</option>
                  <option value="disabled">关闭</option>
                </select>
              </label>
              <label class="mt-field">
                <span>思考强度</span>
                <select v-model="probeForm.reasoningEffort" class="mk-input" :disabled="probeForm.thinkingMode === 'disabled'">
                  <option value="default">跟随配置（{{ cfgEffortLabel }}）</option>
                  <option value="low">low</option>
                  <option value="high">high</option>
                  <option value="max">max</option>
                </select>
              </label>
            </div>

            <p v-if="probeResolved" class="mt-resolved mono">生效：{{ probeResolved.model }} · {{ probeResolved.thinkingMode }} / {{ probeResolved.reasoningEffort }}</p>

            <div class="mt-actions">
              <button type="button" class="mk-btn mk-btn--primary mk-btn--sm" :disabled="probeRunning" @click="runModelProbe">
                {{ probeRunning ? '探测中…（最长 180s）' : '开始探测' }}
              </button>
              <span v-if="probeError" class="mt-err">{{ probeError }}</span>
            </div>

            <!-- 结果卡 -->
            <div v-if="probeResult" class="mt-result" :class="probeResult.jsonOk === 'ok' ? 'is-ok' : 'is-bad'">
              <div class="mt-result__grid">
                <div class="mt-cell"><span>总耗时</span><strong class="mono">{{ fmtMs(probeResult.durationMs) }}</strong></div>
                <div class="mt-cell"><span>首字 TTFT</span><strong class="mono">{{ probeResult.ttftContentMs != null ? fmtMs(probeResult.ttftContentMs) : '—' }}</strong></div>
                <div class="mt-cell"><span>JSON</span><strong :class="probeResult.jsonOk === 'ok' ? 'is-ok' : 'is-bad'">{{ probeResult.jsonOk }}</strong></div>
                <div class="mt-cell"><span>输出字符</span><strong class="mono">{{ probeResult.contentChars }}</strong></div>
                <div class="mt-cell"><span>推理字符</span><strong class="mono">{{ probeResult.reasoningChars ?? 0 }}</strong></div>
                <div class="mt-cell"><span>completion</span><strong class="mono">{{ probeResult.completionTokens ?? '—' }}</strong></div>
                <div class="mt-cell"><span>reasoning tok</span><strong class="mono">{{ probeResult.reasoningTokens ?? 0 }}</strong></div>
                <div class="mt-cell"><span>finish</span><strong class="mono">{{ probeResult.finish || '—' }}</strong></div>
              </div>
              <pre v-if="probeResult.contentPreview" class="mt-preview mono">{{ probeResult.contentPreview }}</pre>
            </div>
          </section>

          <p class="msk__none">说明：探测用该 skill 的 ACTIVE prompt + 当前路由（含 skill_model_configs 覆盖）直发上游，测的是「改档位后真实延迟/JSON/token」，可先在此验证再保存配置。</p>
          </template>
        </div>
      </aside>
    </div>
    <!-- 未找到态：整层挂 .mk-drawer（fixed + 右对齐面板）并补遮罩；
         此前该分支无遮罩，点击背后页面可穿透操作 -->
    <div v-else-if="intent.skillDrawerId" class="mk-drawer">
      <div ref="maskRef" class="mk-drawer__mask" @click="closeSkillDrawer"></div>
      <div class="msk__notfound">
        <strong>未找到 Skill「{{ intent.skillDrawerId }}」</strong>
        <span>它可能未注册或 ID 有误。</span>
        <!-- 未找到态此前无任何出口（遮罩不覆盖该分支），补关闭按钮收起抽屉 -->
        <button type="button" class="mk-btn" @click="closeSkillDrawer">关闭</button>
      </div>
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
import MkLoading from '@/components/mk/MkLoading.vue'
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
    // agentId/agentName 透传 live 档案：此前硬编码 ''，头部阶段色 tone 恒落默认蓝、
    // agent 徽章也只能靠 meta 接口的 parentAgent 兜底
    return { id: live.id, name: live.name, agentId: live.agentId || '', agentName: live.agentName || '', category: live.category, promptVersion: '', description: '' }
  }
  return null
})
const entity = computed(() => skillProfile.value)

/* 宽屏「推挤式」抽屉已废弃（见 shared.css 说明）：抽屉打开只是浮层，不改页面布局。 */

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

/* 页签：概览（只读）/ Prompt（只读 + 设计页跳转）/ 模型配置（抽屉内联表单）/ 模型测试 */
type DrawerTab = 'overview' | 'prompt' | 'runtime' | 'model-test'
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
  if (skillProfile.value) tabs.push({ key: 'runtime', label: '模型配置' })
  if (skillProfile.value) tabs.push({ key: 'model-test', label: '模型测试' })
  return tabs
})

interface LiveMeta {
  agentName: string
  category: string
  model: string
  modelSource: string
  promptVersion: string
  effectivePrompt: string
  /** 截断前的完整长度：供「已截断」提示（effectivePrompt 固定 slice(0, 1200)） */
  effectivePromptLen: number
  llmTemperature: number | null
  llmMaxTokens: number | null
  statsSource: string
  statsRange: string
}
const liveMeta = ref<LiveMeta | null>(null)
const metaLoading = ref(false)
/** meta / effective-prompt 任一接口失败即置位：版本位不再静默显示「默认」误导用户 */
const metaFailed = ref(false)
/** 生效 Prompt 抽屉侧截断上限（slice(0, 1200)），超限即提示已截断 */
const promptTruncated = computed(() => (liveMeta.value?.effectivePromptLen ?? 0) > 1200)

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
    metaFailed.value = false
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
      const fullPrompt = String(prompt.systemPrompt || '')
      liveMeta.value = {
        agentName: String(parent.name || parent.id || ''),
        category: String(skill.category || skillProfile.value?.category || ''),
        model: llmModel || (modelCfg.tier ? `档位 ${String(modelCfg.tier)}` : ''),
        modelSource: String(llmRequest.source || modelCfg.source || ''),
        promptVersion: [version, promptName].filter(Boolean).join(' · '),
        effectivePrompt: fullPrompt.slice(0, 1200),
        effectivePromptLen: fullPrompt.length,
        llmTemperature: llmRequest.temperature != null ? Number(llmRequest.temperature) : null,
        llmMaxTokens: llmRequest.maxTokens != null ? Number(llmRequest.maxTokens) : null,
        statsSource: String(stats.source || ''),
        statsRange: String(stats.range || 'all')
      }
      // 两个接口都被 .catch(() => null) 吞错：任一缺失即如实上报失败
      metaFailed.value = !metaRes || !promptRes
    } catch {
      liveMeta.value = null
      metaFailed.value = true
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

/** 头部健康徽章三分态（与 Skills.vue healthLabel 对齐）：异常 / 空闲（0 调用）/ 健康 */
const healthBadge = computed<{ cls: string; text: string; title: string }>(() => {
  if (stat.value.errors > 0) {
    return { cls: 'mk-badge--bad', text: `${stat.value.errors} 次失败`, title: '窗口内存在失败调用' }
  }
  if (stat.value.calls === 0) {
    return { cls: 'mk-badge--muted', text: '空闲', title: '窗口内无调用（从未调用不等于健康）' }
  }
  return { cls: 'mk-badge--ok', text: '健康', title: '窗口内调用全部成功' }
})

const recent = computed(() => (entity.value ? recentSpansOf(entity.value.id) : []))

const successRate = computed(() => {
  if (!stat.value.calls) return '—'
  const r = ((stat.value.calls - stat.value.errors) / stat.value.calls) * 100
  return `${r.toFixed(1)}%`
})

const fmtMs = (ms: number | null | undefined) => (ms == null ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`)

/* ========== 模型配置（抽屉内联表单，skill_model_configs CRUD） ========== */
interface RtForm {
  enabled: boolean
  tier: 'chat' | 'reasoning'
  model: string
  thinkingMode: 'default' | 'enabled' | 'disabled'
  reasoningEffort: 'default' | 'low' | 'high' | 'max'
  requestTimeoutMs: number | null
}
const defaultRtForm = (): RtForm => ({
  enabled: false,
  tier: 'chat',
  model: '',
  thinkingMode: 'default',
  reasoningEffort: 'default',
  requestTimeoutMs: null,
})
const rtForm = ref<RtForm>(defaultRtForm())
const rtSaving = ref(false)
const rtMsg = ref('')
const rtErr = ref(false)

async function loadRuntimeConfig() {
  const id = intent.skillDrawerId
  if (!id) return
  rtMsg.value = ''
  rtErr.value = false
  try {
    const res = await adminSkillsApi.getSkillModelConfig(id)
    const raw = res.data?.data ?? res.data ?? {}
    rtForm.value = {
      enabled: raw?.enabled === true,
      tier: raw?.tier === 'reasoning' ? 'reasoning' : 'chat',
      model: raw?.model || '',
      thinkingMode: raw?.thinkingMode || 'default',
      reasoningEffort: raw?.reasoningEffort || 'default',
      requestTimeoutMs: raw?.requestTimeoutMs ?? null,
    }
  } catch {
    rtForm.value = defaultRtForm()
  }
}

async function saveRuntimeConfig() {
  const id = intent.skillDrawerId
  if (!id || rtSaving.value) return
  rtSaving.value = true
  rtMsg.value = ''
  rtErr.value = false
  try {
    await adminSkillsApi.updateSkillModelConfig(id, {
      tier: rtForm.value.tier,
      model: rtForm.value.model || undefined,
      thinkingMode: rtForm.value.thinkingMode,
      reasoningEffort: rtForm.value.thinkingMode === 'disabled' ? 'default' : rtForm.value.reasoningEffort,
      requestTimeoutMs: rtForm.value.enabled ? (rtForm.value.requestTimeoutMs ?? null) : null,
      enabled: rtForm.value.enabled,
    })
    rtErr.value = false
    rtMsg.value = '已保存（endpoint / 超时 / 思考档生效；model 以 ACTIVE Prompt 为准）'
    await loadRuntimeConfig()
  } catch (e) {
    rtErr.value = true
    rtMsg.value = `保存失败：${errMsg(e)}`
  } finally {
    rtSaving.value = false
  }
}

async function resetRuntimeConfig() {
  const id = intent.skillDrawerId
  if (!id || rtSaving.value) return
  rtSaving.value = true
  rtMsg.value = ''
  rtErr.value = false
  try {
    await adminSkillsApi.deleteSkillModelConfig(id)
    rtErr.value = false
    rtMsg.value = '已恢复默认（继承上层 / 平台）'
    await loadRuntimeConfig()
  } catch (e) {
    rtErr.value = true
    rtMsg.value = `恢复失败：${errMsg(e)}`
  } finally {
    rtSaving.value = false
  }
}

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

/* ========== 模型测试（model-probe） ========== */
interface ProbeForm {
  thinkingMode: 'default' | 'enabled' | 'disabled'
  reasoningEffort: 'default' | 'low' | 'high' | 'max'
}
interface ProbeResult {
  durationMs?: number
  ttftContentMs?: number | null
  ttftReasoningMs?: number | null
  contentChars?: number
  reasoningChars?: number
  completionTokens?: number | null
  reasoningTokens?: number | null
  promptTokens?: number | null
  finish?: string
  jsonOk?: string
  bracesBalanced?: boolean
  contentPreview?: string
}
const probeForm = ref<ProbeForm>({ thinkingMode: 'default', reasoningEffort: 'default' })
const cfgThinking = ref<'default' | 'enabled' | 'disabled'>('default')
const cfgEffort = ref<'default' | 'low' | 'high' | 'max'>('default')
const probeRunning = ref(false)
const probeError = ref('')
const probeResult = ref<(ProbeResult & { resolved?: { model?: string; thinkingMode?: string; reasoningEffort?: string } }) | null>(null)

const cfgThinkingLabel = computed(() =>
  cfgThinking.value === 'enabled' ? '开启' : cfgThinking.value === 'disabled' ? '关闭' : '继承/默认'
)
const cfgEffortLabel = computed(() => (cfgEffort.value === 'default' ? '继承/默认' : cfgEffort.value))
const probeResolved = computed(() => probeResult.value?.resolved || null)

/** 打开抽屉时同步当前生效思考档 + 配置表单（同一数据源，保证探测与配置一致） */
async function syncProbeConfig() {
  await loadRuntimeConfig()
  cfgThinking.value = rtForm.value.thinkingMode
  cfgEffort.value = rtForm.value.reasoningEffort
  // 探测表单默认「跟随配置」：显式重置为 inherit
  probeForm.value = { thinkingMode: 'default', reasoningEffort: 'default' }
}

async function runModelProbe() {
  const id = intent.skillDrawerId
  if (!id || !skillProfile.value || probeRunning.value) return
  probeRunning.value = true
  probeError.value = ''
  probeResult.value = null
  try {
    const res = await adminSkillsApi.modelProbe(id, {
      thinkingMode: probeForm.value.thinkingMode,
      reasoningEffort: probeForm.value.reasoningEffort,
    })
    const body = res.data?.data ?? res.data ?? {}
    if (body.thinkingMode !== 'default' && (body.thinkingMode as string) !== cfgThinking.value) {
      body.thinkingMode = probeForm.value.thinkingMode
    }
    probeResult.value = body
  } catch (e) {
    probeError.value = `探测失败：${errMsg(e)}`
  } finally {
    if (id === intent.skillDrawerId) probeRunning.value = false
  }
}

function errMsg(e: unknown): string {
  const a = e as { response?: { data?: { error?: { message?: string } | string } }; message?: string }
  if (a?.response?.data?.error) {
    const er = a.response.data.error
    return typeof er === 'string' ? er : er.message || '未知错误'
  }
  return a?.message || String(e)
}

/* 切换 skill 时重置/同步探测表单 */
watch(
  () => intent.skillDrawerId,
  (id) => {
    probeResult.value = null
    probeError.value = ''
    probeRunning.value = false
    rtMsg.value = ''
    if (id) void syncProbeConfig()
  },
  { immediate: true }
)
</script>

<style scoped>
/* ========== 面板：容器/遮罩/头/体/关闭按钮走 .mk-drawer 原语 ==========
   面板比原语多一行 tabs（头 / 页签 / 正文），故只覆写网格行。 */
.msk__panel { grid-template-rows: auto auto 1fr; }

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
  font-size: var(--mk-fs-micro);
  font-weight: 800;
  background: var(--mk-surface-2);
  color: var(--mk-faint);
  margin-left: 3px;
}
.msk__tab-badge.is-bad { background: var(--mk-red-bg); color: var(--mk-red); }
.mk-pill--active .msk__tab-badge { background: var(--mk-blue-bg-strong); color: var(--mk-accent-deep); }

/* ========== 头部身份区 ========== */
/* 身份台：内边距/底边/标题/副题/关闭按钮走 .mk-drawer 原语；此处只留页面私有的纵向网格 + 阶段色渐变 */
.msk__head {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 10px;
  min-width: 0;
  background: linear-gradient(180deg, var(--soft, rgba(44, 99, 208, 0.06)), rgba(255, 255, 255, 0) 90%);
}
.msk__id-row {
  display: flex;
  align-items: flex-start;
  gap: 11px;
}
.msk__icon {
  width: 38px;
  height: 38px;
  border-radius: var(--mk-radius-xl);
  background: var(--soft);
  color: var(--hue);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.msk__icon svg { width: 19px; height: 19px; }
.msk__titlebox { min-width: 0; flex: 1; padding-top: 1px; }
/* 长 id 任意断行：配合面板 min-width:0 / overflow:hidden 不撑宽（字号/颜色走 .mk-drawer__sub） */
.msk__id { display: block; margin-top: 2px; word-break: break-all; }

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
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ========== 正文：内边距/滚动走 .mk-drawer__body 原语；此处只补纵向排布 ========== */
.msk__body {
  display: grid;
  gap: 16px;
  align-content: start;
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
.msk__stat span { font-size: var(--mk-fs-micro); color: var(--mk-faint); font-weight: 600; }
.msk__stat strong {
  font-family: var(--mk-mono);
  font-size: var(--mk-fs-emphasis);
  font-weight: 600;
  color: var(--mk-ink);
  font-variant-numeric: tabular-nums;
}
.msk__stat strong.is-bad { color: var(--mk-red); }
.msk__stat strong.is-ok { color: var(--mk-green); }
.msk__stat strong.is-warn { color: var(--mk-amber); }
.msk__stat strong.is-na { color: var(--mk-faint); }
.msk__note { margin: -8px 0 0; font-size: var(--mk-fs-micro); color: var(--mk-faint); }

/* 生效模型 kv 行 */
.msk__kv {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 8px 12px;
  border: 1px dashed var(--mk-line);
  border-radius: var(--mk-radius-xl);
}
.msk__kv span { font-size: var(--mk-fs-micro); color: var(--mk-faint); font-weight: 600; }
.msk__kv strong { font-size: var(--mk-fs-micro); color: var(--mk-ink); font-weight: 600; }
.msk__src {
  margin-left: auto;
  font-size: var(--mk-fs-micro);
  font-style: normal;
  font-weight: 600;
  color: var(--mk-faint);
}

/* 小节系统 */
.msk__section { display: grid; gap: 8px; }
/* 区块头走 .mk-section__head（shared.css） */
.msk__sec-meta {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  font-weight: 600;
}

/* 行列表（下辖 Skill / 最近调用） */
.msk__list { display: grid; gap: 4px; }
.msk__row {
  display: grid;
  grid-template-columns: 8px 1fr auto;
  gap: 10px;
  align-items: center;
  padding: 8px 10px;
  border: 1px solid #e6ecf6;
  border-radius: var(--mk-radius-xl);
  background: var(--mk-surface);
  font: inherit;
  font-size: var(--mk-fs-micro);
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
.msk__row-num { color: var(--mk-muted); font-size: var(--mk-fs-micro); font-variant-numeric: tabular-nums; }
.msk__none { margin: 0; color: var(--mk-faint); font-size: var(--mk-fs-micro); }
.msk__notfound {
  width: var(--mk-drawer-w, 560px);
  max-width: 100vw;
  height: 100%;
  margin-left: auto;
  background: var(--mk-surface);
  display: grid;
  place-content: center;
  gap: 8px;
  text-align: center;
  padding: 24px;
}
.msk__notfound strong { font-size: var(--mk-fs-body); color: var(--mk-ink); }
.msk__notfound span { font-size: var(--mk-fs-micro); color: var(--mk-faint); }

/* 代码井（Prompt 预览） */
.msk__code {
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--mk-radius-xl);
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
  border-radius: var(--mk-radius-xl);
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
}
.mk-link {
  border: 0;
  background: transparent;
  color: var(--mk-blue, #2c63d0);
  font: inherit;
  font-weight: 700;
  font-size: var(--mk-fs-micro);
  cursor: pointer;
  white-space: nowrap;
}

/* 模型配置抽屉内联表单（与 msk 风格统一） */
.mt-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border: 1px solid #e6ecf6;
  border-radius: var(--mk-radius-xl);
  background: #fbfcfe;
  font-size: var(--mk-fs-micro);
  color: #41516e;
}
.mt-row--check input { width: 15px; height: 15px; accent-color: var(--mk-blue); }
.mt-row--check em { font-style: normal; font-weight: 400; color: var(--mk-faint); margin-left: 6px; }
.mt-rt-msg { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-green); font-weight: 600; }
.mt-rt-msg.is-err { color: var(--mk-red); }
.mt-btn--danger { color: var(--mk-red); border-color: rgba(220, 38, 38, 0.35); background: transparent; }
.mt-btn--danger:hover { background: var(--mk-red-bg); }
.mt-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

/* 底部主操作 */
.msk__section--actions { padding-top: 2px; }
.msk__primary-link {
  border: 1px solid rgba(44, 99, 208, 0.35);
  background: #eef5ff;
  color: var(--mk-blue, #2c63d0);
  font: inherit;
  font-weight: 700;
  font-size: var(--mk-fs-micro);
  padding: 10px 12px;
  border-radius: var(--mk-radius-xl);
  cursor: pointer;
  width: 100%;
  text-align: left;
}
.msk__primary-link:hover { background: #e0edff; }

/* ========== 模型测试（model-probe） ========== */
.mt-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.mt-field { display: grid; gap: 4px; }
.mt-field > span { font-size: var(--mk-fs-micro); color: var(--mk-faint); font-weight: 600; }
.mt-hint { font-style: normal; font-weight: 400; color: var(--mk-faint); font-size: var(--mk-fs-micro); margin-left: 5px; }
.mt-resolved {
  margin: 0;
  padding: 6px 10px;
  border-radius: var(--mk-radius-sm);
  background: #f2f6fd;
  border: 1px dashed #d3e0f5;
  font-size: var(--mk-fs-micro);
  color: #41516e;
}
.mt-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.mt-err { font-size: var(--mk-fs-micro); color: var(--mk-red); font-weight: 600; }
.mt-result {
  display: grid;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--mk-radius-xl);
  border: 1px solid var(--mk-line);
  background: var(--mk-surface);
}
.mt-result.is-ok { border-color: rgba(34, 197, 94, 0.35); }
.mt-result.is-bad { border-color: rgba(220, 38, 38, 0.35); }
.mt-result__grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.mt-cell { display: grid; gap: 2px; }
.mt-cell span { font-size: var(--mk-fs-micro); color: var(--mk-faint); font-weight: 600; }
.mt-cell strong {
  font-family: var(--mk-mono);
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  color: var(--mk-ink);
  font-variant-numeric: tabular-nums;
}
.mt-cell strong.is-ok { color: var(--mk-green); }
.mt-cell strong.is-bad { color: var(--mk-red); }
.mt-preview {
  margin: 0;
  padding: 8px 10px;
  border-radius: var(--mk-radius-sm);
  background: var(--mk-code-bg, #101826);
  border: 1px solid var(--mk-code-border, #1c2a40);
  color: var(--mk-code-fg, #9db8dc);
  font-size: var(--mk-fs-micro);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 160px;
  overflow-y: auto;
}


/* 4K：面板宽/头/体/关闭按钮由 .mk-drawer 全局档接管；此处只放大页面私有内容字号 */
@media (min-width: 2000px) {
  .msk__id { font-size: var(--mk-fs-micro); }
  .msk__tab-badge { font-size: var(--mk-fs-micro); }
  .msk__stat span { font-size: var(--mk-fs-micro); }
  .msk__stat strong { font-size: var(--mk-fs-emphasis); }
  .msk__row { font-size: var(--mk-fs-body); }
  .msk__row-num { font-size: var(--mk-fs-micro); }
  .msk__note { font-size: var(--mk-fs-micro); }
  .mk-section__head h4 { font-size: var(--mk-fs-micro); }
  .msk__sec-meta { font-size: var(--mk-fs-micro); }
  .msk__kv span { font-size: var(--mk-fs-micro); }
  .msk__code { font-size: var(--mk-fs-micro); }
  .msk__prompt { font-size: var(--mk-fs-micro); }
}
@media (min-width: 2800px) {
  .msk__id { font-size: var(--mk-fs-micro); }
  .msk__tab-badge { font-size: var(--mk-fs-micro); }
  .msk__stat span { font-size: var(--mk-fs-micro); }
  .msk__stat strong { font-size: var(--mk-fs-emphasis); }
  .msk__row { font-size: var(--mk-fs-body); }
  .msk__row-num { font-size: var(--mk-fs-micro); }
  .msk__note { font-size: var(--mk-fs-micro); }
  .mk-section__head h4 { font-size: var(--mk-fs-micro); }
  .msk__sec-meta { font-size: var(--mk-fs-micro); }
  .msk__kv span { font-size: var(--mk-fs-micro); }
  .msk__code { font-size: var(--mk-fs-micro); }
  .msk__prompt { font-size: var(--mk-fs-micro); }
}
@media (min-width: 3600px) {
  /* 4K（抽屉 Teleport 到 body，无 zoom）：字号继续放大（面板宽/头/体由 mk-drawer 全局档接管） */
  .msk__id { font-size: var(--mk-fs-body); }
  .msk__tab-badge { font-size: var(--mk-fs-body); }
  .msk__stat span { font-size: var(--mk-fs-body); }
  .msk__stat strong { font-size: 26px; }
  .msk__row { font-size: var(--mk-fs-emphasis); }
  .msk__row-num { font-size: var(--mk-fs-body); }
  .msk__note { font-size: var(--mk-fs-body); }
  .mk-section__head h4 { font-size: var(--mk-fs-body); }
  .msk__sec-meta { font-size: var(--mk-fs-body); }
  .msk__kv span { font-size: var(--mk-fs-body); }
  .msk__code { font-size: var(--mk-fs-body); }
  .msk__prompt { font-size: var(--mk-fs-emphasis); }
}

/* ================= 暗色模式（D1 补完）：Skill 抽屉 ================= */
html[data-theme='dark'] {
  /* 头部身份台渐变仅亮色生效；暗色回到面板表面色（面板底色由 .mk-drawer__panel 原语接管） */
  .msk__head { background: var(--mk-surface); }
  .msk__tab-badge { background: var(--mk-close-bg); }
  .mk-pill--active .msk__tab-badge { background: rgba(91, 141, 239, 0.22); color: var(--mk-ghost-fg); }
  .msk__row { background: #1b1c1d; border-color: #2a2b2d; }
  .msk__row:hover { background: #252627; }
  /* 补漏：指标条分隔线硬编码亮色 #eef2f8，暗色下过亮 */
  .msk__stat + .msk__stat { border-left-color: #2a2b2d; }
  .msk__primary-link:hover { background: rgba(91, 141, 239, 0.14); }
  .msk__section { background: #19191a; }
  .mt-result { background: #1b1c1d; border-color: #2a2b2d; }
  .mt-cell strong { color: var(--mk-ink, #e6edf7); }
  .mt-resolved { background: rgba(91, 141, 239, 0.1); border-color: rgba(91, 141, 239, 0.3); color: var(--mk-ink, #e6edf7); }
  .mt-row { background: #19191a; border-color: #2a2b2d; color: var(--mk-ink, #e6edf7); }
  .mt-row--check em { color: var(--mk-faint); }
  .mt-rt-msg { color: var(--mk-green); }
  /* 文字色补漏 */
  .msk__stat strong,
  .msk__kv strong,
  .msk__row-title { color: var(--mk-ink, #e6edf7); }
  .msk__desc,
  .msk__prompt,
  .msk__row-num { color: var(--mk-muted, #afb1b6); }
}
</style>
