<template>
  <div class="library v2-page">
    <V2Nav />

    <main class="library__main">
      <header class="library__head">
        <div class="library__head-main">
          <h1>资料库</h1>
          <p v-if="!loading && !loadError" class="library__sub">{{ summaryText }}</p>
        </div>
        <button type="button" class="library__upload" :disabled="uploading" @click="openPicker">
          <Upload :size="16" :stroke-width="2" aria-hidden="true" />
          {{ uploading ? '上传中…' : '上传资料' }}
        </button>
      </header>

      <input ref="fileInput" type="file" class="library__input" multiple :accept="ACCEPT" @change="onPick" />

      <p v-if="error" class="library__error">{{ error }}</p>

      <div v-if="items.length" class="library__tools">
        <div class="library__tabs" role="tablist" aria-label="资料筛选">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            type="button"
            role="tab"
            class="library__tab"
            :class="{ 'library__tab--active': filter === tab.key }"
            :aria-selected="filter === tab.key"
            @click="filter = tab.key"
          >
            {{ tab.label }} <b>{{ tab.count }}</b>
          </button>
        </div>

        <label class="library__search">
          <Search :size="15" :stroke-width="1.75" aria-hidden="true" />
          <input v-model="search" type="search" placeholder="搜索资料名或章节" aria-label="搜索资料" />
          <button v-if="search" type="button" class="library__search-clear" aria-label="清空搜索" @click="search = ''">×</button>
        </label>

        <label class="library__usage">
          <span>使用状态</span>
          <select v-model="usageFilter" aria-label="使用状态筛选">
            <option value="all">全部</option>
            <option value="used">已用于路径</option>
            <option value="unused">未用于路径</option>
          </select>
        </label>

        <label class="library__sort">
          <span>排序</span>
          <select v-model="sort" aria-label="资料排序">
            <option value="recent">最近上传</option>
            <option value="name">名称</option>
          </select>
        </label>
      </div>

      <div v-if="loading" class="library__loading">
        <SkeletonLoader variant="list" :count="4" />
      </div>

      <V2ResultState
        v-else-if="loadError"
        tone="error"
        title="资料库加载失败"
        description="网络或服务暂时不可用，你的资料没有丢失。稍后重试即可。"
        action-text="重试"
        @action="load"
      />

      <V2ResultState
        v-else-if="!items.length"
        tone="empty"
        title="资料库还是空的"
        description="上传 PDF / Word / PPT / Excel / TXT / Markdown；生成路径时会按目标相关性选用。"
        action-text="上传资料"
        @action="openPicker"
      />

      <p v-else-if="!visible.length" class="library__no-match">
        没有匹配的资料。
        <button type="button" class="library__link" @click="resetFilters">清空筛选</button>
      </p>

      <div v-else class="library__list">
        <article v-for="item in visible" :key="item.id" class="lib-card">
          <div class="lib-card__main">
            <span class="lib-card__ext" aria-hidden="true">{{ extOf(item) }}</span>
            <div class="lib-card__body">
              <h2 class="lib-card__title">{{ item.name }}</h2>
              <p class="lib-card__meta">{{ metaOf(item) }}</p>
              <p v-if="item.brief?.overview" class="lib-card__brief">{{ item.brief.overview }}</p>
              <p v-else-if="headingsOf(item).length" class="lib-card__brief lib-card__brief--muted">
                章节：{{ headingsOf(item).join(' · ') }}
              </p>
              <div class="lib-card__badges">
                <span class="lib-badge">已解析</span>
                <span v-if="item.brief" class="lib-badge">有摘要</span>
                <span v-if="item.origin === 'web'" class="lib-badge lib-badge--web">联网采集</span>
                <span v-if="item.warnings?.length" class="lib-badge lib-badge--warn">{{ item.warnings.length }} 条解析提示</span>
              </div>
              <p
                v-if="item.usage?.pathCount"
                class="lib-card__usage"
                :title="usageHint(item)"
              >
                用于
                <router-link :to="`/learning-path/${item.usage.paths[0].pathId}`">{{ item.usage.paths[0].pathTitle }}</router-link>
                <template v-if="item.usage.pathCount > 1">等 {{ item.usage.pathCount }} 条路径</template>
                <span v-if="item.usage.refCount" class="lib-card__usage-ref">· 引用 {{ item.usage.refCount }} 处</span>
              </p>
            </div>
          </div>
          <div class="lib-card__actions">
            <button type="button" class="lib-action" @click="openPreview(item)">
              <Eye :size="15" :stroke-width="1.75" aria-hidden="true" />
              预览
            </button>
            <button type="button" class="lib-action lib-action--danger" @click="askDelete(item)">
              <Trash2 :size="15" :stroke-width="1.75" aria-hidden="true" />
              删除
            </button>
          </div>
        </article>
      </div>
    </main>

    <div v-if="preview.open" class="lib-modal" @click.self="closePreview">
      <section class="lib-modal__card" role="dialog" aria-modal="true" aria-labelledby="lib-preview-title">
        <header class="lib-modal__head">
          <div class="lib-modal__head-main">
            <h2 id="lib-preview-title">{{ preview.item?.name }}</h2>
            <p v-if="preview.item" class="lib-modal__meta">{{ metaOf(preview.item) }}</p>
          </div>
          <button type="button" class="lib-modal__close" aria-label="关闭预览" @click="closePreview">
            <X :size="18" :stroke-width="2" aria-hidden="true" />
          </button>
        </header>
        <div class="lib-modal__scroll">
          <div v-if="preview.item?.brief" class="lib-preview__brief">
            <p v-if="preview.item.brief.overview">{{ preview.item.brief.overview }}</p>
            <p v-if="preview.item.brief.toc?.length" class="lib-preview__toc">
              目录：{{ preview.item.brief.toc.slice(0, 8).map((entry) => entry.title).join(' · ') }}
            </p>
          </div>
          <p v-if="preview.loading" class="lib-preview__loading">正在读取原文…</p>
          <p v-else-if="preview.error" class="library__error">{{ preview.error }}</p>
          <pre v-else class="lib-preview__text">{{ preview.markdown }}</pre>
          <p v-if="preview.truncated" class="lib-preview__note">仅预览前 60000 字，完整正文用于路径与课堂取回。</p>
        </div>
      </section>
    </div>

    <div v-if="pendingDelete" class="lib-modal" @click.self="closeDelete">
      <section class="lib-modal__card lib-modal__card--confirm" role="alertdialog" aria-modal="true" aria-labelledby="lib-delete-title">
        <h2 id="lib-delete-title">删除这份资料？</h2>
        <p>「{{ pendingDelete.name }}」删除后不可恢复。已生成的路径不会自动重建。</p>
        <p v-if="deleteUsageWarn" class="lib-modal__usage-warn">{{ deleteUsageWarn }}</p>
        <div class="lib-modal__actions">
          <button type="button" class="lib-action" :disabled="deleting" @click="closeDelete">取消</button>
          <button type="button" class="lib-action lib-action--danger" :disabled="deleting" @click="confirmDelete">
            {{ deleting ? '删除中…' : '删除' }}
          </button>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { Eye, Search, Trash2, Upload, X } from 'lucide-vue-next';
