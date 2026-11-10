<template>
  <div :class="embedded ? 'acl-host acl-host--embedded' : 'mk-page acl-host'">
    <MkPageHead v-if="!embedded" title="访问与注册" />

    <div v-if="configFailed" class="mk-alert mk-alert--row" role="alert">
      <span class="mk-alert__msg">访问策略读取失败：为空不代表未配置</span>
      <button type="button" class="mk-alert__btn" @click="retryLoad">重试</button>
    </div>

    <!-- 单卡承载三组设置（入站 / 出站 / 注册）：原来是「访问来源」与「注册」两张卡并排，
         右卡只有两行开关，下方留半屏空白，两块卡高度也对不齐（2026-10-30 人工复查
         「做成一个卡片吧」）。三组之间用分隔线分段；保存钮仍只保存上面两组访问策略，
         注册两个开关保持逐项即时生效。
         2026-11-03 用户拍板：卡**不做限宽，通栏**（推翻了当天上午按 SPEC §10 加的 .mk-narrow）。
         同页五个页签宽度必须一致：会话安全（表格）、数据导出（三列勾选）只能通栏，
         只有本页与「模型与接入」被收窄，切页签会一宽一窄地跳。 -->
    <section class="mk-card ac-card">
        <div class="mk-card__head">
          <!-- 2026-11-09 设计语言收敛（容器层级）：卡题原为「访问与注册设置」，与页签名
               「访问与注册」逐字重复——页签已经在说这一页是什么，卡头再说一遍就是两行字说一件事。
               正文三段（管理后台访问控制 / 服务端出站访问 / 注册设置）各有自己的标题，
               卡头不再需要标题，只留右侧状态：生效档 + 脏值。
               同页「会话安全」的卡头本来就是无标题的工具条形态，这里向它看齐。 -->
          <div class="mk-card__head-right">
            <span class="mk-badge">当前生效：{{ accessModeText }}</span>
            <span v-if="policyDirty" class="mk-badge mk-badge--warn">未保存</span>
          </div>
        </div>
        <div class="ac-body">
          <!-- 入站：三张等宽选项卡片（2026-11-03 范式二）。每张卡自带「这一档意味着什么」，
               选中高风险档时警示话落在卡内（琥珀小字），不再有贯穿整屏的红条。
               宽度由三列卡片用掉——卡片满屏是「用满了」，「按钮拉满屏」才是面条。 -->
          <section class="ac-section">
            <h4 class="ac-section__title">管理后台访问控制</h4>
            <div class="ac-opts" role="radiogroup" aria-label="访问来源模式" @keydown="onAccessKeydown">
              <button
                v-for="(opt, i) in accessOptions"
                :key="opt.id"
                :ref="(el) => setAccessRef(el, i)"
                type="button"
                role="radio"
                class="ac-opt mk-choice ac-opt--third"
                :class="{
                  'mk-choice--on': policy.adminAccessMode === opt.id,
                  'ac-opt--off': opt.disabled,
                }"
                :tabindex="policy.adminAccessMode === opt.id ? 0 : -1"
                :aria-checked="policy.adminAccessMode === opt.id"
                :aria-disabled="opt.disabled || undefined"
                @click="setAccessMode(opt.id)"
              >
                <span class="ac-opt__head">
                  <component :is="opt.icon" :size="15" :stroke-width="1.8" aria-hidden="true" />
                  <b>{{ opt.label }}</b>
                  <em v-if="opt.recommended" class="ac-opt__tag">推荐</em>
                </span>
                <span class="ac-opt__desc">{{ opt.desc }}</span>
                <!-- 选中点（2026-11-03 评审）：三张卡只靠描边与底色表状态，第一次进来的人
                     不知道「这几块能点」。右上角给一个 ○/● 指示器，不抢描边的主信号。 -->
                <span class="ac-opt__radio" aria-hidden="true"></span>
                <!-- 警示行常驻占位（只有选中这一档时才亮起）：切档时卡片行高不变，页面不抽。
                     未选中的档只读它的 desc，不预先背着「别选我」——那会变成三张卡都在喊。 -->
                <span
                  class="ac-opt__warn"
                  :class="{ 'ac-opt__warn--idle': !(policy.adminAccessMode === opt.id && opt.warn) }"
                >
                  <template v-if="policy.adminAccessMode === opt.id && opt.warn">
                    <TriangleAlert :size="13" :stroke-width="2" aria-hidden="true" />{{ opt.warn }}
                  </template>
                </span>
              </button>
            </div>
            <label v-if="policy.adminAccessMode === 'private'" class="mk-field ac-subfield">
              <span class="mk-field__label">额外允许的客户端 IP</span>
              <textarea
                class="mk-field__textarea ac-textarea"
                rows="2"
                :value="policy.adminAllowedIps.join('\n')"
                @input="policy.adminAllowedIps = splitLines(($event.target as HTMLTextAreaElement).value)"
                placeholder="每行一个 IP 或 CIDR 网段，例如 203.0.113.10"
              ></textarea>
            </label>
            <!-- 切到不需要这份清单的档位后，输入区整块消失，得交代已填内容去了哪（2026-11-02 评审） -->
            <p v-else-if="policy.adminAllowedIps.length" class="ac-note">
              已填的 {{ policy.adminAllowedIps.length }} 条客户端 IP 仍会保留，切回「私有网段」后继续生效。
            </p>
          </section>

          <!-- 出站：三段并列，与入站同构（2026-11-10 用户「不应该也是三段码」：
               原先只有「允许全部 / 仅白名单」两档，而「禁止内网」在服务端本就存在，
               只是被当成白名单为空的保存错误挡住；现在显式成第三档） -->
          <section class="ac-section">
            <h4 class="ac-section__title">服务端出站访问</h4>
            <div class="ac-opts" role="radiogroup" aria-label="服务端出站范围" @keydown="onOutboundKeydown">
              <button
                v-for="(opt, i) in OUTBOUND_OPTIONS"
                :key="opt.id"
                :ref="(el) => setOutboundRef(el, i)"
                type="button"
                role="radio"
                class="ac-opt mk-choice ac-opt--third"
                :class="{
                  'mk-choice--on': outboundMode === opt.id,
                }"
                :tabindex="outboundMode === opt.id ? 0 : -1"
                :aria-checked="outboundMode === opt.id"
                @click="setOutbound(opt.id)"
              >
                <span class="ac-opt__head">
                  <component :is="opt.icon" :size="15" :stroke-width="1.8" aria-hidden="true" />
                  <b>{{ opt.label }}</b>
                </span>
                <span class="ac-opt__desc">{{ opt.desc }}</span>
                <span class="ac-opt__radio" aria-hidden="true"></span>
                <span
                  class="ac-opt__warn"
                  :class="{ 'ac-opt__warn--idle': !(outboundMode === opt.id && opt.warn) }"
                >
                  <template v-if="outboundMode === opt.id && opt.warn">
                    <TriangleAlert :size="13" :stroke-width="2" aria-hidden="true" />{{ opt.warn }}
                  </template>
                </span>
              </button>
            </div>
            <label v-if="outboundMode === 'whitelist'" class="mk-field ac-subfield">
              <span class="mk-field__label">允许的 Host / IP</span>
              <textarea
                class="mk-field__textarea ac-textarea"
                rows="2"
                :value="policy.privateNetworkHosts.join('\n')"
                @input="policy.privateNetworkHosts = splitLines(($event.target as HTMLTextAreaElement).value)"
                placeholder="每行一个 Host 或 CIDR 网段，例如 192.168.1.20"
              ></textarea>
            </label>
            <!-- 选「仅白名单」却把清单清空：多半是想禁内网却没换档，保存前挡住 -->
            <p v-if="outboundEmptyWarn" class="mk-alert ac-risk" role="alert">
              <TriangleAlert :size="15" :stroke-width="2" aria-hidden="true" />
              白名单为空：要禁止内网出站，请直接选「禁止内网」。
            </p>
          </section>

          <!-- 注册：两项也包成带边框的设置卡，与上方「两列卡片」同一套栅格与描边
               （2026-11-03 评审：此前它们是无边框裸露的绿开关，到了这一段视觉语言突然断了）。
               卡内左列 = 标题 + 说明（配额的数值输入也跟着它），右列 = 开关；开关不再自带文字标签，
               标题就是它的标签，状态词仍留在开关旁。 -->
          <section v-if="isLive && registrationEnabled !== null && registerIpQuotaEnabled !== null" class="ac-section">
            <h4 class="ac-section__title">注册设置</h4>
            <div class="ac-reg-rows">
              <div class="ac-setcard">
                <div class="ac-setcard__text">
                  <b>新用户注册</b>
                  <p class="ac-setcard__desc">允许访客在登录页自行注册账号。</p>
                  <button v-if="!registrationEnabled" type="button" class="mk-link" @click="goCreateUser">新建用户 →</button>
                </div>
                <MkSwitch
                  :model-value="registrationEnabled === true"
                  :busy="registrationBusy"
                  aria-label="新用户注册"
                  :state-text="registrationStateText"
                  @update:model-value="setRegistration"
                />
              </div>
              <div class="ac-setcard">
                <div class="ac-setcard__text">
                  <b>{{ IP_QUOTA_TITLE }}</b>
                  <p class="ac-setcard__desc">防止脚本批量注册账号。</p>
                  <!-- 2026-11-01 外部评审：开关关闭时输入框只是「暗一档」，在一屏灰字里仍被读成可填；
                       整组（标签 + 数字 + 单位）一起压暗，才看得出这是「当前不生效的值」 -->
                  <label class="ac-quota-field" :class="{ 'ac-quota-field--off': !registerIpQuotaEnabled }">
                    <span class="mk-field__label">每日上限</span>
                    <!-- 开关关闭时不再显示「5 个 / IP」再补一句「当前不限制」（2026-11-02 评审：
                         一边给数值一边说不限制）。不生效的值整组收起，只留结论。 -->
                    <template v-if="registerIpQuotaEnabled">
                      <input
                        type="number"
                        class="mk-field__input"
                        min="1"
                        max="100"
                        :value="quotaInput"
                        :disabled="quotaBusy"
                        @change="onQuotaInput"
                      />
                      <em>个 / IP</em>
                    </template>
                    <span v-else class="ac-quota-off">当前不限制</span>
                  </label>
                  <button
                    v-if="registerIpQuotaEnabled && quotaDirty"
                    type="button"
                    class="mk-btn mk-btn--sm mk-btn--primary"
                    :disabled="quotaBusy"
                    @click="saveQuota(registerIpQuotaEnabled === true, quotaInput)"
                  >保存上限</button>
                </div>
                <MkSwitch
                  :model-value="registerIpQuotaEnabled === true"
                  :busy="quotaBusy"
                  :aria-label="IP_QUOTA_TITLE"
                  @update:model-value="setQuotaEnabled"
                />
              </div>
            </div>
          </section>
        </div>
        <div class="ac-foot">
          <button
            type="button"
            class="mk-btn mk-btn--primary"
            :disabled="!policyDirty || saving || saveBlocked"
            :title="!policyDirty && !saveBlocked && !configFailed ? '调整任一策略后可保存' : undefined"
            @click="savePolicy"
          >{{ saving ? '保存中…' : '保存策略' }}</button>
          <!-- 未修改时保存钮置灰是「暂无可保存的改动」而非无权限（2026-10-31 三轮评审）：
               当时在灰底主按钮旁补了一句弱化说明。2026-11-02 走查把屏上这句撤掉——它是在
               解释按钮自身的置灰条件，属「让布局自己说话」要收掉的那类；同一句改挂
               「保存策略」的 title（只在这一条成立时挂上），悬停与读屏仍拿得到。
               读取失败时不挂：没有可比较的已保存值，脏值恒假，此时改表单也点不动保存。
               2026-11-03：卡尾不再另写一句「改动尚未保存」——脏值已经由卡头徽章说了，
               同屏两处说同一件事（评审指出）。 -->
        </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import MkSwitch from '@/components/mk/MkSwitch.vue'
