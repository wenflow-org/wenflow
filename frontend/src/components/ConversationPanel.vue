<template>
  <div class="conversation-panel">
    <!-- 对话历史 -->
    <div class="message-history" ref="historyContainer">
      <div
        v-for="(message, index) in messages"
        :key="index"
        :class="['message', message.role]"
      >
        <div class="message-avatar">
          <el-avatar
            :icon="message.role === 'user' ? 'User' : 'Avatar'"
            :size="40"
            :class="message.role"
          />
        </div>
        <div class="message-content">
          <div class="message-bubble">
            {{ message.content }}
          </div>
          <div class="message-time">
            {{ formatTime(message.timestamp) }}
          </div>
        </div>
      </div>
      
      <!-- 加载状态 -->
      <div v-if="loading" class="message assistant loading">
        <div class="message-avatar">
          <el-avatar icon="Avatar" :size="40" />
        </div>
        <div class="message-content">
          <div class="loading-bubble">
            <el-icon class="loading-icon"><Loading /></el-icon>
            <span>AI 思考中...</span>
          </div>
        </div>
      </div>
    </div>
    
    <!-- 当前问题 -->
    <div class="current-question" v-if="currentContent">
      <QuestionCard
        :ui-type="currentContent.uiType"
        :question="currentContent.question"
        :options="currentContent.options"
        :input-hint="currentContent.inputHint"
        :code-language="currentContent.codeLanguage"
        @submit="handleSubmit"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, defineProps, defineEmits, watch, nextTick } from 'vue';
import { Loading } from '@element-plus/icons-vue';
import QuestionCard from './QuestionCard.vue';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

interface Content {
  uiType: 'choice' | 'input' | 'code' | 'reflection';
  question: string;
  options?: string[];
  inputHint?: string;
  codeLanguage?: string;
  hint?: string;
}

defineProps<{
  messages: Message[];
  currentContent: Content | null;
  loading?: boolean;
}>();

const emit = defineEmits<{
  (e: 'response-submit', response: string): void;
}>();

const historyContainer = ref<HTMLElement | null>(null);

// 监听消息变化，自动滚动到底部
watch(
  () => arguments[0]?.messages,
  () => {
    nextTick(() => {
      if (historyContainer.value) {
        historyContainer.value.scrollTop = historyContainer.value.scrollHeight;
      }
    });
  },
  { deep: true }
);

const handleSubmit = (response: string) => {
  emit('response-submit', response);
};

const formatTime = (timestamp: string) => {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  });
};
</script>

<style scoped>
.conversation-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: var(--bg-muted);
  transition: background-color var(--transition-base);
}

.message-history {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.message {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.message.user {
  flex-direction: row-reverse;
}

.message-avatar {
  flex-shrink: 0;
}

.message-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 70%;
}

.message.user .message-content {
  align-items: flex-end;
}

.message-bubble {
  padding: 12px 16px;
  border-radius: 12px;
  line-height: 1.6;
  font-size: 15px;
}

.message.assistant .message-bubble {
  background-color: var(--bg-surface);
  color: var(--text-primary);
  border-bottom-left-radius: 4px;
  box-shadow: var(--shadow-sm);
  transition: background-color var(--transition-base), color var(--transition-base), box-shadow var(--transition-base);
}

.message.user .message-bubble {
  background-color: var(--color-primary);
  color: var(--text-inverse);
  border-bottom-right-radius: 4px;
  transition: background-color var(--transition-base);
}

.loading-bubble {
  padding: 12px 16px;
  background-color: var(--bg-surface);
  border-radius: 12px;
  border-bottom-left-radius: 4px;
  display: flex;
  align-items: center;
  gap: 8px;
  box-shadow: var(--shadow-sm);
  color: var(--text-primary);
  transition: background-color var(--transition-base), color var(--transition-base), box-shadow var(--transition-base);
}

.loading-icon {
  animation: rotating 2s linear infinite;
}

@keyframes rotating {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.message-time {
  font-size: 12px;
  color: var(--text-muted);
  padding: 0 4px;
}

.current-question {
  background-color: var(--bg-surface);
  border-top: 1px solid var(--border-default);
  padding: 20px;
  box-shadow: var(--shadow-md);
  transition: background-color var(--transition-base), border-color var(--transition-base), box-shadow var(--transition-base);
}

/* 滚动条样式 */
.message-history::-webkit-scrollbar {
  width: 6px;
}

.message-history::-webkit-scrollbar-track {
  background: var(--bg-muted);
}

.message-history::-webkit-scrollbar-thumb {
  background: var(--border-dark);
  border-radius: 3px;
  transition: background var(--transition-base);
}

.message-history::-webkit-scrollbar-thumb:hover {
  background: var(--text-muted);
}

/* 暗色主题 */
[data-theme="dark"] .conversation-panel {
  background-color: var(--bg-muted);
}

[data-theme="dark"] .message.assistant .message-bubble {
  background-color: var(--bg-elevated);
  box-shadow: var(--shadow-sm);
}

[data-theme="dark"] .loading-bubble {
  background-color: var(--bg-elevated);
  box-shadow: var(--shadow-sm);
}

[data-theme="dark"] .current-question {
  background-color: var(--bg-elevated);
  border-top-color: var(--border-default);
  box-shadow: var(--shadow-md);
}

[data-theme="dark"] .message-history::-webkit-scrollbar-track {
  background: var(--bg-muted);
}

[data-theme="dark"] .message-history::-webkit-scrollbar-thumb {
  background: var(--border-dark);
}

[data-theme="dark"] .message-history::-webkit-scrollbar-thumb:hover {
  background: var(--text-muted);
}
</style>