import V2Nav from './V2Nav.vue';
import SkeletonLoader from '@/components/ui/SkeletonLoader.vue';
import V2ResultState from '@/components/ui/V2ResultState.vue';
import { useEscape } from '@/views/admin-redesign/useEscape';
import {
  getMaterialLibrary,
  readMaterial,
  removeMaterial,
  uploadMaterial,
  type MaterialLibraryStats,
  type UploadedMaterial,
} from '@/api/materials';
import { toast } from '@/utils/toast';

type FilterKey = 'all' | 'upload' | 'web';
type SortKey = 'recent' | 'name';
type UsageFilterKey = 'all' | 'used' | 'unused';

const ACCEPT = '.pdf,.docx,.pptx,.xlsx,.txt,.md,.markdown,.csv';
const PREVIEW_LIMIT = 60_000;

const fileInput = ref<HTMLInputElement | null>(null);
const items = ref<UploadedMaterial[]>([]);
const stats = ref<MaterialLibraryStats>({
  total: 0,
  uploadCount: 0,
  webCount: 0,
  totalBytes: 0,
  quotaBytes: 0,
});
const loading = ref(true);
const loadError = ref(false);
const error = ref('');
const uploading = ref(false);
const search = ref('');
const filter = ref<FilterKey>('all');
const sort = ref<SortKey>('recent');
const usageFilter = ref<UsageFilterKey>('all');

