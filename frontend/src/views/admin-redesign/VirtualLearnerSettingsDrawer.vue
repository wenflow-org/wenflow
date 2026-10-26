<template>
  <!-- 容量与实验环境（2026-10-26 用户「这个设计一下吧，功能看看放在右上角维护？」）：
       专属 RPM / 最高并发 / 日期模拟是低频设置，原来占满列表下方整行、下半截全空，
       首屏还要滚过它才能看到分页器。改挂页头「维护」菜单 → 右侧抽屉：
       设置不占版面，需要时才展开，保存与脏态也收在抽屉里。
       三项共用一个保存（同一份设置接口，分开保存会让「改了两项只按一个」的另一项悄悄没生效）。 -->
  <Teleport v-if="render" to="body">
    <div v-if="open" ref="maskRef" class="mk-drawer">
      <div class="mk-drawer__mask" @click="close"></div>
      <div ref="panelRef" class="mk-drawer__panel" role="dialog" aria-label="容量与实验环境">
        <header class="mk-drawer__head">
          <div class="mk-drawer__heading">
            <h3 class="mk-drawer__title">容量与实验环境</h3>
            <span class="mk-drawer__sub">自动驾驶的并发与出站速率上限，以及日期模拟</span>
          </div>
          <button type="button" class="mk-drawer__close" aria-label="关闭" @click="close">✕</button>
        </header>
        <div class="mk-drawer__body">
          <VirtualLabLoadSettings
            ref="settingsRef"
            :concurrency="concurrency"
            :concurrency-unavailable="concurrencyUnavailable"
            :rpm="rpm"
            :rpm-saved-limit="rpmSavedLimit"
            :rpm-unavailable="rpmUnavailable"
            @dirty="dirty = $event"
            @saving="saving = $event"
            @failed="failed = $event"
          />
        </div>
        <footer class="mk-drawer__foot">
          <span v-if="dirty" class="vl-settings-drawer__dirty">未保存</span>
          <button type="button" class="mk-btn" @click="close">关闭</button>
          <button
            type="button"
            class="mk-btn mk-btn--primary"
            :disabled="!dirty || saving || failed"
            @click="save"
          >{{ saving ? '保存中…' : '保存' }}</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import VirtualLabLoadSettings from './VirtualLabLoadSettings.vue'

const props = withDefaults(defineProps<{
  concurrency?: { used: number; limit: number; queued: number }
  concurrencyUnavailable?: boolean
  rpm?: { inFlight: number; queued: number; rpm: number }
  rpmSavedLimit?: number
  rpmUnavailable?: boolean
}>(), {
  concurrency: () => ({ used: 0, limit: 0, queued: 0 }),
  concurrencyUnavailable: false,
  rpm: () => ({ inFlight: 0, queued: 0, rpm: 0 }),
  rpmSavedLimit: 0,
  rpmUnavailable: false,
})
/* 模板通过 props 透传给设置组件；脚本侧只用到 props 存在性检查以外的字段，故此处仅作占位 */
void props

const emit = defineEmits<{ (e: 'close'): void }>()

const open = ref(false)
const render = ref(false)
const dirty = ref(false)
const saving = ref(false)
const failed = ref(false)
const settingsRef = ref<InstanceType<typeof VirtualLabLoadSettings> | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const maskRef = ref<HTMLElement | null>(null)

function show() {
  render.value = true
  open.value = true
  void nextTick(() => panelRef.value?.focus?.())
}
function close() {
  open.value = false
  emit('close')
}
function save() {
  void settingsRef.value?.save()
}

/* 关闭后卸载内容：抽屉里的日期模拟表单每次打开重新拉取，避免拿着上次的旧值保存 */
watch(open, (v) => {
  if (!v) {
    dirty.value = false
    saving.value = false
    failed.value = false
  }
})

defineExpose({ open: show, close })
</script>

<style scoped>
/* 脏态标放在底栏最左（底栏本身右对齐，用 margin-right:auto 顶到另一端） */
.vl-settings-drawer__dirty {
  margin-right: auto;
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  color: var(--mk-amber);
  white-space: nowrap;
}
</style>
