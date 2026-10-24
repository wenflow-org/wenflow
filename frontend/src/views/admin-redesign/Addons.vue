<template>
  <!-- 插件（2026-10-20 用户拍板：原「外挂能力」统一叫「插件」）：
       2026-10-19 从「模型与接入」宿主拆为独立页并归入侧栏 Skill 组。插件是能力 bundle，
       成员是运行时 Skill；停用插件不改变主流程结构，缺的那一步走各卡标注的降级路径。
       旧深链 ?tab=addons / /admin/addons / /admin/external-capabilities 由路由改投到本页。 -->
  <div class="mk-page">
    <!-- 2026-10-23 用户「已经有刷新，为什么还有独立刷新」：本页数据（能力配置 / MCP 服务）
         跟随顶栏刷新广播 liveRefreshSeq，页头不再出第二颗刷新钮。 -->
    <MkPageHead
      title="插件"
      sub="可选能力与 MCP 服务"
    />

    <!-- ① 插件 + ② MCP 服务：堆叠单列全宽（2026-09-29 实测半宽卡内能力表 874px 溢出
         506px 容器，并栏不可行；审核 #157 删除恒 false 的 sideBySide 死分支与不可达 CSS） -->
    <div class="ac-cards">

    <!-- ① 插件（2026-10-21 重设计：四张等高卡 → 一张能力表）。
         原设计每组一张卡，卡头「已单独配置」与每个成员的「已单独配置」重复、卡尾再压一段
         「关闭后」说明与「最近 从未」，四张卡几乎一样高且信息密度低。
         现在一行一组：能力 / 成员 / 模型路由 / 最近调用 / 操作；降级行为收进行悬停。 -->
    <div class="mk-card">
      <div class="mk-card__head">
        <!-- 2026-10-23 走查：卡头不复述页名（「插件」页里再挂一枚「插件」标题） -->
        <h3 class="mk-card__title">可选能力</h3>
        <span class="mk-card__meta">{{ pluginRows.length }} 组 · {{ pluginMemberCount }} 个 Skill</span>
      </div>
      <div v-if="configsFailed" class="mk-alert mk-alert--row ac-error" role="alert">
        <span class="mk-alert__msg">插件配置加载失败，以下状态为占位，无法反映真实路由。</span>
        <button type="button" class="mk-alert__btn" @click="loadConfigs">重试</button>
      </div>
      <MkLoading v-if="loading" min text="插件配置加载中…" />
      <div v-else class="mk-table-scroll">
        <table class="mk-table ac-pi-table">
          <thead>
            <tr>
              <th scope="col">能力</th>
              <th scope="col">成员与模型路由</th>
              <th scope="col">最近调用</th>
              <th scope="col" class="mk-th--right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in pluginRows" :key="p.id" :title="pluginRowTitle(p)">
              <td>
                <div class="ac-pi__id">
                  <span class="ac-pi__glyph" aria-hidden="true">{{ p.glyph }}</span>
                  <div class="mk-cell-main">
                    <strong>{{ p.name }}</strong>
                    <span class="mk-cell-sub">{{ p.description }}</span>
                  </div>
                </div>
              </td>
              <!-- 2026-10-24 用户「为什么不能 ui 配置」：组级「已单独配置」把多个成员混成一个结论，
                   而且配好之后操作列连入口都没有。改成逐成员一行：名字（进 Skill 详情）+ 当前路由 + 就地「配置」。 -->
              <td>
                <div class="ac-pi__members">
                  <div v-for="m in p.members" :key="m.id" class="ac-pi__member-row">
                    <button
                      type="button"
                      class="ac-pi__member"
                      :title="`${m.name}（${m.id}）：${m.routeTitle}`"
                      @click="openSkillDrawer(m.id)"
                    ><span>{{ m.name }}</span></button>
                    <span class="mk-badge mk-badge--sm ac-pi__route" :class="m.stateClass" :title="m.routeTitle">{{ m.routeLabel }}</span>
                    <button type="button" class="mk-link ac-pi__cfg" :aria-label="`配置 ${m.name} 的模型路由`" @click="openRouteConfig(m)">配置</button>
                  </div>
                  <!-- MCP 组的服务可用性是另一个维度（模型路由之外），跟在成员后面单独说 -->
                  <span v-if="p.availability" class="ac-pi__availability" :class="p.availability.stateClass">{{ p.availability.text }}</span>
                </div>
              </td>
              <td><span class="ac-pi__last">{{ p.last }}</span></td>
              <td class="ac-pi__actions">
                <div class="mk-actions">
                  <button v-if="p.hasStats" type="button" class="mk-link" @click="goLogs(p.primary)">日志</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ② MCP 服务 -->
    <div class="mk-card ac-mcp-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">MCP 服务</h3>
        <div class="mk-actions">
          <button type="button" class="mk-link" @click="openToolCreate">新建 MCP 服务</button>
        </div>
      </div>
      <div class="ac-mcp" v-if="mcpTools.length">
        <div v-for="t in mcpTools" :key="t.id" class="ac-mcp__row">
          <span class="ac-mcp__dot" :class="t.enabled ? 'is-on' : 'is-off'"></span>
          <div class="ac-mcp__main" :title="`${t.name}（${t.id}）`">
            <strong>{{ t.name }}</strong>
          </div>
          <!-- 类型/端点是中文短标签（文件系统 / 本机进程），走正文无衬线 -->
          <span class="ac-mcp__type">
            <span v-if="t.transport === 'mcp'" class="mk-badge mk-badge--info">MCP</span>
            <template v-else>{{ mcpTypeText(t.type) }}</template>
          </span>
          <span class="ac-mcp__endpoint" :title="endpointTitle(t.endpoint)">{{ endpointLabel(t.endpoint) }}</span>
          <span class="mk-badge" :class="t.enabled ? 'mk-badge--ok' : 'mk-badge--muted'">{{ t.enabled ? '启用' : '停用' }}</span>
          <div class="mk-actions">
            <button
              v-if="t.transport === 'mcp'"
              type="button"
              class="mk-link"
              :disabled="discoveringId === t.id"
              :title="discoveredMap[t.id]?.join(', ')"
              @click="discoverTools(t)"
            >
              {{ discoveringId === t.id ? '发现中…' : (discoveredMap[t.id] ? `工具 ${discoveredMap[t.id].length}` : '发现工具') }}
            </button>
            <button type="button" class="mk-link" :disabled="testingId === t.id" @click="testTool(t)">
              {{ testingId === t.id ? '测试中…' : '测试' }}
            </button>
            <span v-if="testResult?.id === t.id" class="ac-mcp__test" :class="testResult.ok ? 'is-ok' : 'is-bad'">
              {{ testResult.ok ? `通过 · ${testResult.latencyMs}ms` : `失败 · ${testResult.error || ''}` }}
            </span>
            <div class="mk-menu">
              <button type="button" class="mk-menu__btn" aria-label="更多操作" aria-haspopup="menu" :aria-expanded="openMenu === t.id" @click.stop="toggleMenu(t.id)">⋯</button>
              <div v-if="openMenu === t.id" class="mk-menu__pop" :style="popStyle" @click.stop>
                <button type="button" class="mk-menu__item" @click="menuEdit(t)">编辑</button>
                <div class="mk-menu__sep"></div>
                <button type="button" class="mk-menu__item mk-menu__item--danger" @click="menuRemove(t)">删除</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <MkLoading v-else-if="mcpLoading" min />
      <MkEmptyState
        v-else
        :tone="mcpFailed ? 'error' : 'neutral'"
        :icon="mcpFailed ? '!' : ''"
        :title="mcpFailed ? 'MCP 服务加载失败' : '暂无 MCP 服务'"
        :description="mcpFailed ? '无法从后端拉取 MCP 服务列表。' : ''"
        :action-text="mcpFailed ? '重试' : ''"
        action-busy-text="重试中…"
        :action-busy="mcpLoading"
        min
        @action="loadMcpTools"
      />
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
            <input v-model="toolForm.id" class="mk-field__input" placeholder="例如：web-search / text-to-image" :disabled="!!toolEditingId" />
            <span v-if="toolErrors.id" class="mk-field__err">{{ toolErrors.id }}</span>
          </label>
          <label class="mk-field" :class="{ 'mk-field--error': toolErrors.name }">
            <span class="mk-field__label">名称</span>
            <input v-model="toolForm.name" class="mk-field__input" placeholder="例如：网页搜索" />
            <span v-if="toolErrors.name" class="mk-field__err">{{ toolErrors.name }}</span>
          </label>
          <div class="ac-mcp__formrow ac-mcp__formrow--three">
            <label class="mk-field">
              <span class="mk-field__label">连接方式</span>
              <select v-model="toolForm.transport" class="mk-field__select">
                <option value="http">HTTP 接口</option>
                <option value="mcp">MCP 服务</option>
              </select>
            </label>
            <label class="mk-field">
              <span class="mk-field__label">类型（标注）</span>
              <select v-model="toolForm.type" class="mk-field__select" :disabled="toolForm.transport === 'mcp'">
                <option value="http">HTTP 接口</option>
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
          <label class="mk-field" :class="{ 'mk-field--error': toolErrors.endpoint }">
            <span class="mk-field__label">{{ toolForm.transport === 'mcp' ? 'MCP 服务地址' : 'Endpoint' }}</span>
            <input
              v-model="toolForm.endpoint"
              class="mk-field__input"
              :placeholder="toolForm.transport === 'mcp' ? 'https://…/mcp' : 'https://…'"
            />
            <span v-if="toolErrors.endpoint" class="mk-field__err">{{ toolErrors.endpoint }}</span>
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

    <!-- 模型路由快配（2026-10-24）：插件页只改「这个 Skill 用哪个模型」，
         思考/参数/备用链仍回 Skill 运行时的完整表单，避免在这里长出第二套编辑器。 -->
    <Teleport to="body">
      <div v-if="routeOpen" ref="routeMaskRef" class="mk-modal">
        <div ref="routePanelRef" class="mk-modal__panel" role="dialog" aria-label="配置模型路由">
          <div class="mk-modal__head">
            <h3 class="mk-modal__title">配置模型路由</h3>
            <button type="button" class="mk-modal__close" aria-label="关闭" @click="closeRouteConfig">✕</button>
          </div>
          <div class="mk-modal__body">
            <p class="ac-route-target">{{ routeTarget?.name }}<span class="mono">{{ routeTarget?.id }}</span></p>
            <label class="mk-field">
              <span class="mk-field__label">模型</span>
              <MkModelPicker
                aria-label="模型"
                :model-value="routeModel"
                :options="pickerOptions"
                allow-inherit
                inherit-label="跟随平台默认"
                :tier="routeTier"
                @update:model-value="routeModel = $event"
                @pick="onRouteModelPicked"
              />
              <span class="mk-field__hint">只改模型绑定。思考、参数覆盖与备用链在 Skill 运行时里配置。</span>
            </label>
          </div>
          <div class="mk-modal__foot">
            <button type="button" class="mk-link ac-route-full" @click="openFullRuntime">打开完整运行时</button>
            <button type="button" class="mk-btn" @click="closeRouteConfig">取消</button>
            <button type="button" class="mk-btn mk-btn--primary" :disabled="routeSaving" @click="saveRouteConfig">
              {{ routeSaving ? '保存中…' : '保存' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { dataSource, openSkillDrawer, investigateAgent, liveSkillStatsMap } from './store'
import { errMsg, liveRefreshSeq } from './live'
import { adminSkillsApi, adminMcpApi } from '@/api/adminApi'
import { useModelCatalog } from '@/composables/useModelCatalog'
import MkModelPicker, { type MkModelOption } from '@/components/mk/MkModelPicker.vue'
import { PLUGIN_GROUPS, type PluginGroup } from './capabilityCatalog'
import { useEscape } from './useEscape'
import { useOverlay, useMaskClose } from './useOverlay'
import { useRowMenu } from './useRowMenu'
import { askConfirm, doneConfirm, failConfirm } from './useConfirm'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkLoading from '@/components/mk/MkLoading.vue'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import { toast } from '@/utils/toast'

/* 模型目录（模型路由快配的候选）：与 Skill 运行时同一份 File-as-Truth 清单 */
const { pickerOptions, load: loadModelCatalog } = useModelCatalog()
loadModelCatalog()

/* 独立页（2026-10-19）：原 embedded prop 与 count 上报是给「模型与接入」宿主页签用的，
   页签撤除后一并删除——页头刷新直接调两个加载器。 */
async function refreshAll() {
  await Promise.all([loadConfigs(), loadMcpTools()])
}

/* ---------- ① 插件（能力 bundle → 运行时 Skill） ---------- */
interface PluginMemberRow {
  id: string
  name: string
  hasConfig: boolean
  /** 状态徽标的短文案：实际模型 id / 跟随平台默认 / 路由停用 */
  routeLabel: string
  stateClass: string
  /** 成员 chip 的悬停说明（路由状态人话版） */
  routeTitle: string
  /** 已配置的模型（null = 跟随平台默认） */
  model: string | null
}

interface PluginRow {
  id: string
  name: string
  glyph: string
  description: string
  fallback: string
  primary: string
  members: PluginMemberRow[]
  hasStats: boolean
  /** MCP 组额外展示服务可用性（与模型路由是两个维度，分开写） */
  availability: { text: string; stateClass: string } | null
  last: string
}

/**
 * 路由状态只说「这条 Skill 有没有单独配置」：
 * - skill_model_configs 无行 → 继承平台默认路由，能力仍可用；
 * - 有行且 enabled=false → 不用这条自定义路由，回落到平台默认，不是「能力已关闭」。
 * 页面不把两者写成「启用/停用」，避免一个假开关。
 * 2026-10-24：组级徽标撤掉后，状态落到每个成员自己身上，并给出实际模型名。
 */
function routeState(id: string): {
  hasConfig: boolean
  text: string
  stateClass: string
  label: string
  model: string | null
} {
  if (configsFailed.value) {
    return { hasConfig: false, text: '配置未读取', stateClass: 'mk-badge--warn', label: '状态未知', model: null }
  }
  const c = configMap.value[id]
  if (!c) {
    return { hasConfig: false, text: '继承默认', stateClass: 'mk-badge--muted', label: '跟随平台默认', model: null }
  }
  if (c.enabled === false) {
    return { hasConfig: true, text: '自定义路由停用', stateClass: 'mk-badge--warn', label: '路由停用', model: null }
  }
  const model = typeof c.model === 'string' && c.model.trim() ? c.model.trim() : ''
  return {
    hasConfig: true,
    text: '已单独配置',
    stateClass: 'mk-badge--ok',
    label: model || '跟随平台默认',
    model: model || null,
  }
}

function routeTitle(text: string, model: string | null): string {
  switch (text) {
    case '已单独配置': return model ? `该 Skill 使用单独配置的模型：${model}` : '该 Skill 有独立配置行，模型跟随平台默认'
    case '继承默认': return '未单独配置，使用平台默认路由。能力仍可用'
    case '自定义路由停用': return '不使用该 Skill 的自定义模型路由。回落到平台默认后能力仍可用'
    case '配置未读取': return '配置接口未返回，当前状态未知'
    default: return text
  }
}

/** 整行悬停：这一组停用后的行为（原「关闭后」段落，2026-10-21 收进悬停） */
function pluginRowTitle(p: PluginRow): string {
  return `停用后：${p.fallback}`
}

/** 环境变量占位符（${ENV_VAR} 未替换）判定：直出原文会误导为真实地址，统一显示「未配置」 */
const ENV_PLACEHOLDER = /^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/
function endpointLabel(endpoint: string): string {
  if (ENV_PLACEHOLDER.test(endpoint)) return '未配置'
  // 「local」是 MCP 服务的内部取值（本机进程），运营读不出它是什么
  if (endpoint === 'local') return '本机进程'
  return endpoint || '—'
}
function endpointTitle(endpoint: string): string {
  return ENV_PLACEHOLDER.test(endpoint)
    ? `环境变量 ${endpoint} 未替换（未在服务端配置），该工具当前不可用`
    : endpoint
}
/** MCP 工具类型枚举 → 中文（下拉与表格同一套，避免同屏中英两套） */
const MCP_TYPE_TEXT: Record<string, string> = {
  http: 'HTTP 接口', code: '代码执行', search: '搜索', filesystem: '文件系统', image: '生图'
}
const mcpTypeText = (t: string) => MCP_TYPE_TEXT[t] || t

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

function buildPluginRows(
  groups: readonly PluginGroup[],
  mcpAvailability: { text: string; stateClass: string },
): PluginRow[] {
  return groups.map((group) => {
    const members: PluginMemberRow[] = group.members.map((member) => {
      const route = routeState(member.id)
      return {
        id: member.id,
        name: member.name,
        hasConfig: route.hasConfig,
        routeLabel: route.label,
        stateClass: route.stateClass,
        routeTitle: routeTitle(route.text, route.model),
        model: route.model,
      }
    })
    const last = members
      .map((member) => liveSkillStatsMap.value?.[member.id]?.lastAt)
      .find((value) => value && value !== '从未') || '从未'
    return {
      id: group.id,
      name: group.name,
      glyph: group.glyph,
      description: group.description,
      fallback: group.fallback,
      primary: group.primary,
      members,
      hasStats: members.some((member) => (liveSkillStatsMap.value?.[member.id]?.calls ?? 0) > 0),
      availability: group.id === 'mcp' ? mcpAvailability : null,
      last,
    }
  })
}

/* 2026-09-29 拆回模型与接入宿主 tab 后容器从全宽变为内嵌，半宽卡内能力表 874px 溢出容器
   370px——外挂能力表和 MCP 服务改为堆叠全宽（2026-10-19 独立成页后仍是全宽单列）。
   审核 #157：恒为 false 的 sideBySide 状态位与「行数少时并栏」注释一并删除，
   避免注释与实现长期分叉（并栏分支不可达）。 */

/* ---------- ② MCP 服务（平台工具） ---------- */
interface McpTool {
  id: string
  name: string
  description: string
  type: string
  /** 'http'（通用端点）/ 'mcp'（真 MCP server，工具运行时发现） */
  transport: string
  endpoint: string
  enabled: boolean
}

const mcpTools = ref<McpTool[]>([])
/** MCP 服务列表 loading / 失败（独立于能力配置的 loading，避免两域状态互绑） */
const mcpLoading = ref(false)
const mcpFailed = ref(false)

const mcpAvailability = computed(() => {
  if (mcpLoading.value) return { text: '服务加载中…', stateClass: 'mk-badge--muted' }
  if (mcpFailed.value) return { text: '服务列表未读取', stateClass: 'mk-badge--warn' }
  if (!mcpTools.value.length) return { text: '未登记服务', stateClass: 'mk-badge--muted' }
  const enabled = mcpTools.value.filter((tool) => tool.enabled).length
  if (!enabled) return { text: '服务全部停用', stateClass: 'mk-badge--warn' }
  /* 这里只数「启用」的服务，不代表可达：服务可以 enabled 但连接测试失败
     （实测 file-reader 路径无效仍显示「1 个服务可用」）。可达性看 MCP 服务表里每行的「测试」。 */
  return { text: `${enabled} 个服务启用`, stateClass: 'mk-badge--ok' }
})

/** 运行时统计变化时随重算（最近调用 / 日志入口） */
const pluginRows = computed(() => {
  void liveSkillStatsMap.value
  return buildPluginRows(PLUGIN_GROUPS, mcpAvailability.value)
})
/** 卡头读数：几组能力、几个运行时 Skill（2026-10-21 重设计后卡头只放数据） */
const pluginMemberCount = computed(() => pluginRows.value.reduce((n, p) => n + p.members.length, 0))

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
      transport: String(t.transport || 'http'),
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

/** 独立页（2026-10-19）：数据源切换时自动重拉（上面那个 watch 的 immediate 首拉同款）。
    顶栏刷新经 liveRefreshSeq 广播到本页，页头不再有独立刷新钮（2026-10-23 全站收口）。 */
watch(liveRefreshSeq, () => { void refreshAll() })
defineExpose({ refresh: refreshAll })

/* ---------- MCP 服务弹窗 ---------- */
const toolOpen = ref(false)
const toolEditingId = ref('')
const toolSaving = ref(false)
const toolForm = ref({ id: '', name: '', transport: 'http', type: 'http', endpoint: '', description: '', enabled: true })
const toolErrors = ref<{ id?: string; name?: string; endpoint?: string }>({})
useEscape(() => toolOpen.value, () => { toolOpen.value = false })
const panelRef = ref<HTMLElement | null>(null)
const maskRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => toolOpen.value), panelRef)
useMaskClose(maskRef, () => { toolOpen.value = false })

