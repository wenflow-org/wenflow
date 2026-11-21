<template>
  <div class="mat-upload" :class="{ 'mat-upload--empty': !attached.length && !error && !libraryHasUploads }">
    <input
      ref="inputRef"
      type="file"
      class="mat-upload__input"
      multiple
      :accept="ACCEPT"
      @change="onPick"
    />

    <!-- 已挂载资料 chips：× = 从本次目标摘掉（不动资料库文件；管理在 /library） -->
    <div v-if="attached.length" class="mat-upload__chips">
      <span
        v-for="material in shownAttached"
        :key="material.id"
        class="mat-upload__chip"
        :title="`${material.name} · ${describe(material)} · 已挂载，将随本次目标进入路径生成`"
      >
        <i class="mat-upload__chip-ext" aria-hidden="true">{{ extOf(material.name) }}</i>
        <span class="mat-upload__chip-name">{{ material.name }}</span>
        <button
          type="button"
          class="mat-upload__chip-x"
          :aria-label="`摘掉 ${material.name}`"
          @click="detach(material)"
        >✕</button>
      </span>
      <button
        v-if="attached.length > CHIP_LIMIT"
        type="button"
        class="mat-upload__chip mat-upload__chip--more"
        @click="showAll = !showAll"
      >{{ showAll ? '收起' : `+${attached.length - CHIP_LIMIT}` }}</button>
    </div>

    <!-- 说明性文案不再占位（2026-11-21 走查）：挂载语义只在挂载弹层内一句话交代，库管理入口也在弹层 -->

    <p v-if="error" class="mat-upload__error">{{ error }}</p>

    <!-- 挂载选择弹层：从资料库勾选 + 上传新文件；确认后整包回填挂载列表 -->
    <div v-if="pickerOpen" class="mat-upload__picker" role="dialog" aria-modal="true" aria-label="选择要挂载的资料" @click.self="closePicker">
      <div class="mat-upload__picker-card">
        <header class="mat-upload__picker-head">
          <strong>选择要挂载的资料</strong>
          <span class="mat-upload__picker-count">{{ attached.length }} / {{ PATH_LIMIT }}</span>
          <button type="button" class="mat-upload__picker-close" aria-label="关闭" @click="closePicker">✕</button>
        </header>
        <div class="mat-upload__picker-list">
          <label
            v-for="item in libraryItems"
            :key="item.id"
            class="mat-upload__picker-row"
            :class="{ 'mat-upload__picker-row--attached': isAttached(item.id) }"
          >
            <input
              type="checkbox"
              :checked="isAttached(item.id)"
              :disabled="!isAttached(item.id) && attached.length >= PATH_LIMIT"
              @change="toggle(item)"
            />
            <i class="mat-upload__chip-ext" aria-hidden="true">{{ extOf(item.name) }}</i>
            <span class="mat-upload__picker-name" :title="item.name">{{ item.name }}</span>
            <span class="mat-upload__picker-desc">{{ describe(item) }}</span>
          </label>
          <p v-if="!libraryItems.length" class="mat-upload__picker-empty">
            资料库还没有文件。用下方「上传新文件」传一份（支持 PDF / Word / PPT / Excel / TXT / MD / CSV）。
          </p>
        </div>
        <footer class="mat-upload__picker-foot">
          <button type="button" class="mat-upload__picker-upload" :disabled="uploading" @click="inputRef?.click()">
            {{ uploading ? '上传中…' : '上传新文件' }}
          </button>
          <span class="mat-upload__picker-hint">挂载的资料会随本次目标进入路径生成 · <router-link to="/library" class="mat-upload__picker-lib">管理资料库</router-link></span>
          <button type="button" class="mat-upload__picker-done" @click="closePicker">完成</button>
        </footer>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  getMaterialLibrary,
  uploadMaterial,
  type MaterialLibraryStats,
  type UploadedMaterial,
} from '@/api/materials';

/**
 * 资料挂载器（目标对话页输入框的附件层，资料跟路径生成走）。
 *
 * 语义（2026-11-21 重构）：chips 展示的是**本次目标显式挂载**的资料（v-model 双向），
 * 不再等于用户资料库——资料库只在「挂载选择弹层」里出现（勾选 + 上传新文件）。
 * 摘掉 chip 只影响本次挂载，不删资料库文件；删除文件请去 /library。
 * 挂载列表由父页面随 start/reply/confirm 请求带给后端，路径生成只使用挂载的资料；
 * 空列表 = 本次不注入任何资料。
 *
 * 入口不放本组件里：父页面把回形针按钮内置在输入框左下（.composer__attach，
 * 点它调 openPicker 打开弹层），输入框本身是拖放目标（拖入调 addFiles = 上传并自动挂载）。
 * 只支持**文本型**文档：解析在服务端完成（officeparser + 文本层闸门），
 * 扫描件/图片型 PDF、legacy .doc/.ppt/.xls 会被后端拒收并回中文原因，这里原样展示。
 */
