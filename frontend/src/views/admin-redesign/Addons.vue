<template>
  <div class="mk-page">
    <!-- 状态条 -->
    <div class="mk-status" :class="capabilityRows.length ? 'mk-status--ok' : 'mk-status--muted'">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">{{ capabilityRows.length ? '外挂能力' : '暂无外挂能力' }}</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">共 {{ capabilityRows.length }} 个</span>
      <span class="mk-status__meta">MCP {{ mcpCount }}</span>
      <span class="mk-status__meta">能力 Skill {{ capabilityCount }}</span>
      <span class="mk-status__meta">已接入 {{ readyCount }}</span>
      <span class="mk-status__meta">MCP 服务 {{ mcpTools.length }}</span>
    </div>

    <!-- ① 外挂能力 + ② MCP 服务：行数少时并栏（审计 E3），数据增长后回到单列全宽 -->
    <div class="ac-cards" :class="{ 'ac-cards--side': sideBySide }">

    <!-- ① 外挂能力 -->
    <div class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">外挂能力</h3>
        <span class="mk-card__meta">由白名单登记，新能力接入后自动列出</span>
      </div>
      <div v-if="configsFailed" class="ac-error" role="alert">
        <span>能力配置加载失败，以下表格为占位状态，无法反映真实接入情况。</span>
        <button type="button" class="mk-link" @click="loadConfigs">重试</button>
      </div>
      <div class="mk-table-scroll">
        <table v-if="capabilityRows.length" class="mk-table">
          <thead>
            <tr>
              <th>能力</th>
              <th>类型</th>
              <th>模型</th>
              <th>超时</th>
              <th>配置</th>
              <th>最近调用</th>
              <th class="mk-col--actions-wide">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in capabilityRows" :key="r.id">
              <td>
                <div class="mk-cell-main">
                  <strong :title="r.name">{{ r.name }}</strong>
                  <span class="mk-cell-sub" :title="r.id">{{ r.id }}</span>
                </div>
              </td>
              <td><span class="mk-badge" :class="r.id === 'mcp-tool' ? 'mk-badge--info' : 'mk-badge--muted'">{{ r.id === 'mcp-tool' ? 'MCP' : '能力 Skill' }}</span></td>
              <td class="mono ac-model" :title="r.ready ? r.model : ''">{{ r.ready ? r.model : '—' }}</td>
              <td class="mk-num">{{ r.ready ? r.timeout : '—' }}</td>
              <td><span class="mk-badge" :class="r.ready ? 'mk-badge--ok' : 'mk-badge--warn'">{{ r.ready ? '已接入' : '待配置' }}</span></td>
              <td :class="{ 'mk-na': !r.ready }">{{ r.ready ? r.last : '—' }}</td>
              <td>
                <div class="mk-actions">
                  <button v-if="r.ready" type="button" class="mk-link" @click="openSkillDrawer(r.id)">详情 / 配置</button>
                  <button v-else type="button" class="mk-link" @click="goConfig">配置 →</button>
                  <button v-if="r.ready" type="button" class="mk-link" @click="goLogs(r.id)">日志</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        <div v-if="!capabilityRows.length && !loading" class="mk-empty mk-empty--min">
          <span class="mk-empty__icon" aria-hidden="true">⌥</span>
          <strong>暂无外挂能力</strong>
          <span>后续接入生图、网页搜索等能力后会在这里列出，并进行模型与超时配置。</span>
          <button type="button" class="mk-empty__action" @click="goConfig">前往模型与接入配置 →</button>
        </div>
      </div>
    </div>

    <!-- ② MCP 服务 -->
    <div class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">MCP 服务</h3>
        <div class="mk-actions">
          <button type="button" class="mk-link" @click="openToolCreate">新建 MCP 服务 +</button>
        </div>
      </div>
      <div class="ac-mcp" v-if="mcpTools.length">
        <div v-for="t in mcpTools" :key="t.id" class="ac-mcp__row">
          <span class="ac-mcp__dot" :class="t.enabled ? 'is-on' : 'is-off'"></span>
          <div class="ac-mcp__main">
            <strong>{{ t.name }}</strong>
            <span class="ac-mcp__id mono">{{ t.id }}</span>
          </div>
          <span class="ac-mcp__type mono">{{ t.type }}</span>
          <span class="ac-mcp__endpoint mono" :title="endpointTitle(t.endpoint)">{{ endpointLabel(t.endpoint) }}</span>
          <span class="mk-badge" :class="t.enabled ? 'mk-badge--ok' : 'mk-badge--muted'">{{ t.enabled ? '启用' : '停用' }}</span>
          <div class="mk-actions">
            <button type="button" class="mk-link" :disabled="testingId === t.id" @click="testTool(t)">
              {{ testingId === t.id ? '测试中…' : '测试' }}
            </button>
            <span v-if="testResult?.id === t.id" class="ac-mcp__test" :class="testResult.ok ? 'is-ok' : 'is-bad'">
              {{ testResult.ok ? `通过 · ${testResult.latencyMs}ms` : `失败 · ${testResult.error || ''}` }}
            </span>
            <div class="mk-menu">
              <button type="button" class="mk-menu__btn" aria-label="更多操作" aria-haspopup="menu" :aria-expanded="menuOpen" @click.stop="toggleMenu(t.id)">⋯</button>
              <div v-if="openMenu === t.id" class="mk-menu__pop" :style="popStyle" @click.stop>
                <button type="button" class="mk-menu__item" @click="menuEdit(t)">编辑</button>
                <div class="mk-menu__sep"></div>
                <button type="button" class="mk-menu__item mk-menu__item--danger" @click="menuRemove(t)">删除</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="mk-empty mk-empty--min">
        <strong>{{ mcpLoading ? '加载中…' : mcpFailed ? 'MCP 服务加载失败' : '暂无 MCP 服务' }}</strong>
        <span v-if="!mcpLoading && !mcpFailed">MCP 工具（如网页搜索、生图）在此登记，供外挂能力调用。</span>
      </div>
    </div>

    </div>

    <!-- MCP 服务编辑弹窗 -->
    <Teleport to="body">
    <div v-if="toolOpen" ref="maskRef" class="mk-modal">
      <div ref="panelRef" class="mk-modal__panel" role="dialog" aria-label="MCP 服务">
        <div class="mk-modal__head">
          <h3 class="mk-modal__title">{{ toolEditingId ? '编辑 MCP 服务' : '新建 MCP 服务' }}</h3>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="toolOpen = false">✕</button>
        </div>
        <div class="mk-modal__body">
          <label class="mk-field" :class="{ 'mk-field--error': toolErrors.id }">
            <span class="mk-field__label">工具 ID</span>
            <input v-model="toolForm.id" class="mk-field__input" placeholder="如 web-search / text-to-image" :disabled="!!toolEditingId" />
            <span v-if="toolErrors.id" class="mk-field__err">{{ toolErrors.id }}</span>
          </label>
          <label class="mk-field" :class="{ 'mk-field--error': toolErrors.name }">
            <span class="mk-field__label">名称</span>
            <input v-model="toolForm.name" class="mk-field__input" placeholder="如 网页搜索" />
            <span v-if="toolErrors.name" class="mk-field__err">{{ toolErrors.name }}</span>
          </label>
          <div class="ac-mcp__formrow">
            <label class="mk-field">
              <span class="mk-field__label">类型</span>
              <select v-model="toolForm.type" class="mk-field__select">
                <option value="http">HTTP</option>
                <option value="code">代码执行</option>
                <option value="search">搜索</option>
                <option value="filesystem">文件系统</option>
                <option value="image">生图</option>
              </select>
            </label>
            <label class="mk-field">
              <span class="mk-field__label">启用</span>
              <select v-model="toolForm.enabled" class="mk-field__select">
                <option :value="true">启用</option>
                <option :value="false">停用</option>
              </select>
            </label>
          </div>
          <label class="mk-field">
            <span class="mk-field__label">Endpoint</span>
            <input v-model="toolForm.endpoint" class="mk-field__input" placeholder="https://… 或 local / ${ENV_VAR}" />
          </label>
          <label class="mk-field">
            <span class="mk-field__label">描述（可选）</span>
            <textarea v-model="toolForm.description" class="mk-field__textarea" rows="2" placeholder="这个工具做什么"></textarea>
          </label>
        </div>
        <div class="mk-modal__foot">
          <button type="button" class="mk-btn" @click="toolOpen = false">取消</button>
          <button type="button" class="mk-btn mk-btn--primary" :disabled="toolSaving" @click="saveTool">
            {{ toolSaving ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { dataSource, openSkillDrawer, investigateAgent } from './store'
import { timeAgo, errMsg } from './live'
import { adminSkillsApi, adminMcpApi } from '@/api/adminApi'
import { EXTRA_COMPONENT_VISIBLE_SKILLS, EXTRA_CAPABILITY_META } from '@/views/admin/capabilityCatalog'
import { useEscape } from './useEscape'
import { useOverlay, useMaskClose } from './useOverlay'
import { useRowMenu } from './useRowMenu'
import { askConfirm } from './useConfirm'
import { toast } from '@/utils/toast'

const router = useRouter()

/* ---------- ① 外挂能力（白名单驱动） ---------- */
interface CapabilityRow {
  id: string
  name: string
  type: 'mcp' | 'capability'
  ready: boolean
  model: string
  timeout: string
  last: string
}

const CAPABILITY_META = EXTRA_CAPABILITY_META

function formatTimeout(ms: unknown): string {
  const n = Number(ms)
  if (!ms || Number.isNaN(n)) return '继承'
  return `${Math.round(n / 1000)}s`
}

/** 环境变量占位符（${ENV_VAR} 未替换）判定：直出原文会误导为真实地址，统一显示「未配置」 */
const ENV_PLACEHOLDER = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/
function endpointLabel(endpoint: string): string {
  return ENV_PLACEHOLDER.test(endpoint) ? '未配置' : endpoint || '—'
}
function endpointTitle(endpoint: string): string {
  return ENV_PLACEHOLDER.test(endpoint)
    ? `环境变量 ${endpoint} 未替换（未在服务端配置），该工具当前不可用`
    : endpoint
}

const configMap = ref<Record<string, Record<string, unknown>>>({})
const loading = ref(false)
/** 能力配置拉取失败：保留现有表格并展示错误条，避免整表降级为「待配置」 */
const configsFailed = ref(false)

async function loadConfigs() {
  loading.value = true
  configsFailed.value = false
  try {
    const res = await adminSkillsApi.getSkillModelConfigs()
    const body = res.data?.data ?? res.data ?? []
    const items = Array.isArray(body) ? body : body.items || body.configs || []
    const map: Record<string, Record<string, unknown>> = {}
    for (const c of items as Record<string, unknown>[]) {
      const skillId = String(c.skillId || c.id || '')
      if (skillId) map[skillId] = c
    }
    configMap.value = map
  } catch (e) {
    configsFailed.value = true
    toast.error(`配置加载失败：${errMsg(e)}`)
  } finally {
    loading.value = false
  }
}

const capabilityRows = computed<CapabilityRow[]>(() => {
  const out: CapabilityRow[] = []
  for (const id of EXTRA_COMPONENT_VISIBLE_SKILLS) {
    const meta = CAPABILITY_META[id] || { name: id, type: id === 'mcp-tool' ? ('mcp' as const) : ('capability' as const) }
    const c = configMap.value[id]
    if (c) {
      out.push({
        id,
        name: String(c.displayName || meta.name),
        type: meta.type,
        ready: true,
        model: c.model ? String(c.model) : '继承全局',
        timeout: formatTimeout(c.requestTimeoutMs),
        last: timeAgo(c.lastCalledAt as string)
      })
    } else {
      out.push({ id, name: meta.name, type: meta.type, ready: false, model: '', timeout: '', last: '' })
    }
  }
  return out
})

const mcpCount = computed(() => capabilityRows.value.filter((r) => r.type === 'mcp').length)
const capabilityCount = computed(() => capabilityRows.value.filter((r) => r.type === 'capability').length)
const readyCount = computed(() => capabilityRows.value.filter((r) => r.ready).length)

/** E3 并栏：两张卡片行数都少时 1fr 1fr 并排利用宽幅，数据增长后回单列全宽 */
const sideBySide = computed(() => capabilityRows.value.length <= 5 && mcpTools.value.length <= 5)

/* ---------- ② MCP 服务（平台工具） ---------- */
interface McpTool {
  id: string
  name: string
  description: string
  type: string
  endpoint: string
  enabled: boolean
}

const mcpTools = ref<McpTool[]>([])
/** MCP 服务列表 loading / 失败（独立于能力配置的 loading，避免两域状态互绑） */
const mcpLoading = ref(false)
const mcpFailed = ref(false)

async function loadMcpTools() {
  mcpLoading.value = true
  mcpFailed.value = false
  try {
    const res = await adminMcpApi.list()
    const body = res.data?.data ?? {}
    mcpTools.value = (body.tools || []).map((t: Record<string, unknown>) => ({
      id: String(t.id || ''),
      name: String(t.name || t.id || ''),
      description: String(t.description || ''),
      type: String(t.type || 'http'),
      endpoint: String(t.endpoint || ''),
      enabled: t.enabled !== false
    }))
  } catch {
    mcpTools.value = []
    mcpFailed.value = true
  } finally {
    mcpLoading.value = false
  }
}

watch(
  () => [dataSource.value],
  () => {
    void loadConfigs()
    void loadMcpTools()
  },
  { immediate: true }
)

/* ---------- MCP 服务弹窗 ---------- */
const toolOpen = ref(false)
const toolEditingId = ref('')
const toolSaving = ref(false)
const toolForm = ref({ id: '', name: '', type: 'http', endpoint: '', description: '', enabled: true })
const toolErrors = ref<{ id?: string; name?: string; endpoint?: string }>({})
useEscape(() => toolOpen.value, () => { toolOpen.value = false })
const panelRef = ref<HTMLElement | null>(null)
const maskRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => toolOpen.value), panelRef)
useMaskClose(maskRef, () => { toolOpen.value = false })

