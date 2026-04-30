<template>
  <div class="admin-conversations">
    <div class="page-header">
      <h2 class="page-title">
        <el-icon class="page-title-icon"><ChatDotRound /></el-icon>
        目标对话管理
      </h2>
      <p class="page-subtitle">查看和管理用户的目标对话记录</p>
    </div>

    <!-- 筛选工具栏 -->
    <div class="toolbar">
      <div class="toolbar-left">
        <el-select
          v-model="filterForm.userId"
          placeholder="选择用户"
          class="filter-user-select"
          filterable
          clearable
          @change="loadConversations"
        >
          <el-option
            v-for="user in userList"
            :key="user.id"
            :label="`${user.name} (${user.email})`"
            :value="user.id"
          />
        </el-select>

        <el-select
          v-model="filterForm.status"
          placeholder="对话状态"
          class="filter-status-select"
          clearable
          @change="loadConversations"
        >
          <el-option label="进行中" value="active" />
          <el-option label="已完成" value="completed" />
          <el-option label="已归档" value="archived" />
        </el-select>

        <el-date-picker
          v-model="filterForm.dateRange"
          type="daterange"
          range-separator="至"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
          class="filter-date-picker"
          @change="loadConversations"
        />
      </div>

      <div class="toolbar-right">
        <el-button type="primary" @click="loadConversations">
          <el-icon><Search /></el-icon>
          查询
        </el-button>
        <el-button @click="resetFilter">
          <el-icon><Refresh /></el-icon>
          重置
        </el-button>
      </div>
    </div>

        <!-- 对话列表 -->
        <div class="table-container">
          <el-table
            v-loading="loading"
            :data="conversations"
            stripe
            class="conversation-table"
            @row-click="handleRowClick"
          >
            <el-table-column prop="id" label="ID" min-width="120" show-overflow-tooltip />
            <el-table-column label="用户" min-width="140">
              <template #default="{ row }">
                <div class="user-info">
                  <el-avatar :size="28">{{ row.user?.name?.charAt(0) || 'U' }}</el-avatar>
                  <span class="user-name-truncate">{{ row.user?.name || '未知用户' }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="80">
              <template #default="{ row }">
                <el-tag :type="getStatusType(row.status)" size="small">
                  {{ getStatusText(row.status) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="消息数" width="80" align="center">
              <template #default="{ row }">
                {{ getMessageCount(row.messages, row.collectedData) }}
              </template>
            </el-table-column>
            <el-table-column label="生成路径" width="90" align="center">
              <template #default="{ row }">
                <el-tag v-if="row.learningPaths && row.learningPaths.length > 0" type="success" size="small">
                  {{ row.learningPaths.length }}个版本
                </el-tag>
                <el-tag v-else type="info" size="small">未生成</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="创建时间" width="140">
              <template #default="{ row }">
                {{ formatTime(row.createdAt) }}
              </template>
            </el-table-column>
            <el-table-column label="更新时间" width="140">
              <template #default="{ row }">
                {{ formatTime(row.updatedAt) }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="180" fixed="right">
              <template #default="{ row }">
                <el-button type="primary" size="small" @click.stop="viewDetail(row)">
                  查看
                </el-button>
                <el-button
                  type="success"
                  size="small"
                  :loading="regenerating[row.id]"
                  @click.stop="regeneratePath(row)"
                >
                  <el-icon><Refresh /></el-icon>
                  {{ row.learningPaths && row.learningPaths.length > 0 ? '新版本' : '生成' }}
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
    <!-- 分页 -->
    <div class="pagination-container">
      <el-pagination
        v-model:current-page="pagination.page"
        v-model:page-size="pagination.limit"
        :total="pagination.total"
        :page-sizes="[10, 20, 50, 100]"
        layout="total, sizes, prev, pager, next, jumper"
        @size-change="handleSizeChange"
        @current-change="handlePageChange"
      />
    </div>

    <!-- 详情对话框 -->
    <el-dialog
      v-model="dialogVisible"
      title="对话详情"
      width="900px"
      destroy-on-close
    >
      <div v-if="selectedConversation" class="conversation-detail">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="对话 ID">{{ selectedConversation.id }}</el-descriptions-item>
          <el-descriptions-item label="用户">{{ selectedConversation.user?.name || '未命名' }}</el-descriptions-item>
          <el-descriptions-item label="用户邮箱">{{ selectedConversation.user?.email }}</el-descriptions-item>
          <el-descriptions-item label="用户水平">{{ selectedConversation.user?.skillLevel || '未设置' }}</el-descriptions-item>
          <el-descriptions-item label="学习风格">{{ selectedConversation.user?.learningStyle || '未设置' }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="getStatusType(selectedConversation.status)">
              {{ getStatusText(selectedConversation.status) }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="消息数">{{ getMessageCount(selectedConversation.messages, selectedConversation.collectedData) }}</el-descriptions-item>
          <el-descriptions-item label="创建时间">{{ formatTime(selectedConversation.createdAt) }}</el-descriptions-item>
          <el-descriptions-item label="更新时间">{{ formatTime(selectedConversation.updatedAt) }}</el-descriptions-item>
          <el-descriptions-item label="学习路径" :span="2">
            <div v-if="selectedConversation.learningPaths && selectedConversation.learningPaths.length > 0" class="learning-paths-wrap">
              <div class="learning-paths-header">
                <span>已生成 {{ selectedConversation.learningPaths.length }} 个路径版本</span>
                <el-button type="success" size="small" @click="regeneratePath(selectedConversation)" :loading="regenerating[selectedConversation.id]">
                  <el-icon><Refresh /></el-icon>
                  生成新版本
                </el-button>
              </div>
              <div class="learning-paths-tags">
                <el-tag 
                  v-for="path in selectedConversation.learningPaths" 
                  :key="path.id"
                  size="small"
                  class="path-tag"
                  :type="path.generationVersion === selectedConversation.learningPaths.length ? 'success' : 'info'"
                >
                  v{{ path.generationVersion }}: {{ path.name }}
                </el-tag>
              </div>
            </div>
            <el-button v-else type="primary" size="small" @click="generatePath(selectedConversation)" :loading="regenerating[selectedConversation.id]">
              <el-icon><Plus /></el-icon>
              生成学习路径
            </el-button>
          </el-descriptions-item>
        </el-descriptions>

        <el-divider>学习目标</el-divider>
        <div class="detail-section">
          {{ selectedConversation.description }}
        </div>

        <el-divider>收集的数据</el-divider>
        <div class="detail-section">
          <pre class="json-display">{{ formatJson(selectedConversation.collectedData) }}</pre>
        </div>

        <el-divider>对话内容</el-divider>
        <div class="messages-container">
          <div
            v-for="(msg, index) in parseMessages(selectedConversation.messages, selectedConversation.collectedData)"
            :key="index"
            class="message"
            :class="msg.role"
          >
            <div class="message-avatar">
              {{ msg.role === 'user' ? '👤' : '🤖' }}
            </div>
            <div class="message-content">
              <div class="message-role">{{ msg.role === 'user' ? '用户' : 'AI' }}</div>
              <div class="message-text">{{ msg.content }}</div>
            </div>
          </div>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { adminConversationsApi, adminDashboardApi } from '@/api/adminApi';
import { Search, Refresh, Plus, ChatDotRound } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';

const loading = ref(false);
const conversations = ref<any[]>([]);
const userList = ref<any[]>([]);
const dialogVisible = ref(false);
const selectedConversation = ref<any>(null);
const regenerating = ref<Record<string, boolean>>({});

const filterForm = reactive({
  userId: '',
  status: '',
  dateRange: []
});

const pagination = reactive({
  page: 1,
  limit: 20,
  total: 0
});

const loadConversations = async () => {
  loading.value = true;
  try {
    const startDate = filterForm.dateRange?.[0];
    const endDate = filterForm.dateRange?.[1];

    const response: any = await adminConversationsApi.list({
      page: pagination.page,
      limit: pagination.limit,
      userId: filterForm.userId,
      status: filterForm.status,
      startDate: startDate ? new Date(startDate).toISOString() : undefined,
      endDate: endDate ? new Date(endDate).toISOString() : undefined
    });

    if (response.data.success) {
      conversations.value = response.data.data.conversations;
      pagination.total = response.data.data.pagination.total;
    }
  } catch (error: any) {
    console.error('加载对话列表失败:', error);
    ElMessage.error('加载对话列表失败');
  } finally {
    loading.value = false;
  }
};

const loadUserList = async () => {
  try {
    const response: any = await adminDashboardApi.users({ limit: 1000 });
    if (response.data.success) {
      userList.value = response.data.data.users;
    }
  } catch (error: any) {
    console.error('加载用户列表失败:', error);
  }
};

const resetFilter = () => {
  filterForm.userId = '';
  filterForm.status = '';
  filterForm.dateRange = [];
  pagination.page = 1;
  loadConversations();
};

const handleRowClick = (row: any) => {
  // 点击行不展开，需要点击按钮才展开
};

const viewDetail = async (row: any) => {
  try {
    const response: any = await adminConversationsApi.detail(row.id);
    if (response.data.success) {
      selectedConversation.value = response.data.data;
      dialogVisible.value = true;
    }
  } catch (error: any) {
    ElMessage.error('加载对话详情失败');
  }
};

// 生成学习路径
const generatePath = async (conversation: any) => {
  if (!conversation.id) return;
  
  regenerating.value[conversation.id] = true;
  try {
    // 调用后端 API，根据对话生成学习路径
    const response: any = await adminConversationsApi.generatePath(conversation.id);
    
    if (response.data.success) {
      ElMessage.success('学习路径生成成功！');
      // 延迟刷新，确保数据库更新完成
      setTimeout(async () => {
        // 刷新对话列表
        await loadConversations();
        // 更新当前选中的对话
        if (selectedConversation.value?.id === conversation.id) {
          const detailResponse: any = await adminConversationsApi.detail(conversation.id);
          if (detailResponse.data.success) {
            selectedConversation.value = detailResponse.data.data;
          }
        }
      }, 500);
    } else {
      ElMessage.error(response.data.message || '生成失败');
    }
  } catch (error: any) {
    console.error('生成学习路径失败:', error);
    ElMessage.error(error.response?.data?.message || error.message || '生成学习路径失败');
  } finally {
    regenerating.value[conversation.id] = false;
  }
};

// 重新生成学习路径
const regeneratePath = async (row: any) => {
  await generatePath(row);
};

const getMessageCount = (messages: any, collectedData?: any) => {
  // 优先从 collectedData 中获取
  if (collectedData) {
    try {
      const data = typeof collectedData === 'string' ? JSON.parse(collectedData) : collectedData;
      if (data?.messages && Array.isArray(data.messages)) {
        return data.messages.length;
      }
    } catch (e) {
      console.error('解析 collectedData 失败:', e);
    }
  }
  
  // 兼容旧的 messages 字段
  if (!messages) return 0;
  try {
    const msgs = typeof messages === 'string' ? JSON.parse(messages) : messages;
    return Array.isArray(msgs) ? msgs.length : 0;
  } catch {
    return 0;
  }
};

const parseMessages = (messages: any, collectedData?: any) => {
  // 优先从 collectedData 中解析 messages
  if (collectedData) {
    try {
      const data = typeof collectedData === 'string' ? JSON.parse(collectedData) : collectedData;
      if (data?.messages && Array.isArray(data.messages)) {
        return data.messages;
      }
    } catch (e) {
      console.error('解析 collectedData 失败:', e);
    }
  }
  
  // 兼容旧的 messages 字段
  if (!messages) return [];
  try {
    return typeof messages === 'string' ? JSON.parse(messages) : messages;
  } catch {
    return [];
  }
};

// 格式化 JSON 显示
const formatJson = (jsonData: any) => {
  if (!jsonData) return '{}';
  try {
    const data = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
    return JSON.stringify(data, null, 2);
  } catch {
    return String(jsonData);
  }
};

const getStatusType = (status: string) => {
  const types: any = {
    active: 'warning',
    completed: 'success',
    archived: 'info'
  };
  return types[status] || 'info';
};

const getStatusText = (status: string) => {
  const texts: any = {
    active: '进行中',
    completed: '已完成',
    archived: '已归档'
  };
  return texts[status] || status;
};

const formatTime = (time: string) => {
  return new Date(time).toLocaleString('zh-CN');
};

const handleSizeChange = () => {
  pagination.page = 1;
  loadConversations();
};

const handlePageChange = () => {
  loadConversations();
};

onMounted(() => {
  loadConversations();
  loadUserList();
});
</script>

<style scoped>
.admin-conversations {
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

/* 工具栏 */
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  padding: 1rem;
  background: var(--bg-elevated);
  border-radius: var(--fluent-radius-md);
  border: 1px solid var(--border-light);
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}

.filter-user-select {
  width: 250px;
}

.filter-status-select {
  width: 150px;
}

.filter-date-picker {
  margin-left: 1rem;
}

.toolbar-right {
  display: flex;
  gap: 0.5rem;
}

/* 表格 */
.table-container {
  overflow-x: auto;
  border-radius: var(--fluent-radius-md);
  width: 100%;
  -webkit-overflow-scrolling: touch;
}

.conversation-table {
  min-width: 100%;
}

.table-container :deep(.el-table) {
  border-radius: var(--fluent-radius-md);
  overflow: visible;
  width: 100%;
}

.table-container :deep(.el-table__body-wrapper) {
  overflow-x: visible;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.user-name-truncate {
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 分页 */
.pagination-container {
  margin-top: 2rem;
  display: flex;
  justify-content: flex-end;
}

/* 对话详情 */
.conversation-detail {
  max-height: 600px;
  overflow-y: auto;
}

.detail-section {
  margin: 1rem 0;
  padding: 1rem;
  background: var(--bg-elevated);
  border-radius: var(--fluent-radius-sm);
  border: 1px solid var(--border-light);
}

.json-display {
  white-space: pre-wrap;
  word-wrap: break-word;
  font-family: 'Courier New', Courier, monospace;
  font-size: 12px;
  max-height: 400px;
  overflow-y: auto;
  background: var(--bg-muted);
  padding: 1rem;
  border-radius: var(--fluent-radius-sm);
  border: 1px solid var(--border-light);
}

.messages-container {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-top: 1rem;
}

.message {
  display: flex;
  gap: 1rem;
  padding: 1rem;
  border-radius: var(--fluent-radius-md);
  background: var(--bg-elevated);
  border: 1px solid var(--border-light);
}

.message.user {
  background: color-mix(in srgb, var(--color-primary) 10%, var(--bg-elevated) 90%);
}

.message.assistant {
  background: color-mix(in srgb, var(--color-success) 10%, var(--bg-elevated) 90%);
}

.message-avatar {
  font-size: 2rem;
  flex-shrink: 0;
}

.message-content {
  flex: 1;
}

.message-role {
  font-weight: 600;
  margin-bottom: 0.5rem;
  color: var(--text-primary);
}

.message-text {
  color: var(--text-secondary);
  line-height: 1.6;
  white-space: pre-wrap;
}

.learning-paths-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.learning-paths-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem;
}

.learning-paths-tags {
  margin-top: 0.5rem;
}

.path-tag {
  margin-right: 0.5rem;
  margin-bottom: 0.25rem;
}

@media (max-width: 900px) {
  .toolbar {
    flex-direction: column;
    align-items: stretch;
    gap: 0.75rem;
  }

  .filter-user-select,
  .filter-status-select {
    width: 100%;
  }

  .filter-date-picker {
    margin-left: 0;
    width: 100%;
  }

  .learning-paths-header {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
