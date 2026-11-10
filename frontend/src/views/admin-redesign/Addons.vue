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

    <!-- 可选能力（2026-11-05 用户「布局不采取分栏了吧 先保持一致」）：
         单列堆叠，每张能力一张全宽卡，解剖与「系统设置」里的对话 / 向量 / 重排卡一致——
         卡头（图标 + 能力名 + 最近调用 + 开关 + 入口），卡内一行成员。
         此前是 bento：三张内置能力卡三列并排、MCP 占一整行；四个平级能力被拆成
         「3 列 + 1 通栏」两种形状，读者得先分辨为什么第四张不一样宽。
         MCP 仍是带子资源的容器（服务列表挂在卡内），但它现在与其余三张同宽同形。 -->
    <section class="ac-section">
      <!-- 区头只留区名（2026-11-05 用户「这种说明文案不要」）：右端那行
           「4 项能力 · 6 个 Skill」是把下方四张卡再数一遍，读者扫一眼卡片就有答案。
           保留的只有「启停状态未读取」——那是读失败，不读这一行看不出来。 -->
      <div class="ac-section__head">
        <h2 class="ac-section__title">可选能力</h2>
        <span v-if="pluginStateFailed" class="mk-badge mk-badge--warn">启停状态未读取</span>
      </div>
      <div v-if="configsFailed" class="mk-alert mk-alert--row ac-error" role="alert">
        <span class="mk-alert__msg">{{ configErrorText }}</span>
        <button type="button" class="mk-alert__btn" @click="loadPluginConfigs">重试</button>
      </div>
      <!-- 首载骨架：单列四卡，与最终形态同形，数据到达不跳版 -->
      <div v-if="loading" class="ac-list" aria-hidden="true">
        <div v-for="n in 4" :key="n" class="mk-skeleton ac-cap-skel" :class="{ 'ac-cap-skel--wide': n === 4 }"></div>
      </div>
      <div v-else class="ac-list">
        <section
          v-for="p in pluginRows"
          :key="p.id"
          class="mk-card ac-cap"
          :class="{ 'is-off': !pluginEnabled(p.id), 'ac-cap--mcp': p.id === 'mcp' }"
        >
          <!-- 2026-11-07 用户「四根拉长的扁担」：三种内置能力改 1 行 3 列等高卡，
               MCP 作为带子资源的容器独占一行。卡内不再只有标题与右侧开关——
               能力说明、当前配置摘要、累计调用都在卡上，不点「配置」也知道在用哪个。 -->
          <div class="mk-card__head ac-cap__head">
            <div class="ac-cap__id">
              <span class="ac-cap__glyph" aria-hidden="true">
                <component :is="p.icon" :size="15" :stroke-width="1.8" />
              </span>
              <h3 class="mk-card__title">{{ p.name }}</h3>
              <button v-if="p.errorCount > 0" type="button" class="mk-link ac-cap__fail" @click="goLogs(p.primary)">查失败</button>
            </div>
            <MkSwitch
              :model-value="pluginEnabled(p.id)"
              :state-text="pluginEnabled(p.id) ? '启用' : '停用'"
              :busy="pluginBusy === p.id"
              :aria-label="`${p.name}插件开关`"
              @update:model-value="togglePlugin(p.id, $event)"
            />
          </div>

          <p class="ac-cap__desc">{{ p.description }}</p>
          <!-- 成员 Skill 与 MCP 服务可用性：一行小字，不另起一块 -->
          <p v-if="membersText(p)" class="ac-cap__members">{{ membersText(p) }}</p>

          <!-- 配置摘要：主用 / 备选 / 引擎 / 地址，全部来自已保存的服务配置 -->
          <dl v-if="capSummary(p.id).length" class="ac-cap__facts">
            <div v-for="line in capSummary(p.id)" :key="line.k">
              <dt>{{ line.k }}</dt>
              <dd :title="line.v">{{ line.v }}</dd>
            </div>
          </dl>

          <!-- MCP 服务是 MCP 工具调用的子资源：同一张卡内展开，独立开关/测试/发现工具。
               行的右组与卡头同一套解剖（2026-11-05 用户「统一一下右侧」）：
               左侧只放「名称 + 类型/入口」这类读数，右侧只剩控制件——开关 + 动作列。
               此前类型与入口是动作列前面的两个数据列，于是这一行的「右侧」里
               读数与控件混在一起，开关还被挤到比卡头左 70px 的位置。 -->
          <div v-if="p.id === 'mcp'" class="ac-mcp__body">
            <div v-if="mcpTools.length" class="ac-mcp__list">
              <div v-for="t in mcpTools" :key="t.id" class="ac-mcp__row">
                <span class="ac-mcp__dot" :class="t.enabled ? 'is-on' : 'is-off'"></span>
                <div class="ac-mcp__main" :title="`${t.name}（${t.id}）`">
                  <strong>{{ t.name }}</strong>
                  <!-- 类型/端点是中文短标签（文件系统 / 本机进程），走正文无衬线 -->
                  <span class="ac-mcp__meta">
                    <span v-if="t.transport === 'mcp'" class="mk-badge mk-badge--info">MCP</span>
                    <template v-else>{{ mcpTypeText(t.type) }}</template>
                    <span class="ac-mcp__sep" aria-hidden="true">·</span>
                    <span class="ac-mcp__endpoint" :title="endpointTitle(t.endpoint)">{{ endpointLabel(t.endpoint) }}</span>
                    <!-- 工具数是服务自己的读数（发现过一次就有），2026-11-07 用户要求
                         「连接方式 / 工具数」写在行上，而不是藏在「发现工具」按钮的文案里 -->
                    <template v-if="discoveredMap[t.id]">
                      <span class="ac-mcp__sep" aria-hidden="true">·</span>
                      <span class="ac-mcp__tools">工具 {{ discoveredMap[t.id].length }}</span>
                    </template>
                  </span>
                </div>
                <div class="ac-ctl">
                  <MkSwitch
                    :model-value="t.enabled"
                    :state-text="t.enabled ? '启用' : '停用'"
                    :busy="toolBusy === t.id"
                    :aria-label="`${t.name}服务开关`"
                    @update:model-value="toggleToolEnabled(t, $event)"
                  />
                  <div class="mk-actions ac-ctl__acts">
                    <button
                      v-if="t.transport === 'mcp'"
                      type="button"
                      class="mk-link"
                      :disabled="discoveringId === t.id"
                      :title="discoveredMap[t.id]?.join(', ') || '发现这个 MCP 服务提供的工具'"
                      @click="discoverTools(t)"
                    >{{ discoveringId === t.id ? '发现中…' : '发现工具' }}</button>
                    <button type="button" class="mk-link mk-link--hold mk-link--hold-test" :disabled="testingId === t.id" @click="testTool(t)">
                      {{ testingId === t.id ? '测试中…' : '测试' }}
                    </button>
                    <span v-if="testResult?.id === t.id" class="ac-mcp__test" :class="testResult.ok ? 'is-ok' : 'is-bad'">
                      {{ testResult.ok ? `通过 · ${testResult.latencyMs}ms` : `失败 · ${testResult.error || ''}` }}
                    </span>
                    <!-- 配置从 ⋯ 菜单提到行内（2026-11-07 用户「启用 | 测试 | 配置」）：
                         编辑是最常用的动作，藏进菜单等于每次多点一次。
                         2026-11-10 用户「统一一下」：删除同样提到行内（与用户账号页同一裁决），
                         行尾不再留一只只装一项的 ⋯ 菜单。 -->
                    <button type="button" class="mk-link" @click="openToolEdit(t)">配置</button>
                    <button type="button" class="mk-link mk-link--danger" @click="removeTool(t)">删除</button>
                  </div>
                </div>
              </div>
            </div>
            <!-- 子列表局部加载：MkLoading 的 min 会按整页口径撑高，卡内只剩空白 -->
            <MkSkeleton v-else-if="mcpLoading" variant="rows" :count="3" :h="36" />
            <MkEmptyState
              v-else
              :tone="mcpFailed ? 'error' : 'neutral'"
              :title="mcpFailed ? 'MCP 服务加载失败' : '暂无 MCP 服务'"
              :description="mcpFailed ? mcpErrorText : ''"
              :action-text="mcpFailed ? '重试' : '新建服务'"
              action-busy-text="重试中…"
              :action-busy="mcpLoading"
              compact
              @action="mcpFailed ? loadMcpTools() : openToolCreate()"
            />
          </div>

          <div class="ac-cap__foot">
            <span class="ac-cap__calls">累计 {{ p.calls }} 次调用<i v-if="p.last !== '从未'"> · 最近 {{ p.last }}</i></span>
            <!-- 入口降级为次要描边按钮（2026-11-07 用户「绿开关紧挨深蓝按钮撞色」）：
                 本页没有「唯一主操作」，实心主色留给真正的主按钮（保存 / 新建）。 -->
            <button v-if="p.id === 'mcp'" type="button" class="mk-btn mk-btn--sm" @click="openToolCreate">新建服务</button>
            <button v-else type="button" class="mk-btn mk-btn--sm" @click="openConfig(p)">配置</button>
          </div>

        </section>
      </div>
    </section>

    <!-- MCP 服务编辑弹窗 -->
    <Teleport to="body">
    <div v-if="toolOpen" ref="maskRef" class="mk-modal">
      <div ref="panelRef" class="mk-modal__panel mk-modal__panel--wide" role="dialog" aria-label="MCP 服务">
        <div class="mk-modal__head">
          <h3 class="mk-modal__title">{{ toolEditingId ? '编辑 MCP 服务' : '新建 MCP 服务' }}</h3>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="toolOpen = false">✕</button>
        </div>
        <!-- 2026-11-10 用户「统一」：与插件服务配置弹层同一套骨架——宽版 + 段名 +
             两列字段网格。此前是窄弹层、五个字段一路竖排，与隔壁那张弹层像两个产品。 -->
        <div class="mk-modal__body ac-config">
          <section class="ac-sec">
            <h4 class="mk-section__title">基本信息</h4>
            <div class="ac-form">
              <label class="mk-field" :class="{ 'mk-field--error': toolErrors.id }">
                <!-- 编辑态：ID 是主键不可改（输入框禁用），红星撤下、改挂锁定说明——
                     否则禁用框带必填星号会被读成「该填但填不了」（2026-10-31 四轮评审 P0-3） -->
                <span class="mk-field__label">
                  工具 ID
                  <em v-if="!toolEditingId" class="mk-field__req">*</em>
                  <!-- 加全角括号并复用字段次级提示档：不写括号时它和「工具 ID」同字号同色位，
                       整行会被读成一个连写的长标签，看不出后半句是对字段的说明 -->
                  <span v-else class="mk-field__opt">（创建后不可修改）</span>
                </span>
                <input v-model="toolForm.id" class="mk-field__input" placeholder="例如：web-search / text-to-image" :disabled="!!toolEditingId" />
                <span v-if="toolErrors.id" class="mk-field__err">{{ toolErrors.id }}</span>
              </label>
              <label class="mk-field" :class="{ 'mk-field--error': toolErrors.name }">
                <span class="mk-field__label">名称 <em class="mk-field__req">*</em></span>
                <input v-model="toolForm.name" class="mk-field__input" placeholder="例如：网页搜索" />
                <span v-if="toolErrors.name" class="mk-field__err">{{ toolErrors.name }}</span>
              </label>
            </div>
          </section>

          <section class="ac-sec">
            <h4 class="mk-section__title">连接</h4>
            <div class="ac-form">
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
              <label class="mk-field mk-field--full" :class="{ 'mk-field--error': toolErrors.endpoint }">
                <span class="mk-field__label">服务地址 <em class="mk-field__req">*</em></span>
                <input
                  v-model="toolForm.endpoint"
                  class="mk-field__input"
                  :placeholder="toolForm.transport === 'mcp' ? 'https://…/mcp' : 'https://…'"
                />
                <span v-if="toolErrors.endpoint" class="mk-field__err">{{ toolErrors.endpoint }}</span>
              </label>
            </div>
          </section>

          <section class="ac-sec">
            <h4 class="mk-section__title">说明</h4>
            <!-- 必填项已带 *，非必填不再追加「（可选）」 -->
            <label class="mk-field">
              <span class="mk-field__label">描述</span>
              <textarea v-model="toolForm.description" class="mk-field__textarea" rows="2"></textarea>
            </label>
          </section>
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
            <h3 class="mk-modal__title">{{ configTitle }} · 服务配置</h3>
            <button type="button" class="mk-modal__close" aria-label="关闭" @click="closeConfig">✕</button>
          </div>
          <div class="mk-modal__body ac-config">
            <!-- 2026-11-10 用户「二级页面重新设计一下」：弹层分两段——
                 「服务」回答这个能力由哪家提供（搜索单选、抓取可排主备），
                 「密钥与地址」逐家填凭据与端点。此前两段之间没有段名，通道行里
                 还重复印了一遍 provider 名（胶囊 + 下拉各一份），读起来像两件事。 -->
            <section class="ac-sec">
              <h4 class="mk-section__title">服务</h4>
              <div v-for="channel in configTarget?.channels ?? []" :key="channel.id" class="ac-row">
                <span class="ac-row__k">{{ channel.label }}</span>
                <!-- 不做链式降级的通道（搜索 / 决策）：只有一个「用哪一家」的选择位，
                     没有备用、没有排序——运行时也只取这一家，失败即报错（2026-11-10 用户裁决）。
                     选择器本身已经写着这家服务名，左侧再挂一枚同名胶囊是复读。 -->
                <div class="ac-row__ctrl">
                  <template v-if="channel.single">
                    <MkSelect
                      :model-value="orderOf(channel.id)[0] || ''"
                      :options="channelProviderOptions()"
                      :aria-label="`选择${channel.label}服务`"
                      size="sm"
                      @update:model-value="setSingleProvider(channel.id, $event)"
                    />
                  </template>
                  <template v-else>
                    <span
                      v-for="(pid, i) in orderOf(channel.id)"
                      :key="pid"
                      class="ac-prio__item"
                      :title="providerConfiguredOf(pid) ? '已配置' : '缺少密钥'"
                    >
                      <span class="ac-prio__rank">{{ i === 0 ? '主用' : `备用 ${i}` }}</span>
                      <strong class="ac-prio__name">{{ providerLabelOf(pid) }}</strong>
                      <!-- 排序与移出只在 ≥2 个服务时出现：只剩一个时 ↑↓ 与 ✕ 都无效，
                           却仍占着胶囊宽度（2026-11-07 用户「生图来源只有一个，这个叉是干嘛的」） -->
                      <span v-if="orderOf(channel.id).length > 1" class="ac-prio__ops">
                        <button type="button" class="ac-prio__op" aria-label="上移" :disabled="i === 0"
                                @click="moveInOrder(channel.id, i, -1)">↑</button>
                        <button type="button" class="ac-prio__op" aria-label="下移"
                                :disabled="i === orderOf(channel.id).length - 1"
                                @click="moveInOrder(channel.id, i, 1)">↓</button>
                        <button type="button" class="ac-prio__op" aria-label="移出链"
                                @click="removeFromOrder(channel.id, i)">✕</button>
                      </span>
                    </span>
                    <!-- 2026-10-27 原生 select → MkSelect：触发器常驻「＋ 加入备用」，
                         选中后由 setOrder 追加并保持 modelValue=''（原生 select 需手动复位已不需要）。
                         「＋ 加入备用」走 MkSelect 的 placeholder，不再作为列表首项：同名同义的
                         一项会让人以为它已选中/已添加，而 modelValue 恒为 '' 还会给它挂上蓝勾。 -->
                    <MkSelect
                      v-if="availableOf(channel.id).length"
                      :model-value="''"
                      :options="addOptionsOf(channel)"
                      placeholder="＋ 加入备用"
                      :aria-label="`把 provider 加入${channel.label}备用`"
                      size="sm"
                      @change="onAddToOrder(channel.id, $event)"
                    />
                  </template>
                </div>
                <!-- 状态跟着选择位走：单选通道能一眼看出这家有没有密钥；
                     链路通道每家状态在各家卡头，不在这里重复 -->
                <span v-if="channel.single" class="ac-row__state">
                  <span
                    class="mk-badge mk-badge--sm"
                    :class="providerConfiguredOf(orderOf(channel.id)[0]) ? 'mk-badge--ok' : 'mk-badge--warn'"
                  >{{ providerConfiguredOf(orderOf(channel.id)[0]) ? '已配置' : '缺少密钥' }}</span>
                </span>
              </div>
            </section>

            <!-- 字段只给链上的 provider（其余不参与调用，也不占版面）。
                 2026-11-07 用户「API key 在左、端点地址在右」：密钥字段排第一列，
                 地址/模型等可选字段排第二列；空地址=用官方默认（placeholder 就是当前生效值）。 -->
            <section class="ac-sec">
              <h4 class="mk-section__title">密钥与地址</h4>
              <div class="ac-config-provider" v-for="provider in chainProviders" :key="provider.id">
                <header class="ac-config-provider__head">
                  <strong class="ac-config-provider__name">{{ provider.label }}</strong>
                  <span class="mk-badge mk-badge--sm" :class="provider.configured ? 'mk-badge--ok' : 'mk-badge--warn'">
                    {{ provider.configured ? '已配置' : '缺少密钥' }}
                  </span>
                  <span class="ac-config-provider__spacer"></span>
                  <button
                    v-if="hasChainChannel && !isPrimaryOf(provider.id)"
                    type="button"
                    class="mk-link ac-config-provider__primary"
                    @click="setPrimaryOf(provider.id)"
                  >设为主用</button>
                  <!-- 测试只探这一家（不进降级链）：改了端点/密钥后要能立刻知道「它通不通」，
                       走主链会拿到「换一家还是成功了」的假信号 -->
                  <button
                    type="button"
                    class="mk-link mk-link--hold ac-config-provider__test"
                    :disabled="probeBusy === `${configTarget?.id}:${provider.id}`"
                    @click="probeProvider(provider.id)"
                  >{{ probeBusy === `${configTarget?.id}:${provider.id}` ? '测试中…' : '测试' }}</button>
                </header>
                <div class="ac-config-fields">
                  <label class="mk-field" v-for="field in orderedFields(provider)" :key="field.key">
                    <span class="mk-field__label">{{ field.label }}</span>
                    <input
                      v-model="draft[provider.id][field.key]"
                      class="mk-field__input"
                      :type="field.type"
                      :placeholder="fieldPlaceholder(field)"
                      :autocomplete="field.secret ? 'new-password' : 'off'"
                    />
                  </label>
                </div>
                <p
                  v-if="probeResult?.key === `${configTarget?.id}:${provider.id}`"
                  class="ac-config-provider__probe"
                  :class="probeResult.ok ? 'is-ok' : 'is-bad'"
                >{{ probeResult.ok ? `${probeResult.detail} · ${probeResult.latencyMs}ms` : probeResult.detail }}</p>
                <div v-if="provider.keySource === 'db' || clearKeys[provider.id]" class="ac-config-provider__foot">
                  <button
                    type="button"
                    class="mk-link"
                    @click="toggleClearKey(provider.id)"
                  >{{ clearKeys[provider.id] ? '取消清除' : '清除已保存密钥' }}</button>
                </div>
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
  id: PluginId
  name: string
  /** 能力一句话说明（目录里的 description）：卡面在标题下列一行，四张卡不再只有名字 */
  description: string
  /** 能力图标（2026-10-27 用户「能换个图标吗」：中文单字 glyph → lucide 线性图标） */
  icon: Component
  primary: string
  members: PluginMemberRow[]
  /** 窗口内成员调用次数合计：卡脚「累计 N 次调用」 */
  calls: number
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
/**
 * 卡面配置摘要（2026-11-07 用户「四张卡只有名字，得点进『配置』才知道在用谁」）：
 * 只读已保存的服务配置，不读弹窗草稿——卡面说「现在生效的是什么」。
 *   联网：主用 / 备选（搜索链，抓取链与它同源；不同源时第二个键名写「抓取」）
 *   决策与核验：引擎 / 模型
 *   生图：主用（模型）/ 地址
 * 没有配置数据（未加载/加载失败）时返回空数组，卡面整块不渲染——不拿空行冒充「未配置」。
 */
