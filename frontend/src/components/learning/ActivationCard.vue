<template>
  <div class="activation-card">
    <div class="card-header">
      <el-icon><ChatDotRound /></el-icon>
      <span>在开始之前...</span>
    </div>
    <div class="card-body">
      <p class="question">{{ question }}</p>
      <el-input
        v-model="userResponse"
        type="textarea"
        :rows="3"
        placeholder="说说你的想法..."
        @keyup.enter.ctrl="submit"
      />
      <div class="actions">
        <el-button type="primary" @click="submit" :disabled="!userResponse.trim()">
          提交
        </el-button>
        <el-button text @click="skip">
          跳过，直接开始
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ChatDotRound } from '@element-plus/icons-vue'

const props = defineProps<{
  question: string
}>()

const emit = defineEmits<{
  submit: [response: string]
  skip: []
}>()

const userResponse = ref('')

const submit = () => {
  if (userResponse.value.trim()) {
    emit('submit', userResponse.value.trim())
  }
}

const skip = () => {
  emit('skip')
}
</script>

<style scoped lang="scss">
.activation-card {
  background: var(--el-bg-color);
  border-radius: 12px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  overflow: hidden;
  max-width: 800px;
  margin: 0 auto;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 20px;
  background: linear-gradient(135deg, var(--el-color-primary-light-8), var(--el-color-primary-light-9));
  border-bottom: 1px solid var(--el-border-color-lighter);

  .el-icon {
    font-size: 20px;
    color: var(--el-color-primary);
  }

  span {
    font-size: 16px;
    font-weight: 500;
    color: var(--el-color-primary-dark-2);
  }
}

.card-body {
  padding: 24px;

  .question {
    font-size: 18px;
    font-weight: 500;
    color: var(--el-text-color-primary);
    margin-bottom: 20px;
    line-height: 1.6;
  }

  .el-textarea {
    margin-bottom: 16px;
  }

  .actions {
    display: flex;
    gap: 12px;
    justify-content: flex-end;
  }
}

@media (max-width: 768px) {
  .activation-card {
    border-radius: 8px;
  }

  .card-body {
    padding: 16px;

    .question {
      font-size: 16px;
    }
  }

  .actions {
    flex-direction: column;

    .el-button {
      width: 100%;
    }
  }
}
</style>