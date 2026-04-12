<template>
  <el-dialog
    v-model="visible"
    title=""
    width="520px"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    class="rating-dialog"
    @close="handleClose"
  >
    <div class="rating-content">
      <!-- 完成提示 -->
      <div class="completion-header">
        <div class="success-icon">🎉</div>
        <h2>学习完成！</h2>
        <p class="duration-info">本次学习时长：<strong>{{ formatDuration(duration) }}</strong></p>
        <p class="tip-text">请回答以下几个问题，帮助我们优化你的学习计划：</p>
      </div>

      <!-- 评分项 -->
      <div class="rating-items">
        <!-- 任务难度 -->
        <div class="rating-item">
          <div class="item-header">
            <span class="item-number">1</span>
            <span class="item-title">任务难度</span>
          </div>
          <p class="item-desc">这个任务对你来说有多难？</p>
          <div class="slider-container">
            <el-slider
              v-model="ratings.difficulty"
              :min="1"
              :max="10"
              :step="1"
              :marks="difficultyMarks"
              show-stops
            />
          </div>
          <div class="value-display">
            <span class="current-value" :class="getValueClass(ratings.difficulty)">
              {{ ratings.difficulty }}
            </span>
            <span class="value-label">{{ getDifficultyLabel(ratings.difficulty) }}</span>
          </div>
        </div>

        <!-- 认知负荷 -->
        <div class="rating-item">
          <div class="item-header">
            <span class="item-number">2</span>
            <span class="item-title">认知负荷</span>
          </div>
          <p class="item-desc">你感觉今天的脑力消耗是多少？</p>
          <div class="slider-container">
            <el-slider
              v-model="ratings.cognitiveLoad"
              :min="1"
              :max="10"
              :step="1"
              :marks="cognitiveMarks"
              show-stops
            />
          </div>
          <div class="value-display">
            <span class="current-value" :class="getValueClass(ratings.cognitiveLoad)">
              {{ ratings.cognitiveLoad }}
            </span>
            <span class="value-label">{{ getCognitiveLabel(ratings.cognitiveLoad) }}</span>
          </div>
        </div>

        <!-- 学习效率 -->
        <div class="rating-item">
          <div class="item-header">
            <span class="item-number">3</span>
            <span class="item-title">学习效率</span>
          </div>
          <p class="item-desc">你觉得今天的学习效果如何？</p>
          <div class="slider-container">
            <el-slider
              v-model="ratings.effectiveness"
              :min="1"
              :max="10"
              :step="1"
              :marks="effectivenessMarks"
              show-stops
            />
          </div>
          <div class="value-display">
            <span class="current-value" :class="getValueClass(ratings.effectiveness, true)">
              {{ ratings.effectiveness }}
            </span>
            <span class="value-label">{{ getEffectivenessLabel(ratings.effectiveness) }}</span>
          </div>
        </div>

        <!-- 备注 -->
        <div class="rating-item notes-item">
          <div class="item-header">
            <span class="item-number">📝</span>
            <span class="item-title">备注（可选）</span>
          </div>
          <el-input
            v-model="ratings.notes"
            type="textarea"
            :rows="3"
            placeholder="有什么特别想记录的吗？"
            resize="none"
          />
        </div>
      </div>

      <!-- 预估LSS显示 -->
      <div class="lss-preview">
        <span class="lss-label">预估学习压力 (LSS)：</span>
        <span class="lss-value" :class="getLSSClass()">
          {{ estimatedLSS.toFixed(1) }}
        </span>
      </div>
    </div>

    <template #footer>
      <div class="dialog-footer">
        <el-button @click="handleSkip" class="skip-btn">跳过本次</el-button>
        <el-button type="primary" @click="handleSubmit" class="submit-btn">
          提交评分
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { ElMessage } from 'element-plus';

interface RatingData {
  difficulty: number;
  cognitiveLoad: number;
  effectiveness: number;
  notes: string;
}

interface Props {
  modelValue: boolean;
  duration: number; // 学习时长（分钟）
  taskId?: string;
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void;
  (e: 'submit', data: RatingData): void;
  (e: 'skip'): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const visible = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
});

const ratings = ref<RatingData>({
  difficulty: 5,
  cognitiveLoad: 5,
  effectiveness: 5,
  notes: '',
});

// 滑块标记
const difficultyMarks = {
  1: '太容易',
  5: '适中',
  10: '太难',
};

const cognitiveMarks = {
  1: '轻松',
  5: '一般',
  10: '很累',
};

const effectivenessMarks = {
  1: '很差',
  5: '一般',
  10: '很好',
};

// 计算预估LSS
const estimatedLSS = computed(() => {
  return (
    ratings.value.difficulty * 0.3 +
    ratings.value.cognitiveLoad * 0.3 +
    ratings.value.effectiveness * 0.4
  );
});

