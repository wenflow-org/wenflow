<template>
  <div class="debug-sandbox">
    <div class="page-header">
      <h2 class="page-title">
        <el-icon class="page-title-icon"><Setting /></el-icon>
        调试沙盒
      </h2>
      <p class="page-subtitle">快速测试和优化学习路径生成效果</p>
    </div>

    <!-- 创建快照卡片 -->
    <el-card class="create-snapshot-card" shadow="hover">
      <template #header>
        <div class="card-header">
          <span class="card-title">📸 快速创建快照</span>
        </div>
      </template>

      <div class="create-form">
        <el-input
          v-model="newSnapshotForm.name"
          placeholder="快照名称（如：Excel自动化测试）"
          class="snapshot-name-input"
        />
        <el-input
          v-model="newSnapshotForm.description"
          type="textarea"
          :rows="2"
          placeholder="描述（可选）"
          class="snapshot-desc-input"
        />
        
        <div class="source-select">
          <span class="label">数据来源：</span>
          <el-radio-group v-model="newSnapshotForm.sourceType">
            <el-radio label="conversation">从对话导入</el-radio>
            <el-radio label="manual">手动输入</el-radio>
          </el-radio-group>
        </div>

        <!-- 从对话选择 -->
        <div v-if="newSnapshotForm.sourceType === 'conversation'" class="conversation-select">
          <el-select
            v-model="newSnapshotForm.conversationId"
            placeholder="选择最近的对话"
            class="full-width"
            filterable
            :loading="loadingConversations"
            empty-text="暂无可用的对话"
          >
            <el-option
              v-for="conv in recentConversations"
              :key="conv.id"
              :label="`${conv.userName} - ${conv.description?.substring(0, 30) || '无描述'}...`"
              :value="conv.id"
            >
              <div class="conversation-option">
                <span class="user-name">{{ conv.userName }}</span>
                <span class="real-problem">{{ conv.description || '无描述' }}</span>
                <el-tag size="small" type="info">{{ conv.messageCount || 0 }} 条消息</el-tag>
                <span class="time">{{ formatTime(conv.createdAt) }}</span>
              </div>
            </el-option>
          </el-select>
          <el-alert
            v-if="!loadingConversations && recentConversations.length === 0"
            title="没有可用的对话数据"
            description="请先在目标对话页面创建一些对话，或者选择手动输入方式创建快照"
            type="info"
            :closable="false"
            class="conversation-alert"
          />
        </div>

        <!-- 手动输入 -->
        <div v-else class="manual-input">
          <el-input
            v-model="manualData.surfaceGoal"
            placeholder="表面目标（如：我想学Python）"
          />
          <el-input
            v-model="manualData.realProblem"
            placeholder="真问题（如：自动化Excel报表处理）"
          />
          <el-input
            v-model="manualData.motivation"
            placeholder="学习动机"
          />
          <el-select v-model="manualData.level" placeholder="当前水平">
            <el-option label="初学者" value="beginner" />
            <el-option label="中级" value="intermediate" />
            <el-option label="高级" value="advanced" />
          </el-select>
          <el-input
            v-model="manualData.availableTime"
            placeholder="可用时间（如：每天20分钟）"
          />
        </div>

        <el-button 
          type="primary" 
          :loading="creatingSnapshot"
          @click="createSnapshot"
          class="create-btn"
        >
          <el-icon><Plus /></el-icon>
          创建快照
        </el-button>
      </div>
    </el-card>

    <!-- 快照列表 -->
    <el-card class="snapshots-card" shadow="hover">
      <template #header>
        <div class="card-header">
          <span class="card-title">📋 我的快照</span>
          <div class="header-actions">
            <el-button type="danger" size="small" plain @click="showCleanupDialog">
              批量清理
            </el-button>
            <el-button size="small" @click="loadSnapshots">
              刷新
            </el-button>
          </div>
        </div>
      </template>

      <div v-if="loading" class="loading-container">
        <el-skeleton :rows="5" animated />
      </div>

      <div v-else-if="snapshots.length === 0" class="empty-state">
        <el-empty description="暂无快照，请先创建一个" />
      </div>

      <div v-else class="snapshot-list">
        <div
          v-for="snapshot in snapshots"
          :key="snapshot.id"
          class="snapshot-item"
          @click="goToDetail(snapshot.id)"
        >
          <div class="snapshot-header">
            <h3 class="snapshot-name">{{ snapshot.name }}</h3>
            <div class="snapshot-actions" @click.stop>
              <el-button
                type="primary"
                size="small"
                plain
                @click="goToDetail(snapshot.id)"
              >
                查看详情
              </el-button>
              <el-popconfirm
                title="确定删除此快照吗？"
                confirm-button-text="删除"
                cancel-button-text="取消"
                @confirm="deleteSnapshot(snapshot.id)"
              >
                <template #reference>
                  <el-button type="danger" size="small" plain>
                    <el-icon><Delete /></el-icon>
                  </el-button>
                </template>
              </el-popconfirm>
            </div>
          </div>

          <p v-if="snapshot.description" class="snapshot-description">
            {{ snapshot.description }}
          </p>

          <div class="snapshot-info">
            <div class="info-item">
              <span class="label">真问题：</span>
              <span class="value">{{ snapshot.realProblem || '-' }}</span>
            </div>
            <div class="info-row">
              <div class="info-item">
                <span class="label">水平：</span>
                <span class="value">{{ snapshot.level || '-' }}</span>
              </div>
              <div class="info-item">
                <span class="label">时间：</span>
                <span class="value">{{ snapshot.timePerDay || '-' }}</span>
              </div>
            </div>
          </div>

          <div class="snapshot-stats">
            <el-tag type="primary" size="small">
              <el-icon><Document /></el-icon>
              方案 × {{ snapshot.proposalCount }}
            </el-tag>
            <el-tag type="success" size="small">
              <el-icon><Collection /></el-icon>
              路径 × {{ snapshot.pathCount }}
            </el-tag>
            <span class="created-time">{{ formatTime(snapshot.createdAt) }}</span>
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
            @size-change="loadSnapshots"
            @current-change="loadSnapshots"
          />
        </div>
      </div>
    </el-card>

    <!-- 批量清理对话框 -->
    <el-dialog
      v-model="cleanupDialogVisible"
      title="批量清理调试数据"
      width="400px"
    >
      <div class="cleanup-content">
        <p>保留最近的 <el-input-number v-model="keepRecent" :min="1" :max="50" /> 个快照</p>
        <p class="tip">其余快照及其生成的方案、路径将被永久删除</p>
      </div>
      <template #footer>
        <el-button @click="cleanupDialogVisible = false">取消</el-button>
        <el-button type="danger" :loading="cleaning" @click="cleanupSnapshots">
          确认清理
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { Plus, Delete, Refresh, Document, Collection, Setting } from '@element-plus/icons-vue';
import { adminDebugSandboxApi } from '@/api/adminApi';

