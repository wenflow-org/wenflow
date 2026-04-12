<template>
  <div class="content-agent-dialog-card">
    <!-- 问题区域 -->
    <div class="question-section">
      <div class="question-text" v-html="renderedQuestion"></div>
      
      <!-- 提示按钮 -->
      <div class="hint-trigger" v-if="hint">
        <el-button 
          type="info" 
          size="small" 
          @click="handleRequestHint"
          :disabled="hintShown"
          class="hint-btn"
        >
          <el-icon><Light /></el-icon>
          {{ hintShown ? '提示已显示' : '需要提示' }}
        </el-button>
      </div>
      
      <!-- 提示内容 -->
      <div class="hint-content" v-if="hintShown && hint">
        <el-alert
          type="info"
          :closable="false"
          show-icon
        >
          <div class="hint-text">{{ hint }}</div>
        </el-alert>
      </div>
    </div>

    <!-- 答题区域 -->
    <div class="answer-section">
      <!-- 选择题 -->
      <div v-if="uiType === 'choice'" class="choice-options">
        <el-button
          v-for="(option, index) in options"
          :key="index"
          @click="handleSelectOption(index)"
          :type="selectedOption === index ? 'primary' : 'default'"
          class="option-btn"
        >
          {{ option }}
        </el-button>
      </div>

      <!-- 输入题 -->
      <div v-else-if="uiType === 'input'" class="input-wrapper">
        <el-input
          v-model="inputAnswer"
          :placeholder="inputHint || '请输入你的答案'"
          size="large"
          clearable
          @keyup.enter="handleSubmitInput"
        />
      </div>

      <!-- 代码题 -->
      <div v-else-if="uiType === 'code'" class="code-wrapper">
        <el-input
          v-model="codeAnswer"
          type="textarea"
          :rows="8"
          :placeholder="inputHint || '// 请在此处编写你的代码'"
          class="code-editor"
        />
      </div>

      <!-- 反思题 -->
      <div v-else-if="uiType === 'reflection'" class="reflection-wrapper">
        <el-input
          v-model="reflectionAnswer"
          type="textarea"
          :rows="6"
          :placeholder="inputHint || '请分享你的思考和感悟...'"
          resize="vertical"
        />
      </div>

      <!-- 提交按钮 -->
      <div class="submit-actions">
        <el-button
          type="primary"
          size="large"
          @click="handleSubmit"
          :disabled="!canSubmit"
          class="submit-btn"
        >
          提交答案
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { Light } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';

interface Props {
  uiType: 'choice' | 'input' | 'code' | 'reflection';
  question: string;
  options?: string[];
  inputHint?: string;
  hint?: string;
}