import { Globe, Laptop, Network, ShieldCheck, ShieldOff, TriangleAlert } from 'lucide-vue-next'
import { toast } from '@/utils/toast'
import { authAPI } from '@/api/auth'
import {
  liveApiConfig as cfg,
  liveFailures,
  liveSaveNetworkPolicy,
  loadLiveData,
  errMsg,
  registrationEnabled,
  registerIpQuotaEnabled,
  registerIpDailyQuota,
  updateRegistrationSetting,
  updateRegisterIpQuotaSetting,
} from './live'
import { isLive } from './store'
import { askConfirm } from './useConfirm'

/* 嵌入运营中心时页头由宿主承担 */
withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

/* 文案单源（R6 复读单源化）：卡标题与开关标签共用一份 */
const IP_QUOTA_TITLE = '单 IP 每日注册配额'
const router = useRouter()

/* ---------- 访问来源与出站白名单（策略组，一次保存） ---------- */
const policy = reactive({
  adminAccessMode: 'private' as 'loopback' | 'private' | 'any',
  adminAllowedIps: [] as string[],
  allowPrivateNetwork: true,
  privateNetworkHosts: [] as string[],
})
const saving = ref(false)
/** 出站档位（草稿）：由 allowPrivateNetwork + 白名单推导出「禁止内网」这一显式档 */
const outboundMode = ref<OutboundMode>('all')
/** 入表策略按档位归一：禁止内网 = 不放行内网且白名单清空（服务端就是这样判的） */
const effectiveOutbound = computed(() => ({
  allowPrivateNetwork: outboundMode.value === 'all',
  privateNetworkHosts: outboundMode.value === 'deny' ? [] : policy.privateNetworkHosts
}))
/** 接入域读取失败：空表单不得伪装成「未配置」 */
const configFailed = computed(() => !!liveFailures.value.apiConfig)

