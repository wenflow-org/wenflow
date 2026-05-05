<template>
  <div class="checkpoint-card" :class="[`checkpoint-card--${status}`]">
    <div class="checkpoint-card__header">
      <span class="checkpoint-card__kicker">小检核</span>
      <span v-if="status === 'passed'" class="checkpoint-card__status checkpoint-card__status--passed">通过</span>
      <span v-else-if="status === 'failed'" class="checkpoint-card__status checkpoint-card__status--failed">待加强</span>
    </div>

    <strong class="checkpoint-card__title">{{ checkpoint.title }}</strong>

    <p v-if="checkpoint.contextHint" class="checkpoint-card__hint">{{ checkpoint.contextHint }}</p>

    <p class="checkpoint-card__question">{{ checkpoint.question }}</p>

    <!-- single choice -->
    <div v-if="checkpoint.type === 'single_choice'" class="checkpoint-card__options">
      <label
        v-for="opt in checkpoint.options"
        :key="opt.id"
        class="checkpoint-option"
        :class="{
          'checkpoint-option--selected': selectedIds.has(opt.id),
          'checkpoint-option--correct': status === 'passed' && selectedIds.has(opt.id),
          'checkpoint-option--disabled': status !== 'pending'
        }"
      >
        <input
          type="radio"
          name="checkpoint-single"
          :value="opt.id"
          :checked="selectedIds.has(opt.id)"
          :disabled="status !== 'pending'"
          @change="selectSingle(opt.id)"
        />
        <span class="checkpoint-option__marker">{{ opt.id }}</span>
        <span class="checkpoint-option__text">{{ opt.text }}</span>
      </label>
    </div>

    <!-- multi choice -->
    <div v-else-if="checkpoint.type === 'multi_choice'" class="checkpoint-card__options">
      <label
        v-for="opt in checkpoint.options"
        :key="opt.id"
        class="checkpoint-option"
        :class="{
          'checkpoint-option--selected': selectedIds.has(opt.id),
          'checkpoint-option--disabled': status !== 'pending'
        }"
      >
        <input
          type="checkbox"
          :value="opt.id"
          :checked="selectedIds.has(opt.id)"
          :disabled="status !== 'pending'"
          @change="toggleMulti(opt.id)"
        />
        <span class="checkpoint-option__marker">{{ opt.id }}</span>
        <span class="checkpoint-option__text">{{ opt.text }}</span>
      </label>
    </div>

    <!-- short answer -->
    <div v-else-if="checkpoint.type === 'short_answer'" class="checkpoint-card__answer">
      <textarea
        v-model="answerText"
        class="checkpoint-card__textarea"
        :placeholder="'用你自己的话作答…'"
        :rows="3"
        :disabled="status !== 'pending'"
      />
    </div>

    <!-- submit -->
    <div v-if="status === 'pending'" class="checkpoint-card__actions">
      <button
        class="checkpoint-card__submit"
        :disabled="!canSubmit || submitting"
        @click="handleSubmit"
      >
        {{ submitting ? '提交中…' : '提交答案' }}
      </button>
      <button
        v-if="checkpoint.allowSkip !== false"
        class="checkpoint-card__skip"
        :disabled="submitting"
        @click="handleSkip"
      >
        跳过
      </button>
    </div>

    <!-- result -->
    <transition name="checkpoint-fade">
      <div v-if="status !== 'pending' && result" class="checkpoint-card__result" :class="`checkpoint-card__result--${status}`">
        <p class="checkpoint-card__feedback">{{ result.feedback }}</p>
        <p v-if="result.hint" class="checkpoint-card__result-hint">{{ result.hint }}</p>
        <div class="checkpoint-card__result-actions">
          <button
            v-if="result.nextAction === 'continue' || status === 'passed'"
            class="checkpoint-card__btn checkpoint-card__btn--primary"
            @click="$emit('continue')"
          >
            继续学习
          </button>
          <button
            v-if="result.nextAction === 'retry' && status !== 'passed'"
            class="checkpoint-card__btn checkpoint-card__btn--ghost"
            @click="handleRetry"
          >
            重新作答
          </button>
          <button
            v-if="result.nextAction === 'review' && status !== 'passed'"
            class="checkpoint-card__btn checkpoint-card__btn--ghost"
            @click="$emit('review')"
          >
            回顾内容
          </button>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Checkpoint, CheckpointSubmitResult } from '@/api/aiTeaching'

const props = defineProps<{
  checkpoint: Checkpoint
  submitting?: boolean
}>()

const emit = defineEmits<{
  submit: [payload: { selectedOptionIds?: string[]; answerText?: string }]
  skip: []
  continue: []
  review: []
  retry: []
}>()

const selectedIds = ref<Set<string>>(new Set())
const answerText = ref('')
const status = ref<'pending' | 'passed' | 'failed'>('pending')
const result = ref<CheckpointSubmitResult | null>(null)

const canSubmit = computed(() => {
  if (props.checkpoint.type === 'short_answer') {
    return answerText.value.trim().length > 0
  }
  return selectedIds.value.size > 0
})

const selectSingle = (id: string) => {
  selectedIds.value = new Set([id])
}