function openToolCreate() {
  toolEditingId.value = ''
  toolForm.value = { id: '', name: '', type: 'http', endpoint: '', description: '', enabled: true }
  toolErrors.value = {}
  toolOpen.value = true
}

function openToolEdit(t: McpTool) {
  toolEditingId.value = t.id
  toolForm.value = { id: t.id, name: t.name, type: t.type, endpoint: t.endpoint, description: t.description, enabled: t.enabled }
  toolErrors.value = {}
  toolOpen.value = true
}

async function saveTool() {
  toolErrors.value = {}
  if (!toolForm.value.id.trim()) toolErrors.value.id = '请输入工具 ID'
  if (!toolForm.value.name.trim()) toolErrors.value.name = '请输入名称'
  if (!toolForm.value.endpoint.trim()) toolErrors.value.endpoint = '请输入 endpoint'
  if (Object.keys(toolErrors.value).length) return
  toolSaving.value = true
  try {
    if (toolEditingId.value) {
      await adminMcpApi.updateTool(toolEditingId.value, { ...toolForm.value })
    } else {
      await adminMcpApi.createTool({ ...toolForm.value })
    }
    await loadMcpTools()
    toolOpen.value = false
    toast.success(toolEditingId.value ? 'MCP 服务已更新' : 'MCP 服务已创建')
  } catch (e) {
    toast.error(`保存失败：${errMsg(e)}`)
  } finally {
    toolSaving.value = false
  }
}

