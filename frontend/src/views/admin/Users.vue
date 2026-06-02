<template>
  <div class="admin-users">
    <div class="users-bg-layer">
      <div class="users-bg-orb users-bg-orb--1"></div>
      <div class="users-bg-orb users-bg-orb--2"></div>
    </div>

    <div class="page-hero">
      <span class="pill">账户管理</span>
      <h1 class="page-hero__title admin-page-title">
        <el-icon class="admin-page-title__icon"><User /></el-icon>
        管理系统用户账号
      </h1>
      <p class="page-hero__subtitle">查看账户身份、角色与登录情况</p>
    </div>

    <!-- 筛选工具栏 -->
    <div class="toolbar admin-list-toolbar">
      <div class="toolbar-left admin-list-toolbar__group">
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

      <div class="toolbar-right admin-list-toolbar__group">
        <el-button type="primary" class="users-btn users-btn--primary" @click="openCreateDialog">
          新建用户
        </el-button>
        <el-button v-if="selectedUserIds.length > 0" class="users-btn users-btn--danger-ghost" :loading="batchDeleting" @click="handleBatchDelete">
          批量删除 ({{ selectedUserIds.length }})
        </el-button>
      </div>
    </div>

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

    <el-dialog 
      v-model="createVisible" 
      title="新建用户" 
      width="520px"
      class="admin-user-dialog"
      :close-on-click-modal="false"
      :close-on-press-escape="true"
      destroy-on-close
      append-to-body
      @close="closeCreateDialog"
    >
      <el-form ref="createFormRef" class="admin-user-form" :model="createForm" :rules="createRules" label-width="100px">
        <el-form-item label="昵称" prop="name">
          <el-input v-model="createForm.name" placeholder="请输入昵称" />
        </el-form-item>
        <el-form-item label="邮箱" prop="email">
          <el-input v-model="createForm.email" placeholder="请输入邮箱" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input v-model="createForm.password" type="password" show-password placeholder="至少 8 位，需包含字母和数字" />
        </el-form-item>
        <el-form-item label="管理员">
          <el-switch v-model="createForm.isAdmin" />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="admin-user-dialog__footer">
          <el-button class="users-btn users-btn--ghost" @click="closeCreateDialog">取消</el-button>
          <el-button type="primary" class="users-btn users-btn--primary" :loading="creating" @click="handleCreateUser">创建</el-button>
        </div>
      </template>
    </el-dialog>

    <el-dialog 
      v-model="editVisible" 
      title="编辑用户" 
      width="520px"
      class="admin-user-dialog"
      :close-on-click-modal="false"
      :close-on-press-escape="true"
      destroy-on-close
      append-to-body
      @close="closeEditDialog"
    >
      <el-form ref="editFormRef" class="admin-user-form" :model="editForm" :rules="editRules" label-width="100px">
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
          <el-input v-model="editForm.password" type="password" show-password placeholder="留空表示不修改；如填写需满足 8 位+字母+数字" />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="admin-user-dialog__footer">
          <el-button class="users-btn users-btn--danger-ghost" @click="handleDeleteFromEdit">删除用户</el-button>
          <el-button class="users-btn users-btn--ghost" @click="closeEditDialog">取消</el-button>
          <el-button type="primary" class="users-btn users-btn--primary" :loading="updating" @click="handleUpdateUser">保存</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { adminUsersApi } from '@/api/adminApi';
import { User, Search } from '@element-plus/icons-vue';
import { ElMessageBox } from 'element-plus';
import type { FormInstance } from 'element-plus';
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
  padding: 0;
  position: relative;
  overflow: hidden;
}

.users-bg-layer {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  overflow: hidden;
}
.users-bg-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(110px);
  opacity: 0.15;
}
.users-bg-orb--1 {
  width: 460px;
  height: 460px;
  top: -180px;
  right: -120px;
  background: radial-gradient(circle, rgba(52, 120, 246, 0.3), transparent 70%);
  animation: users-orb 26s ease-in-out infinite;
}
.users-bg-orb--2 {
  width: 380px;
  height: 380px;
  left: -100px;
  bottom: 120px;
  background: radial-gradient(circle, rgba(141, 107, 255, 0.2), transparent 70%);
  animation: users-orb 30s ease-in-out infinite reverse;
}
@keyframes users-orb {
  0%, 100% { transform: translate(0, 0) scale(1); }
  33% { transform: translate(30px, -20px) scale(1.05); }
  66% { transform: translate(-20px, 30px) scale(0.95); }
}