// 格式化时长
const formatDuration = (minutes: number) => {
  if (minutes < 60) {
    return `${minutes} 分钟`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours} 小时 ${mins} 分钟` : `${hours} 小时`;
};

// 获取难度标签
const getDifficultyLabel = (value: number) => {
  if (value <= 3) return '比较轻松';
  if (value <= 6) return '难度适中';
  if (value <= 8) return '有一定挑战';
  return '非常困难';
};

// 获取认知负荷标签
const getCognitiveLabel = (value: number) => {
  if (value <= 3) return '精力充沛';
  if (value <= 6) return '正常消耗';
  if (value <= 8) return '比较疲惫';
  return '精力耗尽';
};

// 获取效率标签
const getEffectivenessLabel = (value: number) => {
  if (value <= 3) return '效果不佳';
  if (value <= 6) return '效果一般';
  if (value <= 8) return '效果不错';
  return '收获满满';
};

// 获取值样式类
const getValueClass = (value: number, inverse = false) => {
  if (inverse) {
    // 效率高是好事
    if (value <= 3) return 'value-low';
    if (value <= 6) return 'value-medium';
    return 'value-high';
  }
  // 难度和负荷低是好事
  if (value <= 3) return 'value-high';
  if (value <= 6) return 'value-medium';
  return 'value-low';
};

// 获取LSS样式类
const getLSSClass = () => {
  const lss = estimatedLSS.value;
  if (lss < 4) return 'lss-low';
  if (lss < 7) return 'lss-medium';
  return 'lss-high';
};

// 重置评分
const resetRatings = () => {
  ratings.value = {
    difficulty: 5,
    cognitiveLoad: 5,
    effectiveness: 5,
    notes: '',
  };
};

// 提交
const handleSubmit = () => {
  emit('submit', { ...ratings.value });
  ElMessage.success('评分已提交，感谢反馈！');
  visible.value = false;
  resetRatings();
};

// 跳过
const handleSkip = () => {
  emit('skip');
  visible.value = false;
  resetRatings();
};

// 关闭
const handleClose = () => {
  resetRatings();
};

// 监听弹窗打开，重置评分
watch(visible, (val) => {
  if (val) {
    resetRatings();
  }
});
</script>

<style scoped>
.rating-dialog :deep(.el-dialog__header) {
  display: none;
}

.rating-dialog :deep(.el-dialog__body) {
  padding: 24px 28px 12px;
}

.rating-content {
  text-align: center;
}

.completion-header {
  margin-bottom: 28px;
}

.success-icon {
  font-size: 48px;
  margin-bottom: 12px;
  animation: bounce 0.6s ease;
}

@keyframes bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}

.completion-header h2 {
  margin: 0 0 8px 0;
  font-size: 24px;
  color: #1f2937;
  background: linear-gradient(135deg, #667eea, #764ba2);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.duration-info {
  font-size: 16px;
  color: #4b5563;
  margin: 0 0 8px 0;
}

.duration-info strong {
  color: #667eea;
}

.tip-text {
  font-size: 14px;
  color: #6b7280;
  margin: 0;
}

.rating-items {
  text-align: left;
}

.rating-item {
  padding: 16px 0;
  border-bottom: 1px solid #f3f4f6;
}

.rating-item:last-of-type {
  border-bottom: none;
}

.item-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}

.item-number {
  width: 24px;
  height: 24px;
  background: linear-gradient(135deg, #667eea, #764ba2);
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
}

.item-title {
  font-size: 15px;
  font-weight: 600;
  color: #374151;
}

.item-desc {
  font-size: 13px;
  color: #6b7280;
  margin: 0 0 12px 34px;
}

.slider-container {
  padding: 0 20px 0 34px;
}

.slider-container :deep(.el-slider__runway) {
  height: 8px;
  background: linear-gradient(to right, #10b981, #f59e0b, #ef4444);
  border-radius: 4px;
}

.slider-container :deep(.el-slider__bar) {
  height: 8px;
  background: transparent;
}

.slider-container :deep(.el-slider__button) {
  width: 20px;
  height: 20px;
  border: 3px solid #667eea;
  background: white;
}

.slider-container :deep(.el-slider__marks-text) {
  font-size: 11px;
  color: #9ca3af;
}

.value-display {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
  padding-left: 34px;
}

.current-value {
  font-size: 20px;
  font-weight: 700;
}

.value-high {
  color: #10b981;
}

.value-medium {
  color: #f59e0b;
}

.value-low {
  color: #ef4444;
}

.value-label {
  font-size: 13px;
  color: #6b7280;
}

.notes-item .item-number {
  width: auto;
  padding: 0 8px;
  border-radius: 12px;
  font-size: 14px;
}

.notes-item :deep(.el-textarea__inner) {
  border-radius: 8px;
  border-color: #e5e7eb;
  margin-left: 34px;
  width: calc(100% - 34px);
}

.notes-item :deep(.el-textarea__inner:focus) {
  border-color: #667eea;
}

.lss-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 20px;
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.05), rgba(118, 75, 162, 0.05));
  border-radius: 12px;
  margin-top: 8px;
}

.lss-label {
  font-size: 14px;
  color: #4b5563;
}

.lss-value {
  font-size: 22px;
  font-weight: 700;
}

.lss-low {
  color: #10b981;
}

.lss-medium {
  color: #f59e0b;
}

.lss-high {
  color: #ef4444;
}

.dialog-footer {
  display: flex;
  justify-content: center;
  gap: 16px;
  padding-top: 8px;
}

.skip-btn {
  padding: 10px 24px;
  border-radius: 8px;
  border-color: #e5e7eb;
  color: #6b7280;
}

.skip-btn:hover {
  border-color: #667eea;
  color: #667eea;
}

.submit-btn {
  padding: 10px 32px;
  border-radius: 8px;
  background: linear-gradient(135deg, #667eea, #764ba2);
  border: none;
  font-weight: 500;
}

.submit-btn:hover {
  background: linear-gradient(135deg, #5a67d8, #9f4dba);
}
</style>
