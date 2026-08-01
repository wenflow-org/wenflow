<template>
  <div class="mk-page">
    <div class="mk-status" :class="statusTone">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">{{ statusTitle }}</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">记录 {{ rows.length }}</span>
      <span class="mk-status__meta">失败 {{ failCount }}</span>
      <span class="mk-status__meta">漂移 {{ driftCount }}</span>
      <div class="mk-pills" style="margin-left:auto">
        <button
          v-for="p in statusPills"
          :key="p.id"
          type="button"
          class="mk-pill"
          :class="{ 'mk-pill--active': statusFilter === p.id }"
          @click="statusFilter = statusFilter === p.id ? '' : p.id"
        >
          {{ p.label }}
        </button>
      </div>
    </div>

    <div class="mk-card">
      <div class="mk-card__head">
        <div class="mk-filter">
          <select class="mk-filter__select mono" v-model="agentFilter">
            <option value="">全部节点</option>
            <option v-for="a in agentOptions" :key="a" :value="a">{{ a }}</option>
          </select>
          <input class="mk-filter__input" v-model="keyword" placeholder="搜索 Trace / 路径 / 会话 ID" />
        </div>
        <span class="mk-card__meta">{{ filtered.length }} / {{ rows.length }}</span>
      </div>

      <div class="pcl-scroll">
        <table v-if="filtered.length" class="mk-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>节点</th>
              <th>结果</th>
              <th>版本</th>
              <th>耗时</th>
              <th>Tokens</th>
              <th>诊断摘要</th>
              <th style="text-align:right">详情</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in filtered" :key="r.id" class="pcl-row" @click="openDetail(r)">
              <td class="mk-na">{{ r.time }}</td>
              <td><span class="mono pcl-agent">{{ r.agentId }}</span></td>
              <td>
                <span class="mk-badge" :class="r.success ? 'mk-badge--ok' : 'mk-badge--bad'">{{ r.success ? '成功' : '失败' }}</span>
                <span v-if="r.drift" class="mk-badge mk-badge--warn" style="margin-left:4px">漂移</span>
              </td>
              <td class="mk-num">v{{ r.version }}</td>
              <td class="mk-num">{{ fmtMs(r.durationMs) }}</td>
              <td class="mk-num">{{ r.tokens || '—' }}</td>
              <td class="pcl-digest" :class="{ 'mk-na': !r.digest }" :title="r.digest || ''">{{ r.digest || '—' }}</td>
              <td style="text-align:right"><span class="pcl-go">→</span></td>
            </tr>
          </tbody>
        </table>

        <div v-else class="mk-empty">
          <strong>{{ keyword ? '当前筛选无记录' : '暂无调用记录' }}</strong>
        </div>
      </div>
    </div>

    <!-- 详情抽屉 -->
    <Teleport to="body">
      <div v-if="detail" class="pcl-mask" @mousedown.self="detail = null">
        <aside class="pcl-panel" role="dialog" aria-label="调用详情">
          <header class="pcl-panel__head">
            <div class="pcl-panel__title">
              <span class="mk-badge" :class="detail.success ? 'mk-badge--ok' : 'mk-badge--bad'">
                {{ detail.success ? '成功' : '失败' }}
              </span>
              <h3 class="mono">{{ detail.agentId }}</h3>
              <span class="pcl-panel__id">{{ detail.id }} · {{ detail.time }}</span>
            </div>
            <button type="button" class="pcl-panel__close" aria-label="关闭" @click="detail = null">✕</button>
          </header>

          <div class="pcl-panel__body">
            <div class="pcl-facts">
              <div><span>模型</span><strong class="mono">{{ detail.model || '—' }}</strong></div>
              <div><span>版本</span><strong>v{{ detail.version }}</strong></div>
              <div><span>耗时</span><strong>{{ fmtMs(detail.durationMs) }}</strong></div>
              <div><span>Tokens</span><strong>{{ detail.tokens || '—' }}</strong></div>
              <div><span>逻辑尝试</span><strong>{{ detail.promptAttempts || 1 }}</strong></div>
              <div><span>LLM 请求</span><strong>{{ detail.llmRequests || 1 }}</strong></div>
              <div><span>Trace</span><strong class="mono">{{ detail.traceId || '—' }}</strong></div>
              <div><span>漂移</span><strong :class="{ 'pcl-bad': detail.drift }">{{ detail.drift ? '是' : '否' }}</strong></div>
            </div>

            <div v-if="detail.errorMessage" class="pcl-error">
              <span>错误{{ detail.errorCode ? ` · ${detail.errorCode}` : '' }}</span>
              <p>{{ detail.errorMessage }}</p>
            </div>

            <div class="pcl-tabs">
              <button
                v-for="t in tabs"
                :key="t.id"
                type="button"
                class="mk-pill"
                :class="{ 'mk-pill--active': tab === t.id }"
                @click="tab = t.id"
              >
                {{ t.label }}
              </button>
            </div>
            <pre class="pcl-payload">{{ tabContent }}</pre>
          </div>
        </aside>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { dataSource } from './mockStore'
