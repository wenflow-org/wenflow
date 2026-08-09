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
          <span class="mono fdp__drift-val">seed={{ stringify(d.seedValue) }}</span>
          <span class="mono fdp__drift-val">db={{ stringify(d.dbValue) }}</span>
        </li>
      </ul>
      <p v-if="drift.totalDriftCount > drift.items.length" class="fdp__empty">（共 {{ drift.totalDriftCount }} 项，当前筛选显示 {{ drift.items.length }}）</p>
    </details>

    <!-- 审计 -->
    <details class="fdp__box">
      <summary class="fdp__box-summary">最近变更（审计）</summary>
      <ul v-if="changes.length" class="fdp__changes-list">
        <li v-for="(c, i) in changes" :key="i" class="mono">{{ c.changeType }} · {{ c.targetTable }} · {{ c.targetId }}</li>
      </ul>
      <p v-else class="fdp__empty">暂无变更记录</p>
    </details>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
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
</script>

<style scoped>
.fdp__box { margin-bottom: 12px; border: 1px solid var(--mk-border, #ddd); border-radius: 8px; padding: 0 14px; }
.fdp__box-summary { padding: 10px 0; cursor: pointer; font-weight: 600; color: var(--mk-primary, #4f46e5); }
.fdp__newfield { display: flex; gap: 8px; align-items: center; padding-bottom: 12px; flex-wrap: wrap; }
.fdp__input { padding: 5px 8px; border: 1px solid var(--mk-border, #ddd); border-radius: 4px; font-size: 12px; }
.fdp__btn { padding: 6px 14px; border: 1px solid var(--mk-border, #ddd); border-radius: 6px; background: #fff; cursor: pointer; }
.fdp__msg { color: var(--mk-primary, #4f46e5); font-size: 12px; }
.fdp__drift-list { margin: 0; padding: 0 0 12px; list-style: none; }
.fdp__drift-item { display: flex; gap: 8px; align-items: baseline; padding: 4px 0; border-bottom: 1px dashed #eee; font-size: 12px; }
.fdp__drift-kind { padding: 1px 6px; border-radius: 4px; background: #fef3c7; color: #92400e; }
.fdp__drift-key { font-weight: 600; }
.fdp__drift-field { color: #888; }
.fdp__drift-val { color: #b91c1c; }
.fdp__changes-list { margin: 0; padding: 0 0 12px 18px; color: #666; }
.fdp__empty { padding: 20px; color: #888; text-align: center; }
</style>