function capSummary(id: PluginId): Array<{ k: string; v: string }> {
  const cfg = providerConfigs.value[id]
  if (!cfg) return []
  const providerOf = (pid: string) => cfg.providers.find((p) => p.id === pid)
  const labelOf = (pid: string) => providerOf(pid)?.label || pid
  const chain = (channelId: string) => cfg.channels.find((c) => c.id === channelId)?.order ?? []
  const fieldValue = (pid: string, key: string) => {
    const field = providerOf(pid)?.fields.find((f) => f.key === key)
    return (field?.value || field?.placeholder || '').trim()
  }
  const lines: Array<{ k: string; v: string }> = []

  if (id === 'web') {
    const search = chain('search')
    const fetch = chain('fetch')
    if (search.length) {
      lines.push({ k: '主用', v: labelOf(search[0]) })
      if (search.length > 1) lines.push({ k: '备选', v: search.slice(1).map(labelOf).join(' · ') })
    }
    if (fetch.length && fetch.join(',') !== search.join(',')) {
      lines.push({ k: '抓取', v: fetch.map(labelOf).join(' → ') })
    }
    return lines
  }

  if (id === 'decision') {
    const order = chain('decision')
    const primary = order[0]
    if (!primary) return lines
    lines.push({ k: '引擎', v: labelOf(primary) })
    const model = fieldValue(primary, 'model')
    if (model) lines.push({ k: '模型', v: model })
    return lines
  }

  if (id === 'image') {
    const primary = chain('image')[0]
    if (!primary) return lines
    const model = fieldValue(primary, 'model')
    lines.push({ k: '主用', v: model ? `${labelOf(primary)}（${model}）` : labelOf(primary) })
    const endpoint = fieldValue(primary, 'endpoint')
    if (endpoint) lines.push({ k: '地址', v: endpoint })
    return lines
  }

  return lines
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
  /** orderFixed = 顺序由代码固定（联网），界面不给排；
      single = 不做链式降级（搜索 / 决策），界面只给「用哪一家」 */
  channels: Array<{ id: string; label: string; order: string[]; orderFixed?: boolean; single?: boolean }>
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
      description: group.description,
      icon: PLUGIN_ICONS[group.id],
      primary: group.primary,
      members,
      calls: members.reduce((n, member) => n + (liveSkillStatsMap.value?.[member.id]?.calls ?? 0), 0),
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
/** 弹窗标题用卡面上的组名（目录里的 name），不用服务端的 config label——
    后端 label 还是「决策」，改名后如果直接拼 configTarget.label，卡面与弹窗会各叫一个名字。 */
const configTitle = ref('')
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
  configTitle.value = group.name
  /* 非密钥字段：平台存了值就用值，没存就用服务端给的「当前生效值」（环境变量 / 目录默认）。
     生效值不再挂 placeholder——占位符是灰的，与真正的空字段提示同色，读不出哪个地址已经在生效。 */
  const next: Record<string, Record<string, string>> = {}
  for (const provider of cfg.providers) {
    next[provider.id] = {}
    for (const field of provider.fields) {
      if (!field.secret) next[provider.id][field.key] = field.value || field.placeholder
    }
  }
  draft.value = next
  // 优先级草稿：每条通道从服务端当前生效顺序起步（平台保存 → 环境变量 → 默认）
  const orders: Record<string, string[]> = {}
  for (const channel of cfg.channels) orders[channel.id] = [...channel.order]
  orderDraft.value = orders
  clearKeys.value = {}
  probeResult.value = null
  configOpen.value = true
}