const ACCEPT = '.pdf,.docx,.pptx,.xlsx,.txt,.md,.markdown,.csv';
const CHIP_LIMIT = 4;
/** 挂载上限：与后端 MAX_UPLOAD_MATERIAL_PACKS / GOAL_PATH_MATERIAL_LIMIT 同一数字。 */
const PATH_LIMIT = 3;

const props = defineProps<{
  /** 当前挂载列表（v-model）：整包覆盖语义，组件内增删都 emit 全量列表 */
  modelValue?: UploadedMaterial[];
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: UploadedMaterial[]): void;
  (e: 'change', count: number): void;
}>();

const inputRef = ref<HTMLInputElement | null>(null);
const libraryItems = ref<UploadedMaterial[]>([]);
const library = ref<MaterialLibraryStats | null>(null);
const uploading = ref(false);
const error = ref('');
const showAll = ref(false);
const pickerOpen = ref(false);

const attached = computed<UploadedMaterial[]>(() => props.modelValue || []);
const libraryHasUploads = computed(() => (library.value?.uploadCount ?? 0) > 0);
const shownAttached = computed(() =>
  showAll.value ? attached.value : attached.value.slice(0, CHIP_LIMIT)
);

function describe(material: UploadedMaterial): string {
  const pages = material.structure?.pageCount
    ?? material.structure?.slideCount
    ?? material.structure?.sheetCount
    ?? 0;
  const parts = [`${material.charCount} 字`];
  if (pages > 0) parts.push(`${pages} 页/节`);
  if ((material.structure?.headingCount ?? 0) > 0) parts.push(`${material.structure.headingCount} 个小标题`);
  if ((material.structure?.tableCount ?? 0) > 0) parts.push(`${material.structure.tableCount} 个表格`);
  return parts.join(' · ');
}

/** 扩展名徽标：PDF / DOCX / PPTX / XLSX / TXT / MD / CSV，取不到给 FILE */
function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  if (!m) return 'FILE';
  const ext = m[1].toUpperCase();
  return ext.length <= 5 ? ext : ext.slice(0, 4);
}

function emitUpdate(next: UploadedMaterial[]) {
  emit('update:modelValue', next);
  emit('change', next.length);
}

function isAttached(id: string): boolean {
  return attached.value.some((item) => item.id === id);
}

/** 资料库清单：只喂挂载弹层，不再冒充“已挂载”chips。 */
async function refresh() {
  try {
    const data = await getMaterialLibrary();
    // 弹层只列用户上传；联网入库资料由资料链/后台消费，不冒充“已上传”。
    libraryItems.value = data.items.filter((item) => item.origin !== 'web');
    library.value = data.library;
  } catch {
    // 首屏拉取失败不打扰用户（未登录/网络问题由上层页面处理）
  }
}

onMounted(refresh);

/** 父页面回形针按钮调用：打开挂载选择弹层（顺带刷新资料库清单） */
async function openPicker() {
  error.value = '';
  await refresh();
  pickerOpen.value = true;
}

function closePicker() {
  pickerOpen.value = false;
}

/** 弹层勾选/取消：满了再勾被 checkbox disabled 挡住；这里只处理取消与未满勾选 */
function toggle(material: UploadedMaterial) {
  if (isAttached(material.id)) {
    emitUpdate(attached.value.filter((item) => item.id !== material.id));
    return;
  }
  if (attached.value.length >= PATH_LIMIT) {
    error.value = `最多挂载 ${PATH_LIMIT} 份资料，先摘掉一份再选。`;
    return;
  }
  emitUpdate([...attached.value, material]);
}

/** chip × = 摘掉本次挂载（不动资料库文件） */
function detach(material: UploadedMaterial) {
  emitUpdate(attached.value.filter((item) => item.id !== material.id));
}

/** 单份上传 + 串行处理多选：逐份上传并**自动挂载**，一份失败不影响其余。 */
async function addFiles(files: File[]) {
  if (!files.length) return;
  uploading.value = true;
  error.value = '';
  const uploaded: UploadedMaterial[] = [];
  for (const file of files) {
    try {
      const material = await uploadMaterial(file);
      uploaded.push(material);
    } catch (err) {
      const message = (err as { message?: string })?.message || '上传失败，请重试';
      error.value = `${file.name}：${message}`;
    }
  }
  uploading.value = false;
  showAll.value = false;
  await refresh();
  // 上传成功 → 自动挂载（受上限约束：满了不再追加并提示）
  const room = Math.max(0, PATH_LIMIT - attached.value.length);
  if (uploaded.length > room) {
    error.value = `最多挂载 ${PATH_LIMIT} 份资料，已挂载前 ${room} 份，其余保留在资料库（可稍后在这里调整）。`;
  }
  const toAttach = uploaded.slice(0, room);
  if (toAttach.length > 0) {
    emitUpdate([...attached.value, ...toAttach]);
  }
}

