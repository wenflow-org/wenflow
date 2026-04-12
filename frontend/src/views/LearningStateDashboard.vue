<template>
  <div class="learning-state-dashboard">
    <!-- 顶部状态卡片 -->
    <div class="state-cards-row">
      <!-- 认知深度卡片 -->
      <div class="state-card cognitive">
        <div class="state-card-header">
          <div class="state-icon">
            <el-icon><Lightning /></el-icon>
          </div>
          <span class="state-label">认知深度</span>
        </div>
        <div class="state-card-body">
          <div class="state-value">{{ (state?.cognitive * 100).toFixed(0) }}%</div>
          <div class="state-bar">
            <div class="state-bar-fill cognitive" :style="{ width: (state?.cognitive * 100) + '%' }"></div>
          </div>
          <div class="state-desc">
            {{ getCognitiveLevel(state?.cognitive) }}
          </div>
        </div>
      </div>

      <!-- 压力程度卡片 -->
      <div class="state-card stress">
        <div class="state-card-header">
          <div class="state-icon">
            <el-icon><Sunny /></el-icon>
          </div>
          <span class="state-label">压力程度</span>
        </div>
        <div class="state-card-body">
          <div class="state-value">{{ (state?.stress * 100).toFixed(0) }}%</div>
          <div class="state-bar">
            <div class="state-bar-fill stress" :style="{ width: (state?.stress * 100) + '%' }"></div>
          </div>
          <div class="state-desc">
            {{ getStressLevel(state?.stress) }}
          </div>
        </div>
      </div>

      <!-- 投入程度卡片 -->
      <div class="state-card engagement">
        <div class="state-card-header">
          <div class="state-icon">
            <el-icon><Star /></el-icon>
          </div>
          <span class="state-label">投入程度</span>
        </div>
        <div class="state-card-body">
          <div class="state-value">{{ (state?.engagement * 100).toFixed(0) }}%</div>
          <div class="state-bar">
            <div class="state-bar-fill engagement" :style="{ width: (state?.engagement * 100) + '%' }"></div>
          </div>
          <div class="state-desc">
            {{ getEngagementLevel(state?.engagement) }}
          </div>
        </div>
      </div>

      <!-- 异常状态卡片 -->
      <div class="state-card anomaly" :class="{ 'anomaly-active': state?.anomaly }">
        <div class="state-card-header">
          <div class="state-icon">
            <el-icon><Warning /></el-icon>
          </div>
          <span class="state-label">状态检测</span>
        </div>
        <div class="state-card-body">
          <div class="state-value" :class="{ 'text-warning': state?.anomaly }">
            {{ state?.anomaly ? '异常' : '正常' }}
          </div>
          <div class="state-desc">
            {{ state?.anomalyReason || '状态良好' }}
          </div>
        </div>
      </div>
    </div>

    <!-- AI 洞察和建议 -->
    <div class="ai-insight-section glass-card" v-if="state?.intervention">
      <div class="insight-header">
        <el-icon><ChatDotRound /></el-icon>
        <span class="insight-title">AI 洞察</span>
      </div>
      <div class="insight-content">
        {{ state.intervention }}
      </div>
    </div>

    <!-- 个人基线对比 -->
    <div class="baseline-section glass-card" v-if="baseline">
      <div class="section-header">
        <h3 class="section-title">
          <el-icon><TrendCharts /></el-icon>
          个人基线对比
        </h3>
        <el-tag :type="baseline.isStable ? 'success' : 'warning'" size="small">
          {{ baseline.isStable ? '基线稳定' : '基线建立中' }}
        </el-tag>
      </div>

      <div class="baseline-grid">
        <!-- 响应时间 -->
        <div class="baseline-item">
          <div class="baseline-label">
            <span class="label-icon">⏱️</span>
            <span>响应时间</span>
          </div>
          <div class="baseline-values">
            <div class="value-row">
              <span class="value-label">当前基线：</span>
              <span class="value-number">{{ baseline.current.responseTime.ema.toFixed(1) }}秒</span>
            </div>
            <div class="value-row">
              <span class="value-label">波动范围：</span>
              <span class="value-number">±{{ Math.sqrt(baseline.current.responseTime.emVar).toFixed(1) }}秒</span>
            </div>
          </div>
        </div>

        <!-- 消息长度 -->
        <div class="baseline-item">
          <div class="baseline-label">
            <span class="label-icon">📝</span>
            <span>消息长度</span>
          </div>
          <div class="baseline-values">
            <div class="value-row">
              <span class="value-label">当前基线：</span>
              <span class="value-number">{{ baseline.current.messageLength.ema.toFixed(0) }}字</span>
            </div>
            <div class="value-row">
              <span class="value-label">波动范围：</span>
              <span class="value-number">±{{ Math.sqrt(baseline.current.messageLength.emVar).toFixed(0) }}字</span>
            </div>
          </div>
        </div>

        <!-- 互动间隔 -->
        <div class="baseline-item">
          <div class="baseline-label">
            <span class="label-icon">🔄</span>
            <span>互动间隔</span>
          </div>
          <div class="baseline-values">
            <div class="value-row">
              <span class="value-label">当前基线：</span>
              <span class="value-number">{{ baseline.current.interactionInterval.ema.toFixed(1) }}分钟</span>
            </div>
            <div class="value-row">
              <span class="value-label">波动范围：</span>
              <span class="value-number">±{{ Math.sqrt(baseline.current.interactionInterval.emVar).toFixed(1) }}分钟</span>
            </div>
          </div>
        </div>

        <!-- AI 评分 -->
        <div class="baseline-item">
          <div class="baseline-label">
            <span class="label-icon">⭐</span>
            <span>AI 评分</span>
          </div>
          <div class="baseline-values">
            <div class="value-row">
              <span class="value-label">当前基线：</span>
              <span class="value-number">{{ (baseline.current.aiScore.ema * 100).toFixed(0) }}%</span>
            </div>
            <div class="value-row">
              <span class="value-label">波动范围：</span>
              <span class="value-number">±{{ (Math.sqrt(baseline.current.aiScore.emVar) * 100).toFixed(0) }}%</span>
            </div>
          </div>
        </div>
      </div>

      <div class="baseline-footer">
        <el-progress 
          :percentage="Math.round(baseline.confidence * 100)" 
          :format="formatConfidence"
          :stroke-width="8"
          :show-text="false"
        />
        <p class="confidence-text">
          基线置信度：{{ (baseline.confidence * 100).toFixed(0) }}%
          <el-tooltip content="基于数据量计算，数据越多置信度越高">
            <el-icon class="tooltip-icon"><QuestionFilled /></el-icon>
          </el-tooltip>
        </p>
      </div>
    </div>

    <!-- 学习会话列表 -->
    <div class="sessions-section glass-card" v-if="sessions && sessions.length > 0">
      <div class="section-header">
        <h3 class="section-title">
          <el-icon><Document /></el-icon>
          最近学习会话
        </h3>
      </div>

      <div class="sessions-list">
        <div 
          class="session-item" 
          v-for="session in sessions" 
          :key="session.id"
          @click="viewSessionDetail(session.id)"
        >
          <div class="session-left">
            <div class="session-time">
              {{ formatSessionTime(session.updatedAt) }}
            </div>
            <div class="session-message-count">
              <el-icon><ChatLineRound /></el-icon>
              {{ session.messages?.length || 0 }} 条消息
            </div>
          </div>
          <div class="session-right">
            <div class="session-state" v-if="session.state">
              <el-tag :type="getStateTagType(session.state.cognitive)" size="small">
                认知：{{ (session.state.cognitive * 100).toFixed(0) }}%
              </el-tag>
            </div>
            <el-icon class="session-arrow"><ArrowRight /></el-icon>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { adminApi } from '../api/adminApi';
