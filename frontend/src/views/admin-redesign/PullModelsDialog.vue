<template>
  <!-- 拉取结果浮窗（2026-10-24 用户「拉取作为浮窗吧，相当于获取了，然后勾选要的，然后再配置」）：
       拉取只负责「拿到清单」，不再把整张上游清单铺在供应商详情里；要登记哪些模型在这里勾，
       确认后逐个进入既有的模型设置弹层补单价与能力。 -->
  <Teleport v-if="open" to="body">
    <div ref="maskRef" class="mk-modal">
      <div ref="panelRef" class="mk-modal__panel pmd" role="dialog" aria-modal="true" aria-label="拉取结果">
        <div class="mk-modal__head">
          <div class="pmd-head">
            <h3 class="mk-modal__title">拉取结果</h3>
            <span class="pmd-head__sub">{{ providerName }} · 已拉取 {{ models.length }} 个</span>
          </div>
          <button type="button" class="mk-modal__close" aria-label="关闭" @click="close">✕</button>
        </div>

        <div class="mk-modal__body">
          <div class="pmd-toolbar">
            <input
              v-model="query"
              class="mk-field__input pmd-filter"
              placeholder="筛选模型"
              aria-label="筛选拉取结果"
              autocomplete="off"
            />
            <label class="pmd-all">
              <input
                type="checkbox"
                :checked="allVisibleSelected"
                :indeterminate="someVisibleSelected && !allVisibleSelected"
                :disabled="!selectableVisibleChat.length"
                @change="toggleAll"
              />
              <span>全选当前可添加 {{ selectableVisibleChat.length }} 个</span>
            </label>
          </div>

          <section class="pmd-sec">
            <div class="pmd-sec__head">
              <span class="pmd-sec__title">对话候选</span>
              <b>{{ chatModels.length }}</b>
              <!-- 已添加的也计在候选里：两个数不一致时把「还能加几个」写出来，避免误读 -->
              <span v-if="selectableChat.length !== chatModels.length" class="pmd-sec__hint">可添加 {{ selectableChat.length }}</span>
            </div>
            <div class="pmd-list">
              <div
                v-for="name in filteredChat"
                :key="name"
                class="pmd-row"
                :class="{ 'pmd-row--done': registeredSet.has(name) }"
              >
                <label class="pmd-row__pick">
                  <input
                    v-model="selected"
                    type="checkbox"
                    :value="name"
                    :disabled="registeredSet.has(name)"
                  />
                  <span class="mono pmd-row__id" :title="name">{{ name }}</span>
                </label>
                <span v-if="registeredSet.has(name)" class="mk-badge mk-badge--muted">已添加</span>
                <!-- 就地验一次（2026-10-26 用户「拉取模型那里可以测试了」）：
                     勾选前就知道这个 id 在这个供应商下能不能真的调通，省掉「先登记再回表格测」的一圈 -->
                <span v-if="providerId" class="pmd-row__probe">
                  <button
                    type="button"
                    class="mk-link pmd-row__test"
                    :disabled="!!testing"
                    @click="runTest(name)"
                  >{{ testing === name ? '测试中…' : '测试' }}</button>
                  <span
                    v-if="results[name]"
                    class="pmd-row__res"
                    :class="results[name].ok ? 'is-ok' : 'is-bad'"
                    :title="results[name].text"
                  >{{ results[name].ok ? `已连通 · ${results[name].latency}` : '连接失败' }}</span>
                  <!-- 结果位常驻：没有结果的行也占住同一列宽，各行的「测试」才对得齐 -->
                  <span v-else class="pmd-row__res" aria-hidden="true"></span>
                </span>
              </div>
              <p v-if="!filteredChat.length" class="pmd-empty">
                {{ chatModels.length ? '没有匹配的对话模型' : '这次没有拉取到对话模型' }}
              </p>
            </div>
          </section>

          <!-- 其他用途默认折叠：浮窗的主任务是「勾选要登记的对话模型」，28 个向量/音频行
               展开会把勾选区挤出首屏；筛选只命中其他用途时自动展开。 -->
          <details
            v-if="otherModels.length"
            class="pmd-more"
            :open="!!query.trim() && !filteredChat.length && !!filteredOther.length"
          >
            <summary class="pmd-more__summary">
              <span class="pmd-sec__title">其他用途</span>
              <b>{{ otherModels.length }}</b>
            </summary>
            <div class="pmd-list pmd-list--other">
              <div v-for="name in filteredOther" :key="name" class="pmd-row pmd-row--other">
                <span class="pmd-row__dot" aria-hidden="true"></span>
                <span class="mono pmd-row__id" :title="name">{{ name }}</span>
                <span class="mk-badge mk-badge--muted">{{ kindLabelOf(name) }}</span>
                <button
                  v-if="modelTargetOf(modelKindOf(name)) === 'infra'"
                  type="button"
                  class="mk-link"
                  @click="go('infra')"
                >基础设施配置</button>
                <button
                  v-else-if="modelTargetOf(modelKindOf(name)) === 'plugins'"
                  type="button"
                  class="mk-link"
                  @click="go('plugins')"
                >插件配置</button>
                <span v-else class="pmd-row__na">暂未接入</span>
              </div>
              <p v-if="!filteredOther.length" class="pmd-empty">没有匹配的其他用途模型</p>
            </div>
          </details>
        </div>

        <div class="mk-modal__foot pmd-foot">
          <span class="pmd-foot__count">已选 <b>{{ selected.length }}</b> 个</span>
          <button type="button" class="mk-btn" @click="close">取消</button>
          <button
            type="button"
            class="mk-btn mk-btn--primary"
            :disabled="!selected.length"
            @click="confirm"
          >配置选中的 {{ selected.length }} 个</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { adminModelProvidersApi } from '@/api/adminApi'
