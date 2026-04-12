<template>
  <div class="question-card">
    <!-- 选择题 -->
    <el-card v-if="uiType === 'choice'" class="question-card-choice">
      <template #header>
        <div class="card-header">
          <div class="header-left">
            <el-icon class="header-icon"><CircleCheck /></el-icon>
            <span class="header-title">选择题</span>
          </div>
          <el-tag size="small" type="warning">单选</el-tag>
        </div>
      </template>
      
      <div class="question-text">{{ question }}</div>
      
      <el-radio-group v-model="selectedOption" class="options-group">
        <div
          v-for="(option, index) in options"
          :key="index"
          class="option-item"
          :class="{ selected: selectedOption === index }"
          @click="selectedOption = index"
        >
          <el-radio :label="index" size="large">
            <span class="option-label">{{ String.fromCharCode(65 + index) }}.</span>
            <span class="option-text">{{ option }}</span>
          </el-radio>
        </div>
      </el-radio-group>
      
      <el-button
        type="primary"
        size="large"
        :disabled="selectedOption === null"
        @click="handleSubmit"
        class="submit-btn"
      >
        提交答案
      </el-button>
    </el-card>
    
    <!-- 输入题 -->
    <el-card v-else-if="uiType === 'input'" class="question-card-input">
      <template #header>
        <div class="card-header">
          <div class="header-left">
            <el-icon class="header-icon"><EditPen /></el-icon>
            <span class="header-title">思考题</span>
          </div>
          <el-tag size="small" type="success">开放</el-tag>
        </div>
      </template>
      
      <div class="question-text">{{ question }}</div>
      
      <el-input
        v-model="inputText"
        type="textarea"
        :rows="5"
        :placeholder="inputHint || '请输入你的回答...'"
        maxlength="500"
        show-word-limit
        class="input-textarea"
      />
      
      <div class="input-footer">
        <el-button
          type="primary"
          size="large"
          :disabled="!inputText.trim()"
          @click="handleSubmit"
          class="submit-btn"
        >
          提交回答
        </el-button>
      </div>
    </el-card>
    
    <!-- 代码题 -->
    <el-card v-else-if="uiType === 'code'" class="question-card-code">
      <template #header>
        <div class="card-header">
          <div class="header-left">
            <el-icon class="header-icon"><Monitor /></el-icon>
            <span class="header-title">编程题</span>
          </div>
          <el-tag size="small" type="danger">实践</el-tag>
        </div>
      </template>
      
      <div class="question-text">{{ question }}</div>
      
      <div class="code-editor-wrapper">
        <div class="code-header">
          <span class="code-language">{{ codeLanguage || 'Python' }}</span>
          <el-button size="small" @click="clearCode">
            <el-icon><Delete /></el-icon>
            清空
          </el-button>
        </div>
        <el-input
          v-model="code"
          type="textarea"
          :rows="10"
          :placeholder="`请输入${codeLanguage || 'Python'}代码...`"
          class="code-textarea"
          spellcheck="false"
        />
      </div>
      
      <div class="code-footer">
        <el-button
          type="primary"
          size="large"
          :disabled="!code.trim()"
          @click="handleSubmit"
          class="submit-btn"
        >
          <el-icon><VideoPlay /></el-icon>
          运行并提交
        </el-button>
      </div>
    </el-card>
    
    <!-- 反思题 -->
    <el-card v-else-if="uiType === 'reflection'" class="question-card-reflection">
      <template #header>
        <div class="card-header">
          <div class="header-left">
            <el-icon class="header-icon"><Lightning /></el-icon>
            <span class="header-title">反思题</span>
          </div>
          <el-tag size="small" type="info">元认知</el-tag>
        </div>
      </template>
      
      <div class="question-text">{{ question }}</div>
      
      <el-alert
        v-if="inputHint"
        title="反思引导"
        type="info"
        :closable="false"
        show-icon
        class="reflection-hint"
      >
        {{ inputHint }}
      </el-alert>
      
      <el-input
        v-model="reflectionText"
        type="textarea"
        :rows="6"
        :placeholder="'请深入思考并写下你的想法...'"
        maxlength="1000"
        show-word-limit
        class="reflection-textarea"
      />
      
      <div class="reflection-footer">
        <el-tag size="small" type="info">
          <el-icon><Clock /></el-icon>
          建议用时 3-5 分钟
        </el-tag>
        <el-button
          type="primary"
          size="large"
          :disabled="!reflectionText.trim()"
          @click="handleSubmit"
          class="submit-btn"
        >
          提交反思
        </el-button>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, defineProps, defineEmits } from 'vue';
