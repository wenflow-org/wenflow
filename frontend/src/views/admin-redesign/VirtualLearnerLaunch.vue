<template>
  <!-- 启动实验：必须选故事（一人多故事 → 一故事一 Path）。
       运行模式与对抗预算收进「更多设置」，保留默认值——它们都是低频调参。 -->
  <Teleport v-if="render" to="body">
  <div v-if="launchTarget" ref="launchMaskRef" class="mk-modal">
    <div ref="launchPanelRef" class="mk-modal__panel" role="dialog" aria-label="启动实验">
      <div class="mk-modal__head">
        <h3 class="mk-modal__title">启动实验 · {{ launchTarget.name }}</h3>
        <button type="button" class="mk-modal__close" aria-label="关闭" @click="launchTarget = null">✕</button>
      </div>
      <div class="mk-modal__body">
        <div class="vl-launch-row">
          <label class="mk-field vl-launch-row__story">
            <span class="mk-field__label">选择故事 <em class="mk-field__req">必填</em></span>
            <MkSelect
              v-model="launchForm.storyId"
              :options="launchStoryOptions"
              :placeholder="launchStoryPlaceholder"
              :disabled="launchStoriesLoading"
              aria-label="选择故事"
              block
            />
          </label>
          <button
            type="button"
            class="mk-btn mk-btn--primary"
            :disabled="launchBusy || !launchForm.storyId"
            @click="startLaunch"
          >
            {{ launchBusy ? '启动中…' : '启动' }}
          </button>
        </div>
        <details class="vl-launch-more">
          <summary>更多设置</summary>
          <div class="vl-launch-more__body">
            <label class="mk-field">
              <span class="mk-field__label">运行模式</span>
              <MkSelect
                v-model="launchForm.mode"
                :options="MODE_OPTIONS"
                aria-label="运行模式"
                block
              />
            </label>
            <label class="mk-field">
              <span class="mk-field__label">学生对抗度</span>
              <MkSelect
                v-model="launchForm.friction"
                :options="FRICTION_OPTIONS"
                aria-label="学生对抗度"
                block
              />
            </label>
          </div>
        </details>
      </div>
      <div class="mk-modal__foot">
        <button type="button" class="mk-btn" @click="launchTarget = null">取消</button>
      </div>
    </div>
  </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { adminVirtualLearnersApi } from '@/api/adminApi'
import { errMsg, refreshLiveVirtuals } from './live'
import { openSubPage, isLive } from './store'
import { useEscape } from './useEscape'
import { useOverlay, useMaskClose } from './useOverlay'
import { toast } from '@/utils/toast'
import { FRICTION_OPTIONS, type FrictionBudget } from './vlab'
import MkSelect from '@/components/mk/MkSelect.vue'
import type { LaunchStory } from './virtualLearnersTypes'

const MODE_OPTIONS = [
  { value: 'assisted', label: '辅助模拟' },
  { value: 'blackbox', label: '黑盒模拟' }
] as const

/* render=false 时不渲染 Teleport（保持与拆分前一致的 tab 条件渲染语义），弹窗状态仍常驻 */
withDefaults(defineProps<{ render?: boolean }>(), { render: true })

/* 启动成功事件：列表行自己会刷新；画像页要据此回刷详情读数（2026-10-24 页头「运行」） */
const emit = defineEmits<{ started: [session: Record<string, unknown>] }>()

/** 启动目标（父页面行内「运行」按钮传入；只依赖 id/name/storyCount） */
interface LaunchTarget {
  id: string
  name: string
  storyCount: number
}

const launchTarget = ref<LaunchTarget | null>(null)
/** 两处入口（打开前/加载后）同一句提示，写成常量避免同文件复读 */
const NO_STORY_HINT = '还没有故事，先去画像页生成'
const launchForm = ref({
  storyId: '',
  mode: 'assisted' as 'assisted' | 'blackbox',
  friction: 'normal' as FrictionBudget
})
const launchBusy = ref(false)
const launchStoriesLoading = ref(false)
const launchStories = ref<LaunchStory[]>([])

/** 故事下拉选项：标签沿用原 option 文案（已生成路径数 / 是否运行过） */
const launchStoryOptions = computed(() =>
  launchStories.value.map((st) => ({
    value: st.id,
    label: `${st.title}${st.runCount ? ` · 已生成 ${st.pathCount} 条路径（已运行 ${st.runCount} 次）` : ' · 尚未运行'}`
  }))
)
/** 空值占位：加载中 / 待选 / 无故事三种状态（原 disabled option 的文案） */
const launchStoryPlaceholder = computed(() => {
  if (launchStoriesLoading.value) return '加载故事中…'
  return launchStories.value.length ? '请选择故事' : '暂无故事，请先在画像页生成'
})

const launchPanelRef = ref<HTMLElement | null>(null)
const launchMaskRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => !!launchTarget.value), launchPanelRef)
useMaskClose(launchMaskRef, () => { if (!launchBusy.value) launchTarget.value = null })
useEscape(() => !!launchTarget.value, () => { if (!launchBusy.value) launchTarget.value = null })

/** 父页面触发：加载故事并打开启动弹窗 */
async function open(s: LaunchTarget) {
  if (s.storyCount === 0 && isLive.value) {
    toast.error(NO_STORY_HINT)
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
        pathCount: Number(stats.pathCount ?? 0),
        pathId: bindings.learningPathId ? String(bindings.learningPathId) : null
      }
    })
    if (!launchStories.value.length) {
      toast.error(NO_STORY_HINT)
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
    toast.error('请选择故事')
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
    const storyTitle = launchStories.value.find((x) => x.id === launchForm.value.storyId)?.title || '故事'
    const autopilot = String(session.autopilot || '')
    launchTarget.value = null
    if (autopilot === 'failed') {
      toast.info(`已创建「${storyTitle}」的会话，但自动驾驶没启动，可在画像页继续`)
    } else if (autopilot === 'queued') {
      toast.success(`并发已满，「${storyTitle}」已排队，轮到即自动开跑`)
    } else {
      toast.success(`已开始运行「${storyTitle}」`)
    }
    emit('started', session)
    void refreshLiveVirtuals()
  } catch (e) {
    toast.error(`启动失败：${errMsg(e)}`)
  } finally {
    launchBusy.value = false
  }
}

defineExpose({ open })
</script>

<style scoped>
/* 必填标记走全局 .mk-field__req（原页内 .vl-req 蓝色是另一套「必填」语言） */
.vl-launch-row { display: flex; align-items: flex-end; gap: 10px; }
.vl-launch-row__story { flex: 1 1 auto; min-width: 0; }
.vl-launch-more { margin-top: 10px; }
.vl-launch-more > summary { cursor: pointer; font-size: var(--mk-fs-micro); color: var(--mk-muted); list-style: none; }
.vl-launch-more > summary::-webkit-details-marker { display: none; }
.vl-launch-more > summary::before { content: '▸'; margin-right: 6px; color: var(--mk-faint); }
.vl-launch-more[open] > summary::before { content: '▾'; }
.vl-launch-more__body { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 8px; }
</style>