import { timeAgo } from './mockLive'
import { adminRuntimeDefinitionsApi } from '@/api/adminApi'
import { useEscape } from './useEscape'

defineProps<{ state: string }>()

interface Row {
  id: string
  agentId: string
  success: boolean
  drift: boolean
  version: number
  durationMs: number
  tokens: string
  digest: string
  time: string
  model: string
  traceId: string
  errorCode: string
  errorMessage: string
  promptAttempts: number
  llmRequests: number
  userPayload: string
  rawModelOutput: string
  extractedJson: string
  normalizedOutput: string
  tokenUsage: string
}

/* ---------- demo ---------- */
const demoRows: Row[] = [
  {
    id: 'pcl-demo-1', agentId: 'skill:goal-conversation', success: true, drift: false, version: 3,
    durationMs: 4820, tokens: 'P 860 / C 204', digest: '', time: '18 分钟前', model: 'deepseek-v4-flash',
    traceId: 'tr:8f31a2', errorCode: '', errorMessage: '', promptAttempts: 1, llmRequests: 1,
    userPayload: '{\n  "message": "想把周报自动化"\n}', rawModelOutput: '{\n  "concepts": ["Excel 周报", "自动化"]\n}',
    extractedJson: '{\n  "concepts": ["Excel 周报"]\n}', normalizedOutput: '{\n  "stage": "goal"\n}', tokenUsage: '{\n  "prompt": 860,\n  "completion": 204\n}'
  },
  {
    id: 'pcl-demo-2', agentId: 'skill:teaching-round', success: false, drift: true, version: 5,
    durationMs: 18400, tokens: '—', digest: '未提取到合法 JSON，已回退规则输出', time: '2 分钟前', model: 'deepseek-v4-pro',
    traceId: 'tr:8f31c4', errorCode: 'RATE_LIMIT', errorMessage: '429 rate limit，retryAfter 20s', promptAttempts: 2, llmRequests: 3,
    userPayload: '{\n  "milestone": "m2-3"\n}', rawModelOutput: '', extractedJson: '', normalizedOutput: '', tokenUsage: ''
  },
  {
    id: 'pcl-demo-3', agentId: 'skill:goal-profile-inference', success: true, drift: false, version: 2,
    durationMs: 890, tokens: 'P 620 / C 148', digest: '', time: '17 分钟前', model: 'deepseek-v4-flash',
    traceId: 'tr:8f31a2', errorCode: '', errorMessage: '', promptAttempts: 1, llmRequests: 1,
    userPayload: '{\n  "concepts": ["Excel 周报"]\n}', rawModelOutput: '{\n  "level": "beginner"\n}',
    extractedJson: '{\n  "level": "beginner"\n}', normalizedOutput: '{\n  "profile": "…"\n}', tokenUsage: '{\n  "prompt": 620,\n  "completion": 148\n}'
  },
  {
    id: 'pcl-demo-4', agentId: 'skill:generic-planner', success: true, drift: false, version: 4,
    durationMs: 4820, tokens: 'P 2040 / C 1130', digest: '', time: '15 分钟前', model: 'deepseek-v4-pro',
    traceId: 'tr:8f31a2', errorCode: '', errorMessage: '', promptAttempts: 1, llmRequests: 1,
    userPayload: '{\n  "goal": "Excel 自动化入门"\n}', rawModelOutput: '{\n  "stages": 4\n}',
    extractedJson: '{\n  "stages": 4\n}', normalizedOutput: '{\n  "milestones": 12\n}', tokenUsage: '{\n  "prompt": 2040,\n  "completion": 1130\n}'
  },
  {
    id: 'pcl-demo-5', agentId: 'skill:companion-boost', success: true, drift: false, version: 1,
    durationMs: 1300, tokens: 'P 480 / C 96', digest: '', time: '2 分钟前', model: 'deepseek-v4-flash',
    traceId: 'tr:8f31c4', errorCode: '', errorMessage: '', promptAttempts: 1, llmRequests: 1,
    userPayload: '{\n  "fallback": true\n}', rawModelOutput: '{\n  "note": "缓存讲解"\n}',
    extractedJson: '{\n  "note": "缓存讲解"\n}', normalizedOutput: '{\n  "quality": 0.58\n}', tokenUsage: '{\n  "prompt": 480,\n  "completion": 96\n}'
  },
  {
    id: 'pcl-demo-6', agentId: 'skill:session-wrapup', success: true, drift: false, version: 2,
    durationMs: 1600, tokens: 'P 1450 / C 380', digest: '', time: '12 分钟前', model: 'deepseek-v4-flash',
    traceId: 'tr:8f31b7', errorCode: '', errorMessage: '', promptAttempts: 1, llmRequests: 1,
    userPayload: '{\n  "session": "数据清洗练习"\n}', rawModelOutput: '{\n  "notes": 3\n}',
    extractedJson: '{\n  "notes": 3\n}', normalizedOutput: '{\n  "advice": 1\n}', tokenUsage: '{\n  "prompt": 1450,\n  "completion": 380\n}'
  },
  {
    id: 'pcl-demo-7', agentId: 'skill:snapshot-refresh', success: false, drift: false, version: 1,
    durationMs: 5200, tokens: '—', digest: '输出缺少 fatigue 字段，已用上次值兜底', time: '26 分钟前', model: 'deepseek-v4-flash',
    traceId: 'tr:8f319e', errorCode: 'SCHEMA_MISS', errorMessage: 'normalized output missing field: fatigue', promptAttempts: 1, llmRequests: 1,
    userPayload: '{\n  "user": "user_1784"\n}', rawModelOutput: '{\n  "mastery": 0.6\n}',
    extractedJson: '{\n  "mastery": 0.6\n}', normalizedOutput: '', tokenUsage: ''
  },
  {
    id: 'pcl-demo-8', agentId: 'skill:dialogue-concept-extractor', success: true, drift: true, version: 2,
    durationMs: 2100, tokens: 'P 730 / C 160', digest: 'Prompt 漂移：输出与版本基线不一致', time: '33 分钟前', model: 'deepseek-v4-flash',
    traceId: 'tr:8f31d1', errorCode: '', errorMessage: '', promptAttempts: 1, llmRequests: 1,
    userPayload: '{\n  "dialogue": "…"\n}', rawModelOutput: '{\n  "candidates": 3\n}',
    extractedJson: '{\n  "candidates": 3\n}', normalizedOutput: '{\n  "concepts": 2\n}', tokenUsage: '{\n  "prompt": 730,\n  "completion": 160\n}'
  },
  {
    id: 'pcl-demo-9', agentId: 'skill:turn-simulator', success: true, drift: false, version: 1,
    durationMs: 8200, tokens: 'P 1980 / C 640', digest: '', time: '41 分钟前', model: 'deepseek-v4-pro',
    traceId: 'tr:8f31c9', errorCode: '', errorMessage: '', promptAttempts: 1, llmRequests: 1,
    userPayload: '{\n  "story": "疲惫的运营小张"\n}', rawModelOutput: '{\n  "turns": 5\n}',
    extractedJson: '{\n  "turns": 5\n}', normalizedOutput: '{\n  "fidelity": 0.91\n}', tokenUsage: '{\n  "prompt": 1980,\n  "completion": 640\n}'
  },
  {
    id: 'pcl-demo-10', agentId: 'skill:stage-designer', success: true, drift: false, version: 1,
    durationMs: 3400, tokens: 'P 1660 / C 520', digest: '', time: '48 分钟前', model: 'deepseek-v4-pro',
    traceId: 'tr:8f31d1', errorCode: '', errorMessage: '', promptAttempts: 1, llmRequests: 1,
    userPayload: '{\n  "stage": 3\n}', rawModelOutput: '{\n  "tasks": 6\n}',
    extractedJson: '{\n  "tasks": 6\n}', normalizedOutput: '{\n  "criteria": 6\n}', tokenUsage: '{\n  "prompt": 1660,\n  "completion": 520\n}'
  }
]

