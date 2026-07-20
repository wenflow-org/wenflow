<template>
  <div class="mk-page">
    <!-- 单行健康条 -->
    <div class="mk-status" :class="ready ? 'mk-status--ok' : 'mk-status--warn'">
      <span class="mk-status__dot"></span>
      <strong class="mk-status__title">{{ ready ? '模型服务已就绪' : '配置尚未完成' }}</strong>
      <span class="mk-status__sep"></span>
      <span class="mk-status__meta">密钥 {{ ready ? '已配置' : '未配置' }}</span>
      <span class="mk-status__meta">模型 {{ models.length }}</span>
      <span class="mk-status__meta">路由 3/3</span>
      <button type="button" class="mk-status__action">重新拉取</button>
    </div>

    <div class="ac-grid">
      <!-- 接入与模型 -->
      <section class="mk-card ac-main">
        <div class="mk-card__head">
          <h3 class="mk-card__title">接入与模型</h3>
          <span class="mk-badge" :class="ready ? 'mk-badge--ok' : 'mk-badge--muted'">{{ ready ? '连接正常' : '待配置' }}</span>
        </div>
        <div class="ac-form">
          <div class="ac-row ac-row--2-1">
            <label class="ac-field">
              <span>服务地址</span>
              <input class="mk-filter__input" :value="ready ? 'https://api.deepseek.com/v1' : ''" placeholder="https://api.example.com/v1" />
            </label>
            <label class="ac-field">
              <span>API Key</span>
              <input class="mk-filter__input" type="password" :value="ready ? 'sk-demo-key' : ''" :placeholder="ready ? '留空则沿用' : '输入 API Key'" />
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
              <select class="mk-filter__select"><option>{{ ready ? 'deepseek-v4-flash' : '未设置' }}</option></select>
            </label>
            <label class="ac-field">
              <span>推理默认</span>
              <select class="mk-filter__select"><option>{{ ready ? 'deepseek-v4-pro' : '未设置' }}</option></select>
            </label>
            <label class="ac-field">
              <span>评估默认</span>
              <select class="mk-filter__select"><option>{{ ready ? 'deepseek-v4-pro' : '未设置' }}</option></select>
            </label>
          </div>
        </div>
      </section>

      <!-- 验证工具 -->
      <section class="mk-card ac-side">
        <div class="mk-card__head">
          <h3 class="mk-card__title">连通性验证</h3>
          <span class="mk-badge" :class="ready ? 'mk-badge--ok' : 'mk-badge--muted'">{{ ready ? '测试通过' : '未执行' }}</span>
        </div>
        <div class="ac-form">
          <label class="ac-field">
            <span>测试模型</span>
            <select class="mk-filter__select"><option>{{ ready ? 'deepseek-v4-flash' : '无可用模型' }}</option></select>
          </label>
          <div v-if="ready" class="ac-result">
            <div class="ac-result__meta">
              <span>238ms</span>
              <span class="mono">P 12 / C 9 / T 21</span>
            </div>
            <p>「模型测试成功。」</p>
          </div>
          <button type="button" class="ac-run" :disabled="!ready">运行测试</button>
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
    <div class="ac-save">
      <span class="ac-save__dot"></span>
      <span>2 项未保存变更</span>
      <button type="button" class="mk-link">放弃</button>
      <button type="button" class="ac-save__primary">保存变更</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ state: 'ready' | 'incomplete' }>()
const ready = computed(() => props.state === 'ready')
const models = computed(() =>
  ready.value
    ? ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-v4-lite', 'deepseek-v4-vision', 'qwen3-32b', 'qwen3-14b']
    : []
)
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
