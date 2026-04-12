<template>
  <div class="arena-page">
    <!-- 页面头部 -->
    <div class="page-header">
      <div class="header-left">
        <h2 class="page-title">🎭 多智能体演练场</h2>
        <p class="page-subtitle">AI Agents 自动化测试与优化平台</p>
      </div>
      <div class="header-actions">
        <el-button type="primary" @click="showCreateDialog">
          <el-icon><Plus /></el-icon>
          新建演练
        </el-button>
        <el-button @click="showBatchDialog">
          <el-icon><DocumentCopy /></el-icon>
          批量测试
        </el-button>
        <el-button @click="loadSessions">
          <el-icon><Refresh /></el-icon>
          刷新
        </el-button>
      </div>
    </div>

    <!-- 统计卡片 -->
    <div class="stats-row">
      <el-card class="stat-card" shadow="hover">
        <div class="stat-value">{{ stats.totalSessions }}</div>
        <div class="stat-label">总演练数</div>
      </el-card>
      <el-card class="stat-card" shadow="hover">
        <div class="stat-value success">{{ stats.completedSessions }}</div>
        <div class="stat-label">成功完成</div>
      </el-card>
      <el-card class="stat-card" shadow="hover">
        <div class="stat-value danger">{{ stats.failedSessions }}</div>
        <div class="stat-label">失败</div>
      </el-card>
      <el-card class="stat-card" shadow="hover">
        <div class="stat-value">{{ avgScore }}</div>
        <div class="stat-label">平均评分</div>
      </el-card>
    </div>

    <!-- 演练列表 -->
    <el-card class="sessions-card" shadow="hover">
      <template #header>
        <div class="card-header">
          <span class="card-title">📋 演练记录</span>
          <el-radio-group v-model="filterStatus" size="small">
            <el-radio-button label="">全部</el-radio-button>
            <el-radio-button label="running">运行中</el-radio-button>
            <el-radio-button label="completed">已完成</el-radio-button>
            <el-radio-button label="failed">失败</el-radio-button>
          </el-radio-group>
        </div>
      </template>

      <div v-if="loading" class="loading-container">
        <el-skeleton :rows="5" animated />
      </div>

      <div v-else-if="filteredSessions.length === 0" class="empty-state">
        <el-empty description="暂无演练记录">
          <el-button type="primary" @click="showCreateDialog">创建第一个演练</el-button>
        </el-empty>
      </div>

      <div v-else class="session-list">
        <div
          v-for="session in filteredSessions"
          :key="session.id"
          class="session-item"
          @click="goToDetail(session.id)"
        >
          <div class="session-header">
            <div class="session-info">
              <h3 class="session-name">{{ session.name }}</h3>
              <el-tag :type="getStatusType(session.status)" size="small">
                {{ getStatusText(session.status) }}
              </el-tag>
            </div>
            <div class="session-actions">
              <div class="session-score" v-if="session.evaluation">
                <el-progress
                  type="dashboard"
                  :percentage="session.evaluation.overallScore"
                  :color="getScoreColor"
                  :width="60"
                />
              </div>
              <el-button
                type="danger"
                size="small"
                plain
                @click.stop="deleteSession(session)"
              >
                <el-icon><Delete /></el-icon>
                删除
              </el-button>
            </div>
          </div>

          <div class="session-content">
            <div class="persona-preview" v-if="session.persona">
              <span class="label">真问题：</span>
              <span class="value">{{ session.persona.realProblem || '-' }}</span>
            </div>
            <div class="meta-info">
              <span class="meta-item">
                <el-icon><ChatDotRound /></el-icon>
                {{ session._count?.agentLogs || 0 }} 个Agent
              </span>
              <span class="meta-item">
                <el-icon><Timer /></el-icon>
                {{ formatTime(session.createdAt) }}
              </span>
            </div>
          </div>
        </div>

        <!-- 分页 -->
        <div class="pagination-container">
          <el-pagination
            v-model:current-page="pagination.page"
            v-model:page-size="pagination.limit"
            :total="pagination.total"
            :page-sizes="[10, 20, 50]"
            layout="total, sizes, prev, pager, next"
            @size-change="loadSessions"
            @current-change="loadSessions"
          />
        </div>
      </div>
    </el-card>

    <!-- 创建演练对话框 -->
    <el-dialog v-model="createDialogVisible" title="新建演练会话" width="600px">
      <el-form :model="createForm" label-width="120px">
        <el-form-item label="名称">
          <el-input v-model="createForm.name" placeholder="输入演练名称" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input
            v-model="createForm.description"
            type="textarea"
            :rows="3"
            placeholder="描述这次演练的目标"
          />
        </el-form-item>

        <el-form-item label="用户画像">
          <el-radio-group v-model="createForm.personaType">
            <el-radio-button label="auto">自动生成</el-radio-button>
            <el-radio-button label="custom">自定义</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="createForm.personaType === 'custom'" label="画像描述">
          <el-input
            v-model="createForm.personaPrompt"
            type="textarea"
            :rows="4"
            placeholder="描述用户画像，例如：一位30岁的产品经理，每天1小时，想学习数据分析..."
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="createSession">
          开始演练
        </el-button>
      </template>
    </el-dialog>

    <!-- 批量测试对话框 -->
    <el-dialog v-model="batchDialogVisible" title="批量测试" width="700px">
      <el-alert
        title="批量测试会同时运行多个演练会话"
        description="请提供用户画像列表，系统将自动为每个画像创建演练并运行完整流程"
        type="info"
        :closable="false"
        style="margin-bottom: 1rem"
      />
      <el-form :model="batchForm" label-width="100px">
        <el-form-item label="画像列表">
          <el-input
            v-model="batchForm.personasText"
            type="textarea"
            :rows="10"
            placeholder="每行一个画像，格式：表面目标 | 真问题 | 水平 | 时间 | 周期&#10;&#10;例如：&#10;想学Python | 自动化Excel报表 | 初学者 | 1小时/天 | 8周&#10;想学英语 | 外企面试 | 中级 | 2小时/天 | 4周"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="batchDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="batchRunning" @click="runBatch">
          开始批量测试
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Plus, DocumentCopy, Refresh, ChatDotRound, Timer, Delete } from '@element-plus/icons-vue';
import { adminArenaApi } from '@/api/adminApi';

