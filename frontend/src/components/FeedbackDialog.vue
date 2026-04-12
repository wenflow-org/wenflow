<template>
  <el-dialog v-model="visible" title="学习反馈" width="500px" :close-on-click-modal="false">
    <div class="feedback-form">
      <!-- 总体评分 -->
      <div class="feedback-section">
        <label class="feedback-label">总体评分 <span class="required">*</span></label>
        <el-rate 
          v-model="form.rating" 
          :colors="['#99A9BF', '#F7BA2A', '#FF9900']"
          :texts="['很差', '较差', '一般', '较好', '很好']"
          show-text
        />
      </div>
      
      <!-- 维度评分 -->
      <div class="feedback-section">
        <label class="feedback-label">内容是否有帮助？</label>
        <el-rate 
          v-model="form.helpfulness" 
          :colors="['#99A9BF', '#F7BA2A', '#FF9900']"
          :texts="['没帮助', '较少', '一般', '较有帮助', '很有帮助']"
          show-text
        />
      </div>
      
      <div class="feedback-section">
        <label class="feedback-label">讲解是否清晰？</label>
        <el-rate 
          v-model="form.clarity" 
          :colors="['#99A9BF', '#F7BA2A', '#FF9900']"
          :texts="['混乱', '较混乱', '一般', '清晰', '很清晰']"
          show-text
        />
      </div>
      
      <div class="feedback-section">
        <label class="feedback-label">难度感知</label>
        <el-rate 
          v-model="form.difficulty" 
          :colors="['#409EFF', '#67C23A', '#E6A23C', '#F56C6C', '#F56C6C']"
          :texts="['简单', '较简单', '适中', '较难', '困难']"
          show-text
        />
        <span class="feedback-hint">1=简单，3=适中，5=困难</span>
      </div>
      
      <!-- 文本反馈 -->
      <div class="feedback-section">
        <label class="feedback-label">具体反馈（可选）</label>
        <el-input
          v-model="form.comment"
          type="textarea"
          :rows="3"
          placeholder="请分享你的学习感受，比如：哪些地方做得好，哪些地方需要改进..."
          maxlength="500"
          show-word-limit
        />
      </div>
      
      <div class="feedback-section">
        <label class="feedback-label">困惑点（可选）</label>
        <el-input
          v-model="form.confusionPoint"
          type="textarea"
          :rows="2"
          placeholder="哪个地方让你感到困惑？我们会重点优化这些内容。"
          maxlength="300"
          show-word-limit
        />
      </div>
      
      <div class="feedback-section">
        <label class="feedback-label">改进建议（可选）</label>
        <el-input
          v-model="form.suggestions"
          type="textarea"
          :rows="2"
          placeholder="有什么改进建议吗？你的意见对我们很重要！"
          maxlength="300"
          show-word-limit
        />
      </div>
    </div>
    
    <template #footer>
      <div class="dialog-footer">
        <el-button @click="visible = false">取消</el-button>
        <el-button 
          type="primary" 
          @click="submitFeedback" 
          :loading="submitting"
        >
          提交反馈
        </el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue';
import { ElMessage } from 'element-plus';
import { feedbackApi } from '@/api/feedback';

const props = defineProps<{
  sessionId: string;
  taskId: string;
  strategy?: string;
  uiType?: string;
  roundNumber?: number;
}>();

const emit = defineEmits<{
  (e: 'submitted'): void;
}>();

const visible = ref(false);
const submitting = ref(false);

const form = reactive({
  rating: 0,
  helpfulness: 0,
  clarity: 0,
  difficulty: 0,
  comment: '',
  confusionPoint: '',
  suggestions: ''
});

function open() {
  // 重置表单
  form.rating = 0;
  form.helpfulness = 0;
  form.clarity = 0;
  form.difficulty = 0;
  form.comment = '';
  form.confusionPoint = '';
  form.suggestions = '';
  
  visible.value = true;
}

async function submitFeedback() {
  if (form.rating === 0) {
    ElMessage.warning('请给出总体评分');
    return;
  }
  
  submitting.value = true;
  
  try {
    await feedbackApi.submit({
      sessionId: props.sessionId,
      taskId: props.taskId,
      rating: form.rating,
      helpfulness: form.helpfulness || undefined,
      clarity: form.clarity || undefined,
      difficulty: form.difficulty || undefined,
      comment: form.comment || undefined,
      confusionPoint: form.confusionPoint || undefined,
      suggestions: form.suggestions || undefined,
      strategy: props.strategy,
      uiType: props.uiType,
      roundNumber: props.roundNumber
    });
    
    ElMessage.success('感谢你的反馈！帮助我们做得更好 🎉');
    visible.value = false;
    emit('submitted');
  } catch (error) {
    console.error('提交反馈失败:', error);
    ElMessage.error('提交失败，请重试');
  } finally {
    submitting.value = false;
  }
}

defineExpose({ open });
</script>

<style scoped>
.feedback-form {
  padding: 10px 0;
}

.feedback-section {
  margin-bottom: 24px;
}

.feedback-section:last-child {
  margin-bottom: 0;
}

.feedback-label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: #606266;
  margin-bottom: 12px;
}

.required {
  color: #f56c6c;
  margin-left: 2px;
}

.feedback-hint {
  display: block;
  font-size: 12px;
  color: #909399;
  margin-top: 8px;
}

:deep(.el-rate) {
  margin-top: 8px;
}

:deep(.el-rate__text) {
  font-size: 12px;
  margin-left: 8px;
}

:deep(.el-textarea__inner) {
  resize: vertical;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}
</style>
