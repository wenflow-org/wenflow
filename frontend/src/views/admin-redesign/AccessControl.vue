<template>
  <div :class="embedded ? 'acl-host acl-host--embedded' : 'mk-page acl-host'">
    <MkPageHead v-if="!embedded" title="网络与安全" />

    <div v-if="configFailed" class="mk-alert mk-alert--row" role="alert">
      <span class="mk-alert__msg">网络策略读取失败：为空不代表未配置</span>
      <button type="button" class="mk-alert__btn" @click="retryLoad">重试</button>
    </div>

    <!-- 出站网络策略（2026-11-11 用户「三套维度塞进一个抽屉」）。
         原「管理后台访问控制」从本页撤除：那是入站防火墙，放在 Web 后台里极易误选「仅本机」
         把远程管理员当场锁在门外；该限制仍由部署层（ADMIN_ACCESS_MODE / 反向代理 / 安全组）
         生效，只是不再给界面上的开关。注册设置也已迁到「用户账号」。
         本页现在只回答一件事：后端进程主动发请求时，能到达哪些内网地址。 -->
    <section class="mk-card ac-card">
        <div class="mk-card__head">
          <div class="mk-card__head-right">
            <span class="mk-badge">当前生效：{{ savedOutboundText }}</span>
            <span v-if="policyDirty" class="mk-badge mk-badge--warn">未保存</span>
          </div>
        </div>
        <div class="ac-body">
          <section class="ac-section">
            <h4 class="ac-section__title">本地与内网资源访问</h4>
            <!-- 场景先于档位：运营要知道这一档影响的是 Ollama / 本地知识库这类内网服务，
                 而不只是一个「网络策略」名词。公网始终放行，档位只决定内网范围。 -->
            <p class="ac-note">允许系统连接局域网或本机上的模型（如 Ollama、LocalAI）与本地知识库。公网始终放行，这里选的是内网范围。</p>
            <div class="ac-opts" role="radiogroup" aria-label="本地与内网资源访问范围" @keydown="onOutboundKeydown">
              <button
                v-for="(opt, i) in OUTBOUND_OPTIONS"
                :key="opt.id"
                :ref="(el) => setOutboundRef(el, i)"
                type="button"
                role="radio"
                class="ac-opt mk-choice"
                :class="{ 'mk-choice--on': !configUnknown && outboundMode === opt.id }"
                :tabindex="!configUnknown && outboundMode === opt.id ? 0 : -1"
                :aria-checked="!configUnknown && outboundMode === opt.id"
                @click="setOutbound(opt.id)"
              >
                <span class="ac-opt__head">
                  <component :is="opt.icon" :size="15" :stroke-width="1.8" aria-hidden="true" />
                  <b>{{ opt.label }}</b>
                  <em v-if="opt.recommended" class="ac-opt__tag">推荐</em>
                </span>
                <span class="ac-opt__desc">{{ opt.desc }}</span>
                <span class="ac-opt__radio" aria-hidden="true"></span>
                <!-- 警示行常驻占位（只有选中这一档时才亮起）：切档时卡片行高不变，页面不抽 -->
                <span
                  class="ac-opt__warn"
                  :class="{ 'ac-opt__warn--idle': configUnknown || !(outboundMode === opt.id && opt.warn) }"
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
              白名单为空：要禁止内网访问，请直接选「仅限公共互联网」。
            </p>
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
        </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import MkPageHead from '@/components/mk/MkPageHead.vue'
import { Network, ShieldCheck, ShieldOff, TriangleAlert } from 'lucide-vue-next'
import { toast } from '@/utils/toast'
import { liveApiConfig as cfg, liveFailures, liveSaveNetworkPolicy, loadLiveData, errMsg } from './live'
import { askConfirm } from './useConfirm'

/* 嵌入系统设置时页头由宿主承担 */
withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