const preview = reactive<{
  open: boolean;
  item: UploadedMaterial | null;
  loading: boolean;
  error: string;
  markdown: string;
  truncated: boolean;
}>({
  open: false,
  item: null,
  loading: false,
  error: '',
  markdown: '',
  truncated: false,
});

const pendingDelete = ref<UploadedMaterial | null>(null);
const deleting = ref(false);

const tabs = computed<Array<{ key: FilterKey; label: string; count: number }>>(() => [
  { key: 'all', label: '全部', count: stats.value.total },
  { key: 'upload', label: '我上传', count: stats.value.uploadCount },
  { key: 'web', label: '联网采集', count: stats.value.webCount },
]);

const summaryText = computed(() => {
  // 来源拆分已由页签承载（全部/我上传/联网采集），此处只留总量与配额，避免 390 宽重复占行。
  const used = formatBytes(stats.value.totalBytes);
  const quota = stats.value.quotaBytes > 0 ? ` / ${formatBytes(stats.value.quotaBytes)}` : '';
  return `${stats.value.total} 份 · 已用 ${used}${quota}`;
});

const visible = computed(() => {
  let list = items.value.slice();
  if (filter.value === 'upload') list = list.filter((item) => item.origin !== 'web');
  if (filter.value === 'web') list = list.filter((item) => item.origin === 'web');
  if (usageFilter.value === 'used') list = list.filter((item) => (item.usage?.pathCount ?? 0) > 0);
  if (usageFilter.value === 'unused') list = list.filter((item) => (item.usage?.pathCount ?? 0) <= 0);
  const query = search.value.trim().toLowerCase();
  if (query) {
    list = list.filter((item) => searchText(item).toLowerCase().includes(query));
  }
  if (sort.value === 'name') {
    list.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  } else {
    list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  return list;
});

// 删除确认弹层的使用警示：最多列 3 条路径名，超出折叠为「等 N 条」。
const deleteUsageWarn = computed<string>(() => {
  const usage = pendingDelete.value?.usage;
  if (!usage || usage.pathCount <= 0) return '';
  const titles = (usage.paths || [])
    .slice(0, 3)
    .map((path) => path.pathTitle)
    .filter(Boolean);
  const listed =
    titles.length > 0
      ? usage.pathCount > titles.length
        ? `${titles.join('、')} 等 ${usage.pathCount} 条`
        : titles.join('、')
      : '';
  return listed
    ? `这份资料已被 ${usage.pathCount} 条路径引用：${listed}，删除后相关路径不会重建。`
    : `这份资料已被 ${usage.pathCount} 条路径引用，删除后相关路径不会重建。`;
});

function formatBytes(bytes: number): string {
  const value = Number(bytes) || 0;
  if (value <= 0) return '0 B';
  if (value >= 1024 * 1024) return `${Math.round((value / 1024 / 1024) * 10) / 10}MB`;
  if (value >= 1024) return `${Math.round(value / 1024)}KB`;
  return `${value}B`;
}

function extOf(item: UploadedMaterial): string {
  const fromName = /\.([a-z0-9]+)$/i.exec(item.name || '')?.[1];
  const ext = (fromName || String(item.ext || '').replace(/^\./, '') || 'FILE').toUpperCase();
  return ext.length <= 5 ? ext : ext.slice(0, 4);
}

function metaOf(item: UploadedMaterial): string {
  const pages = item.structure?.pageCount ?? item.structure?.slideCount ?? item.structure?.sheetCount ?? 0;
  const parts = [formatBytes(item.size), `${item.charCount} 字`];
  if (pages > 0) parts.push(`${pages} 页/节`);
  if (item.structure?.headingCount > 0) parts.push(`${item.structure.headingCount} 章`);
  if (item.origin === 'web') parts.push('联网采集');
  return parts.join(' · ');
}

function headingsOf(item: UploadedMaterial): string[] {
  const seen = new Set<string>();
  const headings: string[] = [];
  for (const anchor of item.anchors || []) {
    const heading = String(anchor?.heading || '').trim();
    if (!heading || heading === '（无标题）' || seen.has(heading)) continue;
    seen.add(heading);
    headings.push(heading);
    if (headings.length >= 4) break;
  }
  return headings;
}

function usageHint(item: UploadedMaterial): string {
  return (item.usage?.paths || [])
    .map((path) => `${path.pathTitle}${path.refCount ? `（引用 ${path.refCount} 处）` : ''}`)
    .join('\n');
}

function searchText(item: UploadedMaterial): string {
  return [
    item.name,
    item.brief?.subject || '',
    item.brief?.overview || '',
    ...(item.brief?.toc || []).map((entry) => `${entry.title} ${entry.gist}`),
    ...(item.anchors || []).map((anchor) => anchor.heading),
  ].join(' ');
}

function errMsg(value: unknown): string {
  return (value as { message?: string })?.message || '操作失败，请稍后重试';
}

async function load() {
  loading.value = true;
  loadError.value = false;
  try {
    const data = await getMaterialLibrary({ includeUsage: true });
    items.value = data.items;
    stats.value = data.library;
  } catch {
    loadError.value = true;
  } finally {
    loading.value = false;
  }
}

function openPicker() {
  error.value = '';
  fileInput.value?.click();
}

async function onPick(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []);
  input.value = '';
  await uploadFiles(files);
}