const rows = ref<Row[]>([])

watch(
  () => dataSource.value,
  async (src) => {
    if (src !== 'live') {
      rows.value = [...demoRows]
      return
    }
    try {
      const res = await adminRuntimeDefinitionsApi.getPromptCallLogs({ limit: 100 })
      const body = res.data?.data ?? res.data ?? []
      const items = Array.isArray(body) ? body : body.items || []
      rows.value = items.map((r: Record<string, unknown>) => mapRow(r))
    } catch {
      rows.value = []
    }
  },
  { immediate: true }
)

const cap = (v: unknown, n = 6000): string => {
  if (v == null || v === '') return ''
  const s = typeof v === 'string' ? v : JSON.stringify(v, null, 2)
  return s.length > n ? `${s.slice(0, n)}\n…（截断）` : s
}

function mapRow(r: Record<string, unknown>): Row {
  const usage = (r.tokenUsage as Record<string, unknown>) || null
  const tokens = usage ? `P ${usage.prompt_tokens ?? usage.prompt ?? 0} / C ${usage.completion_tokens ?? usage.completion ?? 0}` : ''
  const drift = !!r.promptDrift
  const success = r.success !== false
  const digest = drift
    ? 'Prompt 漂移：输出与版本基线不一致'
    : !success
      ? String(r.errorMessage || r.errorCode || '调用失败').slice(0, 60)
      : ''
  return {
    id: String(r.id),
    agentId: String(r.agentId || ''),
    success,
    drift,
    version: Number(r.systemPromptVersion || 1),
    durationMs: Number(r.durationMs || 0),
    tokens,
    digest,
    time: timeAgo(String(r.createdAt || '')),
    model: String(r.model || ''),
    traceId: String(r.traceId || ''),
    errorCode: String(r.errorCode || ''),
    errorMessage: String(r.errorMessage || ''),
    promptAttempts: Number(r.promptAttemptCount || 1),
    llmRequests: Number(r.llmRequestCount || 1),
    userPayload: cap(r.userPayload),
    rawModelOutput: cap(r.rawModelOutput),
    extractedJson: cap(r.extractedJson),
    normalizedOutput: cap(r.normalizedOutput),
    tokenUsage: cap(r.tokenUsage)
  }
}

