<template>
  <!-- 工程：基础信息 / 运行时契约 / 协议视图 / Skill 规则总览（低频只读区块） -->
  <div class="sdp-pane">
    <section class="sdp-eng">
      <header class="mk-section__head"><h4>基础信息</h4></header>
      <table class="sdp-kv">
        <tbody>
          <tr><th title="kind">类型</th><td><code class="mono">{{ overview.kind }}</code></td></tr>
          <tr><th title="agentId">Agent 标识</th><td><code class="mono">{{ overview.agentId }}</code></td></tr>
          <tr v-if="overview.file"><th title="file.path">文件路径</th><td><code class="mono">{{ overview.file.path }}</code></td></tr>
          <tr v-if="overview.file?.hash"><th title="file.hash">文件哈希</th><td><code class="mono" :title="overview.file.hash">{{ shortHash(overview.file.hash) }}</code></td></tr>
          <tr v-if="overview.db?.id"><th title="db.id">生效记录 ID</th><td><code class="mono">{{ overview.db.id }}</code></td></tr>
          <tr v-if="overview.db?.version"><th title="db.version">生效版本</th><td><code class="mono">v{{ overview.db.version }}</code></td></tr>
          <!-- B19-F7-3：本行是生效 Prompt 版本记录自身的计数列（agent_prompts.useCount），
               与状态条按调用日志聚合的窗口统计口径不同；标签必须带限定词，否则同屏两个
               「调用次数」会被读成同一事实的两种值。 -->
          <tr v-if="overview.db?.useCount !== undefined">
            <th title="agent_prompts.useCount">本版本累计调用</th>
            <td :title="`生效 Prompt 记录 v${overview.db?.version ?? '?'} 自身的调用计数；与状态条的调用日志窗口统计口径不同`">{{ overview.db.useCount }}</td>
          </tr>
          <tr v-if="overview.db?.model"><th>默认模型</th><td><code class="mono">{{ overview.db.model }}</code></td></tr>
          <tr v-if="overview.db?.publishedAt"><th>发布时间</th><td>{{ fmtTime(String(overview.db.publishedAt)) }}</td></tr>
          <tr v-if="overview.drift">
            <th>漂移状态</th>
            <td>
              <code class="mono" :class="overview.drift === 'in-sync' ? 'sdp-ok' : 'sdp-warn'">{{ driftLabel(overview.drift) }}</code>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="overview.runtimeContract" class="sdp-eng">
      <header class="mk-section__head">
        <h4>运行时契约</h4>
        <span class="sdp-sec-meta mono">{{ overview.runtimeContractSource === 'manifest' ? 'prompts/manifests' : 'buildDefaultRuntimeContract' }}</span>
      </header>
      <table class="sdp-kv">
        <tbody>
          <tr><th title="version">契约版本</th><td><code class="mono">{{ overview.runtimeContract.version }}</code></td></tr>
          <tr><th title="contextMode">上下文模式</th><td><code class="mono">{{ overview.runtimeContract.contextMode }}</code></td></tr>
          <tr v-if="overview.runtimeContract.businessState?.domain"><th title="domain">业务域</th><td><code class="mono">{{ overview.runtimeContract.businessState.domain }}</code></td></tr>
          <tr v-if="overview.runtimeContract.businessState?.phases"><th title="phases">阶段集合</th><td><code class="mono">{{ overview.runtimeContract.businessState.phases.join(', ') }}</code></td></tr>
          <tr v-if="overview.runtimeContract.businessState?.defaultPhase"><th title="defaultPhase">默认阶段</th><td><code class="mono">{{ overview.runtimeContract.businessState.defaultPhase }}</code></td></tr>
          <tr v-if="overview.runtimeContract.businessState?.terminalPhases"><th title="terminalPhases">终止阶段</th><td><code class="mono">{{ overview.runtimeContract.businessState.terminalPhases.join(', ') }}</code></td></tr>
          <tr v-if="overview.runtimeContract.contextUpdate?.mode"><th title="contextUpdate.mode">上下文更新模式</th><td><code class="mono">{{ overview.runtimeContract.contextUpdate.mode }}</code></td></tr>
          <tr><th title="outputEnvelope">输出封装</th><td><code class="mono">{{ overview.runtimeContract.outputEnvelope }}</code></td></tr>
        </tbody>
      </table>
    </section>

    <section class="sdp-eng">
      <header class="mk-section__head">
        <h4>协议视图</h4>
        <span class="sdp-sec-meta">{{ protocols.length ? `${protocols.length} 组协议` : '' }}</span>
      </header>
      <!-- #116 三态互斥：加载中 / 失败 / 空。此前 engLoaded 只是普通变量、无 loading ref，
           「暂无协议数据」在数据到达前就渲染，把「加载中」当「没有」呈现给用户 -->
      <p v-if="engLoading" class="sdp-none"><MkLoading inline text="协议数据加载中…" /></p>
      <div v-else-if="protocols.length" class="sdp-protocols">
        <article v-for="p in protocols" :key="p.id" class="sdp-protocol">
          <header>
            <strong>{{ p.title }}</strong>
            <span class="mk-badge mk-badge--muted">{{ p.statusLabel }}</span>
          </header>
          <p>{{ p.summary }}</p>
          <span class="sdp-protocol__sites mono">{{ p.callSites }}</span>
        </article>
      </div>
      <p v-else-if="engProtoFailed" class="sdp-none sdp-bad-text">协议数据加载失败。<button type="button" class="mk-link" @click="retryEngineering">重试</button></p>
      <p v-else class="sdp-none">暂无协议数据。</p>
    </section>

    <section class="sdp-eng">
      <header class="mk-section__head">
        <h4>Skill 规则总览</h4>
        <span class="sdp-sec-meta" v-if="rulesOverview?.summary">
          {{ rulesOverview.summary.totalRules ?? 0 }} 规则 · {{ rulesOverview.summary.totalPrefixes ?? 0 }} 前缀
          <template v-if="(rulesOverview.summary.conflictPrefixCount ?? 0) > 0">
            · <b class="sdp-warn">{{ rulesOverview.summary.conflictPrefixCount }} 冲突</b>
          </template>
        </span>
      </header>
      <div v-if="rulesOverview?.conflictPrefixes?.length" class="sdp-conflict">
        <strong>prefix 冲突：</strong>
        <span v-for="c in rulesOverview.conflictPrefixes" :key="c.prefix">
          <code class="mono">{{ c.prefix }}</code> 同时被 <code class="mono">{{ c.agentIds.join(', ') }}</code> 使用
        </span>
      </div>
      <p v-if="engLoading" class="sdp-none"><MkLoading inline text="规则数据加载中…" /></p>
      <div v-else-if="nodeRules.length" class="sdp-rules">
        <div v-for="r in nodeRules" :key="r.ruleId" class="sdp-rule">
          <span class="sdp-rule__id mono">{{ r.ruleId }}</span>
          <span class="sdp-rule__text">{{ r.text }}</span>
        </div>
      </div>
      <p v-else-if="engRulesFailed" class="sdp-none sdp-bad-text">规则数据加载失败。<button type="button" class="mk-link" @click="retryEngineering">重试</button></p>
      <p v-else class="sdp-none">本节点没有登记规则。</p>
    </section>
  </div>