const router = useRouter();

// 状态
const loading = ref(false);
const sessions = ref<any[]>([]);
const filterStatus = ref('');
const stats = reactive({
  totalSessions: 0,
  completedSessions: 0,
  failedSessions: 0,
  avgScore: 0
});

// 分页
const pagination = reactive({
  page: 1,
  limit: 10,
  total: 0
});

// 对话框
const createDialogVisible = ref(false);
const batchDialogVisible = ref(false);
const creating = ref(false);
const batchRunning = ref(false);

// 表单

const createForm = reactive({

  name: '',

  description: '',

  personaType: 'auto',

  personaPrompt: '',

});



// 加载模板列表

const batchForm = reactive({
  personasText: ''
});

// 过滤后的会话
const filteredSessions = computed(() => {
  if (!filterStatus.value) return sessions.value;
  return sessions.value.filter(s => s.status === filterStatus.value);
});

// 平均评分
const avgScore = computed(() => {
  const scores = sessions.value
    .filter(s => s.evaluation?.overallScore)
    .map(s => s.evaluation.overallScore);
  if (scores.length === 0) return '-';
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
});

// 加载演练列表
const loadSessions = async () => {
  loading.value = true;
  try {
    const response: any = await adminArenaApi.getSessions({
      page: pagination.page,
      limit: pagination.limit
    });
    if (response.data.success) {
      sessions.value = response.data.data.sessions;
      pagination.total = response.data.data.pagination.total;
    }
  } catch (error: any) {
    ElMessage.error('加载演练列表失败');
  } finally {
    loading.value = false;
  }
};

// 加载统计
const loadStats = async () => {
  try {
    const response: any = await adminArenaApi.getStats();
    if (response.data.success) {
      stats.totalSessions = response.data.data.totalSessions;
      stats.completedSessions = response.data.data.completedSessions;
      stats.failedSessions = response.data.data.failedSessions;
    }
  } catch (error: any) {
    console.error('加载统计失败:', error);
  }
};

// 创建演练
const createSession = async () => {
  creating.value = true;
  try {
    const config: any = {
      personaType: createForm.personaType,
      personaPrompt: createForm.personaPrompt
    };

    const response: any = await adminArenaApi.createSession({
      name: createForm.name || `演练-${Date.now()}`,
      description: createForm.description,
      config
    });
    if (response.data.success) {
      ElMessage.success('演练会话已创建');
      createDialogVisible.value = false;
      loadSessions();
      // 跳转到详情页
      router.push(`/admin/arena/${response.data.data.id}`);
    }
  } catch (error: any) {
    ElMessage.error('创建失败');
  } finally {
    creating.value = false;
  }
};

