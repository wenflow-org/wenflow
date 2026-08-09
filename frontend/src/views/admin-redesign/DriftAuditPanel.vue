<template>
  <div class="fdp">
    <!-- 新建字段 -->
    <details class="fdp__box">
      <summary class="fdp__box-summary">新建字段（仅 soft-info / hidden-inference / derived-presentation 可建）</summary>
      <div class="fdp__newfield">
        <input v-model="newField.fieldId" class="fdp__input mono" placeholder="fieldId（如 myField）" />
        <input v-model="newField.valueType" class="fdp__input mono" placeholder="valueType（如 string）" />
        <select v-model="newField.promptRole" class="fdp__input">
          <option value="soft-info">soft-info</option>
          <option value="hidden-inference">hidden-inference</option>
          <option value="derived-presentation">derived-presentation</option>
        </select>
        <input v-model="newField.description" class="fdp__input" placeholder="描述" />
        <button class="fdp__btn" :disabled="!newField.fieldId || !stage" @click="submitNewField">创建</button>
        <span v-if="newFieldMsg" class="fdp__msg">{{ newFieldMsg }}</span>
      </div>
    </details>

    <!-- 漂移报告 -->
    <details class="fdp__box" open>
      <summary class="fdp__box-summary">漂移报告（seed vs DB，admin 编辑行豁免）</summary>
      <div v-if="driftLoading" class="fdp__empty">检测中…</div>
      <div v-else-if="drift.items.length === 0" class="fdp__empty">✅ 无漂移（seed 与 DB 一致）</div>
      <ul v-else class="fdp__drift-list">
        <li v-for="(d, i) in drift.items" :key="i" class="fdp__drift-item">
          <span class="mono fdp__drift-kind">{{ d.kind }}</span>
          <span class="mono fdp__drift-key">{{ d.key }}</span>
          <span class="fdp__drift-field">{{ d.field }}</span>
          <span class="mono fdp__drift-val fdp__drift-val--seed">seed={{ stringify(d.seedValue) }}</span>
          <span class="mono fdp__drift-val fdp__drift-val--db">db={{ stringify(d.dbValue) }}</span>
        </li>
      </ul>
      <p v-if="drift.totalDriftCount > drift.items.length" class="fdp__empty">（共 {{ drift.totalDriftCount }} 项，当前筛选显示 {{ drift.items.length }}）</p>
    </details>

    <!-- 审计 -->
    <details class="fdp__box">
      <summary class="fdp__box-summary">最近变更（审计）</summary>
      <ul v-if="changes.length" class="fdp__changes-list">
        <li v-for="(c, i) in changes" :key="i" class="fdp__change">
          <span class="fdp__change-kind">{{ String(c.changeType || '—') }}</span>
          <span class="fdp__change-target">{{ String(c.targetTable || '') }}</span>
          <span class="mono">{{ String(c.targetId || '') }}</span>
        </li>
      </ul>
      <p v-else class="fdp__empty">暂无变更记录</p>
    </details>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { adminFieldRoutingsApi } from '@/api/adminApi';

const props = defineProps<{ stage: string }>();
const emit = defineEmits<{ changed: [] }>();

const newField = ref({ fieldId: '', valueType: '', promptRole: 'soft-info', description: '' });
const newFieldMsg = ref('');
const drift = ref<{ items: Array<Record<string, unknown>>; totalDriftCount: number }>({ items: [], totalDriftCount: 0 });
const driftLoading = ref(false);
const changes = ref<Array<Record<string, unknown>>>([]);

function stringify(value: unknown) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value) || typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

async function loadDrift() {
  driftLoading.value = true;
  try {
    const res = await adminFieldRoutingsApi.getDrift();
    drift.value = res.data?.data || { items: [], totalDriftCount: 0 };
  } catch {
    drift.value = { items: [], totalDriftCount: 0 };
  } finally {
    driftLoading.value = false;
  }
}

async function loadChanges() {
  try {
    const c = await adminFieldRoutingsApi.getChanges({ stage: props.stage, limit: 10 });
    changes.value = Array.isArray(c.data?.data) ? c.data.data : (c.data?.data?.changes || []);
  } catch {
    changes.value = [];
  }
}

