<template>
  <div class="register-page">
    <el-card class="register-card">
      <template #header>
        <div class="card-header">
          <div class="header-top">
            <ThemeSwitcher />
          </div>
          <h2>注册</h2>
        </div>
      </template>

      <el-form
        :model="registerForm"
        :rules="rules"
        ref="formRef"
        label-position="top"
        size="large"
      >
        <el-form-item label="用户名" prop="name">
          <el-input
            v-model="registerForm.name"
            placeholder="请输入用户名"
          />
        </el-form-item>

        <el-form-item label="密码" prop="password">
          <el-input
            v-model="registerForm.password"
            type="password"
            placeholder="至少 8 位，需包含字母和数字"
            show-password
          />
        </el-form-item>

        <div class="password-hint">密码至少 8 位，且必须同时包含字母和数字。</div>

        <el-form-item label="确认密码" prop="confirmPassword">
          <el-input
            v-model="registerForm.confirmPassword"
            type="password"
            placeholder="请再次输入密码"
            show-password
          />
        </el-form-item>

        <el-form-item>
          <el-button
            type="primary"
            @click="handleRegister"
            :loading="loading"
            style="width: 100%"
          >
            注册
          </el-button>
        </el-form-item>

        <div class="footer">
          <span>已有账号？</span>
          <el-link type="primary" @click="$router.push('/login')">
            立即登录
          </el-link>
        </div>
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { useUserStore } from '../stores/user';
import ThemeSwitcher from '../components/ThemeSwitcher.vue';

const router = useRouter();
const userStore = useUserStore();
const formRef = ref<FormInstance>();
const loading = ref(false);

const registerForm = reactive({
  name: '',
  password: '',
  confirmPassword: ''
});

const validatePass2 = (rule: any, value: any, callback: any) => {
  if (value === '') {
    callback(new Error('请再次输入密码'));
  } else if (value !== registerForm.password) {
    callback(new Error('两次输入密码不一致'));
  } else {
    callback();
  }
};

const validatePassword = (rule: any, value: string, callback: any) => {
  if (!value) {
    callback(new Error('请输入密码'));
    return;
  }
  if (value.length < 8) {
    callback(new Error('密码长度不能少于 8 位'));
    return;
  }
  if (!/[a-zA-Z]/.test(value)) {
    callback(new Error('密码必须包含字母'));
    return;
  }
  if (!/[0-9]/.test(value)) {
    callback(new Error('密码必须包含数字'));
    return;
  }
  callback();
};

const rules: FormRules = {
  name: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 2, max: 20, message: '用户名长度在 2 到 20 个字符', trigger: 'blur' }
  ],
  password: [
    { required: true, validator: validatePassword, trigger: 'blur' }
  ],
  confirmPassword: [
    { required: true, validator: validatePass2, trigger: 'blur' }
  ]
};

const handleRegister = async () => {
  if (!formRef.value) return;

  await formRef.value.validate(async (valid) => {
    if (valid) {
      loading.value = true;

      try {
        await userStore.register(registerForm.name, registerForm.password);
        ElMessage.success('注册成功');
        router.push('/dashboard');
      } catch (error: any) {
        ElMessage.error(error.message || '注册失败，请稍后重试');
      } finally {
        loading.value = false;
      }
    }
  });
};
</script>

<style scoped>
.register-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-secondary) 100%);
  padding: 20px;
  transition: background var(--transition-normal);
}

[data-theme="dark"] .register-page {
  background: linear-gradient(135deg, var(--color-primary-dark) 0%, var(--color-secondary-dark) 100%);
}

.register-card {
  width: 100%;
  max-width: 400px;
}

.password-hint {
  margin: -4px 0 14px;
  font-size: 12px;
  color: var(--text-secondary, #606266);
}

.card-header {
  text-align: center;
}

.card-header .header-top {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 1rem;
}

.card-header h2 {
  margin: 0;
  color: var(--text-primary);
  transition: color var(--transition-normal);
}

.footer {
  text-align: center;
  color: var(--text-secondary);
  transition: color var(--transition-normal);
}

.footer span {
  margin-right: 5px;
}
</style>