function closeConfig() {
  configOpen.value = false
  configTarget.value = null
  configTitle.value = ''
  orderDraft.value = {}
  clearKeys.value = {}
  probeResult.value = null
}

function toggleClearKey(providerId: string) {
  clearKeys.value = { ...clearKeys.value, [providerId]: !clearKeys.value[providerId] }
}

/* 2026-11-07 用户「联网为什么只有密钥，地址要能换成第三方兼容端点」：
   上一版（2026-11-04「其实这个是写死的」）把联网的地址与顺序锁成只读，弹窗只剩三只密钥框。
   现在地址可覆盖（留空 = 官方默认），顺序也可排——三个能力的弹窗回到同一套模板，
   不再有「联网一个样、决策生图另一个样」的分支。 */
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
/** 「加入备用」下拉的选项：只放该通道尚未上链的 provider。
    触发器的「＋ 加入备用」由 MkSelect 的 placeholder 承担（见模板注释），
    不把触发器文案再塞成首项——同名同义的一项会被读成「备用项已添加」。 */
function addOptionsOf(channel: { id: string }) {
  return availableOf(channel.id).map((p) => ({ value: p.id, label: p.label }))
}
/** 密钥框不重复 provider 头部的「已配置 / 缺少密钥」徽标：状态看徽标，
    框内只说明这个输入框的行为——密钥留空 = 不改动已存密钥。 */