async function submitNewField() {
  newFieldMsg.value = '';
  if (!newField.value.fieldId || !props.stage) return;
  try {
    await adminFieldRoutingsApi.createField({
      fieldId: newField.value.fieldId,
      stage: props.stage,
      promptRole: newField.value.promptRole as 'soft-info' | 'hidden-inference' | 'derived-presentation',
      valueType: newField.value.valueType || undefined,
      description: newField.value.description || undefined,
    });
    newFieldMsg.value = '创建成功';
    newField.value = { fieldId: '', valueType: '', promptRole: 'soft-info', description: '' };
    await Promise.all([loadDrift(), loadChanges()]);
    emit('changed');
  } catch (e: any) {
    newFieldMsg.value = e?.message || '创建失败';
  }
}

defineExpose({ reload: () => Promise.all([loadDrift(), loadChanges()]) });

onMounted(() => {
  void loadDrift();
  void loadChanges();
});

// 切换阶段时刷新（审计按 stage 过滤）
watch(() => props.stage, () => {
  void loadDrift();
  void loadChanges();
});
</script>

<style scoped>
.fdp__box {
  margin-bottom: 12px;
  border: 1px solid var(--mk-line, #e6ebf4);
  border-radius: 12px;
  background: var(--mk-surface, #fff);
  box-shadow: var(--mk-shadow-sm, 0 1px 2px rgba(15, 23, 42, 0.06));
  overflow: hidden;
}
.fdp__box-summary {
  padding: 11px 14px;
  cursor: pointer;
  font: inherit;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--mk-ink, #1a2a44);
  list-style: none;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 8px;
}
.fdp__box-summary::-webkit-details-marker { display: none; }
.fdp__box-summary::before {
  content: '▸';
  font-size: 11px;
  color: var(--mk-faint, #71809a);
  transition: transform 0.16s ease;
}
.fdp__box[open] > .fdp__box-summary::before { transform: rotate(90deg); }
.fdp__box[open] > .fdp__box-summary { border-bottom: 1px solid var(--mk-line, #e6ebf4); }
.fdp__newfield { display: flex; gap: 8px; align-items: center; padding: 12px 14px; flex-wrap: wrap; }
.fdp__input {
  padding: 6px 10px;
  border: 1px solid var(--mk-line, #e6ebf4);
  border-radius: 8px;
  background: var(--mk-surface, #fff);
  color: var(--mk-ink, #1a2a44);
  font: inherit;
  font-size: 12.5px;
  outline: none;
}
.fdp__input:focus { border-color: var(--mk-blue, #3478f6); }
.fdp__btn {
  padding: 6px 16px;
  border: 1px solid var(--mk-blue, #3478f6);
  border-radius: 8px;
  background: var(--mk-blue, #3478f6);
  color: #fff;
  font: inherit;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
}
.fdp__btn:hover { background: #2b64d8; }
.fdp__btn:disabled { opacity: 0.55; cursor: not-allowed; }
.fdp__msg { color: var(--mk-blue, #3478f6); font-size: 12px; font-weight: 600; }
.fdp__drift-list { margin: 0; padding: 6px 14px 12px; list-style: none; }
.fdp__drift-item {
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding: 7px 10px;
  margin-top: 6px;
  border: 1px solid var(--mk-line, #e6ebf4);
  border-radius: 9px;
  background: #fafbfd;
  font-size: 12px;
  flex-wrap: wrap;
}
.fdp__drift-kind {
  flex-shrink: 0;
  padding: 0 8px;
  border-radius: 999px;
  background: var(--mk-amber-bg, #fffbeb);
  color: var(--mk-amber, #b45309);
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.fdp__drift-key { font-weight: 700; color: var(--mk-ink, #1a2a44); }
.fdp__drift-field { color: var(--mk-faint, #71809a); }
.fdp__drift-val { font-size: 11.5px; }
.fdp__drift-val--seed { color: var(--mk-muted, #5b6577); }
.fdp__drift-val--db { color: var(--mk-blue, #3478f6); font-weight: 600; }
.fdp__changes-list { margin: 0; padding: 8px 14px 12px; list-style: none; }
.fdp__change {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 6px 10px;
  margin-top: 6px;
  border: 1px solid var(--mk-line, #e6ebf4);
  border-radius: 9px;
  background: #fafbfd;
  font-size: 12px;
  flex-wrap: wrap;
}
.fdp__change-kind {
  flex-shrink: 0;
  padding: 0 8px;
  border-radius: 999px;
  background: #eef2fa;
  color: var(--mk-muted, #5b6577);
  font-size: 10.5px;
  font-weight: 800;
  text-transform: uppercase;
}
.fdp__change-target { color: var(--mk-muted, #5b6577); }
.fdp__empty { padding: 20px; color: var(--mk-faint, #71809a); text-align: center; }
</style>
