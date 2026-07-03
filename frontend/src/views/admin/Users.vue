<template>
  <div class="admin-page admin-users">
    <AdminPageHeader
      title="管理系统用户账号"
      :icon="User"
      :highlights="userHighlights"
    >
      <template #actions>
        <el-button type="primary" @click="openCreateDialog">新建用户</el-button>
        <el-button v-if="selectedUserIds.length > 0" type="danger" plain :loading="batchDeleting" @click="handleBatchDelete">
          批量删除 ({{ selectedUserIds.length }})
        </el-button>
      </template>
    </AdminPageHeader>

    <section class="admin-filter-panel users-filter-panel">
      <div class="admin-section-head users-filter-panel__head">
        <div class="admin-section-head__copy">
          <h3 class="admin-section-head__title">筛选与目录范围</h3>
        </div>
        <div class="users-filter-panel__summary">
          <span v-if="selectedUserIds.length > 0">已选 {{ selectedUserIds.length }} 人</span>
          <span v-else>当前页 {{ users.length }} 人</span>
        </div>
      </div>

      <div class="admin-list-toolbar users-filter-toolbar">
        <div class="admin-list-toolbar__group">
        <el-input
          v-model="filterForm.search"
          placeholder="搜索昵称或邮箱"
          style="width: 260px"
          clearable
          @input="handleSearch"
          @keyup.enter="handleSearchImmediate"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>

        <el-select
          v-model="filterForm.role"
          placeholder="用户角色"
          style="width: 140px; margin-left: 0.75rem"
          clearable
          @change="handleFilter"
        >
          <el-option label="普通用户" value="user" />
          <el-option label="管理员" value="admin" />
        </el-select>
      </div>

      <div class="admin-list-toolbar__group">
        <p class="users-filter-toolbar__note">
          {{ filterForm.search || filterForm.role ? '已启用筛选' : '默认范围' }}
        </p>
      </div>
      </div>
    </section>

    <!-- 用户列表 -->
    <div class="table-container admin-list-card">
      <el-table
        ref="tableRef"
        v-loading="loading"
        :data="users"
        stripe
        @selection-change="handleSelectionChange"
        style="min-width: 100%"
        >
          <template #empty>
            <el-empty description="暂无用户数据" />
          </template>
          <el-table-column type="selection" width="48" />
          <el-table-column prop="name" label="昵称" min-width="220">
            <template #default="{ row }">
              <div class="user-primary-cell">
                <strong>{{ row.name || '-' }}</strong>
                <span class="user-id-cell">{{ row.id }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="email" label="邮箱" min-width="280" show-overflow-tooltip />
          <el-table-column label="角色" width="96" align="center">
            <template #default="{ row }">
              <el-tag :type="row.isAdmin ? 'danger' : 'primary'" size="small">
                {{ row.isAdmin ? '管理员' : '用户' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="登录状态" width="110" align="center">
            <template #default="{ row }">
              <el-tag :type="row.lastLoginAt ? 'success' : 'info'" size="small" effect="plain">
                {{ row.lastLoginAt ? '已登录' : '未登录' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="最后登录" min-width="180">
            <template #default="{ row }">
              {{ row.lastLoginAt ? formatTime(row.lastLoginAt) : '从未登录' }}
            </template>
          </el-table-column>
          <el-table-column label="操作" width="116" fixed="right" align="center">
            <template #default="{ row }">
              <div class="row-actions">
                <el-button class="users-action-btn" @click="openEditDialog(row)">编辑</el-button>
              </div>
            </template>
          </el-table-column>
      </el-table>
    </div>

    <!-- 分页 -->
    <div class="pagination-container admin-list-pagination">
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

    <!-- 新建用户 Drawer -->
    <el-drawer
      v-model="createVisible"
      title="新建用户"
      size="min(72%, 600px)"
      direction="rtl"
      :close-on-click-modal="false"
      :close-on-press-escape="true"
      destroy-on-close
      @close="closeCreateDialog"
    >
      <div class="drawer-content">
        <el-form ref="createFormRef" class="drawer-form" :model="createForm" :rules="createRules" label-width="100px">
          <el-form-item label="昵称" prop="name">
            <el-input v-model="createForm.name" placeholder="请输入昵称" />
          </el-form-item>
          <el-form-item label="邮箱" prop="email">
            <el-input v-model="createForm.email" placeholder="请输入邮箱" />
          </el-form-item>
          <el-form-item label="密码" prop="password">
            <el-input v-model="createForm.password" type="password" show-password placeholder="至少 8 位，含字母和数字" />
          </el-form-item>
          <el-form-item label="管理员">
            <el-switch v-model="createForm.isAdmin" />
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <div class="drawer-footer">
          <el-button @click="closeCreateDialog">取消</el-button>
          <el-button type="primary" :loading="creating" @click="handleCreateUser">创建</el-button>
        </div>
      </template>
    </el-drawer>

    <!-- 编辑用户 Drawer -->
    <el-drawer
      v-model="editVisible"
      title="编辑用户"
      size="min(72%, 600px)"
      direction="rtl"
      :close-on-click-modal="false"
      :close-on-press-escape="true"
      destroy-on-close
      @close="closeEditDialog"
    >
      <div class="drawer-content">
        <div class="drawer-hero" v-if="editForm.name">
          <h2 class="drawer-hero__title">{{ editForm.name }}</h2>
          <p class="drawer-hero__subtitle">{{ editForm.email }}</p>
        </div>

        <el-form ref="editFormRef" class="drawer-form" :model="editForm" :rules="editRules" label-width="100px">
          <el-form-item label="昵称" prop="name">
            <el-input v-model="editForm.name" placeholder="请输入昵称" />
          </el-form-item>
          <el-form-item label="邮箱" prop="email">
            <el-input v-model="editForm.email" placeholder="请输入邮箱" />
          </el-form-item>
          <el-form-item label="管理员">
            <el-switch v-model="editForm.isAdmin" />
          </el-form-item>
          <el-form-item label="重置密码" prop="password">
            <el-input v-model="editForm.password" type="password" show-password placeholder="留空不修改；填写需 8 位+字母+数字" />
          </el-form-item>
        </el-form>
      </div>
      <template #footer>
        <div class="drawer-footer">
          <el-button type="danger" plain @click="handleDeleteFromEdit">删除用户</el-button>
          <el-button @click="closeEditDialog">取消</el-button>
          <el-button type="primary" :loading="updating" @click="handleUpdateUser">保存</el-button>
        </div>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue';
import { adminUsersApi } from '@/api/adminApi';
import { User, Search } from '@element-plus/icons-vue';
import { ElMessageBox } from 'element-plus';
import type { FormInstance } from 'element-plus';
import AdminPageHeader from './components/AdminPageHeader.vue';
import { toast } from '../../utils/toast';

const createFormRef = ref<FormInstance>();
const editFormRef = ref<FormInstance>();

const loading = ref(false);
const users = ref<any[]>([]);
const tableRef = ref<any>(null);
const createVisible = ref(false);
const creating = ref(false);
const editVisible = ref(false);
const updating = ref(false);
const selectedUserIds = ref<string[]>([]);
const batchDeleting = ref(false);

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

const createRules = {
  name: [{ required: true, message: '请输入昵称', trigger: 'blur' }],
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '请输入正确的邮箱格式', trigger: 'blur' }
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 8, message: '密码至少 8 位', trigger: 'blur' },
    { pattern: /[a-zA-Z]/, message: '密码必须包含字母', trigger: 'blur' },
    { pattern: /[0-9]/, message: '密码必须包含数字', trigger: 'blur' }
  ]
};

const editRules = {
  name: [{ required: true, message: '请输入昵称', trigger: 'blur' }],
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '请输入正确的邮箱格式', trigger: 'blur' }
  ],
  password: [
    { min: 8, message: '密码至少 8 位', trigger: 'blur' },
    { pattern: /[a-zA-Z]/, message: '密码必须包含字母', trigger: 'blur' },
    { pattern: /[0-9]/, message: '密码必须包含数字', trigger: 'blur' }
  ]
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

const adminCount = computed(() => users.value.filter((user) => user.isAdmin).length);
const loggedInCount = computed(() => users.value.filter((user) => Boolean(user.lastLoginAt)).length);
const userHighlights = computed(() => [
  { label: `总用户 ${pagination.total}`, tone: 'neutral' as const },
  { label: `当前页管理员 ${adminCount.value}`, tone: 'danger' as const },
  { label: `当前页已登录 ${loggedInCount.value}`, tone: 'success' as const }
]);

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
    toast.error('加载用户列表失败');
  } finally {
    loading.value = false;
  }
};

