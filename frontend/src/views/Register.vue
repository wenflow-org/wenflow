<template>
  <div class="register-page">
    <el-card class="register-card">
      <template #header>
        <div class="card-header">
          <div class="header-top">
            <ThemeSwitcher />
          </div>
          <h2>娉ㄥ唽</h2>
        </div>
      </template>

      <el-form
        :model="registerForm"
        :rules="rules"
        ref="formRef"
        label-position="top"
        size="large"
      >
        <el-form-item label="鐢ㄦ埛鍚? prop="name">
          <el-input
            v-model="registerForm.name"
            placeholder="璇疯緭鍏ョ敤鎴峰悕"
          />
        </el-form-item>

        <el-form-item label="閭" prop="email">
          <el-input
            v-model="registerForm.name"
            type="text"
            placeholder="璇疯緭鍏ラ偖绠?
          />
        </el-form-item>

        <el-form-item label="瀵嗙爜" prop="password">
          <el-input
            v-model="registerForm.password"
            type="password"
            placeholder="璇疯緭鍏ュ瘑鐮?
            show-password
          />
        </el-form-item>

        <el-form-item label="纭瀵嗙爜" prop="confirmPassword">
          <el-input
            v-model="registerForm.confirmPassword"
            type="password"
            placeholder="璇峰啀娆¤緭鍏ュ瘑鐮?
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
            娉ㄥ唽
          </el-button>
        </el-form-item>

        <div class="footer">
          <span>宸叉湁璐﹀彿锛?/span>
          <el-link type="primary" @click="$router.push('/login')">
            绔嬪嵆鐧诲綍
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
  name: '',
  password: '',
  confirmPassword: ''
});

const validatePass2 = (rule: any, value: any, callback: any) => {
  if (value === '') {
    callback(new Error('璇峰啀娆¤緭鍏ュ瘑鐮?));
  } else if (value !== registerForm.password) {
    callback(new Error('涓ゆ杈撳叆瀵嗙爜涓嶄竴鑷?));
  } else {
    callback();
  }
};

const rules: FormRules = {
  name: [
    { required: true, message: '璇疯緭鍏ョ敤鎴峰悕', trigger: 'blur' },
    { min: 2, max: 20, message: '鐢ㄦ埛鍚嶉暱搴﹀湪 2 鍒?20 涓瓧绗?, trigger: 'blur' }
  ],
  email: [
    { required: true, message: '璇疯緭鍏ラ偖绠?, trigger: 'blur' },
    { type: 'email', message: '璇疯緭鍏ユ纭殑閭鏍煎紡', trigger: 'blur' }
  ],
  password: [
    { required: true, message: '璇疯緭鍏ュ瘑鐮?, trigger: 'blur' },
    { min: 6, message: '瀵嗙爜闀垮害涓嶈兘灏戜簬6浣?, trigger: 'blur' }
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
        ElMessage.success('娉ㄥ唽鎴愬姛');
        router.push('/dashboard');
      } catch (error: any) {
        ElMessage.error(error.message || '娉ㄥ唽澶辫触锛岃绋嶅悗閲嶈瘯');
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
