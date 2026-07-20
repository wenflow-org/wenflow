<template>
  <div class="mk-page">
    <!-- 单行健康条 -->
    <div class="mk-status" :class="filled ? 'mk-status--ok' : 'mk-status--warn'">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">{{ filled ? '模型服务已就绪' : '配置尚未完成' }}</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">密钥 {{ keySet ? '已配置' : '未配置' }}</span>
      <span class="mk-status__meta">模型 {{ models.length }}</span>
      <span class="mk-status__meta">路由 3/3</span>
      <button type="button" class="mk-status__action" :disabled="fetching" @click="fetchModels">
        <span v-if="fetching"><span class="mk-spinner"></span> 拉取中…</span>
        <span v-else>{{ filled ? '重新拉取' : '连接并拉取' }}</span>
      </button>
    </div>

    <div v-if="toast" class="mk-toast" :class="toastCls">{{ toast }}</div>

    <div class="ac-grid">
      <!-- 接入与模型 -->
      <section class="mk-card ac-main">
        <div class="mk-card__head">
          <h3 class="mk-card__title">接入与模型</h3>
          <span class="mk-badge" :class="filled ? 'mk-badge--ok' : 'mk-badge--muted'">{{ filled ? '连接正常' : '待配置' }}</span>
        </div>
        <div class="ac-form">
          <div class="ac-row ac-row--2-1">
            <label class="ac-field">
              <span>服务地址</span>
              <input class="mk-filter__input" :value="keySet ? 'https://api.deepseek.com/v1' : ''" placeholder="https://api.example.com/v1" @input="dirty++" />
            </label>
            <label class="ac-field">
              <span>API Key</span>
              <input class="mk-filter__input" type="password" :value="keySet ? 'sk-demo-key' : ''" :placeholder="keySet ? '留空则沿用' : '输入 API Key'" @input="dirty++" />
            </label>
          </div>
          <label class="ac-field">
            <span>可用模型</span>
            <div class="ac-models">
              <span v-for="m in models" :key="m" class="ac-model">{{ m }}</span>
              <span v-if="!models.length" class="mk-na">先在上方连接并拉取模型</span>
            </div>
          </label>
          <div class="ac-row ac-row--3">
            <label class="ac-field">
              <span>对话默认</span>
              <select class="mk-filter__select" :disabled="!models.length"><option>{{ filled ? 'deepseek-v4-flash' : '未设置' }}</option></select>
            </label>
            <label class="ac-field">
              <span>推理默认</span>
              <select class="mk-filter__select" :disabled="!models.length"><option>{{ filled ? 'deepseek-v4-pro' : '未设置' }}</option></select>
            </label>
            <label class="ac-field">
              <span>评估默认</span>
              <select class="mk-filter__select" :disabled="!models.length"><option>{{ filled ? 'deepseek-v4-pro' : '未设置' }}</option></select>
            </label>
          </div>
        </div>
      </section>

      <!-- 验证工具 -->
      <section class="mk-card ac-side">
        <div class="mk-card__head">
          <h3 class="mk-card__title">连通性验证</h3>
          <span class="mk-badge" :class="testPassed ? 'mk-badge--ok' : 'mk-badge--muted'">{{ testPassed ? '测试通过' : '未执行' }}</span>
        </div>
        <div class="ac-form">
          <label class="ac-field">
            <span>测试模型</span>
            <select class="mk-filter__select" :disabled="!models.length">
              <option v-for="m in models" :key="m">{{ m }}</option>
              <option v-if="!models.length">无可用模型</option>
            </select>
          </label>
          <div v-if="testPassed" class="ac-result">
            <div class="ac-result__meta">
              <span>238ms</span>
              <span class="mono">P 12 / C 9 / T 21</span>
            </div>
            <p>「模型测试成功。」</p>
          </div>
          <button type="button" class="ac-run" :disabled="!models.length || testing" @click="runTest">
            <span v-if="testing"><span class="mk-spinner"></span> 测试中…</span>
            <span v-else>运行测试</span>
          </button>
        </div>
      </section>
    </div>

    <!-- 网络边界（全宽） -->
    <section class="mk-card">
      <div class="mk-card__head">
        <h3 class="mk-card__title">网络边界</h3>
        <span class="mk-badge mk-badge--info">平台策略 · 热生效</span>
      </div>
      <div class="ac-policy">
        <div class="ac-policy__item">
          <span class="ac-policy__label">Admin 访问范围</span>
          <div class="ac-seg">
            <button type="button" class="ac-seg__item">仅本机</button>
            <button type="button" class="ac-seg__item ac-seg__item--active">本机 + 局域网</button>
            <button type="button" class="ac-seg__item">不限制</button>
          </div>
        </div>
        <div class="ac-policy__item">
          <span class="ac-policy__label">私有网络服务</span>
          <div class="ac-seg">
            <button type="button" class="ac-seg__item ac-seg__item--active">允许</button>
            <button type="button" class="ac-seg__item">白名单</button>
          </div>
        </div>
      </div>
    </section>

    <!-- 保存条 -->
    <div v-if="dirty > 0" class="ac-save">
      <span class="ac-save__dot"></span>
      <span>{{ dirty }} 项未保存变更</span>
      <button type="button" class="mk-link" @click="discardAll">放弃</button>
      <button type="button" class="ac-save__primary" @click="saveAll">保存变更</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = defineProps<{ state: 'ready' | 'incomplete' }>()