/* ---------- 模型路由快配（插件页就地改模型绑定） ---------- */
const routeOpen = ref(false)
const routeTarget = ref<PluginMemberRow | null>(null)
const routeModel = ref('')
const routeTier = ref<'chat' | 'reasoning'>('chat')
const routeSaving = ref(false)
const routeMaskRef = ref<HTMLElement | null>(null)
const routePanelRef = ref<HTMLElement | null>(null)
useEscape(() => routeOpen.value, () => closeRouteConfig())
useOverlay(computed(() => routeOpen.value), routePanelRef)
useMaskClose(routeMaskRef, () => closeRouteConfig())

function openRouteConfig(member: PluginMemberRow) {
  const cfg = configMap.value[member.id]
  routeTarget.value = member
  routeModel.value = typeof cfg?.model === 'string' ? cfg.model : ''
  routeTier.value = cfg?.tier === 'reasoning' ? 'reasoning' : 'chat'
  routeOpen.value = true
}

function closeRouteConfig() {
  routeOpen.value = false
  routeTarget.value = null
}

/** 选模型时把层级一起带出（reasoning 模型写 tier=reasoning，与 Skill 运行时同规则） */
function onRouteModelPicked(opt: MkModelOption | null) {
  if (opt?.tier === 'chat' || opt?.tier === 'reasoning') routeTier.value = opt.tier
}