/** 列表字段按元素比：改回原值（含只增删空行）不算改动 */
function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}
/* 脏值 = 表单现值与已保存 networkPolicy 逐项不等。原来是「碰过即置 true、只在加载/保存后
   清零」的一次性标志，改回原值后仍判定有改动，保存钮亮着却提交不出任何差异（2026-11-01
   外部评审）；也让「离开页面」与 beforeunload 的无改动快路径一起失灵。 */
const policyDirty = computed(() => {
  const saved = cfg.value?.networkPolicy
  if (!saved) return false
  return (
    policy.adminAccessMode !== saved.adminAccessMode ||
    effectiveOutbound.value.allowPrivateNetwork !== saved.allowPrivateNetwork ||
    !sameList(policy.adminAllowedIps, saved.adminAllowedIps) ||
    !sameList(effectiveOutbound.value.privateNetworkHosts, saved.privateNetworkHosts)
  )
})

/** 已保存的访问来源档：页面只展示它，编辑中的草稿另存在 policy 里 */
const accessModeText = computed(() => {
  const saved = cfg.value?.networkPolicy?.adminAccessMode
  return saved ? MODE_TEXT[saved] : '读取中'
})

/** 表单按服务端值重置；数组另拷一份，草稿改动不会穿透到用于比较的快照 */
function applyPolicy(): void {
  const saved = cfg.value?.networkPolicy
  if (!saved) return
  policy.adminAccessMode = saved.adminAccessMode
  policy.allowPrivateNetwork = saved.allowPrivateNetwork
  policy.adminAllowedIps = [...saved.adminAllowedIps]
  policy.privateNetworkHosts = [...saved.privateNetworkHosts]
  /* 已保存态回推档位：放行全部 → all；否则有白名单 → whitelist；空清单 → deny */
  outboundMode.value = saved.allowPrivateNetwork
    ? 'all'
    : (saved.privateNetworkHosts.length ? 'whitelist' : 'deny')
}
watch(() => cfg.value, applyPolicy, { immediate: true })