async function uploadFiles(files: File[]) {
  if (!files.length) return;
  uploading.value = true;
  error.value = '';
  for (const file of files) {
    try {
      const record = await uploadMaterial(file);
      items.value = [record, ...items.value.filter((item) => item.id !== record.id)];
      toast.success(`已上传 ${file.name}`);
    } catch (err) {
      error.value = `${file.name}：${errMsg(err)}`;
    }
  }
  uploading.value = false;
  await load();
}

async function openPreview(item: UploadedMaterial) {
  preview.open = true;
  preview.item = item;
  preview.loading = true;
  preview.error = '';
  preview.markdown = '';
  preview.truncated = false;
  try {
    const found = await readMaterial(item.id);
    const markdown = found.markdown || '';
    preview.markdown = markdown.length > PREVIEW_LIMIT ? markdown.slice(0, PREVIEW_LIMIT) : markdown;
    preview.truncated = markdown.length > PREVIEW_LIMIT;
  } catch (err) {
    preview.error = errMsg(err);
  } finally {
    preview.loading = false;
  }
}

function closePreview() {
  preview.open = false;
  preview.item = null;
  preview.markdown = '';
  preview.error = '';
  preview.truncated = false;
}

function askDelete(item: UploadedMaterial) {
  pendingDelete.value = item;
}

function closeDelete() {
  if (deleting.value) return;
  pendingDelete.value = null;
}

async function confirmDelete() {
  const item = pendingDelete.value;
  if (!item) return;
  deleting.value = true;
  try {
    await removeMaterial(item.id);
    pendingDelete.value = null;
    toast.success(`已删除「${item.name}」`);
    await load();
  } catch (err) {
    toast.error(errMsg(err));
  } finally {
    deleting.value = false;
  }
}

function resetFilters() {
  search.value = '';
  filter.value = 'all';
  usageFilter.value = 'all';
  sort.value = 'recent';
}

