<template>
  <div class="mat-upload" :class="{ 'mat-upload--empty': !items.length && !error }">
    <input
      ref="inputRef"
      type="file"
      class="mat-upload__input"
      multiple
      :accept="ACCEPT"
      @change="onPick"
    />

    <!-- 已传资料：输入框上方的紧凑 chips（超过 4 份折叠为 +N）；完整元信息在 title 里 -->
    <div v-if="items.length" class="mat-upload__chips">
      <span
        v-for="material in shownItems"
        :key="material.id"
        class="mat-upload__chip"
        :title="`${material.name} · ${describe(material)}`"
      >
        <i class="mat-upload__chip-ext" aria-hidden="true">{{ extOf(material.name) }}</i>
        <span class="mat-upload__chip-name">{{ material.name }}</span>
        <button
          type="button"
          class="mat-upload__chip-x"
          :aria-label="`删除 ${material.name}`"
          @click="remove(material)"
        >✕</button>
      </span>
      <button
        v-if="items.length > CHIP_LIMIT"
        type="button"
        class="mat-upload__chip mat-upload__chip--more"
        @click="showAll = !showAll"
      >{{ showAll ? '收起' : `+${items.length - CHIP_LIMIT}` }}</button>
    </div>

    <p v-if="error" class="mat-upload__error">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  listMaterials,
  removeMaterial,
  uploadMaterial,
  type UploadedMaterial,
} from '@/api/materials';

/**
 * 上传资料区（目标对话页输入框的附件层）。
 *
 * 入口不放本组件里：父页面把回形针按钮内置在输入框左下（.composer__attach，
 * 点它调 openPicker），输入框本身是拖放目标（拖入调 addFiles）。
 * 这里只渲染「已传资料 chips + 错误行」，没有资料时整体 display:none 不占位。
 *
 * 只支持**文本型**文档：解析在服务端完成（officeparser + 文本层闸门），
 * 扫描件/图片型 PDF、legacy .doc/.ppt/.xls 会被后端拒收并回中文原因，这里原样展示。
 */
const ACCEPT = '.pdf,.docx,.pptx,.xlsx,.txt,.md,.markdown,.csv';
const CHIP_LIMIT = 4;

const inputRef = ref<HTMLInputElement | null>(null);
const items = ref<UploadedMaterial[]>([]);
const uploading = ref(false);
const dragging = ref(false);
const error = ref('');
const showAll = ref(false);

const emit = defineEmits<{
  (e: 'change', count: number): void;
}>();

const shownItems = computed(() =>
  showAll.value ? items.value : items.value.slice(0, CHIP_LIMIT)
);

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

function emitCount() {
  emit('change', items.value.length);
}

async function refresh() {
  try {
    items.value = await listMaterials();
  } catch {
    // 首屏拉取失败不打扰用户（未登录/网络问题由上层页面处理）
  }
  emitCount();
}

onMounted(refresh);

/** 父页面回形针按钮调用：打开文件选择 */
function openPicker() {
  error.value = '';
  inputRef.value?.click();
}

/** 单份上传 + 串行处理多选：逐份回显，一份失败不影响其余。 */
async function addFiles(files: File[]) {
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
  showAll.value = false;
  emitCount();
}

async function onPick(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []);
  // 清空 value，保证同一文件可以再次选择
  input.value = '';
  await addFiles(files);
}

async function remove(material: UploadedMaterial) {
  try {
    await removeMaterial(material.id);
    items.value = items.value.filter((item) => item.id !== material.id);
  } catch (err) {
    error.value = (err as { message?: string })?.message || '删除失败，请重试';
  }
  emitCount();
}

/** 供父组件读取当前已上传资料（后续「资料→路径」接线用）。 */
defineExpose({ refresh, openPicker, addFiles, items, dragging });
</script>

<style scoped>
.mat-upload {
  min-width: 0;
}

/* 无资料无错误时整体退场：不占输入框上方的行（grid 行随之消失） */
.mat-upload--empty {
  display: none;
}

.mat-upload__input {
  display: none;
}

.mat-upload__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

/* 资料 chip：扩展名徽标 + 文件名（省略）+ ✕；完整元信息在 title */
.mat-upload__chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 260px;
  padding: 3px 4px 3px 6px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
  font-size: 11.5px;
  color: var(--muted);
}

.mat-upload__chip-ext {
  flex: 0 0 auto;
  padding: 1px 5px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--blue) 10%, transparent);
  color: var(--blue-deep);
  font-size: 9.5px;
  font-style: normal;
  font-weight: 800;
}

.mat-upload__chip-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--ink);
  font-weight: 600;
}

.mat-upload__chip-x {
  flex: 0 0 auto;
  border: 0;
  background: none;
  padding: 0 3px;
  border-radius: 4px;
  color: var(--faint);
  font-size: 10px;
  cursor: pointer;
}

.mat-upload__chip-x:hover {
  color: var(--red);
}

.mat-upload__chip--more {
  padding: 3px 9px;
  color: var(--blue-deep);
  font-weight: 700;
  cursor: pointer;
}

.mat-upload__error {
  margin: 2px 0 0;
  color: var(--red);
  font-size: 11.5px;
  line-height: 1.5;
}
</style>
