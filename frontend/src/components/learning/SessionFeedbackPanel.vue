<template>
  <section class="session-feedback" :aria-busy="loading || submitting">
    <div class="session-feedback__head">
      <div>
        <p class="session-feedback__kicker">你的感受</p>
        <h2>这次学习对你有帮助吗？</h2>
      </div>
      <span v-if="saved" class="session-feedback__saved" role="status">已保存</span>
    </div>

    <div v-if="loading" class="session-feedback__loading" role="status">正在读取你的反馈…</div>

    <template v-else>
      <fieldset class="session-feedback__field">
        <legend>总体评分</legend>
        <div class="rating-options" role="radiogroup" aria-label="总体评分">
          <button
            v-for="score in 5"
            :key="score"
            type="button"
            role="radio"
            :aria-checked="rating === score"
            :class="['rating-option', { 'is-active': rating === score }]"
            @click="rating = score"
          >
            <span aria-hidden="true">{{ score }}</span>
            <span>{{ ratingLabels[score - 1] }}</span>
          </button>
        </div>
      </fieldset>

      <fieldset class="session-feedback__field">
        <legend>难度感受</legend>
        <div class="fit-options" role="radiogroup" aria-label="难度感受">
          <button
            v-for="option in difficultyOptions"
            :key="option.value"
            type="button"
            role="radio"
            :aria-checked="difficultyFit === option.value"
            :class="['fit-option', { 'is-active': difficultyFit === option.value }]"
            @click="difficultyFit = option.value"
          >
            {{ option.label }}
          </button>
        </div>
      </fieldset>

      <div v-if="showDetails" class="session-feedback__details">
        <fieldset class="session-feedback__field">
          <legend>主要问题，可多选</legend>
          <div class="reason-options">
            <button
              v-for="option in reasonOptions"
              :key="option.value"
              type="button"
              :aria-pressed="reasonCodes.includes(option.value)"
              :class="['reason-option', { 'is-active': reasonCodes.includes(option.value) }]"
              @click="toggleReason(option.value)"
            >
              {{ option.label }}
            </button>
          </div>
        </fieldset>

        <label class="session-feedback__comment">
          <span>补充说明，可选</span>
          <div class="feedback-textarea">
            <textarea
              v-model="comment"
              class="feedback-textarea__inner"
              :rows="3"
              maxlength="1000"
              placeholder="例如：哪个解释、例子或理解检查让你感到困难？"
              aria-describedby="session-feedback-comment-count"
            ></textarea>
            <span id="session-feedback-comment-count" class="feedback-textarea__count">{{ comment.length }} / 1000</span>
          </div>
        </label>
      </div>

      <div v-if="error" class="session-feedback__error" role="alert">
        <span>{{ error }}</span>
        <button type="button" @click="errorKind === 'load' ? load() : submit()">重试</button>
      </div>

      <div class="session-feedback__actions">
        <p>反馈不会影响任务完成状态，你可以随时修改。</p>
        <button
          type="button"
          class="feedback-btn feedback-btn--primary"
          :disabled="rating === 0 || submitting || !dirty"
          @click="submit"
        >
          <span v-if="submitting" class="spinner--sm feedback-btn__spinner" aria-hidden="true"></span>
          {{ saved ? '更新反馈' : '提交反馈' }}
        </button>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  feedbackApi,
  type DifficultyFit,
  type FeedbackItem
} from '@/api/feedback'

const props = defineProps<{
  sessionId: string
  taskId: string
}>()

const emit = defineEmits<{
  submitted: [feedback: FeedbackItem]
  'difficulty-change': [value: number | undefined]
}>()

const rating = ref(0)
const difficultyFit = ref<DifficultyFit | null>(null)
const reasonCodes = ref<string[]>([])
const comment = ref('')
const loading = ref(true)
const submitting = ref(false)
const saved = ref(false)
const error = ref('')
/** 错误来源：load 失败重试应走 load()（submit 在 rating=0 时会被守卫拦下），submit 失败重试 submit() */
const errorKind = ref<'load' | 'submit'>('load')
const savedSnapshot = ref('')

const ratingLabels = ['没有帮助', '帮助较少', '一般', '有帮助', '很有帮助']
const difficultyOptions: Array<{ value: DifficultyFit; label: string }> = [
  { value: 'too_easy', label: '偏简单' },
  { value: 'appropriate', label: '合适' },
  { value: 'too_hard', label: '偏难' }
]
const reasonOptions = [
  { value: 'INACCURATE_CONTENT', label: '内容不准确' },
  { value: 'UNCLEAR_EXPLANATION', label: '解释不清' },
  { value: 'PACE_MISMATCH', label: '节奏不合适' },
  { value: 'DIFFICULTY_MISMATCH', label: '难度不合适' },
  { value: 'CHECKPOINT_ISSUE', label: '理解检查有问题' },
  { value: 'OTHER', label: '其他' }
]

