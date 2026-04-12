<template>
  <transition name="slide-fade">
    <div v-if="visible" class="peer-notification" @click="handleClick">
      <div class="notification-content">
        <el-icon :size="20" color="#67c23a"><ChatDotRound /></el-icon>
        <span class="notification-text">💬 同伴想和你讨论一下这个知识点</span>
      </div>
      <el-button text size="small" class="close-btn" @click.stop="close">
        <el-icon><Close /></el-icon>
      </el-button>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { ChatDotRound, Close } from '@element-plus/icons-vue';

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  click: [];
  close: [];
}>();

const handleClick = () => {
  emit('click');
};

const close = () => {
  emit('close');
};
</script>

<style scoped>
.peer-notification {
  position: fixed;
  bottom: 24px;
  right: 24px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background-color: #ffffff;
  border: 1px solid #e4e7ed;
  border-radius: 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  cursor: pointer;
  z-index: 9999;
  transition: all 0.3s ease;
}

.peer-notification:hover {
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15);
  transform: translateY(-2px);
}

.notification-content {
  display: flex;
  align-items: center;
  gap: 8px;
}

.notification-text {
  font-size: 14px;
  color: #303133;
  font-weight: 500;
}

.close-btn {
  color: #909399;
}

.close-btn:hover {
  color: #303133;
}

.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.3s ease;
}

.slide-fade-enter-from {
  transform: translateX(100%);
  opacity: 0;
}

.slide-fade-leave-to {
  transform: translateX(100%);
  opacity: 0;
}
</style>