useEscape(() => preview.open, closePreview);
useEscape(() => !!pendingDelete.value, closeDelete);

onMounted(load);
</script>

<style scoped>
.library__main {
  max-width: 1080px;
  margin: 0 auto;
  padding: 24px 28px 48px;
  display: grid;
  gap: 16px;
}

.library__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.library__head h1 {
  margin: 0;
  font-size: 18px;
  font-weight: 800;
  letter-spacing: -0.01em;
}

.library__sub {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.5;
}

.library__upload {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  min-height: 38px;
  padding: 0 14px;
  border: 0;
  border-radius: var(--mk-radius-pill);
  background: var(--blue);
  color: var(--mk-on-fill);
  font-family: inherit;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.library__upload:disabled {
  opacity: 0.6;
  cursor: default;
}

.library__input {
  display: none;
}

.library__tools {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.library__tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.library__tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 11px;
  border: 1px solid var(--line);
  border-radius: var(--mk-radius-pill);
  background: var(--surface);
  color: var(--muted);
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
}

.library__tab b {
  color: inherit;
  font-weight: 800;
}

.library__tab--active {
  border-color: color-mix(in srgb, var(--blue) 35%, transparent);
  background: color-mix(in srgb, var(--blue) 8%, var(--surface));
  color: var(--blue-deep);
}

.library__search {
  flex: 1 1 220px;
  max-width: 420px;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 0 12px;
  border: 1px solid var(--line);
  border-radius: var(--mk-radius-pill);
  background: var(--surface);
  color: var(--faint);
}

.library__search:focus-within {
  border-color: var(--blue);
  box-shadow: var(--mk-focus-ring);
}

.library__search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--ink);
  font: inherit;
  font-size: 13px;
}

.library__search-clear {
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: 15px;
  cursor: pointer;
}

.library__sort,
.library__usage {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  font-size: var(--mk-fs-micro);
}

.library__sort select,
.library__usage select {
  min-height: 32px;
  padding: 0 8px;
  border: 1px solid var(--line);
  border-radius: var(--mk-radius-sm);
  background: var(--surface);
  color: var(--ink);
  font: inherit;
  font-size: var(--mk-fs-micro);
}

.library__loading {
  padding: 8px 0;
}

.library__list {
  display: grid;
  gap: 10px;
}

.library__no-match {
  margin: 4px 0;
  color: var(--muted);
  font-size: 13px;
}

.library__link {
  border: 0;
  background: transparent;
  color: var(--blue-deep);
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  text-decoration: underline;
}

.library__error {
  margin: 0;
  color: var(--red);
  font-size: 12.5px;
  line-height: 1.5;
}

.lib-card {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border: 1px solid var(--line);
  border-radius: var(--mk-radius-xl);
  background: var(--surface);
}