async function removeTool(t: McpTool) {
  const ok = await askConfirm({
    title: '删除 MCP 服务',
    message: `确认删除「${t.name}」（${t.id}）？\n删除后依赖它的外挂能力将无法调用。`,
    confirmText: '删除'
  })
  if (!ok) return
  try {
    await adminMcpApi.removeTool(t.id)
    await loadMcpTools()
    toast.success('MCP 服务已删除')
  } catch (e) {
    toast.error(`删除失败：${errMsg(e)}`)
  }
}

/* ---------- 连通性测试 ---------- */
const testingId = ref('')
const testResult = ref<{ id: string; ok: boolean; latencyMs?: number; error?: string } | null>(null)

/* 行内 ⋯ 菜单：编辑/删除收进菜单，测试（带行内结果）保持平铺 */
const { openMenu, toggleMenu, closeMenu, menuOpen, popStyle } = useRowMenu()

function menuEdit(t: McpTool) {
  closeMenu()
  openToolEdit(t)
}

function menuRemove(t: McpTool) {
  closeMenu()
  void removeTool(t)
}

async function testTool(t: McpTool) {
  if (testingId.value) return
  testingId.value = t.id
  testResult.value = null
  try {
    const res = await adminMcpApi.testTool(t.id)
    const d = res.data?.data ?? {}
    testResult.value = { id: t.id, ok: !!d.ok, latencyMs: Number(d.latencyMs || 0), error: d.error }
  } catch (e) {
    testResult.value = { id: t.id, ok: false, error: errMsg(e) }
  } finally {
    testingId.value = ''
  }
}

