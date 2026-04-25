<template>
  <div class="admin-users">
    <div class="page-header">
      <h2 class="page-title">👥 用户管理</h2>
      <p class="page-subtitle">查看和管理平台用户</p>
    </div>

    <!-- 筛选工具栏 -->
    <div class="toolbar">
      <div class="toolbar-left">
        <el-input
          v-model="filterForm.search"
          placeholder="搜索用户名称或邮箱"
          style="width: 300px"
          clearable
          @input="handleSearch"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>

        <el-select
          v-model="filterForm.role"
          placeholder="用户角色"
          style="width: 150px; margin-left: 1rem"
          clearable
          @change="handleFilter"
        >
          <el-option label="普通用户" value="user" />
          <el-option label="管理员" value="admin" />
        </el-select>
      </div>

      <div class="toolbar-right">
        <el-button type="success" @click="openCreateDialog">
          新建用户
        </el-button>
        <el-button type="danger" plain :disabled="selectedUserIds.length === 0" @click="handleBatchDelete">
          批量删除 ({{ selectedUserIds.length }})
        </el-button>
        <el-button type="primary" @click="handleFilter">
          <el-icon><Search /></el-icon>
          查询
        </el-button>
        <el-button @click="resetFilter">
          <el-icon><Refresh /></el-icon>
          重置
        </el-button>
      </div>
    </div>

    <!-- 用户列表 -->
    <div class="table-container">
      <el-table
        ref="tableRef"
        v-loading="loading"
        :data="users"
        stripe
        @selection-change="handleSelectionChange"
        style="min-width: 100%"
      >
        <el-table-column type="selection" width="48" />
        <el-table-column prop="id" label="ID" min-width="120" show-overflow-tooltip />
        <el-table-column prop="name" label="昵称" min-width="100" />
        <el-table-column prop="email" label="邮箱" min-width="180" show-overflow-tooltip />
        <el-table-column label="角色" width="80" align="center">
          <template #default="{ row }">
            <el-tag :type="row.isAdmin ? 'danger' : 'primary'" size="small">
              {{ row.isAdmin ? '管理员' : '用户' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="xp" label="XP" width="70" align="center" />
        <el-table-column prop="level" label="等级" width="70" align="center" />
        <el-table-column label="学习进度" width="140" align="center">
          <template #default="{ row }">
            <div class="progress-info">
              <span>{{ row._count?.learningPaths || 0 }} 路径</span>
              <span>{{ row._count?.tasks || 0 }} 任务</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="skillLevel" label="技能水平" width="90" align="center">
          <template #default="{ row }">
            {{ getSkillLevelText(row.skillLevel) }}
          </template>
        </el-table-column>
        <el-table-column label="最后登录" width="140">
          <template #default="{ row }">
            {{ row.lastLoginAt ? formatTime(row.lastLoginAt) : '从未登录' }}
          </template>
        </el-table-column>
        <el-table-column label="注册时间" width="140">
          <template #default="{ row }">
            {{ formatTime(row.createdAt) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button type="success" link @click="openLearnerModel(row)">学习者模型</el-button>
            <el-button type="primary" link @click="openEditDialog(row)">编辑</el-button>
            <el-button type="danger" link @click="handleDeleteUser(row)">删除</el-button>
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

    <el-dialog 
      v-model="createVisible" 
      title="新建用户" 
      width="520px"
      :close-on-click-modal="false"
      :close-on-press-escape="true"
      destroy-on-close
      append-to-body
      @close="closeCreateDialog"
    >
      <el-form :model="createForm" label-width="100px">
        <el-form-item label="昵称" required>
          <el-input v-model="createForm.name" placeholder="请输入昵称" />
        </el-form-item>
        <el-form-item label="邮箱" required>
          <el-input v-model="createForm.email" placeholder="请输入邮箱" />
        </el-form-item>
        <el-form-item label="密码" required>
          <el-input v-model="createForm.password" type="password" show-password placeholder="至少 8 位，需包含字母和数字" />
        </el-form-item>
        <el-form-item label="管理员">
          <el-switch v-model="createForm.isAdmin" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="closeCreateDialog">取消</el-button>
        <el-button type="primary" :loading="creating" @click="handleCreateUser">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog 
      v-model="editVisible" 
      title="编辑用户" 
      width="520px"
      :close-on-click-modal="false"
      :close-on-press-escape="true"
      destroy-on-close
      append-to-body
      @close="closeEditDialog"
    >
      <el-form :model="editForm" label-width="100px">
        <el-form-item label="昵称" required>
          <el-input v-model="editForm.name" placeholder="请输入昵称" />
        </el-form-item>
        <el-form-item label="邮箱" required>
          <el-input v-model="editForm.email" placeholder="请输入邮箱" />
        </el-form-item>
        <el-form-item label="管理员">
          <el-switch v-model="editForm.isAdmin" />
        </el-form-item>
        <el-form-item label="重置密码">
          <el-input v-model="editForm.password" type="password" show-password placeholder="留空表示不修改；如填写需满足 8 位+字母+数字" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="closeEditDialog">取消</el-button>
        <el-button type="primary" :loading="updating" @click="handleUpdateUser">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { adminUsersApi } from '@/api/adminApi';
import { Search, Refresh } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';

const loading = ref(false);
const router = useRouter();
const users = ref<any[]>([]);
const tableRef = ref<any>(null);
const createVisible = ref(false);
const creating = ref(false);
const editVisible = ref(false);
const updating = ref(false);
const selectedUserIds = ref<string[]>([]);

const createForm = reactive({
  name: '',
  email: '',
  password: '',
  isAdmin: false
});

const editForm = reactive({
  id: '',
  name: '',
  email: '',
  isAdmin: false,
  password: ''
});

const getPasswordRuleError = (password: string) => {
  if (password.length < 8) return '密码至少 8 位';
  if (!/[a-zA-Z]/.test(password)) return '密码必须包含字母';
  if (!/[0-9]/.test(password)) return '密码必须包含数字';
  return '';
};

const filterForm = reactive({
  search: '',
  role: ''
});

const pagination = reactive({
  page: 1,
  limit: 20,
  total: 0
});

const loadUsers = async () => {
  loading.value = true;
  try {
    const response: any = await adminUsersApi.getUsers({
      page: pagination.page,
      limit: pagination.limit,
      search: filterForm.search,
      role: filterForm.role
    });

    if (response.data.success) {
      users.value = (response.data.data.users || []).map((user: any) => {
        const currentLevel = typeof user.currentLevel === 'string' ? user.currentLevel : 'beginner';
        const levelMap: Record<string, number> = {
          beginner: 1,
          intermediate: 5,
          advanced: 10
        };
        return {
          ...user,
          level: levelMap[currentLevel] || 1,
          skillLevel: currentLevel,
          learningGoal: user.learningGoal || '-',
          _count: {
            learningPaths: user._count?.learning_paths || 0,
            tasks: user._count?.teaching_sessions || 0
          }
        };
      });
      pagination.total = response.data.data.pagination.total;
      selectedUserIds.value = [];
      tableRef.value?.clearSelection?.();
    }
  } catch (error: any) {
    console.error('加载用户列表失败:', error);
    ElMessage.error('加载用户列表失败');
  } finally {
    loading.value = false;
  }
};

const handleSearch = () => {
  pagination.page = 1;
  loadUsers();
};

const handleFilter = () => {
  pagination.page = 1;
  loadUsers();
};

const resetFilter = () => {
  filterForm.search = '';
  filterForm.role = '';
  pagination.page = 1;
  loadUsers();
};

const handleSizeChange = () => {
  pagination.page = 1;
  loadUsers();
};

const handlePageChange = () => {
  loadUsers();
};

const getSkillLevelText = (level: string) => {
  const texts: any = {
    beginner: '初学者',
    intermediate: '中级',
    advanced: '高级'
  };
  return texts[level] || level || '未设置';
};

const formatTime = (time: string) => {
  return new Date(time).toLocaleString('zh-CN');
};

const openCreateDialog = () => {
  createForm.name = '';
  createForm.email = '';
  createForm.password = '';
  createForm.isAdmin = false;
  createVisible.value = true;
};

const closeCreateDialog = () => {
  createVisible.value = false;
  createForm.name = '';
  createForm.email = '';
  createForm.password = '';
  createForm.isAdmin = false;
};

const handleCreateUser = async () => {
  if (!createForm.name || !createForm.email || !createForm.password) {
    ElMessage.warning('请填写完整信息');
    return;
  }

  const createPasswordError = getPasswordRuleError(createForm.password);
  if (createPasswordError) {
    ElMessage.warning(createPasswordError);
    return;
  }

  creating.value = true;
  try {
    await adminUsersApi.createUser({
      name: createForm.name,
      email: createForm.email,
      password: createForm.password,
      isAdmin: createForm.isAdmin,
      role: createForm.isAdmin ? 'admin' : 'user',
      currentLevel: 'beginner',
      xp: 0
    });
    ElMessage.success('用户创建成功');
    createVisible.value = false;
    loadUsers();
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.error?.message || '创建用户失败');
  } finally {
    creating.value = false;
  }
};

const handleDeleteUser = async (row: any) => {
  try {
    await ElMessageBox.confirm(`确认删除用户 ${row.name || row.email} 吗？`, '删除用户', {
      type: 'warning'
    });
    await adminUsersApi.deleteUser(row.id);
    ElMessage.success('删除成功');
    loadUsers();
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error?.response?.data?.error?.message || '删除用户失败');
    }
  }
};

const handleSelectionChange = (rows: any[]) => {
  selectedUserIds.value = rows.map(row => row.id);
};

const openLearnerModel = (row: any) => {
  router.push({
    name: 'AdminLearnerModelDetail',
    params: { userId: row.id }
  });
};

const handleBatchDelete = async () => {
  if (selectedUserIds.value.length === 0) return;

  try {
    await ElMessageBox.confirm(
      `确认批量删除 ${selectedUserIds.value.length} 个用户吗？该操作不可恢复。`,
      '批量删除用户',
      { type: 'warning' }
    );
    const response: any = await adminUsersApi.batchDeleteUsers(selectedUserIds.value);
    ElMessage.success(`批量删除成功，已删除 ${response.data?.data?.deletedCount ?? selectedUserIds.value.length} 个用户`);
    loadUsers();
  } catch (error: any) {
    if (error !== 'cancel') {
      ElMessage.error(error?.response?.data?.error?.message || '批量删除失败');
    }
  }
};

const openEditDialog = (row: any) => {
  if (!row || !row.id) {
    ElMessage.warning('用户数据无效');
    return;
  }
  
  editForm.id = row.id;
  editForm.name = row.name || '';
  editForm.email = row.email || '';
  editForm.isAdmin = !!row.isAdmin;
  editForm.password = '';
  editVisible.value = true;
};

const closeEditDialog = () => {
  editVisible.value = false;
  editForm.id = '';
  editForm.name = '';
  editForm.email = '';
  editForm.isAdmin = false;
  editForm.password = '';
};

const handleUpdateUser = async () => {
  if (!editForm.id || !editForm.name || !editForm.email) {
    ElMessage.warning('请填写完整信息');
    return;
  }

  if (editForm.password) {
    const passwordError = getPasswordRuleError(editForm.password);
    if (passwordError) {
      ElMessage.warning(passwordError);
      return;
    }
  }

  updating.value = true;
  try {
    await adminUsersApi.updateUser(editForm.id, {
      name: editForm.name,
      email: editForm.email,
      isAdmin: editForm.isAdmin,
      ...(editForm.password ? { password: editForm.password } : {})
    });
    ElMessage.success('用户更新成功');
    editVisible.value = false;
    loadUsers();
  } catch (error: any) {
    ElMessage.error(error?.response?.data?.error?.message || '更新用户失败');
  } finally {
    updating.value = false;
  }
};

onMounted(() => {
  loadUsers();
});
</script>

<style scoped>
.admin-users {
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
  background: rgba(255, 255, 255, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: var(--radius-xl);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: var(--shadow-sm);
}

.toolbar-left {
  display: flex;
  align-items: center;
}

.toolbar-right {
  display: flex;
  gap: 0.5rem;
}

/* 表格 */
.table-container {
  overflow-x: auto;
  border-radius: var(--radius-xl);
  border: 1px solid rgba(255, 255, 255, 0.35);
  background: rgba(255, 255, 255, 0.72);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: var(--shadow-sm);
  padding: 0.25rem;
  width: 100%;
  -webkit-overflow-scrolling: touch;
}

.table-container :deep(.el-table) {
  border-radius: var(--radius-lg);
  overflow: visible;
  width: 100%;
  --el-table-bg-color: transparent;
  --el-bg-color: transparent;
  --el-fill-color-blank: transparent;
}

.table-container :deep(.el-table__body-wrapper) {
  overflow-x: visible;
}

.progress-info {
  display: flex;
  gap: 1rem;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

/* 分页 */
.pagination-container {
  margin-top: 2rem;
  display: flex;
  justify-content: flex-end;
}

[data-theme="dark"] .toolbar,
[data-theme="dark"] .table-container {
  background: rgba(30, 45, 58, 0.74);
  border-color: rgba(255, 255, 255, 0.1);
}
</style>