/* ---------- 出站网络策略（策略组，一次保存） ---------- */
const policy = reactive({
  allowPrivateNetwork: true,
  privateNetworkHosts: [] as string[],
})
const saving = ref(false)
/** 出站档位（草稿）：由 allowPrivateNetwork + 白名单推导出「禁止内网」这一显式档 */
type OutboundMode = 'all' | 'whitelist' | 'deny'
const outboundMode = ref<OutboundMode>('all')
/** 入表策略按档位归一：禁止内网 = 不放行内网且白名单清空（服务端就是这样判的） */
const effectiveOutbound = computed(() => ({
  allowPrivateNetwork: outboundMode.value === 'all',
  privateNetworkHosts: outboundMode.value === 'deny' ? [] : policy.privateNetworkHosts
}))
/** 接入域读取失败：空表单不得伪装成「未配置」 */
const configFailed = computed(() => !!liveFailures.value.apiConfig)
/** 从未读到 networkPolicy 且当前失败：选项区不能渲染默认档冒充当前生效值 */
const configUnknown = computed(() => configFailed.value && !cfg.value?.networkPolicy)

/** 列表字段按元素比：改回原值（含只增删空行）不算改动 */
function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i])
}
/** 脏值 = 出站现值与已保存 networkPolicy 逐项不等（改回原值即不再算改动） */
const policyDirty = computed(() => {
  const saved = cfg.value?.networkPolicy
  if (!saved) return false
  return (
    effectiveOutbound.value.allowPrivateNetwork !== saved.allowPrivateNetwork ||
    !sameList(effectiveOutbound.value.privateNetworkHosts, saved.privateNetworkHosts)
  )
})

/** 已保存的出站档：页面只展示它，编辑中的草稿另存在 policy 里 */
const savedOutboundText = computed(() => {
  const saved = cfg.value?.networkPolicy
  if (!saved) return configFailed.value ? '读取失败' : '读取中'
  if (saved.allowPrivateNetwork) return '允许内网与本地服务'
  return saved.privateNetworkHosts.length ? '仅白名单' : '仅限公共互联网'
})