const showDetails = computed(() =>
  (rating.value > 0 && rating.value <= 3)
  || (difficultyFit.value !== null && difficultyFit.value !== 'appropriate')
)

const currentSnapshot = computed(() => JSON.stringify({
  rating: rating.value,
  difficultyFit: difficultyFit.value,
  reasonCodes: [...reasonCodes.value].sort(),
  comment: comment.value.trim()
}))

const dirty = computed(() => currentSnapshot.value !== savedSnapshot.value)

const errorMessage = (value: unknown, fallback: string) => {
  if (!value || typeof value !== 'object' || !('message' in value)) return fallback
  const message = (value as { message?: unknown }).message
  return typeof message === 'string' && message ? message : fallback
}

watch(difficultyFit, value => {
  const mapped = value === 'too_easy' ? 2 : value === 'appropriate' ? 5 : value === 'too_hard' ? 8 : undefined
  emit('difficulty-change', mapped)
})

const applyFeedback = (feedback: FeedbackItem | null) => {
  rating.value = feedback?.rating || 0
  difficultyFit.value = feedback?.difficultyFit || null
  reasonCodes.value = [...(feedback?.reasonCodes || [])]
  comment.value = feedback?.comment || ''
  saved.value = !!feedback
  savedSnapshot.value = currentSnapshot.value
}

const load = async () => {
  loading.value = true
  error.value = ''
  try {
    applyFeedback(await feedbackApi.getSession(props.sessionId))
  } catch (err) {
    errorKind.value = 'load'
    error.value = errorMessage(err, '读取反馈失败，你仍可以重新提交。')
    applyFeedback(null)
  } finally {
    loading.value = false
  }
}

const toggleReason = (value: string) => {
  reasonCodes.value = reasonCodes.value.includes(value)
    ? reasonCodes.value.filter(item => item !== value)
    : [...reasonCodes.value, value]
}