import { 
  CircleCheck, 
  EditPen, 
  Monitor, 
  Lightning,
  Delete,
  VideoPlay,
  Clock
} from '@element-plus/icons-vue';

interface Props {
  uiType: 'choice' | 'input' | 'code' | 'reflection';
  question: string;
  options?: string[];
  inputHint?: string;
  codeLanguage?: string;
}

const props = withDefaults(defineProps<Props>(), {
  options: () => [],
  inputHint: '',
  codeLanguage: 'python'
});

const emit = defineEmits<{
  (e: 'submit', response: string): void;
}>();

// 状态
const selectedOption = ref<number | null>(null);
const inputText = ref<string>('');
const code = ref<string>('');
const reflectionText = ref<string>('');

// 提交
const handleSubmit = () => {
  let response = '';
  
  switch (props.uiType) {
    case 'choice':
      if (selectedOption.value !== null && props.options[selectedOption.value]) {
        response = props.options[selectedOption.value];
      }
      break;
    case 'input':
      response = inputText.value.trim();
      break;
    case 'code':
      response = code.value.trim();
      break;
    case 'reflection':
      response = reflectionText.value.trim();
      break;
  }
  
  if (response) {
    emit('submit', response);
  }
};

// 清空代码
const clearCode = () => {
  code.value = '';
};
</script>

<style scoped>
.question-card {
  width: 100%;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-icon {
  font-size: 18px;
  color: var(--color-primary);
}

.header-title {
  font-weight: 600;
  font-size: 16px;
  color: var(--text-primary);
}

.question-text {
  font-size: 16px;
  line-height: 1.6;
  color: var(--text-primary);
  margin-bottom: 20px;
  font-weight: 500;
}

.options-group {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 20px;
}

.option-item {
  padding: 12px 16px;
  border: 2px solid var(--border-default);
  border-radius: 8px;
  cursor: pointer;
  transition: all var(--transition-normal);
}

.option-item:hover {
  border-color: var(--color-primary);
  background-color: var(--bg-hover);
}

.option-item.selected {
  border-color: var(--color-primary);
  background-color: var(--color-progress-bg);
}

.option-label {
  font-weight: 600;
  color: var(--text-secondary);
  margin-right: 8px;
}

.option-text {
  color: var(--text-primary);
}

.submit-btn {
  width: 100%;
  margin-top: 10px;
}

.input-textarea {
  margin-bottom: 16px;
}

.input-footer {
  display: flex;
  justify-content: flex-end;
}

.code-editor-wrapper {
  margin-bottom: 16px;
}

.code-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background-color: var(--bg-muted);
  border-bottom: 1px solid var(--border-default);
  border-radius: 4px 4px 0 0;
}

.code-language {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}

.code-textarea {
  font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
  font-size: 14px;
}

.code-footer {
  display: flex;
  justify-content: flex-end;
}

.reflection-hint {
  margin-bottom: 16px;
}

.reflection-textarea {
  margin-bottom: 16px;
}

.reflection-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

[data-theme="dark"] {
  .question-card {
    background: var(--bg-elevated);
  }

  .header-icon {
    color: var(--color-primary-light);
  }

  .header-title {
    color: var(--text-primary);
  }

  .question-text {
    color: var(--text-primary);
  }

  .option-item {
    border: 2px solid var(--border-default);
    background: var(--bg-surface);
  }

  .option-item:hover {
    border-color: var(--color-primary-light);
    background-color: var(--bg-hover);
  }

  .option-item.selected {
    border-color: var(--color-primary-light);
    background-color: var(--color-progress-bg);
  }

  .option-label {
    color: var(--text-secondary);
  }

  .option-text {
    color: var(--text-primary);
  }

  .code-header {
    background-color: var(--bg-muted);
    border-bottom: 1px solid var(--border-default);
  }

  .code-language {
    color: var(--text-secondary);
  }
}
</style>