async function onPick(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []);
  // 清空 value，保证同一文件可以再次选择
  input.value = '';
  await addFiles(files);
}

/** 供父组件调用：打开弹层 / 拖入上传并自动挂载 */
defineExpose({ refresh, openPicker, addFiles });
</script>

<style scoped>
.mat-upload {
  min-width: 0;
}

/* 无挂载、无错误、资料库也空时整体退场：不占输入框上方的行（grid 行随之消失） */
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
  border-radius: var(--mk-radius-pill);
  background: var(--surface);
  /* 字号下限 12px（§9 偏离 1） */
  font-size: var(--mk-fs-micro);
  color: var(--muted);
}

.mat-upload__chip-ext {
  flex: 0 0 auto;
  padding: 1px 5px;
  /* 行内小 tag → 芯片档 6（5px 中间档退役） */
  border-radius: var(--mk-radius-sm);
  background: color-mix(in srgb, var(--blue) 10%, transparent);
  color: var(--blue-deep);
  font-size: var(--mk-fs-micro);
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
  border-radius: var(--mk-radius-xs);
  color: var(--faint);
  font-size: var(--mk-fs-micro);
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

/* 说明性提示行已撤（2026-11-21 走查）：不占输入框上方空间；挂载语义与库管理入口
   都收进挂载选择弹层（见 .mat-upload__picker-lib）。 */

.mat-upload__picker-lib {
  color: inherit;
  text-decoration: underline;
  text-decoration-color: color-mix(in srgb, currentColor 45%, transparent);
  text-underline-offset: 2px;
}

.mat-upload__picker-lib:hover {
  color: var(--blue-deep);
  text-decoration-color: currentColor;
}

.mat-upload__error {
  margin: 2px 0 0;
  color: var(--red);
  font-size: var(--mk-fs-micro);
  line-height: 1.5;
}

/* ---- 挂载选择弹层 ---- */
.mat-upload__picker {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: color-mix(in srgb, #000 55%, transparent);
}

.mat-upload__picker-card {
  display: flex;
  flex-direction: column;
  width: min(560px, 100%);
  max-height: min(70vh, 520px);
  border: 1px solid var(--line);
  border-radius: var(--mk-radius-lg, 14px);
  background: var(--surface);
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.35);
  overflow: hidden;
}

.mat-upload__picker-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--line);
  font-size: var(--mk-fs-m);
  color: var(--ink);
}

.mat-upload__picker-count {
  color: var(--muted);
  font-size: var(--mk-fs-micro);
  font-weight: 700;
}

.mat-upload__picker-close {
  margin-left: auto;
  border: 0;
  background: none;
  color: var(--faint);
  cursor: pointer;
  font-size: var(--mk-fs-m);
}

.mat-upload__picker-close:hover {
  color: var(--ink);
}

.mat-upload__picker-list {
  flex: 1 1 auto;
  overflow: auto;
  padding: 6px 8px;
}

.mat-upload__picker-row {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 8px 8px;
  border-radius: var(--mk-radius-sm);
  cursor: pointer;
  font-size: var(--mk-fs-micro);
  color: var(--ink);
}

.mat-upload__picker-row:hover {
  background: color-mix(in srgb, var(--blue) 6%, transparent);
}

.mat-upload__picker-row--attached {
  background: color-mix(in srgb, var(--blue) 10%, transparent);
}

.mat-upload__picker-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}

.mat-upload__picker-desc {
  color: var(--muted);
}

.mat-upload__picker-empty {
  margin: 8px;
  color: var(--muted);
  font-size: var(--mk-fs-micro);
  line-height: 1.6;
}

.mat-upload__picker-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-top: 1px solid var(--line);
}

.mat-upload__picker-upload {
  border: 1px solid var(--line);
  border-radius: var(--mk-radius-sm);
  background: none;
  padding: 5px 12px;
  color: var(--blue-deep);
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  cursor: pointer;
}

.mat-upload__picker-upload:disabled {
  opacity: 0.6;
  cursor: default;
}

.mat-upload__picker-hint {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--muted);
  font-size: var(--mk-fs-micro);
}

.mat-upload__picker-done {
  border: 0;
  border-radius: var(--mk-radius-sm);
  background: var(--blue);
  color: #fff;
  padding: 6px 16px;
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  cursor: pointer;
}
</style>