function fieldPlaceholder(field: PluginProviderField): string {
  return field.secret ? '留空表示不修改' : field.placeholder
}
/** 字段顺序：密钥在前、可选地址在后（2026-11-07 用户「API key 放左边，端点放右边」）。
    目录里的字段顺序是按「地址 → 模型 → 密钥」写的，模板里再排一次只影响展示，不改存取键。 */
function orderedFields(provider: PluginProvider): PluginProviderField[] {
  return [...provider.fields].sort((a, b) => Number(b.secret) - Number(a.secret))
}
/** 该插件是否有降级链通道（联网的「抓取」）：没有链时不存在「主用」概念，
    不给「设为主用」这枚点了也不生效的按钮（决策 / 生图只有一个单档通道）。 */
const hasChainChannel = computed(() => (configTarget.value?.channels ?? []).some((ch) => !ch.single))
/** 该 provider 是否已在它所在的每条链上排第一（是则不再给「设为主用」） */
function isPrimaryOf(providerId: string): boolean {
  /* 只看降级链通道：单档通道（搜索 / 决策）没有主用概念，不参与这个判断——
     否则搜索选中 Tavily 时，TinyFish 卡头会挂一个「设为主用」按钮，点下去什么也不会发生 */
  const channels = (configTarget.value?.channels ?? [])
    .filter((ch) => !ch.single && orderOf(ch.id).includes(providerId))
  return channels.length > 0 && channels.every((ch) => orderOf(ch.id)[0] === providerId)
}
/** 设为主用：把该 provider 提到它所在链的第一位（联网有搜索/抓取两条链，两条一起提）。
    等价于在链上连点 ↑，但入口写在 provider 卡头——读「这台是主用的吗」时不用回头数序号。 */