function splitLines(s: string): string[] {
  return s.split('\n').map((x) => x.trim()).filter(Boolean)
}
function retryLoad(): void {
  void loadLiveData()
}

/* 宿主刷新（运营中心顶栏）：策略表单有未保存改动时不动它——重取 cfg 会 applyPolicy
   覆盖草稿；此时只刷新与表单无关的注册状态。无改动时按原「重试」语义整域重取。 */
function reload(): void {
  if (policyDirty.value) {
    if (isLive.value) void loadRegistrationStatus()
    return
  }
  retryLoad()
}
defineExpose({ reload })

/** 选「仅白名单」却又把名单清空：多半是误操作（想禁内网请直接选「禁止内网」），保存前挡住 */
const outboundEmptyWarn = computed(
  () => outboundMode.value === 'whitelist' && policy.privateNetworkHosts.length === 0,
)
const saveBlocked = computed(() => outboundEmptyWarn.value)

/** 生产环境后端拒绝「不限制」来源，选项就地置灰并写原因 */
const isProduction = import.meta.env.PROD
const accessOptions = computed(() => [
  {
    id: 'loopback' as const,
    label: '仅本机',
    icon: Laptop,
    recommended: false,
    disabled: false,
    desc: '只有本机能进后台',
    warn: '',
  },
  {
    id: 'private' as const,
    label: '私有网段',
    icon: Network,
    recommended: true,
    disabled: false,
    desc: '本机与局域网、VPN 内可进',
    warn: '',
  },
  {
    id: 'any' as const,
    label: '不限制',
    icon: Globe,
    recommended: false,
    disabled: isProduction,
    desc: '任意来源都能进后台',
    /* 警示话进卡内（2026-11-03 范式二）：原先它是屏上一整条红横幅，常驻，
       和下方出站那条合起来读成「工地警戒线」。现在只有选中这一档时才亮起。 */
    warn: '公网入口，仅建议临时调试时开启',
  },
])

/** 出站三档：与入站同构（图标 + 标签 + 一句说明 + 选中时的警示），键序固定供方向键用。
 *  2026-11-10 用户「不应该也是三段码」：原先只有两档（允许全部 / 仅白名单），
 *  而「禁止内网」这一档在服务端本来就存在（allowPrivateNetwork=false + 白名单为空），
 *  只是被当成「白名单为空」的保存错误挡住。现在把它显式化，三段与入站对齐。 */