const toggleMulti = (id: string) => {
  const next = new Set(selectedIds.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  selectedIds.value = next
}

const handleSubmit = () => {
  if (!canSubmit.value) return
  const payload: { selectedOptionIds?: string[]; answerText?: string } = {}
  if (props.checkpoint.type === 'short_answer') {
    payload.answerText = answerText.value.trim()
  } else {
    payload.selectedOptionIds = Array.from(selectedIds.value)
  }
  emit('submit', payload)
}

const handleSkip = () => {
  emit('skip')
}

const handleRetry = () => {
  selectedIds.value = new Set()
  answerText.value = ''
  status.value = 'pending'
  result.value = null
  emit('retry')
}

const applyResult = (res: CheckpointSubmitResult) => {
  result.value = res
  status.value = res.passed ? 'passed' : 'failed'
}

defineExpose({ applyResult })
</script>

<style scoped>
.checkpoint-card {
  max-width: 640px;
  margin: 16px auto;
  padding: 20px 22px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid rgba(23, 32, 51, 0.06);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
  display: grid;
  gap: 14px;
  transition: border-color 0.2s ease;
}

.checkpoint-card--passed {
  border-color: rgba(49, 177, 111, 0.2);
}

.checkpoint-card--failed {
  border-color: rgba(232, 100, 80, 0.2);
}

.checkpoint-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.checkpoint-card__kicker {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-primary, #3478f6);
}

.checkpoint-card__status {
  font-size: 11px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 999px;
}

.checkpoint-card__status--passed {
  color: #1a7a42;
  background: rgba(49, 177, 111, 0.1);
}

.checkpoint-card__status--failed {
  color: #b44020;
  background: rgba(232, 100, 80, 0.1);
}

.checkpoint-card__title {
  font-size: 16px;
  font-weight: 700;
  line-height: 1.35;
  color: #172033;
}

.checkpoint-card__hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: #7a8599;
}

.checkpoint-card__question {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
  color: #172033;
}

.checkpoint-card__options {
  display: grid;
  gap: 10px;
}

.checkpoint-option {
  display: grid;
  grid-template-columns: 22px 28px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid rgba(23, 32, 51, 0.08);
  background: rgba(244, 247, 252, 0.7);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.checkpoint-option:hover:not(.checkpoint-option--disabled) {
  border-color: rgba(52, 120, 246, 0.2);
  background: rgba(52, 120, 246, 0.04);
}

.checkpoint-option--selected {
  border-color: rgba(52, 120, 246, 0.3);
  background: rgba(52, 120, 246, 0.06);
}

.checkpoint-option--correct {
  border-color: rgba(49, 177, 111, 0.3);
  background: rgba(49, 177, 111, 0.06);
}

.checkpoint-option--disabled {
  opacity: 0.7;
  cursor: default;
}

.checkpoint-option input {
  display: none;
}

.checkpoint-option__marker {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(243, 246, 251, 0.94);
  border: 1.5px solid rgba(23, 32, 51, 0.12);
  font-size: 10px;
  font-weight: 700;
  color: #7a8599;
  text-transform: uppercase;
}

.checkpoint-option--selected .checkpoint-option__marker {
  background: var(--color-primary, #3478f6);
  border-color: var(--color-primary, #3478f6);
  color: #fff;
}

.checkpoint-option__text {
  font-size: 14px;
  line-height: 1.5;
  color: #172033;
}

.checkpoint-card__answer {
  display: grid;
  gap: 8px;
}

.checkpoint-card__textarea {
  width: 100%;
  min-height: 80px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid rgba(23, 32, 51, 0.1);
  background: rgba(244, 247, 252, 0.6);
  font-size: 14px;
  line-height: 1.6;
  color: #172033;
  resize: vertical;
  transition: border-color 0.15s ease;
  font-family: inherit;
}

.checkpoint-card__textarea:focus {
  outline: none;
  border-color: rgba(52, 120, 246, 0.35);
}

.checkpoint-card__textarea:disabled {
  opacity: 0.6;
  cursor: default;
}

.checkpoint-card__actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
}

.checkpoint-card__submit {
  padding: 10px 22px;
  border-radius: 10px;
  border: none;
  background: var(--color-primary, #3478f6);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.checkpoint-card__submit:hover:not(:disabled) {
  opacity: 0.9;
  transform: translateY(-1px);
}

.checkpoint-card__submit:disabled {
  opacity: 0.45;
  cursor: default;
}

.checkpoint-card__skip {
  padding: 10px 18px;
  border-radius: 10px;
  border: 1px solid rgba(23, 32, 51, 0.1);
  background: transparent;
  color: #7a8599;
  font-size: 13px;
  cursor: pointer;
  transition: border-color 0.15s ease;
}

.checkpoint-card__skip:hover:not(:disabled) {
  border-color: rgba(23, 32, 51, 0.2);
}

.checkpoint-card__skip:disabled {
  opacity: 0.45;
  cursor: default;
}

.checkpoint-card__result {
  padding: 16px;
  border-radius: 12px;
  display: grid;
  gap: 10px;
}

.checkpoint-card__result--passed {
  background: rgba(49, 177, 111, 0.06);
}

.checkpoint-card__result--failed {
  background: rgba(232, 100, 80, 0.06);
}

.checkpoint-card__feedback {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: #172033;
}

.checkpoint-card__result-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: #7a8599;
}

.checkpoint-card__result-actions {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  margin-top: 4px;
}

.checkpoint-card__btn {
  padding: 9px 20px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.checkpoint-card__btn--primary {
  border: none;
  background: var(--color-primary, #3478f6);
  color: #fff;
}

.checkpoint-card__btn--primary:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}

.checkpoint-card__btn--ghost {
  border: 1px solid rgba(23, 32, 51, 0.1);
  background: transparent;
  color: #7a8599;
}

.checkpoint-card__btn--ghost:hover {
  border-color: rgba(23, 32, 51, 0.2);
}

.checkpoint-fade-enter-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.checkpoint-fade-leave-active {
  transition: opacity 0.2s ease;
}

.checkpoint-fade-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.checkpoint-fade-leave-to {
  opacity: 0;
}
</style>