/* 功能状态：拉取/测试/保存全部可操作 */
const keySet = ref(props.state === 'ready')
const filled = ref(props.state === 'ready')
const fetching = ref(false)
const testing = ref(false)
const testPassed = ref(false)
const dirty = ref(props.state === 'ready' ? 2 : 0)
const toast = ref('')
const toastCls = ref('mk-toast--ok')
let toastTimer: ReturnType<typeof setTimeout> | null = null

watch(
  () => props.state,
  (s) => {
    keySet.value = s === 'ready'
    filled.value = s === 'ready'
    testPassed.value = false
    dirty.value = s === 'ready' ? 2 : 0
  }
)

const models = computed(() =>
  filled.value
    ? ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-v4-lite', 'deepseek-v4-vision', 'qwen3-32b', 'qwen3-14b']
    : []
)

function showToast(msg: string, cls = 'mk-toast--ok') {
  toast.value = msg
  toastCls.value = cls
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = ''), 3000)
}

function fetchModels() {
  if (fetching.value) return
  fetching.value = true
  setTimeout(() => {
    fetching.value = false
    keySet.value = true
    filled.value = true
    dirty.value += 1
    showToast(`已获取 ${models.value.length} 个模型，记得保存`)
  }, 900)
}

function runTest() {
  if (testing.value || !models.value.length) return
  testing.value = true
  setTimeout(() => {
    testing.value = false
    testPassed.value = true
    showToast('测试通过 · 238ms')
  }, 800)
}

function saveAll() {
  dirty.value = 0
  showToast('连接与安全配置已保存')
}

function discardAll() {
  dirty.value = 0
  showToast('已放弃未保存的变更', 'mk-toast--info')
}
</script>

<style scoped>
.ac-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 14px;
  align-items: start;
}
.ac-form { display: grid; gap: 14px; padding: 16px; }
.ac-row { display: grid; gap: 12px; }
.ac-row--2-1 { grid-template-columns: 1.6fr 1fr; }
.ac-row--3 { grid-template-columns: repeat(3, 1fr); }
.ac-field { display: grid; gap: 6px; }
.ac-field > span { font-size: 12px; font-weight: 700; color: var(--mk-muted); }
.ac-field .mk-filter__input,
.ac-field .mk-filter__select { width: 100%; }

.ac-models { display: flex; gap: 6px; flex-wrap: wrap; }
.ac-model {
  padding: 4px 10px;
  border-radius: 7px;
  background: #eef2fa;
  color: var(--mk-muted);
  font-family: var(--mk-mono);
  font-size: 11.5px;
  font-weight: 600;
}

.ac-result {
  border: 1px solid var(--mk-line);
  border-radius: 10px;
  padding: 10px 12px;
  display: grid;
  gap: 6px;
  background: #fafbfc;
}
.ac-result__meta { display: flex; justify-content: space-between; font-size: 11.5px; color: var(--mk-faint); }
.ac-result p { margin: 0; font-size: 12.5px; }
.ac-run {
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--mk-line);
  background: var(--mk-surface);
  color: var(--mk-blue);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}
.ac-run:disabled { opacity: 0.5; cursor: not-allowed; }

.ac-policy {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  padding: 16px;
}
.ac-policy__item { display: grid; gap: 8px; }
.ac-policy__label { font-size: 12px; font-weight: 700; color: var(--mk-muted); }
.ac-seg { display: inline-flex; gap: 4px; padding: 3px; background: #eef2fa; border-radius: 10px; width: fit-content; }
.ac-seg__item {
  border: 0;
  background: transparent;
  padding: 6px 12px;
  border-radius: 7px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  color: var(--mk-muted);
  cursor: pointer;
}
.ac-seg__item--active { background: #fff; color: var(--mk-ink); box-shadow: 0 1px 2px rgba(23, 32, 51, 0.1); }

.ac-save {
  position: sticky;
  bottom: 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  width: fit-content;
  margin: 4px auto 0;
  padding: 9px 12px 9px 16px;
  border-radius: 999px;
  border: 1px solid rgba(52, 120, 246, 0.24);
  background: var(--mk-surface);
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.16);
  font-weight: 600;
}
.ac-save__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--mk-amber); }
.ac-save__primary {
  padding: 6px 14px;
  border-radius: 999px;
  border: 0;
  background: var(--mk-blue);
  color: #fff;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
}

@media (max-width: 900px) {
  .ac-grid { grid-template-columns: 1fr; }
  .ac-policy { grid-template-columns: 1fr; }
}
</style>
