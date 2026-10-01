<template>
  <!-- 新建虚拟学习者 -->
  <Teleport v-if="render" to="body">
  <div v-if="createOpen" ref="maskRef" class="mk-modal">
    <div ref="panelRef" class="mk-modal__panel" role="dialog" aria-label="新建虚拟学习者">
      <div class="mk-modal__head">
        <h3 class="mk-modal__title">新建虚拟学习者</h3>
        <button type="button" class="mk-modal__close" aria-label="关闭" @click="createOpen = false">✕</button>
      </div>
      <div class="mk-modal__body">
        <p class="mk-alert mk-alert--info">
          ① 称呼与背景 → ② AI 补全身份（可选）→ ③ 创建 → ④ 画像页生成故事 → ⑤ 按故事运行
        </p>
        <label class="mk-field" :class="{ 'mk-field--error': errors.name }">
          <span class="mk-field__label">称呼 / 样本名 <em class="mk-field__req">必填</em></span>
          <input v-model="form.name" class="mk-field__input" placeholder="例如 焦虑的转行者、自由职业写作者" />
          <span v-if="errors.name" class="mk-field__err">{{ errors.name }}</span>
        </label>
        <label class="mk-field" :class="{ 'mk-field--error': errors.story }">
          <span class="mk-field__label">人物背景 <em class="mk-field__req">必填</em></span>
          <textarea
            v-model="form.story"
            class="mk-field__textarea"
            placeholder="她是谁、职业处境、性格与长期底色。这里只写稳定身份，不要写某次具体学习事件。"
          ></textarea>
          <span class="mk-field__hint">{{ form.story.length }} 字 · 建议 ≥ 40 字 · 具体学习需求在画像页用「故事」产生</span>
          <span v-if="errors.story" class="mk-field__err">{{ errors.story }}</span>
        </label>
        <div v-if="isLive" class="vl-ai-row">
          <!-- 单选组语言（原型 .radio-row/.radio，index.html 323-325）：role=radio + aria-checked；
               视觉仍走全局 .mk-pill（描边胶囊 = 原型 .chip/.radio 同族），选中态由 aria-checked 承载语义 -->
          <div class="vl-sample-pills" role="radiogroup" aria-label="样本类型">
            <button
              type="button"
              class="mk-pill"
              role="radio"
              :class="{ 'mk-pill--active': sampleType === 'general' }"
              :aria-checked="sampleType === 'general'"
              @click="sampleType = 'general'"
            >通用</button>
            <button
              type="button"
              class="mk-pill"
              role="radio"
              :class="{ 'mk-pill--active': sampleType === 'student' }"
              :aria-checked="sampleType === 'student'"
              title="生成传统学生样本：学段/考试节点/学期节奏/家长与同伴环境"
              @click="sampleType = 'student'"
            >传统学生</button>
          </div>
          <button type="button" class="mk-btn mk-btn--ghost vl-ai" :disabled="personaBusy" @click="generatePersona">
            {{ personaBusy ? '生成身份中…' : '✦ AI 生成身份' }}
          </button>
          <span class="vl-ai-hint">人设 Skill · 只补稳定身份，不依赖学习目标，不写会话故事{{ sampleType === 'student' ? ' · 学生样本含考试节点与学期节奏' : '' }}</span>
        </div>
        <p v-if="personaSeed" class="mk-alert mk-alert--ok">已回填人设，可改称呼/背景后创建</p>
        <details class="vl-advanced">
          <summary>可选 · 长期学习倾向（不是某次故事的目标）</summary>
          <label class="mk-field">
            <span class="mk-field__label">长期倾向</span>
            <input
              v-model="form.aspiration"
              class="mk-field__input"
              placeholder="例如 总想补职场工具；可留空，由故事 goalSeed 定义当次需求"
            />
            <span class="mk-field__hint">写入画像备用字段；真正驱动 Path 的是故事里的学习需求</span>
          </label>
        </details>
      </div>
      <div class="mk-modal__foot">
        <button type="button" class="mk-btn" @click="createOpen = false">取消</button>
        <button type="button" class="mk-btn mk-btn--primary" :disabled="creating" @click="createSample">
          {{ creating ? '创建中…' : '创建虚拟学习者' }}
        </button>
      </div>
    </div>
  </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { adminVirtualLearnersApi } from '@/api/adminApi'
import { liveCreateVirtual, errMsg } from './live'
import { openSubPage, isLive } from './store'
import { useEscape } from './useEscape'
import { useOverlay, useMaskClose } from './useOverlay'
import { toast } from '@/utils/toast'

/* render=false 时不渲染 Teleport（保持与拆分前一致的 tab 条件渲染语义），弹窗状态仍常驻 */
withDefaults(defineProps<{ render?: boolean }>(), { render: true })

/* 新建：人设优先（学习需求由故事产生，不在创建时必填） */
const createOpen = ref(false)
const creating = ref(false)
const form = ref({ name: '', story: '', aspiration: '' })
const errors = ref<{ name?: string; story?: string }>({})

function open() {
  form.value = { name: '', story: '', aspiration: '' }
  errors.value = {}
  personaSeed.value = null
  createOpen.value = true
}