</template>

<script setup lang="ts">
/**
 * 工程 tab：基础信息 kv / 运行时契约 / 协议视图 / Skill 规则总览（4 个低频只读区块）
 */
import { computed, ref, watch } from 'vue'
import { adminPromptOpsApi } from '@/api/adminApi'
import { TERMS } from '../terms'
import { shortHash } from './sdp-shared'
import MkLoading from '@/components/mk/MkLoading.vue'

const props = defineProps<{ skillId: string; overview: Overview }>()

interface Overview {
  kind: string
  agentId: string
  file?: { path?: string; hash?: string } | null
  db?: { id?: string; version?: number | string; hash?: string; useCount?: number; model?: string; publishedAt?: string } | null
  drift: 'in-sync' | 'file-vs-db-mismatch' | null
  runtimeContract?: {
    version?: string
    contextMode?: string
    businessState?: { domain?: string; phases?: string[]; defaultPhase?: string; terminalPhases?: string[] } | null
    contextUpdate?: { mode?: string } | null
    outputEnvelope?: string
  } | null
  runtimeContractSource?: 'manifest' | 'default' | null
}

interface Protocol { id: string; title: string; statusLabel: string; summary: string; callSites: string }
interface RuleItem { ruleId: string; text: string; agentId: string }
const protocols = ref<Protocol[]>([])
const rulesOverview = ref<{ summary: { totalRules: number; totalPrefixes: number; conflictPrefixCount: number }; conflictPrefixes: Array<{ prefix: string; agentIds: string[] }>; byPrefix: Record<string, RuleItem[]> } | null>(null)
let engLoaded = false
const engLoading = ref(false)
const engProtoFailed = ref(false)
const engRulesFailed = ref(false)