import { ElMessage } from 'element-plus';
import {
  Lightning,
  Sunny,
  Star,
  Warning,
  ChatDotRound,
  TrendCharts,
  QuestionFilled,
  Document,
  ChatLineRound,
  ArrowRight
} from '@element-plus/icons-vue';

// 状态数据
const state = ref<{
  cognitive: number;
  stress: number;
  engagement: number;
  anomaly: boolean;
  anomalyReason?: string;
  intervention?: string;
  assessedAt: string;
} | null>(null);

const baseline = ref<{
  current: {
    responseTime: { ema: number; emVar: number };
    messageLength: { ema: number; emVar: number };
    interactionInterval: { ema: number; emVar: number };
    aiScore: { ema: number; emVar: number };
  };
  isStable: boolean;
  confidence: number;
} | null>(null);

const sessions = ref<Array<{
  id: string;
  updatedAt: string;
  messages?: any[];
  state?: any;
}>>([]);

// 获取用户 ID（从 localStorage 或 store）
const getUserId = () => {
  const userStr = localStorage.getItem('user');
  if (userStr) {
    const user = JSON.parse(userStr);
    return user.id || user.userId;
  }
  return null;
};

const userId = computed(() => getUserId());

// 加载数据
const loadState = async () => {
  try {
    // 这里可以调用 API 获取最新状态
    // 暂时使用示例数据
    state.value = {
      cognitive: 0.7,
      stress: 0.3,
      engagement: 0.8,
      anomaly: false,
      anomalyReason: '',
      intervention: '你现在的状态很好！认知深度高，压力适中，继续保持这个节奏。',
      assessedAt: new Date().toISOString()
    };
  } catch (error: any) {
    console.error('加载状态失败:', error);
  }
};

