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

        <el-form-item label="邮箱" prop="email">
          <el-input
            v-model="registerForm.email"
            type="email"
            placeholder="请输入邮箱"
          />
        </el-form-item>

        <el-form-item label="密码" prop="password">
          <el-input
            v-model="registerForm.password"
            type="password"
            placeholder="请输入密码"
            show-password
          />
        </el-form-item>

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
  email: '',
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

const rules: FormRules = {
  name: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    { min: 2, max: 20, message: '用户名长度在 2 到 20 个字符', trigger: 'blur' }
  ],
  email: [
    { required: true, message: '请输入邮箱', trigger: 'blur' },
    { type: 'email', message: '请输入正确的邮箱格式', trigger: 'blur' }
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: 6, message: '密码长度不能少于6位', trigger: 'blur' }
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
        await userStore.register(registerForm.email, registerForm.password, registerForm.name);
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