function setPrimaryOf(providerId: string) {
  const next: Record<string, string[]> = { ...orderDraft.value }
  for (const channel of configTarget.value?.channels ?? []) {
    /* 单档通道没有主用/备用之分：换家走「选择服务」下拉，这里不动它 */
    if (channel.single) continue
    const list = orderOf(channel.id)
    if (!list.includes(providerId)) continue
    next[channel.id] = [providerId, ...list.filter((id) => id !== providerId)]
  }
  orderDraft.value = next
}
function providerConfiguredOf(providerId: string): boolean {
  return configTarget.value?.providers.find((p) => p.id === providerId)?.configured ?? false
}
function setOrder(channelId: string, next: string[]) {
  orderDraft.value = { ...orderDraft.value, [channelId]: next }
}
/* 不做链式降级的通道（搜索 / 决策，2026-11-10 用户「都不做链式降级了」）：
   界面上只有一个选择位，换一家直接替换整个顺序，不存在备用。 */
function setSingleProvider(channelId: string, id: string) {
  if (!id) return
  setOrder(channelId, [id])
}
/** 单档通道的候选 = 该插件的全部 provider（换回原来那家也要能选到） */
function channelProviderOptions() {
  return (configTarget.value?.providers ?? []).map((p) => ({ value: p.id, label: p.label }))
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

/** provider 探测（2026-11-07）：结果按「插件:provider」记一条，只给探测过的那张卡渲染 */
const probeBusy = ref('')
const probeResult = ref<{ key: string; ok: boolean; detail: string; latencyMs: number } | null>(null)

async function probeProvider(providerId: string) {
  const pluginId = configTarget.value?.id
  if (!pluginId || probeBusy.value) return
  const key = `${pluginId}:${providerId}`
  probeBusy.value = key
  probeResult.value = null
  try {
    const res = await adminPluginsApi.testProvider(pluginId, providerId)
    const d = res.data?.data ?? {}
    probeResult.value = { key, ok: !!d.ok, detail: String(d.detail || ''), latencyMs: Number(d.latencyMs || 0) }
  } catch (e) {
    probeResult.value = { key, ok: false, detail: errMsg(e), latencyMs: 0 }
  } finally {
    probeBusy.value = ''
  }
}

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
      } else if (now !== (field.value || field.placeholder).trim()) {
        // 与打开弹窗时的初始值比对：生效值原样带出时不算脏，空串 = 删除界面覆盖，回落服务端环境变量
        patch[field.key] = now
      }
    }
    if (clearKeys.value[provider.id]) patch.clearKey = true
    if (Object.keys(patch).length) providers[provider.id] = patch
  }
  /* 单档通道只提交选中的那一家：界面上没有备用位，多提交也没有执行语义 */
  const orders = ordersDirty.value
    ? Object.fromEntries(cfg.channels.map((ch) => [ch.id, ch.single ? orderOf(ch.id).slice(0, 1) : orderOf(ch.id)]))
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
    toast.success(`${configTitle.value}服务配置已保存`)
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