.lib-card__main {
  display: flex;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.lib-card__ext {
  flex: 0 0 auto;
  padding: 3px 6px;
  border-radius: var(--mk-radius-sm);
  background: color-mix(in srgb, var(--blue) 10%, transparent);
  color: var(--blue-deep);
  font-size: var(--mk-fs-micro);
  font-weight: 800;
  letter-spacing: 0.02em;
}

.lib-card__body {
  min-width: 0;
}

.lib-card__title {
  margin: 0;
  color: var(--ink);
  font-size: 14px;
  font-weight: 800;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.lib-card__meta {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.5;
}

.lib-card__brief {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.55;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.lib-card__brief--muted {
  color: var(--faint);
}

.lib-card__badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.lib-badge {
  padding: 2px 7px;
  border-radius: var(--mk-radius-pill);
  background: var(--mk-surface-2);
  color: var(--muted);
  font-size: var(--mk-fs-micro);
  font-weight: 700;
}

.lib-badge--web {
  background: color-mix(in srgb, var(--blue) 8%, var(--surface));
  color: var(--blue-deep);
}

.lib-badge--warn {
  background: color-mix(in srgb, var(--amber) 12%, var(--surface));
  color: var(--amber-ink);
}

.lib-card__usage {
  display: flex;
  flex-wrap: wrap;
  gap: 0 4px;
  margin: 6px 0 0;
  color: var(--muted);
  font-size: var(--mk-fs-micro);
  line-height: 1.5;
}

.lib-card__usage a {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  color: var(--blue-deep);
  font-weight: 700;
  text-decoration: none;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lib-card__usage a:hover {
  text-decoration: underline;
}

.lib-card__actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
}

.lib-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: var(--mk-radius-sm);
  background: transparent;
  color: var(--muted);
  font-family: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.lib-action:hover {
  background: var(--mk-surface-2);
  color: var(--ink);
}

.lib-action--danger {
  color: var(--red);
}

.lib-action--danger:hover {
  background: color-mix(in srgb, var(--red) 8%, var(--surface));
  color: var(--red);
}

.lib-modal {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: grid;
  place-items: center;
  padding: 20px;
  background: color-mix(in srgb, var(--ink) 35%, transparent);
}

.lib-modal__card {
  width: min(860px, 100%);
  max-height: min(82vh, 760px);
  display: flex;
  flex-direction: column;
  border-radius: var(--mk-radius-modal);
  background: var(--surface);
  box-shadow: var(--mk-shadow-modal);
  overflow: hidden;
}

.lib-modal__card--confirm {
  width: min(420px, 100%);
  padding: 20px;
  gap: 10px;
}

.lib-modal__card--confirm h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 800;
}

.lib-modal__card--confirm p {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.6;
}

/* 使用警示：比确认文案低一档（micro），配色对齐 lib-badge--warn 的琥珀警示。 */
.lib-modal__card--confirm .lib-modal__usage-warn {
  padding: 8px 10px;
  border-radius: var(--mk-radius-sm);
  background: color-mix(in srgb, var(--amber) 12%, var(--surface));
  color: var(--amber-ink);
  font-size: var(--mk-fs-micro);
  overflow-wrap: anywhere;
}

.lib-modal__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--line);
}

.lib-modal__head-main {
  min-width: 0;
}

.lib-modal__head h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 800;
  overflow-wrap: anywhere;
}

.lib-modal__meta {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 12px;
}

.lib-modal__close {
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: var(--mk-radius-sm);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.lib-modal__close:hover {
  background: var(--mk-surface-2);
}

.lib-modal__scroll {
  overflow: auto;
  padding: 16px 18px 20px;
}

.lib-preview__brief {
  margin-bottom: 12px;
  padding: 10px 12px;
  border-radius: var(--mk-radius-sm);
  background: var(--mk-surface-2);
  color: var(--muted);
  font-size: 12.5px;
  line-height: 1.6;
}

.lib-preview__brief p {
  margin: 0;
}

.lib-preview__toc {
  margin-top: 6px !important;
  color: var(--faint);
}

.lib-preview__text {
  margin: 0;
  color: var(--ink);
  /* 资料正文预览是阅读文本，跟全站无衬线；等宽只留给代码/ID（2026-10-23 全站字体检查） */
  font-family: var(--mk-sans);
  font-size: 12.5px;
  line-height: 1.75;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.lib-preview__loading,
.lib-preview__note {
  margin: 0;
  color: var(--muted);
  font-size: 12.5px;
}

.lib-preview__note {
  margin-top: 12px;
}

.lib-modal__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}

@media (max-width: 720px) {
  .library__main {
    padding: 16px 14px 32px;
    gap: 12px;
  }

  .library__head {
    align-items: center;
  }

  .library__upload {
    min-height: 36px;
    padding: 0 12px;
  }

  .lib-card {
    flex-direction: column;
    gap: 8px;
    padding: 12px;
  }

  .lib-card__actions {
    align-self: flex-end;
  }

  .lib-modal {
    padding: 10px;
  }

  .lib-modal__card {
    max-height: 88vh;
  }
}
</style>
