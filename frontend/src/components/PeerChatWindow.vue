<template>
  <div v-if="visible" class="peer-chat-window" :style="windowStyle">
    <div class="window-header" @mousedown="startDrag">
      <div class="header-left">
        <el-icon :size="18" color="#67c23a"><ChatDotRound /></el-icon>
        <span class="header-title">同伴讨论</span>
      </div>
      <div class="header-actions">
        <el-button text size="small" @click="close">
          <el-icon><Close /></el-icon>
        </el-button>
      </div>
    </div>

    <div class="window-body">
      <div class="message-list" ref="messageListRef">
        <div
          v-for="(msg, index) in messages"
          :key="index"
          :class="['message-item', msg.role]"
        >
          <div class="message-avatar">
            <el-avatar :size="28" :style="{ backgroundColor: msg.role === 'user' ? '#409eff' : '#67c23a' }">
              <el-icon v-if="msg.role === 'user'"><User /></el-icon>
              <el-icon v-else><ChatDotRound /></el-icon>
            </el-avatar>
          </div>
          <div class="message-body">
            <div class="message-bubble">
              <MarkdownRenderer :content="msg.content" />
            </div>
            <div class="message-time">{{ formatTime(msg.timestamp) }}</div>
          </div>
        </div>

        <div v-if="loading" class="message-item peer">
          <div class="message-avatar">
            <el-avatar :size="28" style="background-color: #67c23a">
              <el-icon><ChatDotRound /></el-icon>
            </el-avatar>
          </div>
          <div class="message-body">
            <div class="message-bubble thinking">
              <el-icon class="loading-icon"><Loading /></el-icon>
              <span>思考中...</span>
            </div>
          </div>
        </div>

        <div v-if="messages.length === 0 && !loading" class="empty-state">
          <el-icon :size="40" color="#c0c4cc"><ChatDotRound /></el-icon>
          <p>和伙伴聊聊你的想法</p>
        </div>
      </div>

      <div class="window-input">
        <el-input
          v-model="userInput"
          type="textarea"
          :autosize="{ minRows: 2, maxRows: 4 }"
          placeholder="随便说说..."
          @keydown.ctrl.enter="sendMessage"
          :disabled="loading"
        />
        <div class="input-actions">
          <el-button
            type="success"
            size="small"
            @click="sendMessage"
            :loading="loading"
            :disabled="!userInput.trim()"
          >
            发送
          </el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { ChatDotRound, Close, User, Loading } from '@element-plus/icons-vue';
import MarkdownRenderer from './MarkdownRenderer.vue';

interface PeerMessage {
  role: 'user' | 'peer';
  content: string;
  timestamp: string;
}

const props = defineProps<{
  visible: boolean;
  loading?: boolean;
  messages: PeerMessage[];
}>();

const emit = defineEmits<{
  send: [message: string];
  close: [];
}>();

const userInput = ref('');
const messageListRef = ref<HTMLElement | null>(null);

const windowStyle = computed(() => ({
  width: '360px',
  height: '500px',
}));

const sendMessage = () => {
  const text = userInput.value.trim();
  if (!text || props.loading) return;

  emit('send', text);
  userInput.value = '';
};

const close = () => {
  emit('close');
};

const formatTime = (timestamp: string) => {
  const date = new Date(timestamp);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
};

watch(() => props.messages, () => {
  nextTick(() => {
    if (messageListRef.value) {
      messageListRef.value.scrollTop = messageListRef.value.scrollHeight;
    }
  });
}, { deep: true });
</script>

<style scoped>
.peer-chat-window {
  position: fixed;
  bottom: 80px;
  right: 24px;
  background-color: #ffffff;
  border-radius: 12px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.15);
  z-index: 9998;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.window-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background-color: #f5f7fa;
  border-bottom: 1px solid #e4e7ed;
  cursor: move;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
}

.window-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.message-item {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.message-item.user {
  flex-direction: row-reverse;
}

.message-body {
  max-width: 80%;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.message-item.user .message-body {
  align-items: flex-end;
}

.message-bubble {
  padding: 8px 12px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.5;
}

.message-item.peer .message-bubble {
  background-color: #f0f9eb;
  color: #303133;
  border-bottom-left-radius: 4px;
}

.message-item.user .message-bubble {
  background-color: #67c23a;
  color: #ffffff;
  border-bottom-right-radius: 4px;
}

.message-bubble.thinking {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #909399;
}

.loading-icon {
  animation: rotating 2s linear infinite;
}

@keyframes rotating {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.message-time {
  font-size: 11px;
  color: #909399;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #909399;
  text-align: center;
  gap: 8px;
}

.window-input {
  border-top: 1px solid #e4e7ed;
  padding: 12px;
  background-color: #ffffff;
}

.input-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}
</style>