const nodeRules = computed(() => {
  if (!rulesOverview.value) return [] as RuleItem[]
  const full = `skill:${props.skillId}`
  const out: RuleItem[] = []
  for (const list of Object.values(rulesOverview.value.byPrefix || {})) {
    for (const r of list || []) {
      if (r.agentId === full || r.agentId === props.skillId) out.push(r)
    }
  }
  return out
})

async function loadEngineering() {
  if (engLoaded) return
  engLoaded = true
  engLoading.value = true
  let pvOk = true
  let roOk = true
  try {
    const [pv, ro] = await Promise.all([
      adminPromptOpsApi.getProtocolView().catch(() => { pvOk = false; return null }),
      adminPromptOpsApi.getSkillRulesOverview().catch(() => { roOk = false; return null })
    ])
    engProtoFailed.value = !pvOk
    engRulesFailed.value = !roOk
    const pBody = pv?.data?.data ?? pv?.data ?? {}
    protocols.value = ((pBody.protocols as Record<string, unknown>[]) || []).map((p) => ({
      id: String(p.id || ''),
      title: String(p.title || p.id || ''),
      statusLabel: String(p.statusLabel || p.status || ''),
      summary: String(p.summary || ''),
      callSites: String(p.callSites || '')
    }))
    rulesOverview.value = (ro?.data?.data ?? ro?.data ?? null) as typeof rulesOverview.value
  } finally {
    engLoading.value = false
  }
}

function retryEngineering() {
  engLoaded = false
  void loadEngineering()
}

/* 切换 skill：清缓存重拉 */
watch(
  () => props.skillId,
  () => {
    engLoaded = false
    protocols.value = []
    rulesOverview.value = null
    void loadEngineering()
  },
  { immediate: true }
)

/** 漂移状态值人话（in-sync / file-vs-db-mismatch → 中文） */
function driftLabel(value: string) {
  return value === 'in-sync' ? TERMS.driftInSync : TERMS.driftValueMismatch
}
const fmtTime = (v: string) => (v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '—')
</script>

