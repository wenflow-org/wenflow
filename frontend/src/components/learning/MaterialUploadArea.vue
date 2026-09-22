<template>
  <div class="mat-upload" :class="{ 'mat-upload--dragging': dragging }">
    <input
      ref="inputRef"
      type="file"
      class="mat-upload__input"
      multiple
      :accept="ACCEPT"
      @change="onPick"
    />

    <!-- 投放区：整行即拖放目标。实心高度 + 虚线框 + 格式说明，不再是小角落 pill -->
    <div
      class="mat-upload__drop"
      :class="{ 'is-over': dragging }"
      @dragenter.prevent="dragging = true"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <button type="button" class="mat-upload__trigger" :disabled="uploading" @click="openPicker">
        <span v-if="uploading" class="mat-upload__spinner" aria-hidden="true"></span>
        <svg v-else viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path fill="currentColor" d="M16.5 6v11.5a4 4 0 0 1-8 0V6a2.5 2.5 0 0 1 5 0v10.5a1 1 0 0 1-2 0V6H10v10.5a2.5 2.5 0 0 0 5 0V6a4 4 0 0 0-8 0v11.5a5.5 5.5 0 0 0 11 0V6z" />
        </svg>
        <span>{{ uploading ? '正在解析…' : '添加资料' }}</span>
      </button>
      <span class="mat-upload__hint">支持 PDF / Word / PPT / Excel / TXT / Markdown · 可拖拽上传</span>
    </div>

    <p v-if="error" class="mat-upload__error">{{ error }}</p>

    <ul v-if="items.length" class="mat-upload__list">
      <li v-for="material in items" :key="material.id" class="mat-upload__item">
        <span class="mat-upload__ext" aria-hidden="true">{{ extOf(material.name) }}</span>
        <span class="mat-upload__name" :title="material.name">{{ material.name }}</span>
        <span class="mat-upload__meta">{{ describe(material) }}</span>
        <button type="button" class="mat-upload__remove" @click="remove(material)">删除</button>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import {
  listMaterials,
  removeMaterial,
  uploadMaterial,
  type UploadedMaterial,
} from '@/api/materials';

/**
 * 上传资料区（目标对话页共用）。
 *
 * 只支持**文本型**文档：解析在服务端完成（officeparser + 文本层闸门），
 * 扫描件/图片型 PDF、legacy .doc/.ppt/.xls 会被后端拒收并回中文原因，这里原样展示。
 */
const ACCEPT = '.pdf,.docx,.pptx,.xlsx,.txt,.md,.markdown,.csv';

const inputRef = ref<HTMLInputElement | null>(null);
const items = ref<UploadedMaterial[]>([]);
const uploading = ref(false);
const dragging = ref(false);
const error = ref('');

function describe(material: UploadedMaterial): string {
  const pages = material.structure.pageCount
    ?? material.structure.slideCount
    ?? material.structure.sheetCount
    ?? 0;
  const parts = [`${material.charCount} 字`];
  if (pages > 0) parts.push(`${pages} 页/节`);
  if (material.structure.headingCount > 0) parts.push(`${material.structure.headingCount} 个小标题`);
  if (material.structure.tableCount > 0) parts.push(`${material.structure.tableCount} 个表格`);
  return parts.join(' · ');
}

/** 扩展名徽标：PDF / DOCX / PPTX / XLSX / TXT / MD / CSV，取不到给 FILE */
function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  if (!m) return 'FILE';
  const ext = m[1].toUpperCase();
  return ext.length <= 5 ? ext : ext.slice(0, 4);
}

async function refresh() {
  try {
    items.value = await listMaterials();
  } catch {
    // 首屏拉取失败不打扰用户（未登录/网络问题由上层页面处理）
  }
}

onMounted(refresh);

function openPicker() {
  error.value = '';
  inputRef.value?.click();
}