let searchTimer: ReturnType<typeof setTimeout> | null = null;

const handleSearch = () => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    pagination.page = 1;
    loadUsers();
  }, 300);
};

const handleSearchImmediate = () => {
  if (searchTimer) clearTimeout(searchTimer);
  pagination.page = 1;
  loadUsers();
};

const handleFilter = () => {
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
  const valid = await createFormRef.value?.validate().catch(() => false);
  if (!valid) return;

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
    toast.success('用户创建成功');
    createVisible.value = false;
    loadUsers();
  } catch (error: any) {
    toast.error(error?.response?.data?.error?.message || '创建用户失败');
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
    toast.success('删除成功');
    loadUsers();
    return true;
  } catch (error: any) {
    if (error !== 'cancel') {
      toast.error(error?.response?.data?.error?.message || '删除用户失败');
    }
    return false;
  }
};

const handleDeleteFromEdit = async () => {
  if (!editForm.id) {
    toast.warning('未选择可删除的用户');
    return;
  }
  const deleted = await handleDeleteUser({
    id: editForm.id,
    name: editForm.name,
    email: editForm.email
  });
  if (deleted) {
    closeEditDialog();
  }
};

const handleSelectionChange = (rows: any[]) => {
  selectedUserIds.value = rows.map(row => row.id);
};

