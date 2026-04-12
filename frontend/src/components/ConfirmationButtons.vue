<template>
  <div class="confirmation-buttons">
    <el-button-group>
      <el-button size="small" @click="handleAction('understood')">
        <el-icon><Check /></el-icon>
        理解了
      </el-button>
      <el-button size="small" type="warning" @click="handleAction('need-more')">
        <el-icon><QuestionFilled /></el-icon>
        换种说法
      </el-button>
      <el-button size="small" type="info" @click="handleAction('give-example')">
        <el-icon><MagicStick /></el-icon>
        举个例子
      </el-button>
      <el-button size="small" type="success" @click="handleAction('review')">
        <el-icon><RefreshLeft /></el-icon>
        快速复习
      </el-button>
    </el-button-group>
  </div>
</template>

<script setup lang="ts">
import { Check, QuestionFilled, MagicStick, RefreshLeft } from '@element-plus/icons-vue';

const emit = defineEmits<{
  action: [action: 'understood' | 'need-more' | 'give-example' | 'review'];
}>();

const handleAction = (action: 'understood' | 'need-more' | 'give-example' | 'review') => {
  emit('action', action);
};
</script>

<style scoped>
.confirmation-buttons {
  display: flex;
  justify-content: flex-start;
  margin-top: 8px;
  padding-left: 48px;
}

.confirmation-buttons .el-button {
  font-size: 12px;
  padding: 4px 12px;
  height: 28px;
}
</style>