const loadBaseline = async () => {
  try {
    if (!userId.value) return;
    
    const response: any = await adminApi.getStudentBaseline(userId.value);
    baseline.value = response.data.data;
  } catch (error: any) {
    console.error('加载基线失败:', error);
  }
};

const loadSessions = async () => {
  try {
    // 这里可以调用 API 获取会话列表
    // 暂时使用示例数据
    sessions.value = [];
  } catch (error: any) {
    console.error('加载会话失败:', error);
  }
};

// 格式化函数
const getCognitiveLevel = (cognitive?: number) => {
  if (!cognitive) return '未知';
  if (cognitive >= 0.7) return '深度思考';
  if (cognitive >= 0.4) return '中等思考';
  return '浅层思考';
};

const getStressLevel = (stress?: number) => {
  if (!stress) return '未知';
  if (stress >= 0.7) return '高压力';
  if (stress >= 0.4) return '适中';
  return '放松';
};

const getEngagementLevel = (engagement?: number) => {
  if (!engagement) return '未知';
  if (engagement >= 0.7) return '高度投入';
  if (engagement >= 0.4) return '正常参与';
  return '参与度低';
};

const formatConfidence = (percent: number) => `${percent}%`;

const formatSessionTime = (timeStr: string) => {
  const date = new Date(timeStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  return `${days}天前`;
};

const getStateTagType = (cognitive: number) => {
  if (cognitive >= 0.7) return 'success';
  if (cognitive >= 0.4) return 'warning';
  return 'info';
};

const viewSessionDetail = (sessionId: string) => {
  // TODO: 实现会话详情查看
  ElMessage.info('会话详情功能开发中...');
};

onMounted(() => {
  loadState();
  loadBaseline();
  loadSessions();
});
</script>

<style scoped lang="scss">
.learning-state-dashboard {
  padding: 20px;
  max-width: 1400px;
  margin: 0 auto;
}

.state-cards-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 20px;
  margin-bottom: 20px;
}

.state-card {
  background: var(--bg-surface);
  border-radius: 12px;
  padding: 20px;
  box-shadow: var(--shadow-sm);
  transition: all var(--transition-normal);
  border: 1px solid var(--border-default);

  &:hover {
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
  }

  &.anomaly.anomaly-active {
    border: 2px solid var(--color-danger);
    background: var(--color-danger-bg);
  }
}

.state-card-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 15px;
}