const router = useRouter();

// 加载状态
const loading = ref(false);
const creatingSnapshot = ref(false);
const cleaning = ref(false);
const loadingConversations = ref(false);

// 快照列表
const snapshots = ref<any[]>([]);
const recentConversations = ref<any[]>([]);
const pagination = reactive({
  page: 1,
  limit: 10,
  total: 0
});

// 新建快照表单
const newSnapshotForm = reactive({
  name: '',
  description: '',
  sourceType: 'conversation',
  conversationId: ''
});

// 手动输入数据
const manualData = reactive({
  surfaceGoal: '',
  realProblem: '',
  motivation: '',
  level: 'beginner',
  availableTime: ''
});

// 清理对话框
const cleanupDialogVisible = ref(false);
const keepRecent = ref(10);

// 加载快照列表
const loadSnapshots = async () => {
  loading.value = true;
  try {
    const response: any = await adminDebugSandboxApi.getSnapshots({
      page: pagination.page,
      limit: pagination.limit
    });
    if (response.data.success) {
      snapshots.value = response.data.data.snapshots;
      pagination.total = response.data.data.pagination.total;
    }
  } catch (error: any) {
    ElMessage.error('加载快照列表失败');
  } finally {
    loading.value = false;
  }
};

// 加载最近对话
const loadRecentConversations = async () => {
  loadingConversations.value = true;
  try {
    const response: any = await adminDebugSandboxApi.getRecentConversations();
    if (response.data.success) {
      recentConversations.value = response.data.data || [];
      console.log('加载到最近对话:', recentConversations.value.length, '条');
    } else {
      ElMessage.warning('获取对话列表失败');
    }
  } catch (error: any) {
    console.error('加载最近对话失败:', error);
    ElMessage.error('加载对话列表失败: ' + (error.message || '未知错误'));
  } finally {
    loadingConversations.value = false;
  }
};

// 创建快照
const createSnapshot = async () => {
  if (!newSnapshotForm.name.trim()) {
    ElMessage.warning('请输入快照名称');
    return;
  }

  if (newSnapshotForm.sourceType === 'conversation' && !newSnapshotForm.conversationId) {
    ElMessage.warning('请选择一个对话');
    return;
  }

  creatingSnapshot.value = true;
  try {
    let collectedData = null;

    // 如果是手动输入，构建 collectedData
    if (newSnapshotForm.sourceType === 'manual') {
      collectedData = JSON.stringify({
        understanding: {
          surface_goal: manualData.surfaceGoal,
          real_problem: manualData.realProblem,
          motivation: manualData.motivation,
          background: {
            current_level: manualData.level,
            available_time: manualData.availableTime
          }
        },
        collected: {
          level: manualData.level,
          timePerDay: manualData.availableTime
        }
      });
    }

    const response: any = await adminDebugSandboxApi.createSnapshot({
      name: newSnapshotForm.name,
      description: newSnapshotForm.description,
      sourceConversationId: newSnapshotForm.sourceType === 'conversation' 
        ? newSnapshotForm.conversationId 
        : null
    });

    if (response.data.success) {
      ElMessage.success('快照创建成功');
      // 重置表单
      newSnapshotForm.name = '';
      newSnapshotForm.description = '';
      newSnapshotForm.conversationId = '';
      // 刷新列表
      loadSnapshots();
      // 跳转到详情页
      router.push(`/admin/debug-sandbox/${response.data.data.id}`);
    }
  } catch (error: any) {
    ElMessage.error('创建快照失败');
  } finally {
    creatingSnapshot.value = false;
  }
};

