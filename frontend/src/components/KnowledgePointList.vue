<template>
  <el-card class="knowledge-point-list">
    <template #header>
      <div class="card-header">
        <el-icon><Collection /></el-icon>
        <span>知识点进度</span>
      </div>
    </template>

    <div v-if="knowledgePoints.length === 0" class="empty-kp">
      <el-icon :size="24" color="#c0c4cc"><Document /></el-icon>
      <p>知识点将在授课过程中自动识别</p>
    </div>

    <div v-else class="kp-list">
      <div
        v-for="(kp, index) in knowledgePoints"
        :key="index"
        class="kp-item"
      >
        <div class="kp-icon">
          <el-tooltip v-if="kp.status === 'mastered'" content="已掌握" placement="top" :show-after="300">
            <el-icon color="#67c23a" :size="16"><Select /></el-icon>
          </el-tooltip>
          <el-tooltip v-else-if="kp.status === 'learning'" :content="`学习中 (${kp.progress}%)`" placement="top" :show-after="300">
            <el-icon color="#e6a23c" :size="16"><Loading /></el-icon>
          </el-tooltip>
          <el-tooltip v-else-if="kp.status === 'review'" content="需要复习" placement="top" :show-after="300">
            <el-icon color="#f56c6c" :size="16"><WarningFilled /></el-icon>
          </el-tooltip>
          <el-tooltip v-else content="未开始" placement="top" :show-after="300">
            <div class="kp-dot pending"></div>
          </el-tooltip>
        </div>
        <div class="kp-info">
          <span class="kp-name">{{ kp.name }}</span>
          <span v-if="kp.status === 'learning'" class="kp-progress-text">{{ kp.progress }}%</span>
        </div>
        <div v-if="kp.status === 'learning'" class="kp-bar">
          <el-progress
            :percentage="kp.progress"
            :stroke-width="4"
            :show-text="false"
            color="#e6a23c"
          />
        </div>
      </div>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { Collection, Document, Select, Loading, WarningFilled } from '@element-plus/icons-vue';
import type { KnowledgePointStatus } from '@/api/aiTeaching';

defineProps<{
  knowledgePoints: KnowledgePointStatus[];
}>();
</script>

<style scoped>
.knowledge-point-list {
  flex-shrink: 0;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
  color: #303133;
}

.empty-kp {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px 0;
  color: #909399;
  font-size: 12px;
  text-align: center;
}

.kp-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.kp-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
}

.kp-icon {
  flex-shrink: 0;
  width: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.kp-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #c0c4cc;
}

.kp-info {
  flex: 1;
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-width: 0;
}

.kp-name {
  font-size: 13px;
  color: #303133;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.kp-progress-text {
  font-size: 11px;
  color: #e6a23c;
  flex-shrink: 0;
  margin-left: 8px;
}

.kp-bar {
  width: 60px;
  flex-shrink: 0;
}
</style>