type OutboundMode = 'all' | 'whitelist' | 'deny'
const OUTBOUND_OPTIONS: ReadonlyArray<{
  id: OutboundMode
  label: string
  icon: typeof Network
  desc: string
  warn: string
}> = [
  {
    id: 'all',
    label: '允许全部内网',
    icon: Network,
    desc: '服务端可访问任意内网地址',
    warn: '含云厂商元数据地址，出站目标可信时才保持这一档',
  },
  {
    id: 'whitelist',
    label: '仅白名单',
    icon: ShieldCheck,
    desc: '只允许清单里的 Host / IP',
    warn: '',
  },
  {
    id: 'deny',
    label: '禁止内网',
    icon: ShieldOff,
    desc: '公网照常，内网地址一律不可达',
    warn: '保存后白名单会清空',
  },
]
function setAccessMode(mode: 'loopback' | 'private' | 'any'): void {
  if (policy.adminAccessMode === mode) return
  if (accessOptions.value.find((o) => o.id === mode)?.disabled) return
  policy.adminAccessMode = mode
}
/* 键盘契约（审核 #160）：roving tabindex + 方向键循环切换并移动焦点 */
const accessEls = ref<(HTMLElement | null)[]>([])
function setAccessRef(el: unknown, i: number): void {
  accessEls.value[i] = (el as HTMLElement) || null
}
function onAccessKeydown(e: KeyboardEvent): void {
  const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End']
  if (!keys.includes(e.key)) return
  const opts = accessOptions.value
  const n = opts.length
  const cur = opts.findIndex((o) => o.id === policy.adminAccessMode)
  const from = cur >= 0 ? cur : 0
  const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1
  let next = from
  if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = n - 1
  else {
    // 跳过不可选档（生产环境的「不限制」）
    for (let i = 1; i <= n; i++) {
      const cand = (from + step * i + n * i) % n
      if (!opts[cand].disabled) { next = cand; break }
    }
  }
  e.preventDefault()
  if (opts[next].disabled) return
  setAccessMode(opts[next].id)
  void nextTick(() => accessEls.value[next]?.focus())
}

/* 出站三档同样走 radio 语义：roving tabindex + 方向键切换 */
function setOutbound(mode: OutboundMode): void {
  if (outboundMode.value === mode) return
  outboundMode.value = mode
  policy.allowPrivateNetwork = mode === 'all'
}
const outboundEls = ref<(HTMLElement | null)[]>([])
function setOutboundRef(el: unknown, i: number): void {
  outboundEls.value[i] = (el as HTMLElement) || null
}
function onOutboundKeydown(e: KeyboardEvent): void {
  const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End']
  if (!keys.includes(e.key)) return
  e.preventDefault()
  const n = OUTBOUND_OPTIONS.length
  const cur = OUTBOUND_OPTIONS.findIndex((o) => o.id === outboundMode.value)
  const from = cur >= 0 ? cur : 0
  const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1
  let next = from
  if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = n - 1
  else next = (from + step + n) % n
  setOutbound(OUTBOUND_OPTIONS[next].id)
  void nextTick(() => outboundEls.value[next]?.focus())
}

const MODE_TEXT: Record<'loopback' | 'private' | 'any', string> = {
  loopback: '仅本机（127.0.0.1）',
  private: '私有网段',
  any: '不限制来源'
}
const MODE_RANK: Record<'loopback' | 'private' | 'any', number> = { loopback: 2, private: 1, any: 0 }
/** 本次保存是「收紧」而不是「放宽」：按档位比较编辑值与服务端现值 */
function isTightening(): boolean {
  const saved = cfg.value?.networkPolicy?.adminAccessMode
  if (!saved) return false
  return MODE_RANK[policy.adminAccessMode] > MODE_RANK[saved]
}

async function savePolicy(): Promise<void> {
  if (saving.value || !policyDirty.value || saveBlocked.value) return
  if (policy.adminAccessMode === 'any') {
    const ok = await askConfirm({
      title: '开放公网访问',
      message: '你正在将 Admin 后台开放到公网/任意来源访问。\n任何能访问该服务地址的人都能看到管理入口，请确认已了解风险。',
      confirmText: '确认开放',
    })
    if (!ok) return
  } else if (isTightening()) {
    /* 2026-11-01 外部评审（三轮 P0）：往严收紧同样可能「把自己关在门外」——
       原来只在开放公网时拦一次，收紧没有任何提示，误选「仅本机」保存后远程管理员直接掉线。 */
    const ok = await askConfirm({
      title: '收紧后台访问来源',
      message: `保存后只接受「${MODE_TEXT[policy.adminAccessMode]}」进来的请求。
如果你现在不是从这类来源访问后台，保存会立刻把自己挡在门外（要到服务器上改配置才能恢复）。`,
      confirmText: '我已确认当前来源',
    })
    if (!ok) return
  }
  saving.value = true
  try {
    await liveSaveNetworkPolicy({ ...policy, ...effectiveOutbound.value })
    toast.success('访问策略已保存并生效')
  } catch (e) {
    toast.error(`保存失败：${errMsg(e)}`)
  } finally {
    saving.value = false
  }
}

