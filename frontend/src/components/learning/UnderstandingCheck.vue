<template>
  <div class="understanding-check">
    <div class="check-header">
      <el-icon><CircleCheck /></el-icon>
      <span>理解检查</span>
    </div>
    
    <div class="check-body">
      <p class="check-question">{{ question }}</p>
      
      <el-input
        v-model="userAnswer"
        type="textarea"
        :rows="4"
        placeholder="用你自己的话说..."
        @keyup.enter.ctrl="submitCheck"
      />
      
      <el-button 
        type="primary" 
        @click="submitCheck"
        :loading="checking"
        :disabled="!userAnswer.trim()"
      >
        提交
      </el-button>
    </div>
    
    <transition name="fade">
      <div v-if="feedback" class="feedback-area" :class="feedback.level">
        <div class="feedback-icon">
          <el-icon v-if="feedback.level === 'passed'"><CircleCheckFilled /></el-icon>
          <el-icon v-else-if="feedback.level === 'vague'"><Warning /></el-icon>
          <el-icon v-else><Close /></el-icon>
        </div>
        
        <div class="feedback-content">
          <p class="feedback-message">{{ feedback.message }}</p>
          
          <div v-if="feedback.hint" class="feedback-hint">
            <el-icon><InfoFilled /></el-icon>
            <span>{{ feedback.hint }}</span>
          </div>
        </div>
        
        <div class="feedback-actions">
          <el-button 
            v-if="feedback.needReview" 
            size="small"
            @click="review"
          >
            <el-icon><RefreshLeft /></el-icon>
            回顾一下
          </el-button>
          <el-button 
            v-if="feedback.level !== 'passed'"
            size="small"
            type="primary"
            @click="complete"
          >
            继续学习
          </el-button>
          <el-button 
            v-if="feedback.level === 'passed'"
            size="small"
            type="success"
            @click="complete"
          >
            太棒了！继续
          </el-button>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { CircleCheck, CircleCheckFilled, Warning, Close, InfoFilled, RefreshLeft } from '@element-plus/icons-vue'

interface Feedback {
  level: 'passed' | 'vague' | 'deviation'
  message: string
  hint?: string
  needReview: boolean
}

const props = defineProps<{
  question: string
}>()

const emit = defineEmits<{
  check: [answer: string]
  review: []
  complete: []
}>()

const userAnswer = ref('')
const checking = ref(false)
const feedback = ref<Feedback | null>(null)

const submitCheck = async () => {
  if (!userAnswer.value.trim()) return
  
  checking.value = true
  emit('check', userAnswer.value.trim())
  checking.value = false
}

const setFeedback = (newFeedback: Feedback) => {
  feedback.value = newFeedback
}

const review = () => {
  emit('review')
}

const complete = () => {
  emit('complete')
}

defineExpose({
  setFeedback
})
</script>

<style scoped lang="scss">
.understanding-check {
  background: var(--el-bg-color);
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  overflow: hidden;
  max-width: 800px;
  margin: 0 auto;
}

.check-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 20px;
  background: linear-gradient(135deg, var(--el-color-success-light-8), var(--el-color-success-light-9));
  border-bottom: 1px solid var(--el-border-color-lighter);

  .el-icon {
    font-size: 20px;
    color: var(--el-color-success);
  }

  span {
    font-size: 16px;
    font-weight: 500;
    color: var(--el-color-success-dark-2);
  }
}

.check-body {
  padding: 24px;

  .check-question {
    font-size: 18px;
    font-weight: 500;
    color: var(--el-text-color-primary);
    margin-bottom: 20px;
    line-height: 1.6;
  }

  .el-textarea {
    margin-bottom: 16px;
  }

  .el-button {
    width: 100%;
  }
}

.feedback-area {
  padding: 20px;
  border-top: 1px solid var(--el-border-color-lighter);

  &.passed {
    background: linear-gradient(135deg, var(--el-color-success-light-9), var(--el-color-success-light-8));

    .feedback-icon {
      color: var(--el-color-success);
    }
  }

  &.vague {
    background: linear-gradient(135deg, var(--el-color-warning-light-9), var(--el-color-warning-light-8));

    .feedback-icon {
      color: var(--el-color-warning);
    }
  }

  &.deviation {
    background: linear-gradient(135deg, var(--el-color-danger-light-9), var(--el-color-danger-light-8));

    .feedback-icon {
      color: var(--el-color-danger);
    }
  }

  .feedback-icon {
    text-align: center;
    margin-bottom: 12px;

    .el-icon {
      font-size: 48px;
    }
  }

  .feedback-content {
    text-align: center;
    margin-bottom: 16px;

    .feedback-message {
      font-size: 16px;
      color: var(--el-text-color-primary);
      margin-bottom: 8px;
      line-height: 1.5;
    }

    .feedback-hint {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      font-size: 14px;
      color: var(--el-text-color-secondary);

      .el-icon {
        font-size: 16px;
      }
    }
  }

  .feedback-actions {
    display: flex;
    gap: 12px;
    justify-content: center;
    flex-wrap: wrap;
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@media (max-width: 768px) {
  .understanding-check {
    border-radius: 8px;
  }

  .check-body {
    padding: 16px;

    .check-question {
      font-size: 16px;
    }
  }

  .feedback-area {
    padding: 16px;

    .feedback-icon .el-icon {
      font-size: 40px;
    }

    .feedback-content .feedback-message {
      font-size: 15px;
    }

    .feedback-actions {
      flex-direction: column;

      .el-button {
        width: 100%;
      }
    }
  }
}
</style>