/* ---------- 跳转 ---------- */
function goLogs(skillId: string) {
  investigateAgent(skillId)
}
function goConfig() {
  void router.push('/admin/api-config')
}

/* toast */
</script>

<style scoped>
.mono { font-family: var(--mk-mono); font-size: 12px; }

/* 能力列：主名 + ID 双行，最小宽度兜底（原 51px 截断至 1-2 字符；并栏/窄卡下不被其余列挤压，
   超宽时由 .mk-table-scroll 横向滚动承接） */
.mk-table th:first-child,
.mk-table td:first-child { min-width: 160px; }

/* E3 并栏容器：默认单列全宽；内容少时 1fr 1fr 并排 */
.ac-cards {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
  align-items: stretch;
}
@media (min-width: 1100px) {
  .ac-cards--side { grid-template-columns: 1fr 1fr; }
}

/* 能力配置加载失败错误条 */
.ac-error {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 12px 16px 0;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--mk-red-bg);
  color: var(--mk-red);
  font-size: 12.5px;
  font-weight: 600;
}
.ac-error .mk-link { color: var(--mk-red); text-decoration: underline; }


/* ② MCP 服务行 */
.ac-mcp { display: grid; }
.ac-mcp__row {
  display: grid;
  grid-template-columns: 10px 1.2fr 90px 1fr auto auto;
  gap: 12px;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid var(--mk-line);
}
.ac-mcp__row:last-child { border-bottom: none; }
.ac-mcp__dot { width: 8px; height: 8px; border-radius: 50%; }
.ac-mcp__dot.is-on { background: var(--mk-green); box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.12); }
.ac-mcp__dot.is-off { background: var(--mk-faint); }
.ac-mcp__main { display: grid; gap: 1px; min-width: 0; }
.ac-mcp__main strong { font-size: 12.5px; font-weight: 600; color: var(--mk-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ac-mcp__id { font-size: 10.5px; color: var(--mk-faint); }
.ac-mcp__type { font-size: 11px; color: var(--mk-muted); }
.ac-mcp__test { font-size: 11px; font-weight: 700; white-space: nowrap; }
.ac-mcp__test.is-ok { color: var(--mk-green); }
.ac-mcp__test.is-bad { color: var(--mk-red); max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
/* 模型列：长模型名单行截断（上限 --mk-col-model-wide 140px + title 全值；原 57px 无截断越界源） */
.ac-model {
  max-width: var(--mk-col-model-wide);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ac-mcp__endpoint {
  font-size: 11px;
  color: var(--mk-faint);
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ac-mcp__formrow { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

/* 窄屏：MCP 行两行重排（状态点/名称/徽标一行，类型/endpoint 次行，操作收底行） */
@media (max-width: 700px) {
  .ac-mcp__row {
    grid-template-columns: 10px minmax(0, 1fr) auto;
    grid-template-areas:
      'dot main badge'
      '. type endpoint'
      '. actions actions';
    row-gap: 5px;
    column-gap: 12px;
    padding: 12px 16px;
  }
  .ac-mcp__dot { grid-area: dot; }
  .ac-mcp__main { grid-area: main; }
  .ac-mcp__type { grid-area: type; }
  .ac-mcp__endpoint { grid-area: endpoint; }
  .ac-mcp__row .mk-badge { grid-area: badge; }
  .ac-mcp__row .mk-actions { grid-area: actions; }
}
@media (max-width: 800px) {
  .ac-mcp__formrow { grid-template-columns: 1fr; }
}

/* ========== 大屏/4K 适配（全站 mk 体系档位：≥2000px 字号放大；zoom 档 ≥2800px→1.15、≥3600px→1.3） ========== */
@media (min-width: 2000px) {
  .mono { font-size: 13.5px; }
  .ac-mcp__row { padding: 12px 18px; }
  .ac-mcp__main strong { font-size: 14px; }
  .ac-mcp__id { font-size: 12px; }
  .ac-mcp__type, .ac-mcp__endpoint { font-size: 12.5px; }
}
@media (min-width: 2800px) {
  .mono { font-size: 15.5px; }
  .ac-mcp__row { padding: 14px 22px; }
  .ac-mcp__main strong { font-size: 16px; }
  .ac-mcp__id { font-size: 14px; }
  .ac-mcp__type, .ac-mcp__endpoint { font-size: 14.5px; }
}
@media (min-width: 3600px) {
  .mono { font-size: 18px; }
  .ac-mcp__row { padding: 16px 26px; }
  .ac-mcp__main strong { font-size: 18.5px; }
  .ac-mcp__id { font-size: 16px; }
  .ac-mcp__type, .ac-mcp__endpoint { font-size: 17px; }
}

/* ================= 暗色模式（D1 补完）：外挂能力 ================= */
html[data-theme='dark'] {
  .ac-error { background: rgba(248, 113, 113, 0.1); }
  .ac-mcp__dot.is-off { background: #4a5874; }
}
</style>