/** 单份上传 + 串行处理多选：逐份回显，一份失败不影响其余。 */
async function uploadFiles(files: File[]) {
  if (!files.length) return;
  uploading.value = true;
  error.value = '';
  for (const file of files) {
    try {
      const material = await uploadMaterial(file);
      items.value = [material, ...items.value];
    } catch (err) {
      const message = (err as { message?: string })?.message || '上传失败，请重试';
      error.value = `${file.name}：${message}`;
    }
  }
  uploading.value = false;
}

async function onPick(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []);
  // 清空 value，保证同一文件可以再次选择
  input.value = '';
  await uploadFiles(files);
}

async function onDrop(event: DragEvent) {
  dragging.value = false;
  await uploadFiles(Array.from(event.dataTransfer?.files || []));
}

async function remove(material: UploadedMaterial) {
  try {
    await removeMaterial(material.id);
    items.value = items.value.filter((item) => item.id !== material.id);
  } catch (err) {
    error.value = (err as { message?: string })?.message || '删除失败，请重试';
  }
}

/** 供父组件读取当前已上传资料（后续「资料→路径」接线用）。 */
defineExpose({ refresh, items });
</script>

<style scoped>
.mat-upload {
  margin: 0 0 10px;
}

.mat-upload__input {
  display: none;
}

/* 投放区：有实心高度的整行拖放目标（虚线框在拖拽时变实线蓝底） */
.mat-upload__drop {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  min-height: 46px;
  padding: 7px 12px;
  border: 1px dashed var(--line);
  border-radius: 12px;
  background: color-mix(in srgb, var(--surface) 55%, transparent);
  transition: border-color 0.15s ease, background 0.15s ease;
}

.mat-upload__drop:hover {
  border-color: color-mix(in srgb, var(--blue) 40%, var(--line));
}

.mat-upload__drop.is-over {
  border-style: solid;
  border-color: var(--blue);
  background: color-mix(in srgb, var(--blue) 8%, transparent);
}

.mat-upload__drop.is-over .mat-upload__trigger {
  background: var(--blue);
  color: #fff;
}

.mat-upload__trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  padding: 5px 12px;
  border: 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--blue) 12%, transparent);
  color: var(--blue-deep);
  font: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.mat-upload__trigger:hover:not(:disabled) {
  background: color-mix(in srgb, var(--blue) 20%, transparent);
}

.mat-upload__trigger:disabled {
  opacity: 0.65;
  cursor: default;
}

.mat-upload__spinner {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: 2px solid color-mix(in srgb, var(--blue-deep) 30%, transparent);
  border-top-color: var(--blue-deep);
  animation: mat-upload-spin 0.7s linear infinite;
}

@keyframes mat-upload-spin {
  to { transform: rotate(360deg); }
}

.mat-upload__hint {
  flex: 1;
  min-width: 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--faint);
}

.mat-upload__error {
  margin: 6px 0 0;
  color: var(--red);
  font-size: 12px;
  line-height: 1.5;
}

.mat-upload__list {
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* 已上传资料：类型徽标 + 文件名 + 元信息 + 删除，卡片行而非裸文本 */
.mat-upload__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface);
  font-size: 12px;
}

.mat-upload__ext {
  flex: 0 0 auto;
  padding: 2px 6px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--blue) 10%, transparent);
  color: var(--blue-deep);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.02em;
}

.mat-upload__name {
  flex: 1;
  min-width: 0;
  color: var(--ink);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mat-upload__meta {
  flex: 0 0 auto;
  color: var(--faint);
  font-size: 11px;
}

.mat-upload__remove {
  flex: 0 0 auto;
  border: 0;
  background: none;
  padding: 2px 4px;
  border-radius: 6px;
  color: var(--faint);
  font-size: 11.5px;
  cursor: pointer;
}

.mat-upload__remove:hover {
  color: var(--red);
  background: color-mix(in srgb, var(--red) 8%, transparent);
}
</style>