import { useEscape } from './useEscape'
import { useMaskClose, useOverlay } from './useOverlay'
import { errMsg } from './live'
import { MODEL_KIND_LABEL, MODEL_KIND_ORDER, modelKindOf, modelTargetOf } from './platformModelKind'

const props = defineProps<{
  /** 供应商名（浮窗副标题，说明这批模型从哪来） */
  providerName: string
  /** 供应商 id：就地测试要用它自己的地址与密钥（未传 = 不渲染测试动作） */
  providerId?: string
  /** 本次拉取到的全部模型 id */
  models: string[]
  /** 已登记进模型清单的 id：这些行只读标记「已添加」 */
  registered: string[]
}>()

const emit = defineEmits<{
  /** 勾选完成：按勾选顺序把 id 交给宿主逐个配置 */
  confirm: [ids: string[]]
  /** 非对话模型的去向：基础设施 / 插件配置 */
  navigate: [target: 'infra' | 'plugins']
}>()

const open = ref(false)
const query = ref('')
const selected = ref<string[]>([])
/** 正在测试的模型 id（同一时刻只跑一个：串行避免一把把上游打满） */
const testing = ref('')
/** 行内测试结果：ok 显耗时，失败显「✗ 失败」（原因进 title） */
const results = ref<Record<string, { ok: boolean; latency: string; text: string }>>({})
const maskRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)

const registeredSet = computed(() => new Set(props.registered))
const chatModels = computed(() => props.models.filter((name) => modelKindOf(name) === 'chat'))
const otherModels = computed(() =>
  props.models
    .filter((name) => modelKindOf(name) !== 'chat')
    .sort((a, b) => {
      const diff = MODEL_KIND_ORDER.indexOf(modelKindOf(a)) - MODEL_KIND_ORDER.indexOf(modelKindOf(b))
      return diff || a.localeCompare(b)
    })
)
const kindLabelOf = (name: string) => MODEL_KIND_LABEL[modelKindOf(name)]

const matched = (name: string) => {
  const q = query.value.trim().toLowerCase()
  return !q || name.toLowerCase().includes(q)
}
const filteredChat = computed(() => chatModels.value.filter(matched))
/** 全部候选里还能勾的对话模型（不受筛选影响，只用于段头读数） */
const selectableChat = computed(() => chatModels.value.filter((name) => !registeredSet.value.has(name)))
const filteredOther = computed(() => otherModels.value.filter(matched))
/** 当前筛选结果里还能勾的对话模型（已添加的不可勾） */
const selectableVisibleChat = computed(() =>
  filteredChat.value.filter((name) => !registeredSet.value.has(name))
)
const allVisibleSelected = computed(() =>
  selectableVisibleChat.value.length > 0
  && selectableVisibleChat.value.every((name) => selected.value.includes(name))
)
const someVisibleSelected = computed(() =>
  selectableVisibleChat.value.some((name) => selected.value.includes(name))
)

function toggleAll(): void {
  const names = selectableVisibleChat.value
  if (allVisibleSelected.value) {
    selected.value = selected.value.filter((name) => !names.includes(name))
  } else {
    selected.value = Array.from(new Set([...selected.value, ...names]))
  }
}

function openWith(): void {
  selected.value = []
  query.value = ''
  results.value = {}
  testing.value = ''
  open.value = true
}

/** 就地测试：复用供应商测试端点（用该供应商自己的地址与密钥真发一次），
    结果只落在本行——勾选清单不该因为一个模型失败而整块变红。 */