.state-icon {
  font-size: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  background: var(--color-primary);
  color: var(--text-inverse);

  .state-card.cognitive & {
    background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
  }

  .state-card.stress & {
    background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
  }

  .state-card.engagement & {
    background: linear-gradient(135deg, var(--color-success) 0%, #38f9d7 100%);
  }

  .state-card.anomaly & {
    background: linear-gradient(135deg, #fa709a 0%, var(--color-accent) 100%);
  }
}

.state-label {
  font-size: 14px;
  color: var(--text-secondary);
  font-weight: 500;
}

.state-card-body {
  .state-value {
    font-size: 32px;
    font-weight: bold;
    color: var(--text-primary);
    margin-bottom: 10px;

    &.text-warning {
      color: var(--color-danger);
    }
  }

  .state-bar {
    height: 8px;
    background: var(--bg-muted);
    border-radius: 4px;
    overflow: hidden;
    margin-bottom: 10px;

    .state-bar-fill {
      height: 100%;
      transition: width 0.5s ease;

      &.cognitive {
        background: linear-gradient(90deg, #f093fb 0%, #f5576c 100%);
      }

      &.stress {
        background: linear-gradient(90deg, #4facfe 0%, #00f2fe 100%);
      }

      &.engagement {
        background: linear-gradient(90deg, var(--color-success) 0%, #38f9d7 100%);
      }
    }
  }

  .state-desc {
    font-size: 13px;
    color: var(--text-secondary);
  }
}

.glass-card {
  background: var(--bg-surface);
  border-radius: 12px;
  padding: 20px;
  box-shadow: var(--shadow-sm);
  margin-bottom: 20px;
  border: 1px solid var(--border-default);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;

  .section-title {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary);
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
  }
}

.ai-insight-section {
  .insight-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 15px;
    font-size: 16px;
    font-weight: 600;
    color: var(--color-primary);
  }

  .insight-content {
    font-size: 15px;
    line-height: 1.6;
    color: var(--text-secondary);
    padding: 15px;
    background: var(--bg-muted);
    border-radius: 8px;
    border-left: 4px solid var(--color-primary);
  }
}

.baseline-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 20px;
}

.baseline-item {
  padding: 15px;
  background: var(--bg-muted);
  border-radius: 8px;
}

.baseline-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);

  .label-icon {
    font-size: 18px;
  }
}

.baseline-values {
  .value-row {
    display: flex;
    justify-content: space-between;
    padding: 5px 0;
    font-size: 13px;

    .value-label {
      color: var(--text-secondary);
    }

    .value-number {
      color: var(--text-primary);
      font-weight: 500;
    }
  }
}

.baseline-footer {
  margin-top: 20px;
  text-align: center;

  .confidence-text {
    margin-top: 10px;
    font-size: 14px;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;

    .tooltip-icon {
      cursor: pointer;
      color: var(--text-muted);
    }
  }
}

.sessions-list {
  .session-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 15px;
    border-radius: 8px;
    cursor: pointer;
    transition: all var(--transition-fast);

    &:hover {
      background: var(--bg-hover);
    }

    .session-left {
      display: flex;
      gap: 15px;
      align-items: center;

      .session-time {
        font-size: 14px;
        color: var(--text-primary);
        font-weight: 500;
      }

      .session-message-count {
        display: flex;
        align-items: center;
        gap: 5px;
        font-size: 13px;
        color: var(--text-secondary);
      }
    }

    .session-right {
      display: flex;
      align-items: center;
      gap: 10px;

      .session-arrow {
        color: var(--text-muted);
      }
    }
  }
}

[data-theme="dark"] {
  .state-card {
    background: var(--bg-elevated);
  }

  .state-icon {
    .state-card.cognitive & {
      background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
    }

    .state-card.stress & {
      background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
    }

    .state-card.engagement & {
      background: linear-gradient(135deg, var(--color-success) 0%, #38f9d7 100%);
    }

    .state-card.anomaly & {
      background: linear-gradient(135deg, #fa709a 0%, var(--color-accent) 100%);
    }
  }

  .glass-card {
    background: var(--bg-elevated);
  }

  .ai-insight-section {
    .insight-content {
      background: var(--bg-muted);
    }
  }

  .baseline-item {
    background: var(--bg-muted);
  }
}
</style>