async function saveRouteConfig() {
  const target = routeTarget.value
  if (!target || routeSaving.value) return
  const model = routeModel.value.trim()
  // 没有配置行 + 选择跟随平台默认 = 什么都没改。若照常 upsert 会新建一行
  // （thinkingMode 默认 default，反而覆盖平台默认的 disabled），这里直接当作无操作。
  if (!model && !configMap.value[target.id]) {
    closeRouteConfig()
    return
  }
  routeSaving.value = true
  try {
    await adminSkillsApi.updateSkillModelConfig(target.id, {
      model: model || null,
      tier: routeTier.value,
    })
    toast.success(`${target.name} 的模型路由已保存`)
    closeRouteConfig()
    await loadConfigs()
  } catch (e) {
    toast.error(`保存失败：${errMsg(e)}`)
  } finally {
    routeSaving.value = false
  }
}

/** 完整运行时：思考/参数覆盖/备用链仍在那张表单里，插件页不重复造一套 */
function openFullRuntime() {
  const id = routeTarget.value?.id
  closeRouteConfig()
  if (id) openSkillDrawer(id)
}

function openToolCreate() {
  toolEditingId.value = ''
  toolForm.value = { id: '', name: '', transport: 'http', type: 'http', endpoint: '', description: '', enabled: true }
  toolErrors.value = {}
  toolOpen.value = true
}