// 批量测试
const runBatch = async () => {
  if (!batchForm.personasText.trim()) {
    ElMessage.warning('请输入画像列表');
    return;
  }

  batchRunning.value = true;
  try {
    // 解析画像列表
    const lines = batchForm.personasText.split('\n').filter(line => line.trim());
    const personas = lines.map(line => {
      const parts = line.split('|').map(p => p.trim());
      return {
        surfaceGoal: parts[0] || '',
        realProblem: parts[1] || '',
        level: parts[2] || '初学者',
        timePerDay: parts[3] || '1小时',
        totalWeeks: parts[4] || '8周'
      };
    });

    const response: any = await adminArenaApi.createBatch(personas);
    if (response.data.success) {
      ElMessage.success(`已创建 ${response.data.data.count} 个演练`);
      batchDialogVisible.value = false;
      loadSessions();
    }
  } catch (error: any) {
    ElMessage.error('批量创建失败');
  } finally {
    batchRunning.value = false;
  }
};

// 显示对话框
const showCreateDialog = () => {
  createForm.name = '';
  createForm.description = '';
  createForm.personaType = 'auto';
  createForm.personaPrompt = '';
  createDialogVisible.value = true;
};

const showBatchDialog = () => {
  batchForm.personasText = '';
  batchDialogVisible.value = true;
};

// 跳转详情
const goToDetail = (id: string) => {
  router.push(`/admin/arena/${id}`);
};

// 删除会话
const deleteSession = async (session: any) => {
  try {
    await ElMessageBox.confirm(
      `确定要删除演练 "${session.name}" 吗？此操作不可恢复。`,
      '确认删除',
      {
        confirmButtonText: '删除',
        cancelButtonText: '取消',
        type: 'warning'
      }
    );
    
    await adminArenaApi.deleteSession(session.id);
    ElMessage.success('删除成功');
    loadSessions();
    loadStats();
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error('删除失败: ' + (error.message || '未知错误'));
    }
  }
};

// 状态样式
const getStatusType = (status: string) => {
  const map: Record<string, string> = {
    running: 'warning',
    completed: 'success',
    failed: 'danger'
  };
  return map[status] || 'info';
};

const getStatusText = (status: string) => {
  const map: Record<string, string> = {
    running: '运行中',
    completed: '已完成',
    failed: '失败'
  };
  return map[status] || status;
};

// 评分颜色
const getScoreColor = (percentage: number) => {
  if (percentage >= 80) return '#67c23a';
  if (percentage >= 60) return '#e6a23c';
  return '#f56c6c';
};

// 格式化时间
const formatTime = (time: string) => {
  if (!time) return '-';
  const date = new Date(time);
  return date.toLocaleString('zh-CN');
};

onMounted(() => {
  loadSessions();
  loadStats();
});
</script>

<style scoped>
.arena-page {
  padding: 0;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
}

.header-left {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.page-title {
  font-size: 1.75rem;
  font-weight: 700;
  color: #1e293b;
  margin: 0;
}

.page-subtitle {
  font-size: 0.95rem;
  color: #64748b;
  margin: 0;
}

.header-actions {
  display: flex;
  gap: 0.75rem;
}

/* 统计卡片 */
.stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.stat-card {
  text-align: center;
  padding: 1rem;
}

.stat-value {
  font-size: 2rem;
  font-weight: 700;
  color: #3b82f6;
}

.stat-value.success {
  color: #10b981;
}

.stat-value.danger {
  color: #ef4444;
}

.stat-label {
  font-size: 0.9rem;
  color: #64748b;
  margin-top: 0.25rem;
}

/* 会话列表 */
.sessions-card {
  border-radius: 12px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.card-title {
  font-size: 1.125rem;
  font-weight: 600;
}

.session-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.session-item {
  padding: 1.25rem;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.session-item:hover {
  border-color: #3b82f6;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.1);
}

.session-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}

.session-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.session-info {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.session-name {
  font-size: 1.125rem;
  font-weight: 600;
  color: #1e293b;
  margin: 0;
}

.persona-preview {
  color: #64748b;
  font-size: 0.9rem;
  margin-bottom: 0.5rem;
}

.persona-preview .label {
  color: #94a3b8;
}

.meta-info {
  display: flex;
  gap: 1rem;
  color: #94a3b8;
  font-size: 0.85rem;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

/* 分页 */
.pagination-container {
  margin-top: 1.5rem;
  display: flex;
  justify-content: center;
}

/* 空状态 */
.empty-state {
  padding: 3rem 0;
}

.loading-container {
  padding: 2rem 0;
}
</style>