/* 未保存保护：与 ApiConfig 同款，离开页面前拦一次 */
onBeforeRouteLeave(async () => {
  if (!policyDirty.value) return true
  const ok = await askConfirm({
    title: '有未保存的访问策略',
    message: '离开将丢弃这些修改，确认离开？',
    confirmText: '丢弃并离开',
  })
  return ok === true
})
function onBeforeUnloadHandler(e: BeforeUnloadEvent) {
  if (policyDirty.value) {
    e.preventDefault()
    e.returnValue = ''
  }
}
onMounted(() => window.addEventListener('beforeunload', onBeforeUnloadHandler))
onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnloadHandler))

/* ---------- 注册开关（高风险，二次确认） ---------- */
const registrationBusy = ref(false)
/** 生效值：配置开但核心学习服务阻断时注册实际不可用（auth.ts registration-status） */
const registrationTemporaryUnavailable = ref(false)
async function loadRegistrationStatus(): Promise<void> {
  try {
    const s = await authAPI.getRegistrationStatus()
    registrationTemporaryUnavailable.value = s.temporaryUnavailable === true
  } catch {
    registrationTemporaryUnavailable.value = false
  }
}
const registrationStateText = computed(() =>
  registrationTemporaryUnavailable.value ? '暂不可用' : '',
)
function goCreateUser(): void {
  void router.push('/admin/people')
}
async function setRegistration(target: boolean): Promise<void> {
  if (registrationBusy.value || registrationEnabled.value === null) return
  if (target === registrationEnabled.value) return
  const ok = await askConfirm({
    title: target ? '开放注册' : '关闭注册',
    message: target
      ? '确认开放新用户自助注册？\n任何人都能通过注册页创建账号。'
      : '确认关闭新用户自助注册？\n关闭后新账号只能由管理员手动创建。',
    confirmText: target ? '开放注册' : '关闭注册',
    danger: target,
  })
  if (!ok) return
  registrationBusy.value = true
  try {
    await updateRegistrationSetting(target)
    await loadRegistrationStatus()
    toast.success(target ? '注册已开放' : '注册已关闭，新账号只能由管理员创建')
  } catch (e) {
    registrationEnabled.value = !target
    toast.error(`切换失败：${errMsg(e)}`)
  } finally {
    registrationBusy.value = false
  }
}

/* ---------- 单 IP 每日注册配额（默认关，避免误伤同一出口的正常注册） ---------- */
const quotaBusy = ref(false)
const quotaInput = ref(5)
/** 已落盘的限额：状态词只报它，改数字未保存时屏幕上不出现新值 */
const quotaSaved = ref(5)
watch(
  () => registerIpDailyQuota.value,
  (v) => {
    if (typeof v === 'number' && v >= 1 && v <= 100) {
      quotaInput.value = v
      quotaSaved.value = v
    }
  },
  { immediate: true },
)
const quotaDirty = computed(() => quotaInput.value !== quotaSaved.value)
/** 配额输入只在 change 时校验：清空/非法值回退最近一次有效值（Number('')=0 会被钳到 1 静默改值） */
function onQuotaInput(e: Event): void {
  const input = e.target as HTMLInputElement
  const raw = input.value.trim()
  const v = Number(raw)
  if (!raw || !Number.isInteger(v) || v < 1) {
    input.value = String(quotaInput.value)
    return
  }
  quotaInput.value = Math.min(100, Math.max(1, v))
}
async function setQuotaEnabled(enabled: boolean): Promise<void> {
  if (quotaBusy.value) return
  if (enabled && !registerIpQuotaEnabled.value) {
    const ok = await askConfirm({
      title: '启用单 IP 每日注册配额',
      message: `开启后，同一 IP 24 小时内最多注册 ${quotaInput.value} 个账号。\n若您所在网络有多个真实用户共享出口 IP，可能误伤正常注册。`,
      confirmText: '启用配额',
      danger: false,
    })
    if (!ok) return
  }
  await saveQuota(enabled, quotaInput.value)
}
async function saveQuota(enabled: boolean, quota: number): Promise<void> {
  if (quotaBusy.value) return
  quotaBusy.value = true
  try {
    await updateRegisterIpQuotaSetting(enabled, quota)
    quotaSaved.value = quota
    toast.success(enabled ? `配额已启用：每 IP 每日 ${quota} 个` : '配额已关闭，注册不再限制数量')
  } catch (e) {
    quotaInput.value = quotaSaved.value
    toast.error(`保存失败：${errMsg(e)}`)
  } finally {
    quotaBusy.value = false
  }
}