.page-hero {
  position: relative;
  z-index: 1;
  padding: 24px 28px;
  border-radius: 20px;
  border: 1px solid rgba(52, 120, 246, 0.08);
  background: radial-gradient(circle at top right, rgba(52, 120, 246, 0.06), transparent 34%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(244, 247, 252, 0.92));
  backdrop-filter: blur(16px);
  margin-bottom: 1.5rem;
}
.page-hero__title { margin: 8px 0 0; font-size: 1.5rem; font-weight: 700; color: var(--text-primary); letter-spacing: -0.03em; }
.page-hero__subtitle { margin: 4px 0 0; color: var(--text-secondary); font-size: 0.9375rem; }
.pill {
  display: inline-flex; align-items: center; width: fit-content; min-height: 26px; padding: 0 12px;
  border-radius: 999px; background: color-mix(in srgb, var(--color-primary) 10%, white);
  color: var(--color-primary-dark, #1f57cc); font-size: 12px; font-weight: 700;
}

/* 工具栏 */
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
  padding: 1rem;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.6), rgba(244, 247, 252, 0.72));
  border: 1px solid var(--glass-border-light);
  border-radius: 18px;
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  box-shadow: var(--shadow-sm);
  position: relative;
  z-index: 1;
}

.toolbar-left {
  display: flex;
  align-items: center;
}

.toolbar-right {
  display: flex;
  gap: 0.5rem;
}

.users-btn {
  min-height: 38px;
  border-radius: 14px;
  font-weight: 700;
}

.users-btn--primary {
  border-color: transparent;
}

.users-btn--neutral {
  border: 1px solid rgba(52, 120, 246, 0.2);
  background: color-mix(in srgb, var(--color-primary) 8%, white);
  color: var(--color-primary-dark, #1f57cc);
}

.users-btn--neutral:hover {
  border-color: rgba(52, 120, 246, 0.32);
  background: color-mix(in srgb, var(--color-primary) 12%, white);
}

.users-btn--ghost {
  border: 1px solid var(--border-light);
  background: color-mix(in srgb, var(--bg-surface) 80%, white);
  color: var(--text-primary);
}

.users-btn--ghost:hover {
  border-color: color-mix(in srgb, var(--color-primary) 30%, var(--border-light));
  background: color-mix(in srgb, var(--color-primary) 6%, white);
}

.users-btn--danger-ghost {
  border: 1px solid color-mix(in srgb, var(--color-danger) 36%, white);
  background: color-mix(in srgb, var(--color-danger) 8%, white);
  color: var(--color-danger-dark, #d95054);
}

.users-btn--danger-ghost:hover {
  border-color: color-mix(in srgb, var(--color-danger) 52%, white);
  background: color-mix(in srgb, var(--color-danger) 12%, white);
}

.users-btn--danger-ghost.is-disabled,
.users-btn--danger-ghost.is-disabled:hover {
  border-color: var(--border-light);
  background: var(--bg-subtle);
  color: var(--text-disabled);
}

/* 表格 */
.table-container {
  overflow-x: auto;
  max-width: 100%;
  border-radius: 20px;
  border: 1px solid var(--glass-border-light);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.6), rgba(244, 247, 252, 0.72));
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  box-shadow: var(--shadow-sm);
  padding: 0.25rem;
  width: 100%;
  -webkit-overflow-scrolling: touch;
  position: relative;
  z-index: 1;
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
  color: var(--color-primary-dark, #1f57cc);
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
  margin-top: 2rem;
  display: flex;
  justify-content: flex-end;
}

:deep(.admin-user-dialog .el-dialog) {
  border-radius: 18px;
  border: 1px solid rgba(52, 120, 246, 0.12);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(246, 248, 252, 0.96));
  box-shadow: 0 20px 44px rgba(24, 36, 72, 0.18);
}

:deep(.admin-user-dialog .el-dialog__header) {
  margin: 0;
  padding: 18px 22px 14px;
  border-bottom: 1px solid rgba(52, 120, 246, 0.08);
}

:deep(.admin-user-dialog .el-dialog__title) {
  font-weight: 700;
  letter-spacing: -0.01em;
}

:deep(.admin-user-dialog .el-dialog__body) {
  padding: 18px 22px 8px;
}

:deep(.admin-user-dialog .el-dialog__footer) {
  padding: 12px 22px 18px;
}

.admin-user-form {
  padding-top: 2px;
}

:deep(.admin-user-form .el-form-item) {
  margin-bottom: 18px;
}

:deep(.admin-user-form .el-input__wrapper),
:deep(.admin-user-form .el-select__wrapper) {
  border-radius: 12px;
}

.admin-user-dialog__footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