function openToolEdit(t: McpTool) {
  toolEditingId.value = t.id
  toolForm.value = {
    id: t.id,
    name: t.name,
    transport: t.transport || 'http',
    type: t.type,
    endpoint: t.endpoint,
    description: t.description,
    enabled: t.enabled
  }
  toolErrors.value = {}
  toolOpen.value = true
}

async function saveTool() {
  toolErrors.value = {}
  if (!toolForm.value.id.trim()) toolErrors.value.id = '请输入工具 ID'
  if (!toolForm.value.name.trim()) toolErrors.value.name = '请输入名称'
  if (!toolForm.value.endpoint.trim()) toolErrors.value.endpoint = '请输入 Endpoint 地址'
  if (Object.keys(toolErrors.value).length) {
    // 兜底：任何字段的校验失败都必须有可见反馈，不能静默 return（此前 endpoint 的错误
    // 没有渲染位，点保存既不提交也无提示，用户读作按钮坏了）
    toast.error('请先补全表单中标红的必填项')
    return
  }
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
    message: `确认删除「${t.name}」（${t.id}）？\n删除后依赖它的插件将无法调用，但主流程仍会继续。`,
    confirmText: '删除',
    busy: true
  })
  if (!ok) return
  try {
    await adminMcpApi.removeTool(t.id)
    await loadMcpTools()
    toast.success('MCP 服务已删除')
    doneConfirm()
  } catch (e) {
    toast.error(`删除失败：${errMsg(e)}`)
    failConfirm()
  }
}