/** 表单按服务端值重置；数组另拷一份，草稿改动不会穿透到用于比较的快照 */
function applyPolicy(): void {
  const saved = cfg.value?.networkPolicy
  if (!saved) return
  policy.allowPrivateNetwork = saved.allowPrivateNetwork
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

/* 宿主刷新（顶栏）：策略表单有未保存改动时不动它——重取 cfg 会 applyPolicy 覆盖草稿 */
function reload(): void {
  if (policyDirty.value) return
  retryLoad()
}
defineExpose({ reload })

/** 选「仅白名单」却又把名单清空：多半是误操作（想禁内网请直接选「仅限公共互联网」），保存前挡住 */
const outboundEmptyWarn = computed(
  () => outboundMode.value === 'whitelist' && policy.privateNetworkHosts.length === 0,
)
const saveBlocked = computed(() => outboundEmptyWarn.value)

/** 出站三档：图标 + 场景化标签 + 一句影响 + 选中时的警示，键序固定供方向键用。
 *  2026-11-11：标签从「全部放行 / 仅公网」改成场景说法——运营要判断的是
 *  「能不能连局域网里的 Ollama / 本地知识库」，不是抽象的网络档位。 */
const OUTBOUND_OPTIONS: ReadonlyArray<{
  id: OutboundMode
  label: string
  icon: typeof Network
  desc: string
  warn: string
  recommended?: boolean
}> = [
  {
    id: 'all',
    label: '允许内网与本地服务',
    icon: Network,
    desc: '可连接局域网 / 本机的模型与知识库',
    warn: '出站目标可信时才保持这一档',
    recommended: true,
  },
  {
    id: 'whitelist',
    label: '仅白名单',
    icon: ShieldCheck,
    desc: '公网照常，内网只放行清单里的 Host / IP',
    warn: '',
  },
  {
    id: 'deny',
    label: '仅限公共互联网',
    icon: ShieldOff,
    desc: '禁止向内网 / 本机发请求，公网照常',
    warn: '保存后白名单会清空',
  },
]
function setOutbound(mode: OutboundMode): void {
  if (configUnknown.value) return
  if (outboundMode.value === mode) return
  outboundMode.value = mode
  policy.allowPrivateNetwork = mode === 'all'
}
const outboundEls = ref<(HTMLElement | null)[]>([])
function setOutboundRef(el: unknown, i: number): void {
  outboundEls.value[i] = (el as HTMLElement) || null
}
/** 键盘契约：roving tabindex + 方向键循环切换 */
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

async function savePolicy(): Promise<void> {
  if (saving.value || !policyDirty.value || saveBlocked.value) return
  const saved = cfg.value?.networkPolicy
  saving.value = true
  try {
    /* 入站字段回传服务端现值：本页不再编辑它们，但协议仍是整域提交，
       漏传会被后端当成「恢复默认」，等于悄悄改掉部署层的访问限制。 */
    await liveSaveNetworkPolicy({
      adminAccessMode: saved?.adminAccessMode ?? 'private',
      adminAllowedIps: saved ? [...saved.adminAllowedIps] : [],
      ...effectiveOutbound.value,
    })
    toast.success('网络策略已保存并生效')
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
    title: '有未保存的网络策略',
    message: '离开将丢弃这些修改。',
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
</script>

<style scoped>
/* 嵌入系统设置：宿主承担页头与页面内边距，本页只做页签面板并自管纵向滚动 */
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
.ac-card { width: 100%; }
.ac-body { display: grid; gap: 18px; padding: 4px 16px 16px; }
.ac-body .mk-field { margin: 0; min-width: 0; }

.ac-section { display: grid; gap: 10px; min-width: 0; }
.ac-section__title { margin: 0; font-size: var(--mk-fs-body); font-weight: 700; color: var(--mk-ink); }
.ac-note { margin: 0; font-size: var(--mk-fs-micro); color: var(--mk-muted); line-height: 1.6; }

/* 互斥枚举 = 等宽选项卡片：每张卡自带「这一档意味着什么」与选中高风险档时的琥珀警示行 */
.ac-opts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.ac-opt {
  display: grid;
  align-content: start;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-md);
  color: var(--mk-muted);
  text-align: left;
  cursor: pointer;
  position: relative;
  transition: border-color 0.12s var(--mk-ease-out), background 0.12s var(--mk-ease-out);
}
.ac-opt:not(.mk-choice--on) { border-color: var(--mk-line); background: var(--mk-surface); }
.ac-opt:not(.mk-choice--on):hover { border-color: color-mix(in srgb, var(--mk-blue) 40%, var(--mk-line)); }
.ac-opt:focus-visible { outline: 2px solid var(--mk-blue); outline-offset: 1px; }
.ac-opt.mk-choice--on { color: var(--mk-ink); }
.ac-opt__head { display: flex; align-items: center; gap: 7px; }
.ac-opt__head b { font-size: var(--mk-fs-body); font-weight: 700; color: inherit; }
.ac-opt__desc { font-size: var(--mk-fs-micro); line-height: 1.5; }
/* 右上角 ○/● 选中指示：卡片整体可点，这个点只负责说「这里能点、当前选的是它」 */
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
.ac-opt__tag {
  padding: 1px 6px;
  border-radius: var(--mk-radius-sm);
  background: color-mix(in srgb, var(--mk-blue) 12%, transparent);
  color: var(--mk-blue-text);
  font-size: var(--mk-fs-micro);
  font-style: normal;
  font-weight: 600;
}
/* 警示行常驻占位（idle 时不可见但保留高度）：切档时卡片不抽高 */
.ac-opt__warn {
  display: flex;
  align-items: flex-start;
  gap: 5px;
  font-size: var(--mk-fs-micro);
  line-height: 1.5;
  color: var(--mk-amber);
}
.ac-opt__warn--idle { visibility: hidden; }
.ac-opt__warn svg { flex: none; margin-top: 1px; }
.ac-opt:not(.mk-choice--on) .ac-opt__warn { visibility: hidden; }
.ac-subfield { margin-top: 2px; }
.ac-textarea { width: 100%; resize: vertical; }
.ac-risk {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin: 0;
  color: var(--mk-red);
  font-size: var(--mk-fs-micro);
  line-height: 1.6;
}
.ac-risk svg { flex: none; margin-top: 1px; }
.ac-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 16px 16px;
}
</style>