// 删除快照
const deleteSnapshot = async (id: string) => {
  try {
    const response: any = await adminDebugSandboxApi.deleteSnapshot(id);
    if (response.data.success) {
      ElMessage.success('快照已删除');
      loadSnapshots();
    }
  } catch (error: any) {
    ElMessage.error('删除失败');
  }
};

// 跳转到详情页
const goToDetail = (id: string) => {
  router.push(`/admin/debug-sandbox/${id}`);
};

// 显示清理对话框
const showCleanupDialog = () => {
  cleanupDialogVisible.value = true;
};

// 批量清理
const cleanupSnapshots = async () => {
  cleaning.value = true;
  try {
    const response: any = await adminDebugSandboxApi.cleanup(keepRecent.value);
    if (response.data.success) {
      ElMessage.success(`已清理 ${response.data.data.deletedCount} 个旧快照`);
      cleanupDialogVisible.value = false;
      loadSnapshots();
    }
  } catch (error: any) {
    ElMessage.error('清理失败');
  } finally {
    cleaning.value = false;
  }
};

// 格式化时间
const formatTime = (time: string) => {
  if (!time) return '-';
  const date = new Date(time);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;
  return date.toLocaleDateString('zh-CN');
};

onMounted(() => {
  loadSnapshots();
  loadRecentConversations();
});
</script>

<style scoped>
.debug-sandbox {
  padding: 0;
}

.page-header {
  margin-bottom: 2rem;
}

.page-title {
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 0.5rem 0;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.page-title-icon {
  color: var(--color-primary);
}

.page-subtitle {
  font-size: 1rem;
  color: var(--text-secondary);
  margin: 0;
}

/* 卡片样式 */
.create-snapshot-card {
  margin-bottom: 2rem;
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
  color: var(--text-primary);
}

.header-actions {
  display: flex;
  gap: 0.5rem;
}

/* 创建表单 */
.create-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.snapshot-name-input {
  max-width: 400px;
}

.snapshot-desc-input {
  max-width: 600px;
}

.source-select {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.source-select .label {
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.conversation-select {
  max-width: 600px;
}

.full-width {
  width: 100%;
}

.conversation-alert {
  margin-top: 0.5rem;
}

.conversation-option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0;
}

.conversation-option .user-name {
  font-weight: 500;
  color: var(--text-primary);
}

.conversation-option .real-problem {
  color: var(--text-secondary);
  font-size: 0.85rem;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conversation-option .time {
  color: var(--text-muted);
  font-size: 0.8rem;
}

.manual-input {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
  max-width: 800px;
}

.create-btn {
  align-self: flex-start;
  margin-top: 0.5rem;
}

/* 快照列表 */
.snapshots-card {
  border-radius: 12px;
}

.snapshot-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.snapshot-item {
  padding: 1.25rem;
  border: 1px solid rgba(255, 255, 255, 0.32);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  background: rgba(255, 255, 255, 0.72);
}

.snapshot-item:hover {
  border-color: var(--color-primary);
  box-shadow: var(--shadow-md);
}

.snapshot-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.snapshot-name {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.snapshot-actions {
  display: flex;
  gap: 0.5rem;
}

.snapshot-description {
  color: var(--text-secondary);
  font-size: 0.9rem;
  margin: 0 0 0.75rem 0;
}

.snapshot-info {
  background: rgba(255, 255, 255, 0.72);
  padding: 0.75rem;
  border-radius: 6px;
  margin-bottom: 0.75rem;
}

.info-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.info-item .label {
  color: var(--text-secondary);
  font-size: 0.85rem;
}

.info-item .value {
  color: var(--text-primary);
  font-size: 0.9rem;
  font-weight: 500;
}

.info-row {
  display: flex;
  gap: 2rem;
  margin-top: 0.25rem;
}

.snapshot-stats {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.created-time {
  margin-left: auto;
  color: var(--text-muted);
  font-size: 0.85rem;
}

/* 清理对话框 */
.cleanup-content {
  text-align: center;
}

.cleanup-content p {
  margin: 1rem 0;
}

.cleanup-content .tip {
  color: var(--text-secondary);
  font-size: 0.85rem;
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
