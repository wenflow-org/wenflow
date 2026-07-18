<template>
  <div class="kp-card" :class="`kp-card--${props.status || 'new'}`">
    <div class="kp-card__top">
      <div class="kp-card__chip" :class="`kp-card__chip--${props.status || 'new'}`">
        <span class="kp-card__chip-dot" />
        {{ statusText }}
      </div>
      <span class="kp-card__label">当前知识点</span>
    </div>
    <div class="kp-card__title">{{ knowledgePoint }}</div>
    <div class="kp-card__hint">学完后告诉我是否需要换一种方式解释</div>
    <div class="kp-card__actions">
      <button type="button" class="kp-btn kp-btn--primary" @click="handleAction('mastered')">
        <el-icon><Check /></el-icon>
        <span>我懂了，继续</span>
      </button>
      <button type="button" class="kp-btn kp-btn--ghost" @click="handleAction('need-more')">
        <el-icon><QuestionFilled /></el-icon>
        <span>换种方式讲讲</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Check, QuestionFilled } from '@element-plus/icons-vue';

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

const handleAction = (action: 'mastered' | 'need-more') => {
  emit('action', action);
};
</script>

<style scoped>
.kp-card {
  margin-top: 14px;
  padding: 16px 18px 14px;
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  border: 1px solid rgba(15, 23, 42, 0.06);
  border-radius: 16px;
  box-shadow: 0 4px 14px -8px rgba(15, 23, 42, 0.18);
  position: relative;
  overflow: hidden;
}

.kp-card::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: linear-gradient(180deg, #3478f6 0%, #5b9af8 100%);
}

.kp-card--mastered::before {
  background: linear-gradient(180deg, #10b981 0%, #34d399 100%);
}

.kp-card--learning::before {
  background: linear-gradient(180deg, #f59e0b 0%, #fbbf24 100%);
}

.kp-card__top {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.kp-card__chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  background: rgba(52, 120, 246, 0.1);
  color: #2563eb;
  letter-spacing: 0.02em;
}

.kp-card__chip-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
}

.kp-card__chip--mastered {
  background: rgba(16, 185, 129, 0.12);
  color: #047857;
}

.kp-card__chip--learning {
  background: rgba(245, 158, 11, 0.12);
  color: #b45309;
}

.kp-card__label {
  font-size: 12px;
  color: #94a3b8;
  letter-spacing: 0.04em;
}

.kp-card__title {
  font-size: 15px;
  font-weight: 700;
  color: #0f172a;
  line-height: 1.5;
  margin-bottom: 4px;
}

.kp-card__hint {
  font-size: 12px;
  color: #64748b;
  margin-bottom: 14px;
}

.kp-card__actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.kp-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: transform 0.18s ease, box-shadow 0.2s ease, background 0.2s ease;
  border: 1px solid transparent;
  line-height: 1;
}

.kp-btn:active {
  transform: translateY(0);
}

.kp-btn--primary {
  background: linear-gradient(135deg, #3478f6 0%, #2563eb 100%);
  color: #ffffff;
  box-shadow: 0 6px 14px -6px rgba(52, 120, 246, 0.55);
}

.kp-btn--primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 18px -6px rgba(52, 120, 246, 0.65);
}

.kp-btn--ghost {
  background: #ffffff;
  color: #475569;
  border-color: rgba(15, 23, 42, 0.12);
}

.kp-btn--ghost:hover {
  border-color: rgba(52, 120, 246, 0.4);
  color: #2563eb;
  background: rgba(52, 120, 246, 0.04);
  transform: translateY(-1px);
}

.kp-btn .el-icon {
  font-size: 14px;
}
</style>
