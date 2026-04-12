<template>
  <div class="content-segment">
    <div class="segment-content" v-html="renderedContent"></div>
    
    <div v-if="thinkingPause" class="thinking-pause">
      <div class="pause-header">
        <el-icon><CaretRight /></el-icon>
        <span>想一想</span>
      </div>
      <p class="pause-question">{{ thinkingPause.question }}</p>
      
      <div v-if="thinkingPause.type === 'open'" class="open-input">
        <el-input
          v-model="userResponse"
          type="textarea"
          :rows="3"
          placeholder="写下你的想法..."
        />
      </div>
      
      <div v-else-if="thinkingPause.type === 'choice'" class="options">
        <el-checkbox-group v-model="selectedOptions">
          <el-checkbox 
            v-for="opt in thinkingPause.options" 
            :key="opt" 
            :label="opt"
          >
            {{ opt }}
          </el-checkbox>
        </el-checkbox-group>
      </div>
      
      <div class="pause-actions">
        <el-button 
          type="primary" 
          size="default"
          @click="submitResponse"
          :disabled="!hasResponse"
        >
          说说我的想法
        </el-button>
        <el-button text @click="continueNext">
          继续
        </el-button>
      </div>
    </div>

    <div v-else class="continue-area">
      <el-button type="primary" @click="continueNext">
        继续学习
        <el-icon class="el-icon--right"><ArrowRight /></el-icon>
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import MarkdownIt from 'markdown-it'
import { CaretRight, ArrowRight } from '@element-plus/icons-vue'

const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true
})

interface ThinkingPause {
  question: string
  type: 'open' | 'choice'
  options?: string[]
}

const props = defineProps<{
  content: string
  thinkingPause?: ThinkingPause
}>()

const emit = defineEmits<{
  submitResponse: [response: string]
  continue: []
}>()

const userResponse = ref('')
const selectedOptions = ref<string[]>([])

const renderedContent = computed(() => md.render(props.content))

const hasResponse = computed(() => {
  if (!props.thinkingPause) return false
  if (props.thinkingPause.type === 'open') {
    return userResponse.value.trim().length > 0
  }
  return selectedOptions.value.length > 0
})

const submitResponse = () => {
  const response = props.thinkingPause?.type === 'choice'
    ? selectedOptions.value.join(', ')
    : userResponse.value.trim()
  
  if (response) {
    emit('submitResponse', response)
    userResponse.value = ''
    selectedOptions.value = []
  }
}

const continueNext = () => {
  emit('continue')
}
</script>

<style scoped lang="scss">
.content-segment {
  background: var(--el-bg-color);
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  overflow: hidden;
  max-width: 800px;
  margin: 0 auto;
}

.segment-content {
  padding: 24px;
  line-height: 1.8;
  font-size: 16px;
  color: var(--el-text-color-primary);

  :deep(h1),
  :deep(h2),
  :deep(h3) {
    margin-top: 24px;
    margin-bottom: 12px;
    color: var(--el-text-color-primary);
  }

  :deep(p) {
    margin-bottom: 16px;
  }

  :deep(ul),
  :deep(ol) {
    margin-bottom: 16px;
    padding-left: 24px;
  }

  :deep(li) {
    margin-bottom: 8px;
  }

  :deep(code) {
    background: var(--el-fill-color-light);
    padding: 2px 6px;
    border-radius: 4px;
    font-family: 'Fira Code', monospace;
    font-size: 14px;
  }

  :deep(pre) {
    background: var(--el-fill-color-darker);
    padding: 16px;
    border-radius: 8px;
    overflow-x: auto;
    margin-bottom: 16px;

    code {
      background: none;
      padding: 0;
    }
  }

  :deep(blockquote) {
    border-left: 4px solid var(--el-color-primary);
    padding-left: 16px;
    margin: 16px 0;
    color: var(--el-text-color-secondary);
  }
}

.thinking-pause {
  background: linear-gradient(135deg, var(--el-color-warning-light-9), var(--el-color-warning-light-8));
  padding: 20px;
  border-top: 1px solid var(--el-border-color-lighter);

  .pause-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;

    .el-icon {
      font-size: 18px;
      color: var(--el-color-warning-dark-2);
    }

    span {
      font-size: 15px;
      font-weight: 500;
      color: var(--el-color-warning-dark-2);
    }
  }

  .pause-question {
    font-size: 15px;
    color: var(--el-text-color-primary);
    margin-bottom: 16px;
    line-height: 1.6;
  }

  .open-input {
    margin-bottom: 16px;
  }

  .options {
    margin-bottom: 16px;
    
    :deep(.el-checkbox-group) {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    :deep(.el-checkbox) {
      margin-right: 0;
      padding: 12px 16px;
      background: var(--el-bg-color);
      border-radius: 8px;
      transition: all 0.2s;

      &:hover {
        background: var(--el-fill-color-light);
      }
    }
  }

  .pause-actions {
    display: flex;
    gap: 12px;
    justify-content: flex-end;
  }
}

.continue-area {
  padding: 20px 24px;
  display: flex;
  justify-content: flex-end;
  border-top: 1px solid var(--el-border-color-lighter);
}

@media (max-width: 768px) {
  .content-segment {
    border-radius: 8px;
  }

  .segment-content {
    padding: 16px;
    font-size: 15px;
  }

  .thinking-pause {
    padding: 16px;

    .pause-actions {
      flex-direction: column;

      .el-button {
        width: 100%;
      }
    }
  }
}
</style>