async function createSample() {
  errors.value = {}
  if (!form.value.name.trim()) errors.value.name = '请输入称呼 / 样本名'
  if (form.value.story.trim().length < 20) errors.value.story = '人物背景至少 20 字，稳定人设才有依据'
  if (Object.keys(errors.value).length) return

  creating.value = true
  try {
    const createdId = await liveCreateVirtual({
      name: form.value.name.trim(),
      goal: form.value.aspiration.trim(),
      story: form.value.story.trim(),
      personaSeed: personaSeed.value || undefined
    })
    createOpen.value = false
    if (createdId) {
      toast.success('虚拟人已创建。下一步：在画像页生成故事（产生学习需求）')
      openSubPage('virtual', createdId)
    } else {
      toast.success('虚拟人已创建，但列表刷新失败——若列表未出现，请手动刷新查看')
    }
  } catch (e) {
    toast.error(`创建失败：${errMsg(e)}`)
  } finally {
    creating.value = false
  }
}

/* AI 生成身份：skill:virtual-learner-persona-designer（只做人设，不依赖学习目标、不写故事） */
const personaBusy = ref(false)
const personaSeed = ref<Record<string, unknown> | null>(null)
/** AI 生成身份的样本类型：general=自由生成 / student=传统学生（课纲/考试/学期节奏） */
const sampleType = ref<'general' | 'student'>('general')
async function generatePersona() {
  if (personaBusy.value) return
  personaBusy.value = true
  try {
    const res = await adminVirtualLearnersApi.generatePersona({
      ...(sampleType.value === 'student' ? { sampleType: 'student' } : {}),
      existingPersonaSeed: {
        name: form.value.name.trim() || undefined,
        nameHint: form.value.name.trim() || undefined,
        notes: form.value.story.trim() || undefined,
        background: form.value.story.trim() || undefined
      }
    })
    const d = res.data?.data ?? res.data ?? {}
    const seed = (d.personaSeed || d.profile || d) as Record<string, unknown>
    if (!seed || typeof seed !== 'object') {
      toast.error('生成失败：未返回 personaSeed')
      return
    }
    personaSeed.value = seed
    const nameFromSeed = String(seed.name || seed.nameHint || seed.occupation || '').trim()
    if (nameFromSeed) form.value.name = nameFromSeed
    const background = String(seed.background || seed.corePersonality || seed.behavioralProfileSummary || '').trim()
    if (background) form.value.story = background
    toast.success('人设已回填，可改后点「创建虚拟学习者」')
  } catch (e) {
    toast.error(`生成失败：${errMsg(e)}`)
  } finally {
    personaBusy.value = false
  }
}

const panelRef = ref<HTMLElement | null>(null)
const maskRef = ref<HTMLElement | null>(null)
useOverlay(computed(() => createOpen.value), panelRef)
useMaskClose(maskRef, () => { if (!creating.value) createOpen.value = false })
useEscape(() => createOpen.value, () => { if (!creating.value) createOpen.value = false })

defineExpose({ open })
</script>

<style scoped>
/* 步骤/人设成功提示走全局 .mk-alert mk-alert--info/--ok 语气，不再页内覆写底色 */
/* AI 生成身份行：样本类型 pills（全局 mk-pill 单选词汇）+ 触发钮 + 口径 hint */
.vl-ai-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin: 2px 0 4px;
}
.vl-sample-pills {
  display: inline-flex;
  gap: 4px;
  flex: 0 0 auto;
}
.vl-ai { flex: 0 0 auto; }
.vl-ai-hint {
  margin: 0;
  font-size: var(--mk-fs-micro);
  color: var(--mk-faint, #8492ab);
  line-height: 1.45;
}
/* 高级折叠区（可选字段）：描边浅底盒，色值走 token（暗色由 token 自适应，不再打补丁） */
.vl-advanced {
  margin-top: 4px;
  border-radius: var(--mk-radius-xl);
  border: 1px solid var(--mk-line);
  background: var(--mk-surface-2);
  padding: 8px 12px;
}
.vl-advanced summary {
  cursor: pointer;
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  color: var(--mk-muted);
  list-style: none;
}
.vl-advanced summary::-webkit-details-marker { display: none; }
.vl-advanced[open] summary { margin-bottom: 8px; }

@media (min-width: 2000px) {
  .vl-ai-row { gap: 12px; }
  .vl-advanced { padding: 10px 14px; }
  .vl-advanced[open] summary { margin-bottom: 9px; }
}
@media (min-width: 2800px) {
  .vl-ai-row { gap: 14px; }
  .vl-advanced { padding: 12px 17px; }
  .vl-advanced[open] summary { margin-bottom: 11px; }
}
@media (min-width: 3600px) {
  .vl-ai-row { gap: 16px; }
  .vl-ai-hint { font-size: var(--mk-fs-body); }
  .vl-advanced { padding: 14px 20px; }
  .vl-advanced summary { font-size: var(--mk-fs-body); }
  .vl-advanced[open] summary { margin-bottom: 13px; }
}
</style>