/* ---------- 连通性测试 ---------- */
const testingId = ref('')
const testResult = ref<{ id: string; ok: boolean; latencyMs?: number; error?: string } | null>(null)

/* 行内 ⋯ 菜单：编辑/删除收进菜单，测试（带行内结果）保持平铺 */
const { openMenu, toggleMenu, closeMenu, popStyle } = useRowMenu()

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

/* ---------- MCP 工具发现（transport='mcp'）：工具由服务端 tools/list 动态给出 ---------- */
const discoveringId = ref('')
const discoveredMap = ref<Record<string, string[]>>({})

async function discoverTools(t: McpTool) {
  if (discoveringId.value) return
  discoveringId.value = t.id
  try {
    const res = await adminMcpApi.listMcpTools(t.id, true)
    const body = res.data?.data ?? {}
    const names = ((body.tools || []) as Array<Record<string, unknown>>)
      .map((tool) => String(tool.name || ''))
      .filter(Boolean)
    discoveredMap.value = { ...discoveredMap.value, [t.id]: names }
    toast.success(`「${t.name}」发现 ${names.length} 个工具`)
  } catch (e) {
    toast.error(`发现工具失败：${errMsg(e)}`)
  } finally {
    discoveringId.value = ''
  }
}

/* ---------- 跳转 ---------- */
function goLogs(skillId: string) {
  investigateAgent(skillId)
}