/* 筛选 */
const statusFilter = ref('')
const agentFilter = ref('')
const keyword = ref('')
const statusPills = [
  { id: 'fail', label: '失败' },
  { id: 'drift', label: '漂移' },
  { id: 'ok', label: '成功' }
]

const agentOptions = computed(() => [...new Set(rows.value.map((r) => r.agentId))].sort())

const filtered = computed(() =>
  rows.value.filter((r) => {
    if (agentFilter.value && r.agentId !== agentFilter.value) return false
    if (statusFilter.value === 'fail' && r.success) return false
    if (statusFilter.value === 'drift' && !r.drift) return false
    if (statusFilter.value === 'ok' && !r.success) return false
    const q = keyword.value.trim().toLowerCase()
    if (q && !`${r.traceId} ${r.agentId}`.toLowerCase().includes(q)) return false
    return true
  })
)

const failCount = computed(() => rows.value.filter((r) => !r.success).length)
const driftCount = computed(() => rows.value.filter((r) => r.drift).length)
const statusTone = computed(() => (!rows.value.length ? 'mk-status--muted' : failCount.value ? 'mk-status--bad' : driftCount.value ? 'mk-status--warn' : 'mk-status--ok'))
const statusTitle = computed(() =>
  !rows.value.length ? '还没有 Prompt 调用记录' : failCount.value ? `${failCount.value} 次调用失败` : driftCount.value ? `注意：${driftCount.value} 次漂移` : 'Prompt 调用健康'
)

