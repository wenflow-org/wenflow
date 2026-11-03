<template>
  <!-- 插件（2026-10-20 用户拍板：原「外挂能力」统一叫「插件」）：
       2026-10-19 从「模型与接入」宿主拆为独立页并归入侧栏 Skill 组。插件是能力 bundle，
       成员是运行时 Skill；停用插件不改变主流程结构，缺的那一步走各卡标注的降级路径。
       旧深链 ?tab=addons / /admin/addons / /admin/external-capabilities 由路由改投到本页。 -->
  <div class="mk-page">
    <!-- 2026-10-23 用户「已经有刷新，为什么还有独立刷新」：本页数据（能力配置 / MCP 服务）
         跟随顶栏刷新广播 liveRefreshSeq，页头不再出第二颗刷新钮。
         2026-10-27 用户「mcp 和可选能力有什么不一样」：MCP 服务是 MCP 工具调用的子资源，
         不再另起一张同权卡；新建入口跟着 MCP 能力行走，页头不再挂全局「新建 MCP 服务」。 -->
    <MkPageHead title="插件" />

    <!-- 可选能力（2026-10-27 bento 重设计）：
         三张内置能力卡并排（联网 / 决策 / 生图），MCP 工具调用占一整行——
         它不是第四张同形卡，而是带子资源的容器：能力头在下、服务列表挂在卡内。
         这样「可选能力」回答开没开、最近用没用；MCP 卡再回答「接了哪些服务」。 -->
    <section class="ac-section">
      <div class="ac-section__head">
        <h2 class="ac-section__title">可选能力</h2>
        <span v-if="pluginStateFailed" class="mk-badge mk-badge--warn">启停状态未读取</span>
        <span class="ac-section__meta">{{ pluginRows.length }} 项能力 · {{ pluginMemberCount }} 个 Skill</span>
      </div>
      <div v-if="configsFailed" class="mk-alert mk-alert--row ac-error" role="alert">
        <span class="mk-alert__msg">{{ configErrorText }}</span>
        <button type="button" class="mk-alert__btn" @click="loadPluginConfigs">重试</button>
      </div>
      <!-- 首载骨架：保持三卡 + 全宽 MCP 卡的位置，数据到达不跳版 -->
      <div v-if="loading" class="ac-cap-grid" aria-hidden="true">
        <div v-for="n in 3" :key="n" class="mk-skeleton ac-cap-skel"></div>
        <div class="mk-skeleton ac-cap-skel ac-cap-skel--wide"></div>
      </div>
      <div v-else class="ac-cap-grid">
        <article
          v-for="p in pluginRows"
          :key="p.id"
          class="ac-cap"
          :class="{ 'is-off': !pluginEnabled(p.id), 'ac-cap--wide': p.id === 'mcp' }"
        >
          <header class="ac-cap__head">
            <span class="ac-cap__glyph" aria-hidden="true">
              <component :is="p.icon" :size="18" :stroke-width="1.8" />
            </span>
            <div class="ac-cap__id">
              <strong>{{ p.name }}</strong>
              <span class="ac-cap__last">{{ p.last === '从未' ? '从未调用' : `最近 ${p.last}` }}</span>
            </div>
            <div class="ac-cap__actions">
              <MkSwitch
                :model-value="pluginEnabled(p.id)"
                :state-text="pluginEnabled(p.id) ? '启用' : '停用'"
                :busy="pluginBusy === p.id"
                :aria-label="`${p.name}插件开关`"
                @update:model-value="togglePlugin(p.id, $event)"
              />
              <!-- MCP 的入口是「新建服务」；其余能力的入口是服务配置 -->
              <button v-if="p.id === 'mcp'" type="button" class="mk-btn mk-btn--sm" @click="openToolCreate">新建服务</button>
              <button v-else type="button" class="mk-btn mk-btn--sm" @click="openConfig(p)">配置</button>
            </div>
          </header>
          <div class="ac-cap__meta">
            <span v-if="membersText(p)" class="ac-cap__members">{{ membersText(p) }}</span>
            <button v-if="p.errorCount > 0" type="button" class="mk-link ac-cap__fail" @click="goLogs(p.primary)">查失败</button>
          </div>

          <!-- MCP 服务是 MCP 工具调用的子资源：同一张卡内展开，独立开关/测试/发现工具 -->
          <div v-if="p.id === 'mcp'" class="ac-mcp__body">
            <div v-if="mcpTools.length" class="ac-mcp__list">
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
                <MkSwitch
                  :model-value="t.enabled"
                  :state-text="t.enabled ? '启用' : '停用'"
                  :busy="toolBusy === t.id"
                  :aria-label="`${t.name}服务开关`"
                  @update:model-value="toggleToolEnabled(t, $event)"
                />
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
                  <button v-if="testResult?.id === t.id && !testResult.ok" type="button" class="mk-link" @click="openToolEdit(t)">编辑</button>
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
            <!-- 子列表局部加载：MkLoading 的 min 会按整页口径撑高，卡内只剩空白 -->
            <MkSkeleton v-else-if="mcpLoading" variant="rows" :count="3" :h="36" />
            <MkEmptyState
              v-else
              :tone="mcpFailed ? 'error' : 'neutral'"
              :icon="mcpFailed ? '!' : ''"
              :title="mcpFailed ? 'MCP 服务加载失败' : '暂无 MCP 服务'"
              :description="mcpFailed ? mcpErrorText : ''"
              :action-text="mcpFailed ? '重试' : '新建服务'"
              action-busy-text="重试中…"
              :action-busy="mcpLoading"
              compact
              @action="mcpFailed ? loadMcpTools() : openToolCreate()"
            />
          </div>
        </article>
      </div>
    </section>

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
            <!-- 编辑态：ID 是主键不可改（输入框禁用），红星撤下、改挂锁定说明——
                 否则禁用框带必填星号会被读成「该填但填不了」（2026-10-31 四轮评审 P0-3） -->
            <span class="mk-field__label">
              工具 ID
              <em v-if="!toolEditingId" class="mk-field__req">*</em>
              <em v-else class="ac-field__locked">创建后不可修改</em>
            </span>
            <input v-model="toolForm.id" class="mk-field__input" placeholder="例如：web-search / text-to-image" :disabled="!!toolEditingId" />
            <span v-if="toolErrors.id" class="mk-field__err">{{ toolErrors.id }}</span>
          </label>
          <label class="mk-field" :class="{ 'mk-field--error': toolErrors.name }">
            <span class="mk-field__label">名称 <em class="mk-field__req">*</em></span>
            <input v-model="toolForm.name" class="mk-field__input" placeholder="例如：网页搜索" />
            <span v-if="toolErrors.name" class="mk-field__err">{{ toolErrors.name }}</span>
          </label>
          <div class="ac-mcp__formrow">
            <label class="mk-field">
              <span class="mk-field__label">连接方式</span>
              <MkSelect v-model="toolForm.transport" :options="TRANSPORT_OPTIONS" aria-label="连接方式" block />
            </label>
            <label class="mk-field">
              <span class="mk-field__label">类型</span>
              <MkSelect
                v-model="toolForm.type"
                :options="TOOL_TYPE_OPTIONS"
                aria-label="类型"
                :disabled="toolForm.transport === 'mcp'"
                block
              />
            </label>
          </div>
          <label class="mk-field" :class="{ 'mk-field--error': toolErrors.endpoint }">
            <span class="mk-field__label">服务地址 <em class="mk-field__req">*</em></span>
            <input
              v-model="toolForm.endpoint"
              class="mk-field__input"
              :placeholder="toolForm.transport === 'mcp' ? 'https://…/mcp' : 'https://…'"
            />
            <span v-if="toolErrors.endpoint" class="mk-field__err">{{ toolErrors.endpoint }}</span>
          </label>
          <label class="mk-field">
            <!-- 必填项已带 *，非必填不再追加「（可选）」 -->
            <span class="mk-field__label">描述</span>
            <textarea v-model="toolForm.description" class="mk-field__textarea" rows="2"></textarea>
          </label>
        </div>
        <div class="mk-modal__foot">
          <button type="button" class="mk-btn" @click="toolOpen = false">取消</button>
          <button type="button" class="mk-btn mk-btn--primary" :disabled="toolSaving || !toolForm.id.trim() || !toolForm.name.trim() || !toolForm.endpoint.trim()" @click="saveTool">
            {{ toolSaving ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>
    </div>
    </Teleport>

    <!-- 插件服务配置（2026-10-24 用户「联网是配置模型吗」）：
         联网 = 搜索/抓取 provider 的密钥与入口；决策 = 判定模型端点；生图 = 生图端点与模型。
         这里不碰 Skill 的 LLM 模型绑定（那在 Skill 运行时的模型面板里）。 -->
    <Teleport to="body">
      <div v-if="configOpen" ref="configMaskRef" class="mk-modal">
        <div ref="configPanelRef" class="mk-modal__panel mk-modal__panel--wide" role="dialog" aria-label="插件服务配置">
          <div class="mk-modal__head">
            <h3 class="mk-modal__title">{{ configTarget?.label }} · 服务配置</h3>
            <button type="button" class="mk-modal__close" aria-label="关闭" @click="closeConfig">✕</button>
          </div>
          <div class="mk-modal__body">
            <!-- 资料采集去哪了（2026-10-31 四轮评审 P0-4）：联网卡列了三个成员能力
                 （网页搜索/网页抓取/资料采集），配置弹窗却只有 搜索/抓取 两条通道——
                 资料采集是编排 Skill，复用这两条通道取数，没有自己的 provider 链；
                 不造假通道行，用一行说明把口径闭合。 -->
            <p v-if="configTarget?.id === 'web'" class="ac-config-note">
              资料采集不单独配密钥：它复用「搜索 / 抓取」两条通道取数。这两条通道配好，联网的三个成员能力即可用。
            </p>
            <!-- 优先级（2026-10-26 用户两次走查：「这个真的很丑」「本身是三选一，然后用户可以
                 自己配置优先级」）：每通道一条链，第一位是主用，其余是备用；顺序由用户自己排，
                 也可以把 provider 加进/移出链。
                 原先那行只读的「TinyFish → Tavily → Exa」+ 5 张平铺 provider 卡，读出的是
                 「这些都在用」，而运行时其实只有一个首选——顺序必须能改，且只展示链上的人。 -->
            <div v-for="channel in configTarget?.channels ?? []" :key="channel.id" class="ac-prio">
              <span class="ac-prio__k">{{ channel.label }}</span>
              <div class="ac-prio__list">
                <span
                  v-for="(pid, i) in orderOf(channel.id)"
                  :key="pid"
                  class="ac-prio__item"
                  :title="providerConfiguredOf(pid) ? '已配置' : '缺少密钥'"
                >
                  <span class="ac-prio__rank">{{ i === 0 ? '主用' : `备用 ${i}` }}</span>
                  <strong class="ac-prio__name">{{ providerLabelOf(pid) }}</strong>
                  <span class="ac-prio__ops">
                    <!-- 排序箭头只在 ≥2 个服务时出现（2026-10-31 四轮评审）：只有一个主用时
                         ↑↓ 无效且挤在胶囊里 -->
                    <template v-if="orderOf(channel.id).length > 1">
                      <button type="button" class="ac-prio__op" aria-label="上移" :disabled="i === 0"
                              @click="moveInOrder(channel.id, i, -1)">↑</button>
                      <button type="button" class="ac-prio__op" aria-label="下移"
                              :disabled="i === orderOf(channel.id).length - 1"
                              @click="moveInOrder(channel.id, i, 1)">↓</button>
                    </template>
                    <button type="button" class="ac-prio__op" aria-label="移出链"
                            :disabled="orderOf(channel.id).length === 1"
                            @click="removeFromOrder(channel.id, i)">✕</button>
                  </span>
                </span>
                <!-- 2026-10-27 原生 select → MkSelect：触发器常驻「＋ 加入备用」，
                     选中后由 setOrder 追加并保持 modelValue=''（原生 select 需手动复位已不需要） -->
                <MkSelect
                  v-if="availableOf(channel.id).length"
                  :model-value="''"
                  :options="addOptionsOf(channel)"
                  :aria-label="`把 provider 加入${channel.label}备用`"
                  size="sm"
                  @change="onAddToOrder(channel.id, $event)"
                />
              </div>
            </div>
            <!-- 字段只给链上的 provider（其余不参与调用，也不占版面） -->
            <section class="ac-config-provider" v-for="provider in chainProviders" :key="provider.id">
              <header class="ac-config-provider__head">
                <strong class="ac-config-provider__name">{{ provider.label }}</strong>
                <span class="ac-config-provider__badges">
                  <span class="mk-badge" :class="provider.configured ? 'mk-badge--ok' : 'mk-badge--warn'">
                    {{ provider.configured ? '已配置' : '缺少密钥' }}
                  </span>
                </span>
              </header>
              <div class="ac-config-fields">
                <label class="mk-field" v-for="field in provider.fields" :key="field.key">
                  <span class="mk-field__label">{{ field.label }}</span>
                  <input
                    v-model="draft[provider.id][field.key]"
                    class="mk-field__input"
                    :type="field.type"
                    :placeholder="field.placeholder"
                    :autocomplete="field.secret ? 'new-password' : 'off'"
                  />
                </label>
              </div>
              <div v-if="provider.keySource === 'db' || clearKeys[provider.id]" class="ac-config-provider__foot">
                <button
                  type="button"
                  class="mk-link"
                  @click="toggleClearKey(provider.id)"
                >{{ clearKeys[provider.id] ? '取消清除' : '清除已保存密钥' }}</button>
              </div>
            </section>
          </div>
          <div class="mk-modal__foot">
            <button type="button" class="mk-btn" @click="closeConfig">取消</button>
            <button type="button" class="mk-btn mk-btn--primary" :disabled="configSaving" @click="saveConfig">
              {{ configSaving ? '保存中…' : '保存' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, type Component } from 'vue'
import { Globe, Image as ImageIcon, Scale, Wrench } from 'lucide-vue-next'
import { dataSource, investigateAgent, liveSkillStatsMap } from './store'
import { errMsg, liveRefreshSeq } from './live'
import { adminMcpApi, adminPluginsApi } from '@/api/adminApi'
import { PLUGIN_GROUPS, type PluginGroup, type PluginId } from './capabilityCatalog'
import { useEscape } from './useEscape'
import { useOverlay, useMaskClose } from './useOverlay'
import { useRowMenu } from './useRowMenu'
import { askConfirm, doneConfirm, failConfirm } from './useConfirm'
import MkEmptyState from '@/components/mk/MkEmptyState.vue'
import MkSkeleton from '@/components/mk/MkSkeleton.vue'
import MkSwitch from '@/components/mk/MkSwitch.vue'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import MkSelect from '@/components/mk/MkSelect.vue'
import { toast } from '@/utils/toast'

/* 独立页（2026-10-19）：原 embedded prop 与 count 上报是给「模型与接入」宿主页签用的，
   页签撤除后一并删除——页头刷新直接调三个加载器。 */
async function refreshAll() {
  await Promise.all([loadPluginConfigs(), loadMcpTools(), loadPluginStates()])
}

/* ---------- ① 插件（能力 bundle → 运行时 Skill） ---------- */
interface PluginMemberRow {
  id: string
  name: string
}

interface PluginRow {
  id: string
  name: string
  /** 能力图标（2026-10-27 用户「能换个图标吗」：中文单字 glyph → lucide 线性图标） */
  icon: Component
  primary: string
  members: PluginMemberRow[]
  /** 窗口内有失败调用的成员数 > 0：决定「查失败」入口出不出现（零失败的插件不该给这颗钮） */
  errorCount: number
  /** MCP 组额外展示服务可用性（与模型路由是两个维度，分开写） */
  availability: { text: string; stateClass: string } | null
  last: string
}

/**
 * 2026-10-24：列表页只回答「这个插件开没开」，模型路由细节收进「配置」弹窗。
 * 这里不再把「有没有配置行」翻译成组级徽标——那是把成员状态混成一个结论。
 */

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
/** 成员行去重（2026-10-24）：成员名与组名相同时不再逐字复述，
    只保留可用性短语（如「2 个服务可用」）；两者都没有时整行不渲染。 */
function membersText(p: PluginRow): string {
  const names = p.members.map((m) => m.name).filter((n) => !!n && n !== p.name)
  const parts: string[] = [...names]
  if (p.availability) parts.push(p.availability.text)
  return parts.join(' · ')
}
/** MCP 工具类型枚举 → 中文（下拉与表格同一套，避免同屏中英两套）。
    http 档叫「HTTP 工具」而非「HTTP 接口」：连接方式下拉的 http 档已叫后者，
    并排两框曾显示一模一样的「HTTP 接口」，读作绑定写重（2026-10-31 三轮评审）。 */
const MCP_TYPE_TEXT: Record<string, string> = {
  http: 'HTTP 工具', code: '代码执行', search: '搜索', filesystem: '文件系统', image: '生图'
}
const mcpTypeText = (t: string) => MCP_TYPE_TEXT[t] || t

/* ---------- 插件外部服务配置（联网 / 决策 / 生图） ---------- */
interface PluginProviderField {
  key: string
  label: string
  type: 'text' | 'password'
  value: string
  placeholder: string
  secret: boolean
}
interface PluginProvider {
  id: string
  label: string
  configured: boolean
  keySource: 'db' | 'env' | 'none'
  keyHint: string | null
  fields: PluginProviderField[]
}
interface PluginConfig {
  id: string
  label: string
  channels: Array<{ id: string; label: string; order: string[] }>
  providers: PluginProvider[]
}

const providerConfigs = ref<Record<string, PluginConfig>>({})
const loading = ref(false)
/** 服务配置拉取失败：保留现有列表并展示错误条，避免把未知状态读成「未配置」 */
const configsFailed = ref(false)
/** 后端原文（错误原文保留，运营据此判断是网关、权限还是配置） */
const configErrorText = ref('')
/** MCP 列表拉取失败原因（同口径） */
const mcpErrorText = ref('')

async function loadPluginConfigs() {
  loading.value = true
  configsFailed.value = false
  try {
    const res = await adminPluginsApi.getConfig()
    const list = res.data?.data?.plugins
    const map: Record<string, PluginConfig> = {}
    if (Array.isArray(list)) {
      for (const plugin of list as PluginConfig[]) {
        if (plugin?.id) map[plugin.id] = plugin
      }
    }
    providerConfigs.value = map
  } catch (e) {
    configsFailed.value = true
    configErrorText.value = errMsg(e)
    toast.error(`插件服务配置加载失败：${errMsg(e)}`)
  } finally {
    loading.value = false
  }
}

/** 能力图标：中文单字 glyph 换成可扫读的线性图标 */
const PLUGIN_ICONS: Record<PluginId, Component> = {
  web: Globe,
  decision: Scale,
  image: ImageIcon,
  mcp: Wrench,
}

function buildPluginRows(
  groups: readonly PluginGroup[],
  mcpAvailability: { text: string; stateClass: string },
): PluginRow[] {
  return groups.map((group) => {
    const members: PluginMemberRow[] = group.members.map((member) => ({
      id: member.id,
      name: member.name,
    }))
    const last = members
      .map((member) => liveSkillStatsMap.value?.[member.id]?.lastAt)
      .find((value) => value && value !== '从未') || '从未'
    return {
      id: group.id,
      name: group.name,
      icon: PLUGIN_ICONS[group.id],
      primary: group.primary,
      members,
      errorCount: members.reduce((n, member) => n + (liveSkillStatsMap.value?.[member.id]?.errors ?? 0), 0),
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
  } catch (e) {
    mcpTools.value = []
    mcpFailed.value = true
    mcpErrorText.value = errMsg(e)
  } finally {
    mcpLoading.value = false
  }
}
watch(
  () => [dataSource.value],
  () => {
    void loadPluginConfigs()
    void loadMcpTools()
    void loadPluginStates()
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
/* 2026-10-27 原生 select → MkSelect：文案与原 <option> 逐字一致；
   类型选项从 MCP_TYPE_TEXT 派生，避免下拉与行内展示两套中文名。 */
const TRANSPORT_OPTIONS = [
  { value: 'http', label: 'HTTP 接口' },
  { value: 'mcp', label: 'MCP 服务' }
]
const TOOL_TYPE_OPTIONS = Object.entries(MCP_TYPE_TEXT).map(([value, label]) => ({ value, label }))
useEscape(() => toolOpen.value, () => { toolOpen.value = false })
const panelRef = ref<HTMLElement | null>(null)
const maskRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => toolOpen.value), panelRef)
useMaskClose(maskRef, () => { toolOpen.value = false })

/* ---------- 插件启停（2026-10-24） ---------- */
const pluginStates = ref<Record<string, boolean>>({ web: true, decision: true, image: true, mcp: true })
const pluginStateFailed = ref(false)
/** 在途的插件 id：开关自己 busy，避免连点 */
const pluginBusy = ref('')
const pluginEnabled = (id: string) => pluginStates.value[id] !== false

async function loadPluginStates() {
  try {
    const res = await adminPluginsApi.list()
    const states = res.data?.data?.states
    if (states && typeof states === 'object') pluginStates.value = { ...pluginStates.value, ...states }
    pluginStateFailed.value = false
  } catch (e) {
    pluginStateFailed.value = true
    toast.error(`插件启停状态加载失败：${errMsg(e)}`)
  }
}

async function togglePlugin(id: string, enabled: boolean) {
  if (pluginBusy.value) return
  pluginBusy.value = id
  try {
    const res = await adminPluginsApi.setEnabled(id, enabled)
    const states = res.data?.data?.states
    if (states && typeof states === 'object') pluginStates.value = { ...pluginStates.value, ...states }
    else pluginStates.value = { ...pluginStates.value, [id]: enabled }
    toast.success(enabled ? '插件已启用' : '插件已停用')
  } catch (e) {
    toast.error(`保存失败：${errMsg(e)}`)
  } finally {
    pluginBusy.value = ''
  }
}

/* ---------- 插件服务配置（联网 / 决策 / 生图的 provider 密钥、入口与模型） ---------- */
const configOpen = ref(false)
const configTarget = ref<PluginConfig | null>(null)
const configSaving = ref(false)
/** providerId → fieldKey → 草稿值。密钥字段留空 = 不修改 */
const draft = ref<Record<string, Record<string, string>>>({})
/** channelId → 有序 provider id 草稿（第一位 = 主用；保存时整体提交） */
const orderDraft = ref<Record<string, string[]>>({})
/** providerId → 是否清除已存密钥 */
const clearKeys = ref<Record<string, boolean>>({})
const configMaskRef = ref<HTMLElement | null>(null)
const configPanelRef = ref<HTMLElement | null>(null)
useEscape(() => configOpen.value, () => closeConfig())
useOverlay(computed(() => configOpen.value), configPanelRef)
useMaskClose(configMaskRef, () => closeConfig())

function openConfig(group: PluginRow) {
  const cfg = providerConfigs.value[group.id]
  if (!cfg) {
    toast.error('服务配置尚未加载，请刷新后重试')
    return
  }
  configTarget.value = cfg
  const next: Record<string, Record<string, string>> = {}
  for (const provider of cfg.providers) {
    next[provider.id] = {}
    for (const field of provider.fields) {
      if (!field.secret) next[provider.id][field.key] = field.value
    }
  }
  draft.value = next
  // 优先级草稿：每条通道从服务端当前生效顺序起步（平台保存 → 环境变量 → 默认）
  const orders: Record<string, string[]> = {}
  for (const channel of cfg.channels) orders[channel.id] = [...channel.order]
  orderDraft.value = orders
  clearKeys.value = {}
  configOpen.value = true
}

function closeConfig() {
  configOpen.value = false
  configTarget.value = null
  orderDraft.value = {}
  clearKeys.value = {}
}

function toggleClearKey(providerId: string) {
  clearKeys.value = { ...clearKeys.value, [providerId]: !clearKeys.value[providerId] }
}

function providerLabelOf(providerId: string): string {
  return configTarget.value?.providers.find((p) => p.id === providerId)?.label || providerId
}

/* ---------- 通道优先级编辑（2026-10-26）---------- */
function orderOf(channelId: string): string[] {
  return orderDraft.value[channelId] ?? []
}
/** 该通道里还没上链的 provider（「加入备用」下拉的选项） */
function availableOf(channelId: string) {
  const used = new Set(orderOf(channelId))
  return (configTarget.value?.providers ?? []).filter((p) => !used.has(p.id))
}
/** 「加入备用」下拉的选项：首项是常驻占位，其余为该通道尚未上链的 provider */
function addOptionsOf(channel: { id: string }) {
  return [
    { value: '', label: '＋ 加入备用' },
    ...availableOf(channel.id).map((p) => ({ value: p.id, label: p.label }))
  ]
}
function providerConfiguredOf(providerId: string): boolean {
  return configTarget.value?.providers.find((p) => p.id === providerId)?.configured ?? false
}
function setOrder(channelId: string, next: string[]) {
  orderDraft.value = { ...orderDraft.value, [channelId]: next }
}
function moveInOrder(channelId: string, index: number, delta: number) {
  const list = [...orderOf(channelId)]
  const target = index + delta
  if (target < 0 || target >= list.length) return
  ;[list[index], list[target]] = [list[target], list[index]]
  setOrder(channelId, list)
}
/** 移出链：至少留一个，清空会静默回落到环境变量/默认，与用户看到的操作不一致 */
function removeFromOrder(channelId: string, index: number) {
  const list = orderOf(channelId)
  if (list.length <= 1) return
  setOrder(channelId, list.filter((_, i) => i !== index))
}
/** 加入备用链（2026-10-27 原生 select → MkSelect）：change 直接给选中值，
    触发器保持 modelValue=''，不再需要把原生 select 手动复位成 ''。 */
function onAddToOrder(channelId: string, id: string) {
  if (!id) return
  setOrder(channelId, [...orderOf(channelId), id])
}
/** 只给「在链上」的 provider 渲染字段：不在链上的不参与调用，平铺出来会被读成都在用 */
const chainProviders = computed<PluginProvider[]>(() => {
  const ids: string[] = []
  for (const channel of configTarget.value?.channels ?? []) {
    for (const id of orderOf(channel.id)) if (!ids.includes(id)) ids.push(id)
  }
  return ids
    .map((id) => configTarget.value?.providers.find((p) => p.id === id))
    .filter((p): p is PluginProvider => Boolean(p))
})
/** 顺序改过才算脏：只改顺序也要能保存 */
const ordersDirty = computed(() => {
  const cfg = configTarget.value
  if (!cfg) return false
  return cfg.channels.some((ch) => orderOf(ch.id).join(',') !== ch.order.join(','))
})

async function saveConfig() {
  const cfg = configTarget.value
  if (!cfg || configSaving.value) return
  const providers: Record<string, Record<string, string | null> & { clearKey?: boolean }> = {}
  for (const provider of cfg.providers) {
    const patch: Record<string, string | null> & { clearKey?: boolean } = {}
    for (const field of provider.fields) {
      const now = (draft.value[provider.id]?.[field.key] ?? '').trim()
      if (field.secret) {
        if (now) patch[field.key] = now
      } else if (now !== field.value) {
        // 空串 = 删除界面覆盖，回落服务端环境变量
        patch[field.key] = now
      }
    }
    if (clearKeys.value[provider.id]) patch.clearKey = true
    if (Object.keys(patch).length) providers[provider.id] = patch
  }
  const orders = ordersDirty.value
    ? Object.fromEntries(cfg.channels.map((ch) => [ch.id, orderOf(ch.id)]))
    : undefined
  if (!Object.keys(providers).length && !orders) {
    closeConfig()
    return
  }
  configSaving.value = true
  try {
    const res = orders
      ? await adminPluginsApi.saveConfig(cfg.id, providers, orders)
      : await adminPluginsApi.saveConfig(cfg.id, providers)
    const saved = res.data?.data?.plugin as PluginConfig | undefined
    if (saved?.id) providerConfigs.value = { ...providerConfigs.value, [saved.id]: saved }
    toast.success(`${cfg.label}服务配置已保存`)
    closeConfig()
  } catch (e) {
    toast.error(`保存失败：${errMsg(e)}`)
  } finally {
    configSaving.value = false
  }
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

/** MCP 服务启停：落 PUT /admin/mcp/tools/:id 的 enabled（此前只能在编辑弹窗里改，与插件开关两个粒度混在一起） */
const toolBusy = ref('')
async function toggleToolEnabled(t: McpTool, enabled: boolean) {
  if (toolBusy.value) return
  toolBusy.value = t.id
  const before = t.enabled
  t.enabled = enabled
  try {
    await adminMcpApi.updateTool(t.id, { enabled })
    toast.success(enabled ? '服务已启用' : '服务已停用')
  } catch (e) {
    t.enabled = before
    toast.error(`保存失败：${errMsg(e)}`)
  } finally {
    toolBusy.value = ''
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

/* 可选能力：三张内置能力卡 + 一张全宽 MCP 卡（2026-10-27 bento 重设计）。
   auto-fit 280px：1280 档三列，窄屏自动两列/单列；MCP 卡始终整行。 */
.ac-section { display: grid; gap: 12px; }
.ac-section__head { display: flex; align-items: center; gap: 10px; min-width: 0; }
.ac-section__title { margin: 0; font-size: var(--mk-fs-emphasis); font-weight: 650; color: var(--mk-ink); }
.ac-section__meta {
  margin-left: auto;
  font-size: var(--mk-fs-micro);
  color: var(--mk-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.ac-cap-grid {
  display: grid;
  /* 三张能力卡恒等分整行（2026-10-31 四轮评审 P2-8）：auto-fit 280px 在宽屏会多出空轨道——
     三张卡只占约 3/4 行宽，右侧留一条尴尬空白，与下方通栏 MCP 卡右缘不齐。
     宽屏恒 3 列（本组就是 3 张内置能力卡 + 一张通栏卡），窄屏回落 auto-fit 自然折行。 */
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  align-items: stretch;
}
@media (max-width: 1080px) {
  .ac-cap-grid { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
}
.ac-cap {
  display: grid;
  align-content: start;
  gap: 10px;
  min-width: 0;
  padding: 14px 16px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-xl);
  background: var(--mk-surface);
}
.ac-cap--wide { grid-column: 1 / -1; container-type: inline-size; }
.ac-cap__head { display: flex; align-items: flex-start; gap: 10px; min-width: 0; }
.ac-cap__glyph {
  flex: none;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: var(--mk-radius-md);
  background: var(--mk-surface-3);
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  font-weight: 700;
}
.ac-cap__id { display: grid; gap: 2px; min-width: 0; flex: 1; }
.ac-cap__id strong { font-size: var(--mk-fs-body); font-weight: 650; color: var(--mk-ink); line-height: 1.3; }
.ac-cap__last { font-size: var(--mk-fs-micro); color: var(--mk-faint); font-variant-numeric: tabular-nums; }
.ac-cap__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
  flex: none;
}
.ac-cap__meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.ac-cap__members { font-size: var(--mk-fs-micro); color: var(--mk-faint); line-height: 1.45; }
.ac-cap__fail { font-size: var(--mk-fs-micro); }
/* 停用只压信息层，开关与按钮保持清晰可点 */
.ac-cap.is-off .ac-cap__id,
.ac-cap.is-off .ac-cap__glyph,
.ac-cap.is-off .ac-cap__meta { opacity: 0.55; }
.ac-cap-skel { height: 104px; border-radius: var(--mk-radius-xl); }
.ac-cap-skel--wide { grid-column: 1 / -1; height: 168px; }

/* 资料采集口径说明行（P0-4）：与通道行同节奏的中性小字 */
.ac-config-note {
  margin: 0;
  padding: 8px 12px;
  border-radius: var(--mk-radius-md);
  background: var(--mk-surface-2);
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  line-height: 1.6;
}
/* 编辑态锁定说明（P0-3）：替代必填红星的位置，弱色小字（页面前缀，不占 mk- 原语命名空间） */
.ac-field__locked {
  font-style: normal;
  font-weight: 400;
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  margin-left: 5px;
}
/* MCP 服务编辑弹窗：先排通道优先级（主用 + 备用，用户可自己调），再填链上 provider 的密钥/入口。
   2026-10-25 用户「不要这种解释型文案」：简介、降级注记、provider 说明句、字段提示行全撤。
   2026-10-26 用户两次走查「这个真的很丑」「本身是三选一，然后用户可以自己配置优先级」：
   原先是「只读顺序行 + 全部 provider 平铺成灰底卡」，读起来像都在用、每张卡还各带一个
   「缺少密钥」；现在顺序行变成可编辑的链，字段只给链上的人，卡也不再是灰底盒子。 */
.ac-prio {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--mk-line);
}
.ac-prio:last-of-type { border-bottom: 0; }
.ac-prio__k {
  flex: none;
  width: 32px;
  padding-top: 6px;
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  color: var(--mk-muted);
}
.ac-prio__list { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
.ac-prio__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 5px 3px 9px;
  border: 1px solid var(--mk-line);
  border-radius: 999px;
  background: var(--mk-surface);
}
.ac-prio__rank { font-size: var(--mk-fs-micro); color: var(--mk-faint); }
.ac-prio__name { font-size: var(--mk-fs-micro); font-weight: 700; color: var(--mk-ink); }
.ac-prio__ops { display: inline-flex; align-items: center; gap: 1px; }
.ac-prio__op {
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  line-height: 1;
  cursor: pointer;
}
.ac-prio__op:hover:not(:disabled) { background: var(--mk-hover-surface); color: var(--mk-ink); }
.ac-prio__op:disabled { opacity: 0.35; cursor: default; }
/* 「加入备用」下拉的视觉由 MkSelect 承担（2026-10-27 原生 select → MkSelect）：
   原 .ac-prio__add 的虚线胶囊壳不再需要，触发器的描边/圆角/字号统一走共享原语。 */
/* provider 段：白面 + 发丝线分隔（不再用灰底卡片堆叠），字段两列避免占位符被压断 */
.ac-config-provider {
  margin-top: 0;
  padding: 12px 0 0;
  border: 0;
  border-top: 1px solid var(--mk-line);
  border-radius: 0;
  background: transparent;
}
.ac-config-provider__head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.ac-config-provider__name { font-size: var(--mk-fs-body); font-weight: 600; color: var(--mk-ink); }
.ac-config-provider__badges { display: inline-flex; align-items: center; gap: 6px; }
.ac-config-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 14px;
  margin-top: 10px;
}
.ac-config-provider__foot { display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-top: 8px; }
.ac-config-provider__foot .mk-link { font-size: var(--mk-fs-micro); }
@media (max-width: 720px) {
  .ac-cap { padding: 12px 14px; }
  .ac-cap__head { flex-wrap: wrap; }
  .ac-cap__actions { width: 100%; justify-content: flex-end; }
}

/* 能力配置加载失败错误条：外形走 .mk-alert--row，本类只保留节内位置 */
.ac-error { margin: 0; }

/* MCP 子列表：挂在 MCP 工具调用卡内（cap--wide），不再另起卡或缩进到行外 */
.ac-mcp__body { display: grid; gap: 8px; }
.ac-mcp__list {
  container-type: inline-size;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-md);
  background: var(--mk-surface-2);
  overflow: hidden;
}
.ac-mcp__row {
  display: grid;
  /* 2026-10-24：类型/入口按内容收（max-content 上限），富余空间只留在末尾动作列，
     消除 585–662px 的空白中段；动作列右对齐。 */
  /* 名称吃掉剩余宽度，类型/入口/状态/动作全部 max-content 靠右成组；
     不再让某个具名列被余量拉成 500px+ 的空列。 */
  grid-template-columns: 10px minmax(0, 1fr) max-content max-content max-content max-content;
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid var(--mk-line);
}
.ac-mcp__row:last-child { border-bottom: none; }
.ac-mcp__dot { width: 8px; height: 8px; border-radius: 50%; }
.ac-mcp__dot.is-on { background: var(--mk-green); box-shadow: 0 0 0 3px color-mix(in srgb, var(--mk-green) 12%, transparent); }
.ac-mcp__dot.is-off { background: var(--mk-faint); }
.ac-mcp__main { display: grid; gap: 1px; min-width: 0; }
.ac-mcp__main strong { font-size: var(--mk-fs-micro); font-weight: 600; color: var(--mk-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ac-mcp__type { font-size: var(--mk-fs-micro); color: var(--mk-muted); white-space: nowrap; max-width: 240px; overflow: hidden; text-overflow: ellipsis; }
/* 状态徽标与动作组同处右缘：徽标列吃 1fr 并右对齐，把空白留在类型/入口与动作之间，
   消除某个具名列被拉成 585–662px 空列（2026-10-24 复核）。 */
.ac-mcp__row > .mk-switch { justify-self: end; }
.ac-mcp__row > .mk-actions { justify-self: end; }
.ac-mcp__test { font-size: var(--mk-fs-micro); font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; }
.ac-mcp__test.is-ok { color: var(--mk-green); }
.ac-mcp__test.is-bad { color: var(--mk-red); max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
.ac-mcp__endpoint {
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  min-width: 0;
  /* max-content 列必须给上限：超长 endpoint 否则会把整行顶出卡片 */
  max-width: 240px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ac-mcp__formrow { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

/* MCP 子列表作为容器：行按「子列表自身宽度」重排，而非视口宽度
   （窄屏缩进后子列表可用宽度更小，视口断点不触发） */
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
  .ac-mcp__row .mk-switch { grid-area: badge; justify-self: end; }
  .ac-mcp__row .mk-actions { grid-area: actions; }
}
@media (max-width: 800px) {
  .ac-mcp__formrow { grid-template-columns: 1fr; }
}

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