/* toast */
</script>

<style scoped>
/* 独立页（2026-10-19 从「模型与接入」页签拆出）：正文按页滚动（.mk-page 自带内衬，
   与成本分析 / 健康中心同款），不再需要宿主 flex 列里的内滚容器。 */
.mono { font-family: var(--mk-mono); font-size: var(--mk-fs-micro); }

/* 插件能力表（2026-10-21 重设计）：一行一组能力，替代原来的四张等高卡。
   成员不再逐条挂「已单独配置」徽章（与组级徽章重复），路由状态收在成员 chip 的悬停里。 */
.ac-pi-table { width: 100%; }
.ac-pi-table th { white-space: nowrap; }
.ac-pi-table td { vertical-align: middle; }
.ac-pi-table tbody tr:hover { background: var(--mk-hover-surface); }
.ac-pi__id { display: flex; align-items: center; gap: 10px; min-width: 0; }
.ac-pi__glyph {
  flex: none;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--mk-surface-3);
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  font-weight: 700;
}
.ac-pi__members { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
/* 逐成员一行：名字（进详情）+ 当前路由 + 就地配置 */
.ac-pi__member-row { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.ac-pi__route {
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--mk-mono);
  font-size: var(--mk-fs-micro);
}
.ac-pi__cfg { font-size: var(--mk-fs-micro); }
.ac-pi__member {
  padding: 3px 9px;
  border: 1px solid var(--mk-line);
  border-radius: 999px;
  background: var(--mk-surface-2);
  color: var(--mk-ink);
  font: inherit;
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.ac-pi__member:hover { border-color: color-mix(in srgb, var(--mk-blue) 50%, transparent); }

.ac-pi__availability { font-size: var(--mk-fs-micro); color: var(--mk-muted); white-space: nowrap; }
.ac-pi__last { font-size: var(--mk-fs-micro); color: var(--mk-faint); white-space: nowrap; }
.ac-pi__actions { text-align: right; }
.ac-pi__actions .mk-actions { justify-content: flex-end; }

/* 两卡容器：堆叠单列全宽（并栏分支 2026-09-29 实测溢出后退役，审核 #157 清掉不可达规则） */
.ac-cards {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 12px;
  align-items: stretch;
}
/* 卡片可压缩：左卡宽表 min-content 会撑爆 1fr，饿死右卡导致 MCP 行逐字竖排 */
.ac-cards > .mk-card { min-width: 0; }

/* 能力配置加载失败错误条：外形走 .mk-alert--row，本类只保留卡内位置 */
.ac-error { margin: 12px 16px 0; }


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
.ac-mcp__dot.is-on { background: var(--mk-green); box-shadow: 0 0 0 3px color-mix(in srgb, var(--mk-green) 12%, transparent); }
.ac-mcp__dot.is-off { background: var(--mk-faint); }
.ac-mcp__main { display: grid; gap: 1px; min-width: 0; }
.ac-mcp__main strong { font-size: var(--mk-fs-micro); font-weight: 600; color: var(--mk-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ac-mcp__type { font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.ac-mcp__test { font-size: var(--mk-fs-micro); font-weight: 700; white-space: nowrap; }
.ac-mcp__test.is-ok { color: var(--mk-green); }
.ac-mcp__test.is-bad { color: var(--mk-red); max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
.ac-mcp__endpoint {
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ac-mcp__formrow { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.ac-mcp__formrow--three { grid-template-columns: 1fr 1fr 1fr; }

/* MCP 卡片作为容器：行按「卡片自身宽度」重排，而非视口宽度
   （并栏时卡片可能远窄于视口，视口断点不触发） */
.ac-mcp-card { container-type: inline-size; }

/* 窄卡：MCP 行两行重排（状态点/名称/徽标一行，类型/endpoint 次行，操作收底行） */
@container (max-width: 540px) {
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

/* 模型路由快配弹窗：成员身份 + 只读提示；左下「打开完整运行时」与右侧取消/保存同排 */
.ac-route-target {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 0;
  font-weight: 600;
}
.ac-route-target .mono { font-weight: 400; color: var(--mk-muted); font-size: var(--mk-fs-micro); }
.ac-route-full { margin-right: auto; align-self: center; }

/* ========== 大屏/4K 适配（全站 mk 体系档位：≥2000px 字号放大；zoom 档 ≥2800px→1.15、≥3600px→1.3） ========== */
@media (min-width: 2000px) {
  .mono { font-size: var(--mk-fs-micro); }
  .ac-mcp__row { padding: 12px 18px; }
  .ac-mcp__main strong { font-size: var(--mk-fs-body); }
    .ac-mcp__type, .ac-mcp__endpoint { font-size: var(--mk-fs-micro); }
}
@media (min-width: 2800px) {
  .mono { font-size: var(--mk-fs-micro); }
  .ac-mcp__row { padding: 14px 22px; }
  .ac-mcp__main strong { font-size: var(--mk-fs-micro); }
    .ac-mcp__type, .ac-mcp__endpoint { font-size: var(--mk-fs-micro); }
}
@media (min-width: 3600px) {
  .mono { font-size: var(--mk-fs-body); }
  .ac-mcp__row { padding: 16px 26px; }
  .ac-mcp__main strong { font-size: var(--mk-fs-emphasis); }
    .ac-mcp__type, .ac-mcp__endpoint { font-size: var(--mk-fs-body); }
}

/* ================= 暗色模式（D1 补完）：外挂能力 ================= */
html[data-theme='dark'] {
  .ac-error { background: rgba(248, 113, 113, 0.1); }
  /* .ac-mcp__dot.is-off 不再重写：基础规则已走 var(--mk-faint)，暗色下自动取 #7a7e85 */
}
</style>
