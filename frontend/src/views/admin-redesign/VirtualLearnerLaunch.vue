<template>
  <!-- 启动实验：必须选故事（一人多故事 → 一故事一 Path） -->
  <Teleport v-if="render" to="body">
  <div v-if="launchTarget" ref="launchMaskRef" class="mk-modal">
    <div ref="launchPanelRef" class="mk-modal__panel" role="dialog" aria-label="启动实验">
      <div class="mk-modal__head">
        <h3 class="mk-modal__title">启动实验 · {{ launchTarget.name }}</h3>
        <button type="button" class="mk-modal__close" aria-label="关闭" @click="launchTarget = null">✕</button>
      </div>
      <div class="mk-modal__body">
        <label class="mk-field">
          <span class="mk-field__label">选择故事 <em class="vl-req">必填</em></span>
          <select v-model="launchForm.storyId" class="mk-field__select" :disabled="launchStoriesLoading">
            <option disabled value="">
              {{ launchStoriesLoading ? '加载故事中…' : launchStories.length ? '请选择故事' : '暂无故事，请先在画像页生成' }}
            </option>
            <option v-for="st in launchStories" :key="st.id" :value="st.id">
              {{ st.title }}{{ st.pathId ? ' · 已有 Path' : ' · 尚无 Path' }}（运行 {{ st.runCount }}）
            </option>
          </select>
        </label>
        <label class="mk-field">
          <span class="mk-field__label">运行模式</span>
          <select v-model="launchForm.mode" class="mk-field__select">
            <option value="assisted">辅助模拟（白盒，链路可控）</option>
            <option value="blackbox">黑盒 API（裁判评估，贴近真实）</option>
          </select>
        </label>
        <label class="mk-field">
          <span class="mk-field__label">对抗预算</span>
          <select v-model="launchForm.friction" class="mk-field__select">
            <option value="none">无摩擦</option>
            <option value="low">低</option>
            <option value="normal">正常</option>
            <option value="high">高</option>
            <option value="stress_test">压力测试</option>
          </select>
          <span class="mk-field__hint">预算越高，虚拟学习者越"难带"：分心、畏难、追问</span>
        </label>
      </div>
      <div class="mk-modal__foot">
        <button type="button" class="mk-btn" @click="launchTarget = null">取消</button>
        <button
          type="button"
          class="mk-btn mk-btn--primary"
          :disabled="launchBusy || !launchForm.storyId"
          @click="startLaunch"
        >
          {{ launchBusy ? '启动中…' : '按故事启动' }}
        </button>
      </div>
    </div>
  </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { adminVirtualLearnersApi } from '@/api/adminApi'
import { errMsg } from './live'
import { openSubPage, isLive } from './store'
import { useEscape } from './useEscape'
import { useOverlay, useMaskClose } from './useOverlay'
import { toast } from '@/utils/toast'
import type { LaunchStory } from './virtualLearnersTypes'

/* render=false 时不渲染 Teleport（保持与拆分前一致的 tab 条件渲染语义），弹窗状态仍常驻 */
withDefaults(defineProps<{ render?: boolean }>(), { render: true })

/** 启动目标（父页面行内「运行」按钮传入；只依赖 id/name/storyCount） */
interface LaunchTarget {
  id: string
  name: string
  storyCount: number
}

const launchTarget = ref<LaunchTarget | null>(null)
const launchForm = ref({
  storyId: '',
  mode: 'assisted' as 'assisted' | 'blackbox',
  friction: 'normal' as 'none' | 'low' | 'normal' | 'high' | 'stress_test'
})
const launchBusy = ref(false)
const launchStoriesLoading = ref(false)
const launchStories = ref<LaunchStory[]>([])

const launchPanelRef = ref<HTMLElement | null>(null)
const launchMaskRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => !!launchTarget.value), launchPanelRef)
useMaskClose(launchMaskRef, () => { launchTarget.value = null })
useEscape(() => !!launchTarget.value, () => { launchTarget.value = null })

/** 父页面触发：加载故事并打开启动弹窗 */
async function open(s: LaunchTarget) {
  if (s.storyCount === 0 && isLive.value) {
    toast.error('请先在画像页生成故事；故事产生学习需求后才能运行')
    openSubPage('virtual', s.id)
    return
  }
  launchTarget.value = s
  launchForm.value = { storyId: '', mode: 'assisted', friction: 'normal' }
  launchStories.value = []
  launchStoriesLoading.value = true
  try {
    const res = await adminVirtualLearnersApi.getVirtualLearnerStories(s.id)
    const body = res.data?.data ?? res.data ?? {}
    const list = Array.isArray(body.stories) ? body.stories : []
    launchStories.value = list.map((st: Record<string, unknown>, index: number) => {
      const stats = (st.stats || {}) as Record<string, unknown>
      const latest = (st.latestRun || {}) as Record<string, unknown>
      const bindings = (latest.bindings || {}) as Record<string, unknown>
      return {
        id: String(st.storyId || st.id || st.key || `story-${index}`),
        title: String(st.storyTitle || st.title || `故事 ${index + 1}`),
        runCount: Number(stats.totalRuns ?? 0),
        pathId: bindings.learningPathId ? String(bindings.learningPathId) : null
      }
    })
    if (!launchStories.value.length) {
      toast.error('该虚拟人还没有故事，请先在画像页生成')
      launchTarget.value = null
      openSubPage('virtual', s.id)
      return
    }
    if (launchStories.value.length === 1) {
      launchForm.value.storyId = launchStories.value[0].id
    }
  } catch (e) {
    toast.error(`加载故事失败：${errMsg(e)}`)
    launchTarget.value = null
  } finally {
    launchStoriesLoading.value = false
  }
}

async function startLaunch() {
  const target = launchTarget.value
  if (!target || launchBusy.value) return
  if (!launchForm.value.storyId) {
    toast.error('请选择故事；每个故事对应一套学习任务（Path）')
    return
  }
  launchBusy.value = true
  try {
    const payload = {
      storyId: launchForm.value.storyId,
      frictionBudget: launchForm.value.friction
    }
    const res =
      launchForm.value.mode === 'blackbox'
        ? await adminVirtualLearnersApi.startBlackboxVirtualSession(target.id, payload)
        : await adminVirtualLearnersApi.startVirtualSession(target.id, payload)
    const session = res.data?.data ?? res.data ?? {}
    const sid = String(session.id || session.sessionId || '')
    const storyTitle = launchStories.value.find((x) => x.id === launchForm.value.storyId)?.title || '故事'
    launchTarget.value = null
    toast.success(`已按「${storyTitle}」启动：${sid.slice(0, 14)}${sid.length > 14 ? '…' : ''}`)
    openSubPage('virtual', target.id)
  } catch (e) {
    toast.error(`启动失败：${errMsg(e)}`)
  } finally {
    launchBusy.value = false
  }
}

defineExpose({ open })
</script>

<style scoped>
.vl-req {
  font-style: normal;
  font-size: var(--mk-fs-11);
  font-weight: 700;
  color: var(--mk-blue, #2c63d0);
  margin-left: 4px;
}
@media (min-width: 2000px) {
  .vl-req { font-size: 12px; }
}
@media (min-width: 2800px) {
  .vl-req { font-size: 14px; }
}
@media (min-width: 3600px) {
  .vl-req { font-size: 16.5px; }
}
</style>