async function runTest(modelId: string): Promise<void> {
  if (!props.providerId || testing.value) return
  testing.value = modelId
  try {
    const res = await adminModelProvidersApi.test(props.providerId, { modelId })
    const data = res?.data?.data ?? {}
    results.value = {
      ...results.value,
      [modelId]: { ok: true, latency: `${data.durationMs ?? 0}ms`, text: data.content || '连通正常' },
    }
  } catch (e) {
    results.value = { ...results.value, [modelId]: { ok: false, latency: '', text: errMsg(e) } }
  } finally {
    testing.value = ''
  }
}

function close(): void {
  open.value = false
}

function confirm(): void {
  if (!selected.value.length) return
  emit('confirm', [...selected.value])
  open.value = false
}

function go(target: 'infra' | 'plugins'): void {
  emit('navigate', target)
  open.value = false
}

useEscape(() => open.value, close)
useOverlay(open, panelRef)
useMaskClose(maskRef, close)

defineExpose({ openWith })
</script>

<style scoped>
.pmd.mk-modal__panel { width: min(760px, 96vw); max-width: none; }
.pmd-head { display: grid; gap: 2px; min-width: 0; }
.pmd-head__sub { color: var(--mk-muted); font-size: var(--mk-fs-micro); }
.pmd-toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--mk-line);
}
.pmd-filter { width: 220px; }
.pmd-all {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-left: auto;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  cursor: pointer;
}
.pmd-sec { margin-top: 14px; }
.pmd-sec + .pmd-sec { margin-top: 18px; }
.pmd-more { margin-top: 16px; }
.pmd-more__summary {
  display: flex;
  align-items: baseline;
  gap: 8px;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
  cursor: pointer;
}
.pmd-more__summary b { color: var(--mk-ink); }
/* 折叠提示：display:flex 会隐藏 details 原生三角，补一个明确的展开标记 */
.pmd-more__summary::before { content: '▸'; color: var(--mk-faint); }
.pmd-more[open] .pmd-more__summary::before { content: '▾'; }
.pmd-more[open] .pmd-more__summary { margin-bottom: 6px; }
.pmd-list--other { max-height: 32vh; }
.pmd-sec__head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
}
.pmd-sec__title { color: var(--mk-ink); font-weight: 700; }
.pmd-sec__head b { color: var(--mk-ink); }
.pmd-sec__hint { color: var(--mk-faint); }
.pmd-list {
  max-height: 46vh;
  overflow-y: auto;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-md);
}
.pmd-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 38px;
  padding: 0 12px;
  border-bottom: 1px solid var(--mk-line);
  font-size: var(--mk-fs-micro);
}
.pmd-row:last-child { border-bottom: 0; }
.pmd-row:hover { background: var(--mk-table-row-hover-bg); }
.pmd-row--done { cursor: default; }
.pmd-row--done .pmd-row__id { color: var(--mk-faint); }
/* 勾选区自成一枚 label：整行不再是 label，行内的「测试」钮才能独立点击
   （此前把测试按钮放进 label，点它会连带切换勾选）。 */
.pmd-row__pick {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1 1 auto;
  min-width: 0;
  cursor: pointer;
}
.pmd-row--done .pmd-row__pick { cursor: default; }
/* 行内测试：动作与结果各自定宽、贴右缘——有「已添加」徽标或没有结果时，
   各行的「测试」仍在同一条竖线上，结果列也同一条右边缘。 */
.pmd-row__probe {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex: none;
}
.pmd-row__test { width: 32px; flex: none; font-size: var(--mk-fs-micro); text-align: left; }
.pmd-row__test:disabled { opacity: 0.55; cursor: default; }
.pmd-row__res {
  width: 108px;
  flex: none;
  font-size: var(--mk-fs-micro);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  text-align: right;
}
.pmd-row__res.is-ok { color: var(--mk-green); }
.pmd-row__res.is-bad { color: var(--mk-red); font-weight: 600; }
.pmd-row__id {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pmd-row--other { cursor: default; }
.pmd-row__dot { width: 6px; height: 6px; border-radius: 50%; background: var(--mk-faint); flex: none; }
.pmd-row__na { color: var(--mk-faint); font-size: var(--mk-fs-micro); }
.pmd-empty {
  margin: 0;
  padding: 14px 12px;
  color: var(--mk-muted);
  font-size: var(--mk-fs-micro);
}
.pmd-foot { align-items: center; }
.pmd-foot__count { margin-right: auto; color: var(--mk-muted); font-size: var(--mk-fs-micro); }
.pmd-foot__count b { color: var(--mk-ink); }
</style>