onMounted(() => { if (isLive.value) void loadRegistrationStatus() })
</script>

<style scoped>
/* 嵌入运营中心（2026-10-27）：宿主承担页头与页面内边距，本页只做页签面板——
   占满剩余高度并自管纵向滚动，与 tools/export 面板同判例 */
.acl-host--embedded {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: grid;
  gap: 12px;
  align-content: start;
}
@media (max-width: 900px) {
  .acl-host--embedded { flex: none; overflow: visible; }
}
/* 卡通栏左对齐（与同页签运维工具/数据导出/会话安全外框同轴，2026-10-31 三轮评审：
   上一版 1200 居中在左侧导航 + 左对齐页头的后台里砍断了左轴线）。
   2026-11-03 用户第二次拍板「不要限宽」：正文也不压 720/736 上限，跟卡片同宽——
   卡片通栏、控件却缩在左侧半屏，正是外部评审说的「左挤右空」。宽屏下分段控件与
   文本框会拉长，这是用户选定的代价（见 CHANGELOG 2026-11-03）。 */
.ac-card { width: 100%; }
.ac-reg-rows { display: grid; gap: 12px; }
.ac-body { display: grid; gap: 18px; padding: 4px 16px 16px; }
.ac-body .mk-field { margin: 0; min-width: 0; }

/* 三段设置（入站 / 出站 / 注册）：段间用分隔线，不再用大卡占位 */
.ac-section { display: grid; gap: 10px; min-width: 0; }
.ac-section + .ac-section {
  padding-top: 16px;
  border-top: 1px solid var(--mk-line);
}
.ac-section__title { margin: 0; font-size: var(--mk-fs-body); font-weight: 700; color: var(--mk-ink); }
.ac-note { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-muted); line-height: 1.6; }

/* 互斥枚举 = 等宽选项卡片（2026-11-03 范式二，用户「参考这个设计一下」）：
   三档入站 / 两档出站共用一套。每张卡自带一句「这一档意味着什么」与（选中高风险档时的）
   琥珀警示行，宽度由栅格分掉——通栏卡里这样才是「用满了」，而不是一个按钮拉满 1400px。
   默认档无警示文字，屏上不出现任何红条（出站那两条红横幅就此退役，只留会挡住保存的那条）。 */
.ac-opts {
  display: grid;
  /* 6 列铺满：入站三档各占 2 列（三等分），出站两档各占 3 列（二等分），两行都刚好满宽 */
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
}
.ac-opt {
  grid-column: span 3;
  display: grid;
  align-content: start;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-md);
  color: var(--mk-muted);
  text-align: left;
  cursor: pointer;
  transition: border-color 0.12s var(--mk-ease-out), background 0.12s var(--mk-ease-out);
}
/* 底色与选中色都交给全局原语（2026-11-09 收敛）：默认面写在本类，选中面由 .mk-choice--on 给；
   这里只补一处 scoped 覆盖——选中时正文提到 --mk-ink（原 .ac-opt--on 的职责）。 */
.ac-opt:not(.mk-choice--on) { border-color: var(--mk-line); background: var(--mk-surface); }
.ac-opt--third { grid-column: span 2; }
.ac-opt:not(.mk-choice--on):hover { border-color: color-mix(in srgb, var(--mk-blue) 40%, var(--mk-line)); }
.ac-opt:focus-visible { outline: 2px solid var(--mk-blue); outline-offset: 1px; }
.ac-opt.mk-choice--on { color: var(--mk-ink); }
.ac-opt--off { cursor: not-allowed; opacity: 0.55; }
.ac-opt--off:hover { border-color: var(--mk-line); }
.ac-opt__head { display: flex; align-items: center; gap: 7px; }
.ac-opt__head b { font-size: var(--mk-fs-body); font-weight: 700; color: inherit; }
.ac-opt__desc { font-size: var(--mk-fs-micro); line-height: 1.5; }
/* 右上角 ○/● 选中指示：卡片整体可点，这个点只负责说「这里能点、当前选的是它」 */
.ac-opt { position: relative; }
.ac-opt__radio {
  position: absolute;
  top: 12px;
  right: 12px;
  width: 13px;
  height: 13px;
  border: 1px solid var(--mk-line);
  border-radius: 50%;
  background: var(--mk-surface);
}
.ac-opt.mk-choice--on .ac-opt__radio { border-color: var(--mk-blue); background: var(--mk-blue); box-shadow: inset 0 0 0 3px var(--mk-surface); }
.ac-opt--off .ac-opt__radio { opacity: 0.5; }
.ac-opt__tag {
  padding: 1px 6px;
  border-radius: var(--mk-radius-sm);
  background: color-mix(in srgb, var(--mk-blue) 12%, transparent);
  color: var(--mk-blue-text);
  font-size: var(--mk-fs-micro);
  font-style: normal;
  font-weight: 700;
  line-height: 1.4;
}
/* 警示行常驻占位：固定 16px 一行，选中时亮起、未选中时占位不可见——
   两态像素相同，切档时卡片与页面都不动（原先整卡上下跳 49~101px）。 */
