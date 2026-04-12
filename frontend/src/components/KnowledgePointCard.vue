<template>
  <div class="knowledge-point-card">
    <div class="kp-header">
      <el-icon><Collection /></el-icon>
      <span class="kp-label">知识点</span>
      <el-tag size="small" :type="statusType">{{ statusText }}</el-tag>
    </div>
    <div class="kp-title">{{ knowledgePoint }}</div>
    <div class="kp-actions">
      <el-button type="primary" size="small" @click="handleAction('mastered')">
        <el-icon><Check /></el-icon>
        已掌握，继续
      </el-button>
      <el-button type="warning" plain size="small" @click="handleAction('need-more')">
        <el-icon><QuestionFilled /></el-icon>
        没懂，再讲一遍
      </el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Collection, Check, QuestionFilled, VideoPause } from '@element-plus/icons-vue';

const props = defineProps<{
  knowledgePoint: string;
  status?: 'new' | 'learning' | 'mastered';
}>();

const emit = defineEmits<{
  action: [action: 'mastered' | 'need-more'];
}>();

const statusText = computed(() => {
  const map = { new: '新知识点', learning: '学习中', mastered: '已掌握' };
  return map[props.status || 'new'];
});

const statusType = computed(() => {
  const map = { new: 'info', learning: 'warning', mastered: 'success' };
  return map[props.status || 'new'];
});

const handleAction = (action: 'mastered' | 'need-more') => {
  emit('action', action);
};
</script>

<style scoped>
.knowledge-point-card {
  margin-top: 12px;
  padding: 12px 16px;
  background-color: #ffffff;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.kp-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: 12px;
  color: #909399;
}

.kp-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 12px;
}

.kp-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.kp-actions .el-button--warning.is-plain {
  color: #ffffff;
  border-color: #e6a23c;
  background-color: #e6a23c;
}

.kp-actions .el-button--warning.is-plain:hover,
.kp-actions .el-button--warning.is-plain:focus {
  color: #ffffff;
  background-color: #d97706;
  border-color: #d97706;
}

.kp-actions .el-button--info.is-plain {
  color: #475569;
  border-color: #cbd5e1;
  background-color: #f8fafc;
}

.kp-actions .el-button--info.is-plain:hover,
.kp-actions .el-button--info.is-plain:focus {
  color: #ffffff;
  background-color: #475569;
  border-color: #475569;
}
</style>