<style scoped>
.sdp-pane { display: grid; gap: 14px; align-content: start; }
.sdp-ok { color: var(--mk-green); }
.sdp-warn { color: var(--mk-amber); }
.sdp-bad-text { color: var(--mk-red); font-weight: 700; }
.sdp-none { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.sdp-eng { display: grid; gap: 8px; }
/* 区块头走 .mk-section__head（shared.css） */
.sdp-sec-meta { font-size: var(--mk-fs-micro); color: var(--mk-faint); display: inline-flex; gap: 10px; align-items: center; }
.sdp-kv {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--mk-fs-micro);
  background: var(--mk-surface);
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  overflow: hidden;
}
.sdp-kv th {
  text-align: left;
  font-weight: 600;
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
  /* 2026-10-06 审核 #120：原 7px 12px → 行高 36-37px，17 行全部低于规范下限 40px；
     提到与 .mk-table th/td 同档（10px 16px）后行高回到 ~44px */
  padding: 10px 16px;
  width: 180px;
  background: #f8fafc;
  border-right: 1px solid var(--mk-surface-3);
  vertical-align: top;
}
.sdp-kv td {
  padding: 10px 16px;
  color: #334155;
  border-bottom: 1px solid var(--mk-surface-3);
  word-break: break-all;
}
.sdp-kv tr:last-child th, .sdp-kv tr:last-child td { border-bottom: none; }
.sdp-kv code { font-size: var(--mk-fs-micro); }
.sdp-protocols { display: grid; gap: 8px; }
.sdp-protocol {
  border: 1px solid #e6ecf6;
  border-radius: var(--mk-radius-xl);
  padding: 10px 12px;
  display: grid;
  gap: 4px;
  background: var(--mk-surface);
}
.sdp-protocol header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.sdp-protocol strong { font-size: var(--mk-fs-micro); font-weight: 600; color: #223252; }
.sdp-protocol p { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-muted); line-height: 1.6; }
.sdp-protocol__sites { font-size: var(--mk-fs-micro); color: var(--mk-faint); word-break: break-all; }
.sdp-conflict {
  display: grid;
  gap: 4px;
  padding: 9px 12px;
  border-radius: var(--mk-radius-xl);
  background: var(--mk-amber-bg);
  border: 1px solid rgba(180, 83, 9, 0.3);
  color: var(--mk-amber);
  font-size: var(--mk-fs-micro);
}
.sdp-rules { display: grid; gap: 6px; }
.sdp-rule {
  display: grid;
  gap: 3px;
  padding: 7px 10px 7px 12px;
  border-left: 2px solid rgba(141, 107, 255, 0.45);
  background: #faf9ff;
  border-radius: 0 var(--mk-radius-sm) var(--mk-radius-sm) 0;
  font-size: var(--mk-fs-micro);
}
.sdp-rule__id { color: var(--wf-color-accent); font-size: var(--mk-fs-micro); font-weight: 700; }
.sdp-rule__text { color: var(--mk-ink); line-height: 1.55; }

/* 4K：字号跟随壳层放大 */
@media (min-width: 3600px) {
  .mk-section__head h4 { font-size: var(--mk-fs-body); }
  .sdp-sec-meta { font-size: var(--mk-fs-body); }
  .sdp-kv { font-size: var(--mk-fs-body); }
  .sdp-kv th { font-size: var(--mk-fs-body); padding: 10px 16px; }
  .sdp-kv td { padding: 10px 16px; }
  .sdp-kv code { font-size: var(--mk-fs-body); }
  .sdp-protocol { padding: 14px 16px; }
  .sdp-protocol strong { font-size: var(--mk-fs-emphasis); }
  .sdp-protocol p { font-size: var(--mk-fs-body); }
  .sdp-protocol__sites { font-size: var(--mk-fs-body); }
  .sdp-conflict { font-size: var(--mk-fs-body); padding: 13px 16px; }
  .sdp-rule { font-size: var(--mk-fs-body); padding: 10px 12px 10px 16px; }
  .sdp-rule__id { font-size: var(--mk-fs-body); }
}

/* 暗色模式：sdp 面板/表格浅色硬编码收敛 */
[data-theme='dark'] .sdp-kv { background: var(--wf-bg-subtle); }
[data-theme='dark'] .sdp-kv th { background: #202122; color: var(--mk-muted); }
[data-theme='dark'] .sdp-kv td { color: #e6edf7; }
[data-theme='dark'] .sdp-kv th, [data-theme='dark'] .sdp-kv td { border-color: #313235; }
[data-theme='dark'] .sdp-protocol { background: var(--wf-bg-subtle); border-color: #313235; }
[data-theme='dark'] .sdp-protocol strong { color: #e6edf7; }
[data-theme='dark'] .sdp-rule { background: rgba(141, 107, 255, 0.08); }
[data-theme='dark'] .sdp-rule__text { color: #dbdbdd; }

</style>