.ac-opt__warn {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 16px;
  font-size: var(--mk-fs-micro);
  font-weight: 600;
  line-height: 16px;
  color: var(--mk-amber);
}
.ac-opt__warn svg { flex: none; }
.ac-opt__warn--idle { visibility: hidden; }
/* 2026-11-09 设计语言收敛（可选卡片）：删掉「选中且带警示 → 整卡描边转琥珀」。
   选中态与警示态原先抢同一个通道（border-color），结果选中一张高风险卡时蓝色选中边
   被琥珀覆盖，读者分不清「这张是选中的」还是「这张有问题」——两者语义互相抵消。
   现在各走各的通道：选中 = 蓝描边 + 实心单选点（全站唯一选中语法），
   风险 = 卡内那行琥珀警示文字（本来就常驻占位，切档不抽高度）。 */

/* 档位相关的子字段（额外允许的客户端 IP / 允许的 Host / IP）：只在自己那一档出现。
   宽度对齐上方「两列卡片」的列宽（而不是给一个随手定的上限）：右缘与出站/注册卡片
   同一根线，读起来是有栅格的；卡片通栏指的是容器，不是输入框（2026-11-03）。 */
.ac-subfield { margin: 0; width: calc((100% - 10px) / 2); max-width: 100%; }

/* 风险提示（白名单为空）：会挡住保存，是「做不了」而非「提醒」，保留整条告警。
   沿用共享 .mk-alert 的色料档，本类只补「图标 + 文本」两栏布局。 */
.ac-risk {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0;
  line-height: 1.5;
}
.ac-risk svg { flex: none; margin-top: 1px; }

/* 注册两项 = 两张设置卡，与上方「两列卡片」同栅格同描边：左列标题 + 说明（含配额数值），
   右列开关（标题即它的标签，故开关不再自带 label），顶部对齐。 */
.ac-reg-rows { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.ac-setcard {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-md);
  background: var(--mk-surface);
}
.ac-setcard__text { display: grid; gap: 4px; align-content: start; min-width: 0; }
.ac-setcard__text b { font-size: var(--mk-fs-body); font-weight: 700; color: var(--mk-ink); }
.ac-setcard__desc { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-muted); line-height: 1.5; }
.ac-quota-field { display: inline-flex; align-items: center; gap: 8px; }
.ac-quota-field .mk-field__label { margin: 0; }
.ac-quota-field .mk-field__input { width: 76px; text-align: center; font-variant-numeric: tabular-nums; }
.ac-quota-field em { font-style: normal; color: var(--mk-faint); }
/* 配额关闭 = 这组数不生效：整组压暗 + 输入框改虚线边 + 明写「当前不限制」。
   仅压暗仍被读成「可填」（2026-11-01 外部评审二轮），三重信号一起给才不留歧义。 */
.ac-quota-field--off { opacity: 0.45; }
.ac-quota-field--off .mk-field__input { border-style: dashed; }
.ac-quota-off { font-size: var(--mk-fs-micro); font-weight: 600; color: var(--mk-muted); white-space: nowrap; }

/* 窄档：选项卡片两列 → 单列（卡片本身自带说明，堆叠后仍读得通） */
@media (max-width: 900px) {
  .ac-opts { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ac-opt, .ac-opt--third { grid-column: span 1; }
  .ac-subfield { width: 100%; }
}
@media (max-width: 620px) {
  .ac-opts { grid-template-columns: 1fr; }
  .ac-reg-rows { grid-template-columns: 1fr; }
}

/* 保存归位到表单末尾：改完整张卡，动作就在手边（2026-10-30 人工复查） */
.ac-foot {
  display: flex;
  align-items: center;
  /* 主操作靠右（2026-11-03）：同页签「数据导出」的卡尾也是「左读数 / 右主操作」，
     本页原先独自把「保存策略」放在左下角，是这页看着不像同一套 UI 的三处之一。 */
  justify-content: flex-end;
  gap: 12px;
  padding: 14px 16px 18px;
  border-top: 1px solid var(--mk-line);
}

/* 全宽（2026-10-31 外部评审）：760 卡内上下分段控件都撑满，唯独 textarea 420px 右侧留半截 */
.ac-textarea { resize: vertical; font-size: var(--mk-fs-micro); min-height: 0; width: 100%; }
</style>
