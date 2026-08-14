<template>
  <!-- 工程：基础信息 / 运行时契约 / 协议视图 / Skill 规则总览（低频只读区块） -->
  <div class="sdp-pane">
    <section class="sdp-eng">
      <header class="sdp-sec-head"><h4>基础信息</h4></header>
      <table class="sdp-kv">
        <tbody>
          <tr><th>kind</th><td><code class="mono">{{ overview.kind }}</code></td></tr>
          <tr><th>agentId</th><td><code class="mono">{{ overview.agentId }}</code></td></tr>
          <tr v-if="overview.file"><th>file path</th><td><code class="mono">{{ overview.file.path }}</code></td></tr>
          <tr v-if="overview.file?.hash"><th>file hash</th><td><code class="mono" :title="overview.file.hash">{{ shortHash(overview.file.hash) }}</code></td></tr>
          <tr v-if="overview.db?.id"><th>DB ACTIVE id</th><td><code class="mono">{{ overview.db.id }}</code></td></tr>
          <tr v-if="overview.db?.version"><th>DB ACTIVE version</th><td><code class="mono">v{{ overview.db.version }}</code></td></tr>
          <tr v-if="overview.db?.useCount !== undefined"><th>调用次数</th><td>{{ overview.db.useCount }}</td></tr>
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
      <header class="sdp-sec-head">
        <h4>运行时契约</h4>
        <span class="sdp-sec-meta mono">{{ overview.runtimeContractSource === 'manifest' ? 'prompt-lab/manifests' : 'buildDefaultRuntimeContract' }}</span>
      </header>
      <table class="sdp-kv">
        <tbody>
          <tr><th>version</th><td><code class="mono">{{ overview.runtimeContract.version }}</code></td></tr>
          <tr><th>contextMode</th><td><code class="mono">{{ overview.runtimeContract.contextMode }}</code></td></tr>
          <tr v-if="overview.runtimeContract.businessState?.domain"><th>domain</th><td><code class="mono">{{ overview.runtimeContract.businessState.domain }}</code></td></tr>
          <tr v-if="overview.runtimeContract.businessState?.phases"><th>phases</th><td><code class="mono">{{ overview.runtimeContract.businessState.phases.join(', ') }}</code></td></tr>
          <tr v-if="overview.runtimeContract.businessState?.defaultPhase"><th>defaultPhase</th><td><code class="mono">{{ overview.runtimeContract.businessState.defaultPhase }}</code></td></tr>
          <tr v-if="overview.runtimeContract.businessState?.terminalPhases"><th>terminalPhases</th><td><code class="mono">{{ overview.runtimeContract.businessState.terminalPhases.join(', ') }}</code></td></tr>
          <tr v-if="overview.runtimeContract.contextUpdate?.mode"><th>contextUpdate.mode</th><td><code class="mono">{{ overview.runtimeContract.contextUpdate.mode }}</code></td></tr>
          <tr><th>outputEnvelope</th><td><code class="mono">{{ overview.runtimeContract.outputEnvelope }}</code></td></tr>
        </tbody>
      </table>
    </section>

    <section class="sdp-eng">
      <header class="sdp-sec-head">
        <h4>协议视图</h4>
        <span class="sdp-sec-meta">{{ protocols.length ? `${protocols.length} 组协议` : '' }}</span>
      </header>
      <div v-if="protocols.length" class="sdp-protocols">
        <article v-for="p in protocols" :key="p.id" class="sdp-protocol">
          <header>
            <strong>{{ p.title }}</strong>
            <span class="mk-badge mk-badge--muted">{{ p.statusLabel }}</span>
          </header>
          <p>{{ p.summary }}</p>
          <span class="sdp-protocol__sites mono">{{ p.callSites }}</span>
        </article>
      </div>
      <p v-if="engProtoFailed" class="sdp-none sdp-bad-text">协议数据加载失败。<button type="button" class="mk-link" @click="retryEngineering">重试</button></p>
      <p v-else class="sdp-none">暂无协议数据。</p>
    </section>

    <section class="sdp-eng">
      <header class="sdp-sec-head">
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
      <div v-if="nodeRules.length" class="sdp-rules">
        <div v-for="r in nodeRules" :key="r.ruleId" class="sdp-rule">
          <span class="sdp-rule__id mono">{{ r.ruleId }}</span>
          <span class="sdp-rule__text">{{ r.text }}</span>
        </div>
      </div>
      <p v-if="engRulesFailed" class="sdp-none sdp-bad-text">规则数据加载失败。</p>
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
  let pvOk = true
  let roOk = true
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
.sdp-none { margin: 0; font-size: 12px; color: var(--mk-faint); }
.sdp-eng { display: grid; gap: 8px; }
.sdp-sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.sdp-sec-head h4 {
  margin: 0;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--mk-faint);
}
.sdp-sec-meta { font-size: 11px; color: var(--mk-faint); display: inline-flex; gap: 10px; align-items: center; }
.sdp-kv {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  background: #fff;
  border: 1px solid var(--mk-line);
  border-radius: 12px;
  overflow: hidden;
}
.sdp-kv th {
  text-align: left;
  font-weight: 600;
  font-size: 11px;
  color: var(--mk-muted);
  padding: 7px 12px;
  width: 180px;
  background: #f8fafc;
  border-right: 1px solid #f0f2f5;
  vertical-align: top;
}
.sdp-kv td {
  padding: 7px 12px;
  color: #334155;
  border-bottom: 1px solid #f0f2f5;
  word-break: break-all;
}
.sdp-kv tr:last-child th, .sdp-kv tr:last-child td { border-bottom: none; }
.sdp-kv code { font-size: 11px; }
.sdp-protocols { display: grid; gap: 8px; }
.sdp-protocol {
  border: 1px solid #e6ecf6;
  border-radius: 10px;
  padding: 10px 12px;
  display: grid;
  gap: 4px;
  background: #fff;
}
.sdp-protocol header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.sdp-protocol strong { font-size: 12.5px; font-weight: 600; color: #223252; }
.sdp-protocol p { margin: 0; font-size: 11.5px; color: var(--mk-muted); line-height: 1.6; }
.sdp-protocol__sites { font-size: 10px; color: var(--mk-faint); word-break: break-all; }
.sdp-conflict {
  display: grid;
  gap: 4px;
  padding: 9px 12px;
  border-radius: 10px;
  background: var(--mk-amber-bg);
  border: 1px solid rgba(180, 83, 9, 0.3);
  color: var(--mk-amber);
  font-size: 11.5px;
}
.sdp-rules { display: grid; gap: 6px; }
.sdp-rule {
  display: grid;
  gap: 3px;
  padding: 7px 10px 7px 12px;
  border-left: 2px solid rgba(141, 107, 255, 0.45);
  background: #faf9ff;
  border-radius: 0 8px 8px 0;
  font-size: 12px;
}
.sdp-rule__id { color: #8d6bff; font-size: 10.5px; font-weight: 700; }
.sdp-rule__text { color: #263950; line-height: 1.55; }

/* 4K：字号跟随壳层放大 */
@media (min-width: 3600px) {
  .sdp-sec-head h4 { font-size: 17.5px; }
  .sdp-sec-meta { font-size: 17.5px; }
  .sdp-kv { font-size: 18px; }
  .sdp-kv th { font-size: 17px; padding: 10px 16px; }
  .sdp-kv td { padding: 10px 16px; }
  .sdp-kv code { font-size: 17px; }
  .sdp-protocol { padding: 14px 16px; }
  .sdp-protocol strong { font-size: 19px; }
  .sdp-protocol p { font-size: 18px; }
  .sdp-protocol__sites { font-size: 16.5px; }
  .sdp-conflict { font-size: 18px; padding: 13px 16px; }
  .sdp-rule { font-size: 18px; padding: 10px 12px 10px 16px; }
  .sdp-rule__id { font-size: 16.5px; }
}
</style>