const submit = async () => {
  if (!rating.value || submitting.value) return
  submitting.value = true
  error.value = ''
  try {
    const feedback = await feedbackApi.submit({
      sessionId: props.sessionId,
      taskId: props.taskId,
      rating: rating.value,
      difficultyFit: difficultyFit.value || undefined,
      reasonCodes: showDetails.value ? reasonCodes.value : [],
      comment: showDetails.value ? comment.value : ''
    })
    applyFeedback(feedback)
    emit('submitted', feedback)
  } catch (err) {
    errorKind.value = 'submit'
    error.value = errorMessage(err, '提交失败，你填写的内容已保留。')
  } finally {
    submitting.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.session-feedback {
  padding: 24px 28px;
  border: 1px solid var(--border-default, rgba(23, 32, 51, 0.08));
  border-radius: 16px;
  background: var(--bg-surface, #fff);
  color: var(--text-primary, #172033);
}

.session-feedback__head,
.session-feedback__actions {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.session-feedback__kicker {
  margin: 0 0 6px;
  color: var(--color-primary, #3478f6);
  font-size: 12px;
  font-weight: 700;
}

.session-feedback h2 {
  margin: 0;
  font-size: 18px;
}

.session-feedback__saved {
  padding: 5px 10px;
  border-radius: 999px;
  background: var(--color-success-bg, rgba(49, 177, 111, 0.1));
  color: var(--color-success, #238657);
  font-size: 12px;
  font-weight: 700;
}

.session-feedback__loading {
  padding: 24px 0 4px;
  color: var(--text-secondary, #607086);
}

.session-feedback__field {
  margin: 22px 0 0;
  padding: 0;
  border: 0;
}

.session-feedback__field legend,
.session-feedback__comment > span {
  display: block;
  margin-bottom: 10px;
  padding: 0;
  text-align: left;
  color: var(--text-secondary, #52657c);
  font-size: 13px;
  font-weight: 700;
}

.rating-options,
.fit-options,
.reason-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.rating-option,
.fit-option,
.reason-option {
  min-height: 40px;
  padding: 8px 14px;
  border: 1px solid var(--border-default, #dce4ef);
  border-radius: 999px;
  background: transparent;
  color: var(--text-secondary, #52657c);
  cursor: pointer;
  transition: border-color 180ms ease, background 180ms ease, color 180ms ease, transform 180ms ease;
}

.rating-option {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 96px;
}

.rating-option span:first-child {
  color: var(--text-primary, #172033);
  font-size: 15px;
  font-weight: 800;
}

.rating-option span:last-child {
  font-size: 12px;
}

.rating-option:hover,
.fit-option:hover,
.reason-option:hover,
.rating-option.is-active,
.fit-option.is-active,
.reason-option.is-active {
  border-color: var(--color-primary, #3478f6);
  background: color-mix(in srgb, var(--color-primary, #3478f6) 9%, transparent);
  color: var(--color-primary-dark, #1f57cc);
}

.rating-option:active,
.fit-option:active,
.reason-option:active {
  transform: translateY(1px);
}

.session-feedback__details {
  margin-top: 20px;
  padding-top: 2px;
  border-top: 1px solid var(--border-default, #e5eaf1);
}

.session-feedback__comment {
  display: grid;
  margin-top: 20px;
}

.session-feedback__error {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 18px;
  padding: 10px 12px;
  border-left: 3px solid var(--color-danger, #ef7578);
  background: var(--color-danger-bg, rgba(239, 117, 120, 0.08));
  color: var(--text-primary, #172033);
  font-size: 13px;
}

.session-feedback__error button {
  border: 0;
  background: transparent;
  color: var(--color-primary, #3478f6);
  cursor: pointer;
  font-weight: 700;
}

.session-feedback__actions {
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  margin-top: 22px;
}

.session-feedback__actions p {
  margin: 0;
  color: var(--text-secondary, #607086);
  font-size: 12px;
  line-height: 1.6;
}

/* 补充说明输入：等价旧 el-input textarea（含字数），移除 EP 依赖 */
.feedback-textarea {
  position: relative;
  display: inline-block;
  width: 100%;
  vertical-align: bottom;
}

.feedback-textarea__inner {
  display: block;
  width: 100%;
  box-sizing: border-box;
  padding: 5px 11px;
  border: none;
  border-radius: 4px;
  background: var(--bg-surface, #fff);
  color: var(--text-primary, #172033);
  box-shadow: 0 0 0 1px var(--border-default, #dce4ef) inset;
  font-family: inherit;
  font-size: var(--text-sm, 14px);
  line-height: 1.5;
  resize: vertical;
  transition: box-shadow var(--transition-fast, 150ms ease);
}

.feedback-textarea__inner::placeholder {
  color: var(--text-muted, #607086);
}

.feedback-textarea__inner:hover {
  box-shadow: 0 0 0 1px var(--border-dark, #ced4da) inset;
}

.feedback-textarea__inner:focus {
  outline: none;
  box-shadow: 0 0 0 1px var(--color-primary, #3478f6) inset;
}

.feedback-textarea__count {
  position: absolute;
  right: 10px;
  bottom: 5px;
  background: var(--bg-surface, #fff);
  color: var(--text-muted, #909399);
  font-size: 12px;
  line-height: 14px;
}

/* 提交按钮：视觉对齐原 el-button--primary 及其全局覆写 */
.feedback-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  white-space: nowrap;
  vertical-align: middle;
  cursor: pointer;
  font-family: inherit;
  line-height: 1;
  height: 32px;
  padding: 8px 15px;
  font-size: 14px;
  border: 1px solid transparent;
  border-radius: 999px;
  transition: all var(--transition-fast, 150ms ease);
}

.feedback-btn--primary {
  background: var(--color-primary, #3478f6);
  border-color: var(--color-primary, #3478f6);
  color: var(--text-on-primary, #fff);
  font-weight: var(--font-medium, 500);
  box-shadow: 0 14px 28px color-mix(in srgb, var(--color-primary, #3478f6) 24%, transparent);
}

.feedback-btn--primary:hover:not(:disabled) {
  background: var(--color-primary-dark, #1f57cc);
  border-color: var(--color-primary-dark, #1f57cc);
  color: var(--text-on-primary, #fff);
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm, 0 2px 4px rgba(44, 62, 80, 0.06));
}

.feedback-btn--primary:active:not(:disabled) {
  transform: translateY(0);
}

.feedback-btn:disabled {
  cursor: not-allowed;
}

.feedback-btn__spinner {
  margin-right: 6px;
}

@media (max-width: 640px) {
  .session-feedback {
    padding: 20px 18px;
  }

  .session-feedback__head,
  .session-feedback__actions {
    flex-direction: column;
    align-items: stretch;
  }

  .rating-options {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .rating-option {
    width: 100%;
  }

  .session-feedback__actions .feedback-btn {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .rating-option,
  .fit-option,
  .reason-option {
    transition: none;
  }
}
</style>