/** 删除是行内动作（2026-11-10）：不再经过 ⋯ 菜单 */
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

/* 可选能力（2026-11-07 用户「四根拉长的扁担」）：
   三种内置能力 1 行 3 列、等高；MCP 是带子资源的容器，独占整行。
   2026-11-05 曾按用户「先保持一致」做成四张同宽单列——一致性有了，但 1360px 宽里
   每张卡只有一行标题 + 一行成员，纵向白占了 3 屏。列数只在内置能力之间统一，
   MCP 的宽度由它的内容（服务表）决定，不再假装自己是第四张同形卡。 */
.ac-section { display: grid; gap: 12px; }
.ac-section__head { display: flex; align-items: center; gap: 10px; min-width: 0; }
.ac-section__title { margin: 0; font-size: var(--mk-fs-emphasis); font-weight: 650; color: var(--mk-ink); }
.ac-list { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; }
@media (min-width: 1024px) {
  .ac-list { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .ac-cap--mcp { grid-column: 1 / -1; }
}
/* 卡头沿用 .mk-card__head 的排版（12/16 + 发丝线）：图标 + 能力名（+ 查失败），右侧只有开关 */
.ac-cap { display: flex; flex-direction: column; flex: none; }
.ac-cap__head { min-width: 0; }
.ac-cap__id { display: flex; align-items: center; gap: 8px; min-width: 0; flex-wrap: wrap; }
.ac-cap__glyph {
  flex: none;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: var(--mk-radius-sm);
  background: var(--mk-surface-3);
  color: var(--mk-muted);
}
/* 能力说明：卡面上唯一的一句「这组是干什么的」，两行封顶（长描述不把三列拉成不等高） */
.ac-cap__desc {
  margin: 0;
  padding: 12px 16px 0;
  color: var(--mk-ink);
  font-size: var(--mk-fs-micro);
  line-height: 1.55;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.ac-cap__members { margin: 0; padding: 4px 16px 0; font-size: var(--mk-fs-micro); color: var(--mk-muted); line-height: 1.45; }
/* 配置摘要：主用 / 备选 / 引擎 / 模型 / 地址——键定宽，值单行省略（完整值在 title 里） */
.ac-cap__facts { display: grid; gap: 4px; margin: 12px 16px 0; padding: 0; }
.ac-cap__facts > div { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.ac-cap__facts dt { flex: none; width: 36px; color: var(--mk-faint); font-size: var(--mk-fs-micro); }
.ac-cap__facts dd {
  margin: 0;
  min-width: 0;
  color: var(--mk-ink);
  font-size: var(--mk-fs-micro);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 卡脚：读数在左、入口在右；margin-top:auto 让同一行三张卡的卡脚落在一条线上 */
.ac-cap__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: auto;
  padding: 14px 16px;
}
.ac-cap__calls {
  min-width: 0;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ac-cap__calls i { font-style: normal; color: var(--mk-faint); }
.ac-cap__fail { font-size: var(--mk-fs-micro); }
/* 停用只压信息层，开关与按钮保持清晰可点 */
.ac-cap.is-off .ac-cap__id,
.ac-cap.is-off .ac-cap__glyph,
.ac-cap.is-off .ac-cap__desc,
.ac-cap.is-off .ac-cap__facts { opacity: 0.55; }
.ac-cap-skel { height: 168px; border-radius: var(--mk-radius-xl); }
.ac-cap-skel--wide { height: 120px; }
@media (min-width: 1024px) {
  .ac-cap-skel--wide { grid-column: 1 / -1; }
}

/* 服务配置弹窗（2026-11-10 重设计）：两段——「服务」选谁提供，「密钥与地址」逐家填。
   段名用共享 .mk-section__title；通道行 = 固定宽标签 + 控件 + 状态，三列对齐。
   2026-10-25 用户「不要这种解释型文案」：简介、降级注记、provider 说明句、字段提示行全撤。 */
.ac-config { display: grid; gap: 18px; }
.ac-sec { display: grid; gap: 10px; align-content: start; }
.ac-sec + .ac-sec { padding-top: 16px; border-top: 1px solid var(--mk-line); }
.ac-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.ac-row__k {
  flex: none;
  width: 36px;
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  color: var(--mk-muted);
}
.ac-row__ctrl { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
.ac-row__ctrl :deep(.mk-select) { min-width: 180px; }
.ac-row__state { margin-left: auto; flex: none; }
.ac-prio__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 5px 3px 9px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-sm);
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
/* provider 段：白面 + 发丝线分隔（不再用灰底卡片堆叠），字段两列避免占位符被压断。
   段名已在上面，首家的顶部发丝线由 .ac-sec 的标题承担，不再叠一条。 */
.ac-config-provider {
  margin-top: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}
.ac-config-provider + .ac-config-provider { padding-top: 14px; border-top: 1px solid var(--mk-line); }
.ac-config-provider__head { display: flex; align-items: center; gap: 10px; }
.ac-config-provider__name { font-size: var(--mk-fs-body); font-weight: 600; color: var(--mk-ink); }
.ac-config-provider__spacer { flex: 1 1 auto; }
.ac-config-provider__primary { font-size: var(--mk-fs-micro); }
.ac-config-provider__test { font-size: var(--mk-fs-micro); }
/* 探测结果：成功一条绿字、失败一条红字（上游原文，可换行展示不截断） */
.ac-config-provider__probe {
  margin: 8px 0 0;
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.ac-config-provider__probe.is-ok { color: var(--mk-green); }
.ac-config-provider__probe.is-bad { color: var(--mk-red); }
.ac-config-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 14px;
  margin-top: 10px;
}
/* 焦点环只留设计系统那一圈（:root :focus-visible 的 2px outline 特异度高于 .mk-field__input
   的 outline:none，输入框聚焦时会叠出「描边 + 光圈」两道，2026-11-07 用户「原生焦点框」） */
.ac-config-fields .mk-field__input:focus-visible { outline: none; }
.ac-config-provider__foot { display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-top: 8px; }
.ac-config-provider__foot .mk-link { font-size: var(--mk-fs-micro); }

/* 能力配置加载失败错误条：外形走 .mk-alert--row，本类只保留节内位置 */
.ac-error { margin: 0; }

/* MCP 子列表：挂在 MCP 工具调用卡内，与本卡其余内容同一 16px 槽。
   卡头自带一条底边发丝线，这里只补纵向间距，不再画第二条线。 */
/* 行的右组（能力卡卡头与 MCP 服务行共用，2026-11-05 用户「统一一下右侧」）：
   开关 + **定宽动作列**。动作列不定宽时，开关的 x 跟着动作文案走——
   「配置」与「新建服务」差 24px，四张卡的开关凑不到一条竖线，行与行读起来像两套版。 */
.ac-section { --ac-act-w: 104px; }
.ac-ctl { display: inline-flex; align-items: center; gap: 12px; flex: none; }
.ac-ctl__acts {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  min-width: var(--ac-act-w);
}
.ac-mcp__body { display: grid; gap: 8px; padding: 0 16px; }
/* 服务列表 2 列（2026-11-07 用户「MCP 服务排成两列卡片」）：
   每台服务是一张自带的描边小卡，不再是一条通栏行——8 台服务单列排下去是 8 行，
   而每行只有「名称 + 地址 + 三个动作」，横向留白全浪费。
   最小列宽 440：1280 视口的内容宽 1040（40 内衬）正好放下两列 500；
   再窄就回落单列，否则动作列（发现工具/测试/配置/⋯）会把名称挤没。 */
.ac-mcp__list {
  container-type: inline-size;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(440px, 1fr));
  gap: 8px;
}
.ac-mcp__row {
  display: grid;
  /* 左侧只放读数（名称 + 类型/入口），右侧整块是控制件（开关 + 动作列） */
  grid-template-columns: 10px minmax(0, 1fr) max-content;
  gap: 12px;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-md);
  background: var(--mk-surface);
}
.ac-mcp__dot { width: 8px; height: 8px; border-radius: 50%; }
.ac-mcp__dot.is-on { background: var(--mk-green); box-shadow: 0 0 0 3px color-mix(in srgb, var(--mk-green) 12%, transparent); }
.ac-mcp__dot.is-off { background: var(--mk-faint); }
.ac-mcp__main { display: grid; gap: 1px; min-width: 0; }
.ac-mcp__main strong { font-size: var(--mk-fs-micro); font-weight: 600; color: var(--mk-ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* 类型 / 入口并成名称下面的一行读数：它们描述这台服务，不参与操作 */
.ac-mcp__meta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  white-space: nowrap;
  overflow: hidden;
}
.ac-mcp__sep { color: var(--mk-faint); }
.ac-mcp__tools { color: var(--mk-muted); font-variant-numeric: tabular-nums; }
.ac-mcp__row > .ac-ctl { justify-self: end; }
.ac-mcp__test { font-size: var(--mk-fs-micro); font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; }
.ac-mcp__test.is-ok { color: var(--mk-green); }
.ac-mcp__test.is-bad { color: var(--mk-red); max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
.ac-mcp__endpoint {
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint);
  min-width: 0;
  /* max-content 列必须给上限：超长 endpoint 否则会把整行顶出卡片。
     2 列卡片里每行只有 500px，240 会把「类型 · 地址」挤到动作列上，收到 180。 */
  max-width: 180px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 弹层字段网格（2026-11-10 统一）：服务配置与 MCP 编辑共用——两列，整行字段挂 --full */
.ac-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 14px; }
.ac-form > .mk-field--full { grid-column: 1 / -1; }
@media (max-width: 720px) {
  .ac-form { grid-template-columns: minmax(0, 1fr); }
}

/* MCP 子列表作为容器：行按「子列表自身宽度」重排，而非视口宽度
   （窄屏缩进后子列表可用宽度更小，视口断点不触发） */
/* 窄卡：MCP 行两行重排（状态点/名称/徽标一行，类型/endpoint 次行，操作收底行） */
@container (max-width: 540px) {
  .ac-mcp__row {
    grid-template-columns: 10px minmax(0, 1fr);
    grid-template-areas:
      'dot main'
      '. ctl';
    row-gap: 5px;
    column-gap: 12px;
    padding: 12px 16px;
  }
  .ac-mcp__dot { grid-area: dot; }
  .ac-mcp__main { grid-area: main; }
  .ac-mcp__row .ac-ctl { grid-area: ctl; justify-self: end; }
}

/* ========== 大屏/4K 适配（全站 mk 体系档位：≥2000px 字号放大；zoom 档 ≥2800px→1.15、≥3600px→1.3） ========== */
@media (min-width: 2000px) {
  .mono { font-size: var(--mk-fs-micro); }
  .ac-mcp__row { padding: 12px 18px; }
  .ac-mcp__main strong { font-size: var(--mk-fs-body); }
    .ac-mcp__meta { font-size: var(--mk-fs-micro); }
}
@media (min-width: 2800px) {
  .mono { font-size: var(--mk-fs-micro); }
  .ac-mcp__row { padding: 14px 22px; }
  .ac-mcp__main strong { font-size: var(--mk-fs-micro); }
    .ac-mcp__meta { font-size: var(--mk-fs-micro); }
}
@media (min-width: 3600px) {
  .mono { font-size: var(--mk-fs-body); }
  .ac-mcp__row { padding: 16px 26px; }
  .ac-mcp__main strong { font-size: var(--mk-fs-emphasis); }
    .ac-mcp__meta { font-size: var(--mk-fs-body); }
}

/* ================= 暗色模式（D1 补完）：外挂能力 ================= */
html[data-theme='dark'] {
  .ac-error { background: rgba(248, 113, 113, 0.1); }
  /* .ac-mcp__dot.is-off 不再重写：基础规则已走 var(--mk-faint)，暗色下自动取 #7a7e85 */
}
</style>