interface Emits {
  (e: 'submit', answer: string | string[]): void;
  (e: 'request-hint'): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

// 渲染问题（支持简单的 Markdown）
const renderedQuestion = computed(() => {
  // 简单的 Markdown 渲染
  return props.question
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
});

// 选择题状态
const selectedOption = ref<number | null>(null);

// 输入题状态
const inputAnswer = ref('');

// 代码题状态
const codeAnswer = ref('');

// 反思题状态
const reflectionAnswer = ref('');

// 提示状态
const hintShown = ref(false);

// 是否可以提交
const canSubmit = computed(() => {
  switch (props.uiType) {
    case 'choice':
      return selectedOption.value !== null;
    case 'input':
      return inputAnswer.value.trim().length > 0;
    case 'code':
      return codeAnswer.value.trim().length > 0;
    case 'reflection':
      return reflectionAnswer.value.trim().length > 0;
    default:
      return false;
  }
});

// 处理选择题选项选择
const handleSelectOption = (index: number) => {
  selectedOption.value = index;
};

// 处理输入题提交
const handleSubmitInput = () => {
  if (canSubmit.value) {
    handleSubmit();
  }
};

// 处理提示请求
const handleRequestHint = () => {
  hintShown.value = true;
  emit('request-hint');
};

// 处理提交
const handleSubmit = () => {
  let answer: string | string[] = '';

  switch (props.uiType) {
    case 'choice':
      if (selectedOption.value !== null && props.options) {
        answer = props.options[selectedOption.value];
      }
      break;
    case 'input':
      answer = inputAnswer.value.trim();
      break;
    case 'code':
      answer = codeAnswer.value.trim();
      break;
    case 'reflection':
      answer = reflectionAnswer.value.trim();
      break;
  }

  if (answer) {
    emit('submit', answer);
    
    // 显示成功提示
    ElMessage.success('答案已提交');
  }
};

// 重置组件状态
const reset = () => {
  selectedOption.value = null;
  inputAnswer.value = '';
  codeAnswer.value = '';
  reflectionAnswer.value = '';
  hintShown.value = false;
};

// 暴露重置方法给父组件
defineExpose({
  reset
});
</script>

<style scoped>
.content-agent-dialog-card {
  background: var(--bg-surface, #ffffff);
  border-radius: var(--radius-lg, 12px);
  padding: 1.5rem;
  box-shadow: var(--shadow-md, 0 4px 12px rgba(0, 0, 0, 0.1));
  border: 1px solid var(--border-default, #e2e8f0);
}

/* 问题区域 */
.question-section {
  margin-bottom: 1.5rem;
}

.question-text {
  font-size: 1rem;
  line-height: 1.6;
  color: var(--text-primary, #1a202c);
  margin-bottom: 1rem;
  font-weight: 500;
}

.question-text :deep(strong) {
  color: var(--color-primary, #3b82f6);
  font-weight: 600;
}

.question-text :deep(code) {
  background: var(--bg-code, #f1f5f9);
  padding: 0.125rem 0.375rem;
  border-radius: 4px;
  font-family: 'Courier New', monospace;
  font-size: 0.9em;
  color: var(--text-code, #475569);
}

.hint-trigger {
  margin-bottom: 0.75rem;
}

.hint-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.hint-content {
  margin-top: 0.75rem;
}

.hint-text {
  font-size: 0.875rem;
  line-height: 1.5;
}

/* 答题区域 */
.answer-section {
  border-top: 1px solid var(--border-default, #e2e8f0);
  padding-top: 1.25rem;
}

/* 选择题样式 */
.choice-options {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.option-btn {
  width: 100%;
  justify-content: flex-start;
  padding: 0.875rem 1rem;
  font-size: 0.9375rem;
  border-radius: var(--radius-md, 8px);
  transition: all var(--transition-fast, 0.2s);
}

.option-btn:hover {
  transform: translateX(4px);
}

/* 输入题样式 */
.input-wrapper {
  margin-bottom: 1rem;
}

.input-wrapper :deep(.el-input__wrapper) {
  border-radius: var(--radius-md, 8px);
  padding: 0.75rem 1rem;
}

/* 代码题样式 */
.code-wrapper {
  margin-bottom: 1rem;
}

.code-editor :deep(.el-textarea__inner) {
  font-family: 'Courier New', monospace;
  font-size: 0.875rem;
  line-height: 1.5;
  background: var(--bg-code, #f8fafc);
  border-radius: var(--radius-md, 8px);
  padding: 1rem;
}

.code-editor :deep(.el-textarea__inner:focus) {
  background: var(--bg-surface, #ffffff);
}

/* 反思题样式 */
.reflection-wrapper {
  margin-bottom: 1rem;
}

.reflection-wrapper :deep(.el-textarea__inner) {
  border-radius: var(--radius-md, 8px);
  padding: 0.875rem 1rem;
  line-height: 1.6;
}

/* 提交按钮 */
.submit-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 1rem;
}

.submit-btn {
  min-width: 120px;
  border-radius: var(--radius-md, 8px);
  font-weight: 500;
  background: linear-gradient(135deg, var(--color-primary, #3b82f6), var(--color-primary-dark, #2563eb));
  border: none;
}

.submit-btn:hover {
  background: linear-gradient(135deg, var(--color-primary-dark, #2563eb), var(--color-primary-darker, #1d4ed8));
}

.submit-btn:disabled {
  background: var(--bg-disabled, #cbd5e0);
  cursor: not-allowed;
}

/* 暗色模式支持 */
@media (prefers-color-scheme: dark) {
  .content-agent-dialog-card {
    background: var(--bg-surface-dark, #1e293b);
    border-color: var(--border-dark, #334155);
  }

  .question-text {
    color: var(--text-primary-dark, #f1f5f9);
  }

  .code-editor :deep(.el-textarea__inner) {
    background: var(--bg-code-dark, #0f172a);
    color: var(--text-primary-dark, #f1f5f9);
  }
}

/* 响应式 */
@media (max-width: 640px) {
  .content-agent-dialog-card {
    padding: 1rem;
  }

  .question-text {
    font-size: 0.9375rem;
  }

  .option-btn {
    padding: 0.75rem 0.875rem;
    font-size: 0.875rem;
  }

  .submit-btn {
    width: 100%;
  }
}
</style>