/* 详情 */
const detail = ref<Row | null>(null)
useEscape(() => !!detail.value, () => { detail.value = null })
const tab = ref('input')
const tabs = [
  { id: 'input', label: '输入载荷' },
  { id: 'raw', label: '模型输出' },
  { id: 'extracted', label: '提取 JSON' },
  { id: 'normalized', label: '归一化' },
  { id: 'tokens', label: 'Token' }
]

function openDetail(r: Row) {
  detail.value = r
  tab.value = 'input'
}

const tabContent = computed(() => {
  if (!detail.value) return ''
  const map: Record<string, string> = {
    input: detail.value.userPayload,
    raw: detail.value.rawModelOutput,
    extracted: detail.value.extractedJson,
    normalized: detail.value.normalizedOutput,
    tokens: detail.value.tokenUsage
  }
  return map[tab.value] || '（无记录）'
})

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`)
</script>

<style scoped>
.pcl-scroll { max-height: 68vh; overflow-y: auto; }
.pcl-scroll thead th { position: sticky; top: 0; background: var(--mk-surface); z-index: 1; }
.pcl-row { cursor: pointer; }
.pcl-row:hover { background: #f6f9ff; }
.pcl-go { color: var(--mk-faint); font-weight: 700; }
.pcl-row:hover .pcl-go { color: var(--mk-blue); }
.pcl-agent { font-size: 11px; color: var(--mk-blue); }
.pcl-digest {
  font-size: 12px;
  color: var(--mk-muted);
  max-width: 220px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mono { font-family: var(--mk-mono); }

.pcl-mask {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(15, 23, 42, 0.36);
  display: flex;
  justify-content: flex-end;
}
.pcl-panel {
  width: min(600px, 100vw);
  height: 100%;
  background: #fff;
  box-shadow: -16px 0 48px rgba(15, 23, 42, 0.18);
  display: grid;
  grid-template-rows: auto 1fr;
  animation: pcl-in 0.2s ease;
}
@keyframes pcl-in { from { transform: translateX(30px); opacity: 0; } }
.pcl-panel__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 16px 18px;
  border-bottom: 1px solid #e1e8f2;
}
.pcl-panel__title { display: grid; gap: 6px; justify-items: start; }
.pcl-panel__title h3 { margin: 0; font-size: 16px; }
.pcl-panel__id { font-size: 11px; color: #8492ab; }
.pcl-panel__close { border: 0; background: #f0f2f5; width: 30px; height: 30px; border-radius: 8px; cursor: pointer; color: #5b6577; }
.pcl-panel__body { padding: 16px 18px; display: grid; gap: 14px; align-content: start; overflow-y: auto; }

.pcl-facts {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.pcl-facts > div { display: grid; gap: 2px; min-width: 0; }
.pcl-facts span { font-size: 11px; color: #8492ab; font-weight: 600; }
.pcl-facts strong { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pcl-bad { color: var(--mk-red); }

.pcl-error {
  border: 1px solid rgba(220, 38, 38, 0.3);
  background: #fef5f5;
  border-radius: 10px;
  padding: 10px 12px;
  display: grid;
  gap: 4px;
}
.pcl-error span { font-size: 11px; font-weight: 700; color: var(--mk-red); }
.pcl-error p { margin: 0; font-size: 12.5px; color: var(--mk-muted); white-space: pre-wrap; }

.pcl-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
.pcl-payload {
  margin: 0;
  padding: 12px 14px;
  border-radius: 10px;
  background: #0d1420;
  color: #8ba3c7;
  font: 11px/1.65 'JetBrains Mono', monospace;
  max-height: 46vh;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