const handleBatchDelete = async () => {
  if (selectedUserIds.value.length === 0) return;

  batchDeleting.value = true;
  try {
    await ElMessageBox.confirm(
      `确认批量删除 ${selectedUserIds.value.length} 个用户吗？该操作不可恢复。`,
      '批量删除用户',
      { type: 'warning' }
    );
    const response: any = await adminUsersApi.batchDeleteUsers(selectedUserIds.value);
    toast.success(`批量删除成功，已删除 ${response.data?.data?.deletedCount ?? selectedUserIds.value.length} 个用户`);
    loadUsers();
  } catch (error: any) {
    if (error !== 'cancel') {
      toast.error(error?.response?.data?.error?.message || '批量删除失败');
    }
  } finally {
    batchDeleting.value = false;
  }
};

const openEditDialog = (row: any) => {
  if (!row || !row.id) {
    toast.warning('用户数据无效');
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
  const valid = await editFormRef.value?.validate().catch(() => false);
  if (!valid) return;

  updating.value = true;
  try {
    await adminUsersApi.updateUser(editForm.id, {
      name: editForm.name,
      email: editForm.email,
      isAdmin: editForm.isAdmin,
      ...(editForm.password ? { password: editForm.password } : {})
    });
    toast.success('用户更新成功');
    editVisible.value = false;
    loadUsers();
  } catch (error: any) {
    toast.error(error?.response?.data?.error?.message || '更新用户失败');
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
  gap: 16px;
}

.users-summary-grid {
  margin-top: -4px;
}

.users-summary-card__meta {
  margin-top: 6px;
  font-size: 0.82rem;
  color: var(--admin-text-secondary);
}

.users-filter-panel {
  gap: 14px;
}

.users-filter-panel__head {
  margin-bottom: 0;
}

.users-filter-panel__summary {
  color: var(--admin-text-secondary);
  font-size: 12px;
  font-weight: 600;
}

.users-filter-toolbar__note {
  margin: 0;
  color: var(--admin-text-muted);
  font-size: 12px;
}

/* 表格 */
.table-container {
  position: relative;
}

.table-container :deep(.el-table) {
  border-radius: var(--fluent-radius-md);
  overflow: visible;
  width: 100%;
  --el-table-bg-color: transparent;
  --el-bg-color: transparent;
  --el-fill-color-blank: transparent;
}

.table-container :deep(.el-table__body-wrapper) {
  overflow-x: auto;
}

.user-primary-cell {
  display: grid;
  gap: 4px;
}

.user-primary-cell strong {
  font-size: 0.92rem;
  font-weight: 600;
  color: var(--text-primary);
}

.user-id-cell {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 0.72rem;
  line-height: 1.3;
  color: var(--text-muted);
}

:deep(.el-table .cell) {
  word-break: break-word;
}

.row-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
}

.users-action-btn {
  min-height: 30px;
  padding: 0 12px;
  border-radius: 999px;
  border: 1px solid rgba(52, 120, 246, 0.16);
  background: rgba(245, 249, 255, 0.96);
  color: var(--admin-text-brand);
  font-size: 0.8125rem;
  font-weight: 700;
}

.users-action-btn:hover {
  border-color: rgba(52, 120, 246, 0.28);
  background: rgba(238, 244, 255, 0.98);
  color: var(--color-primary-dark, #1f57cc);
}

:deep(.el-table th.el-table__cell) {
  background: rgba(52, 120, 246, 0.03);
  font-weight: 700;
}
:deep(.el-table .el-table__row:hover > td.el-table__cell) {
  background: rgba(52, 120, 246, 0.03);
}

/* 分页 */
.pagination-container {
  margin-top: 0.5rem;
}

/* Drawer 样式 */
.drawer-content {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.drawer-hero {
  padding-bottom: 20px;
  border-bottom: var(--admin-border-subtle);
}

.drawer-hero__title {
  margin: 0 0 8px 0;
  font-size: 24px;
  font-weight: 700;
  color: var(--admin-text-primary);
  line-height: 1.2;
}

.drawer-hero__subtitle {
  margin: 0;
  font-size: 14px;
  color: var(--admin-text-secondary);
  font-family: var(--admin-font-mono);
}

.drawer-form {
  padding-top: 2px;
}

:deep(.drawer-form .el-form-item) {
  margin-bottom: 18px;
}

:deep(.drawer-form .el-input__wrapper),
:deep(.drawer-form .el-select__wrapper) {
  border-radius: 12px;
}

.drawer-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

@media (max-width: 768px) {
  .users-filter-panel__head {
    align-items: flex-start;
  }
}
</style>
