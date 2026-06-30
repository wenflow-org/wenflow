<template>
  <div class="source-view" v-if="sourceDoc">
    <!-- Stats bar -->
    <div class="source-stats">
      <span class="source-stats__item">
        {{ sourceDoc.rootSections.length }} 章
      </span>
      <span class="source-stats__item">
        {{ totalSections }} 节
      </span>
      <span class="source-stats__item" v-if="modifiedCount > 0">
        {{ modifiedCount }} 处修改
      </span>
    </div>

    <!-- Top-level sections (DEFINITIONS / EXECUTION) -->
    <div
      v-for="root in sourceDoc.rootSections"
      :key="root.id"
      class="root-block"
    >
      <div class="root-header" @click="toggleRoot(root.id)">
        <el-icon class="root-arrow" :class="{ 'root-arrow--open': openRoots.has(root.id) }">
          <ArrowRight />
        </el-icon>
        <span class="root-title">{{ root.title }}</span>
        <span class="root-count">{{ root.children?.length ?? 0 }} 节</span>
        <div class="root-actions" @click.stop>
          <el-button
            text
            size="small"
            @click="expandAll(root, true)"
            :disabled="allExpanded(root)"
          >
            全部展开
          </el-button>
          <el-button
            text
            size="small"
            @click="expandAll(root, false)"
            :disabled="allCollapsed(root)"
          >
            全部折叠
          </el-button>
        </div>
      </div>

      <div v-show="openRoots.has(root.id)" class="root-body">
        <div
          v-for="child in root.children"
          :key="child.id"
          class="section-card"
          :class="{
            [`section-card--${child.contentType}`]: true,
            'section-card--modified': modifiedSections.has(child.id)
          }"
        >
          <!-- Section header -->
          <div class="section-header" @click="toggleSection(child.id)">
            <el-icon class="section-arrow" :class="{ 'section-arrow--open': openSections.has(child.id) }">
              <ArrowRight />
            </el-icon>
            <span class="section-title">{{ child.title }}</span>
            <el-tag size="small" :type="contentTypeTag(child.contentType)" class="section-type">
              {{ contentTypeLabel(child.contentType) }}
            </el-tag>
            <span class="section-meta" v-if="child.content">
              {{ child.content.split('\n').length }} 行
            </span>
            <span v-if="modifiedSections.has(child.id)" class="section-modified-dot" title="已修改" />
            <!-- Content preview when collapsed -->
            <span
              v-if="!openSections.has(child.id) && child.content"
              class="section-preview"
            >{{ previewText(child.content) }}</span>
          </div>

          <!-- Section body (expanded) -->
          <div v-show="openSections.has(child.id)" class="section-body">
            <!-- Text editor -->
            <el-input
              v-if="child.contentType === 'text'"
              v-model="edits[child.id]"
              type="textarea"
              :rows="textRows(child.content)"
              class="section-editor"
              @change="onEdit(child)"
            />
            <div v-if="child.contentType === 'text' && edits[child.id]" class="section-char-count">
              {{ edits[child.id].length }} 字符 · {{ edits[child.id].split('\n').length }} 行
            </div>

            <!-- Table editor -->
            <TableEditor
              v-else-if="child.contentType === 'table'"
              :content="child.content"
              :sectionId="child.id"
              :modelValue="edits[child.id] || child.content"
              @update:modelValue="v => { edits[child.id] = v; onEdit(child) }"
            />

            <!-- Schema tree -->
            <SchemaEditor
              v-else-if="child.contentType === 'schema'"
              :content="child.content"
              :sectionId="child.id"
              :modelValue="edits[child.id] || child.content"
              @update:modelValue="v => { edits[child.id] = v; onEdit(child) }"
            />

            <!-- Stages editor -->
            <StagesEditor
              v-else-if="child.contentType === 'stages'"
              :content="child.content"
              :sectionId="child.id"
              :modelValue="edits[child.id] || child.content"
              @update:modelValue="v => { edits[child.id] = v; onEdit(child) }"
            />

            <!-- Constraints editor -->
            <ConstraintsEditor
              v-else-if="child.contentType === 'constraints'"
              :content="child.content"
              :sectionId="child.id"
              :modelValue="edits[child.id] || child.content"
              @update:modelValue="v => { edits[child.id] = v; onEdit(child) }"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { ArrowRight } from '@element-plus/icons-vue'
import type { SourceDocument, SourceSection } from '@/utils/sourceParser'
import TableEditor from './TableEditor.vue'
import SchemaEditor from './SchemaEditor.vue'
import StagesEditor from './StagesEditor.vue'
import ConstraintsEditor from './ConstraintsEditor.vue'

const props = defineProps<{
  sourceDoc: SourceDocument | null
}>()

const emit = defineEmits<{
  (e: 'update', doc: SourceDocument): void
}>()

const openRoots = ref(new Set<string>())
const openSections = ref(new Set<string>())
const edits = ref<Record<string, string>>({})
const modifiedSections = ref(new Set<string>())

const totalSections = computed(() => {
  if (!props.sourceDoc) return 0
  return props.sourceDoc.rootSections.reduce((sum, r) => sum + (r.children?.length ?? 0), 0)
})

const modifiedCount = computed(() => modifiedSections.value.size)

watch(() => props.sourceDoc, (sourceDoc) => {
  openRoots.value.clear()
  openSections.value.clear()
  edits.value = {}
  modifiedSections.value.clear()
  if (sourceDoc) {
    for (const root of sourceDoc.rootSections) {
      openRoots.value.add(root.id)
      for (const child of root.children || []) {
        openSections.value.add(child.id)
        edits.value[child.id] = child.content
      }
    }
  }
}, { immediate: true })

function toggleRoot(id: string) {
  if (openRoots.value.has(id)) openRoots.value.delete(id)
  else openRoots.value.add(id)
}

function toggleSection(id: string) {
  if (openSections.value.has(id)) openSections.value.delete(id)
  else openSections.value.add(id)
}

function expandAll(root: SourceSection, open: boolean) {
  for (const child of root.children || []) {
    if (open) openSections.value.add(child.id)
    else openSections.value.delete(child.id)
  }
}

function allExpanded(root: SourceSection): boolean {
  return (root.children || []).every(c => openSections.value.has(c.id))
}

function allCollapsed(root: SourceSection): boolean {
  return (root.children || []).every(c => !openSections.value.has(c.id))
}

function previewText(content: string): string {
  const firstLine = content.split('\n')[0].trim()
  if (!firstLine) return ''
  return firstLine.length > 60 ? firstLine.slice(0, 60) + '…' : firstLine
}

function textRows(content: string): number {
  return Math.max(3, Math.min(18, content.split('\n').length + 2))
}

function onEdit(section: SourceSection) {
  if (!edits.value[section.id]) return
  section.content = edits.value[section.id]
  modifiedSections.value.add(section.id)
  emit('update', props.sourceDoc!)
}

function contentTypeTag(type: string): 'success' | 'warning' | 'info' | 'danger' | '' {
  if (type === 'table') return 'success'
  if (type === 'schema') return 'warning'
  if (type === 'stages') return 'success'
  if (type === 'constraints') return 'danger'
  return 'info'
}

function contentTypeLabel(type: string): string {
  if (type === 'table') return '表格'
  if (type === 'schema') return 'Schema'
  if (type === 'stages') return '阶段'
  if (type === 'constraints') return '约束'
  return '文本'
}
</script>

<style scoped>
.source-view { display: flex; flex-direction: column; gap: 12px; }

/* Stats bar */
.source-stats {
  display: flex;
  gap: 16px;
  padding: 8px 12px;
  background: var(--admin-bg-surface);
  border-radius: 6px;
  border: 1px solid var(--admin-border-color, #e5e7eb);
}

.source-stats__item {
  font-size: 12px;
  font-weight: 600;
  color: var(--admin-text-secondary, #6b7280);
}

/* Root block */
.root-block {
  border: 1px solid var(--admin-border-color, #e5e7eb);
  border-radius: 8px;
  overflow: hidden;
  background: var(--admin-bg-surface);
}

.root-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  cursor: pointer;
  user-select: none;
  background: var(--admin-bg-hover, #f9fafb);
}

.root-header:hover { background: var(--admin-bg-surface-alt, #f3f4f6); }

.root-arrow {
  transition: transform 0.2s;
  font-size: 14px;
  color: var(--admin-text-muted, #9ca3af);
}

.root-arrow--open { transform: rotate(90deg); }

.root-title {
  font-size: 15px;
  font-weight: 700;
  color: var(--admin-text-primary, #111827);
  flex: 1;
  letter-spacing: -0.01em;
}

.root-count {
  font-size: 11px;
  color: var(--admin-text-muted, #9ca3af);
  background: var(--admin-bg-surface);
  padding: 2px 8px;
  border-radius: 10px;
}

.root-actions {
  display: flex;
  gap: 4px;
}

.root-actions :deep(.el-button) {
  font-size: 11px;
  padding: 2px 8px;
}

.root-body {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* Section card */
.section-card {
  border: 1px solid var(--admin-border-color, #e5e7eb);
  border-radius: 6px;
  overflow: hidden;
  background: var(--admin-bg-page);
}

.section-card:hover {
  border-color: var(--admin-color-brand, #3b82f6);
}

.section-card--modified {
  border-left: 3px solid var(--admin-color-warning, #f59e0b);
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  cursor: pointer;
  user-select: none;
}

.section-header:hover {
  background: var(--admin-bg-hover, #f9fafb);
}

.section-arrow {
  transition: transform 0.2s;
  font-size: 12px;
  color: var(--admin-text-muted, #9ca3af);
  flex-shrink: 0;
}

.section-arrow--open { transform: rotate(90deg); }

.section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--admin-text-primary, #111827);
  flex-shrink: 0;
}

.section-type { flex-shrink: 0; }

.section-meta {
  font-size: 11px;
  color: var(--admin-text-muted, #9ca3af);
  flex-shrink: 0;
}

.section-modified-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--admin-color-warning, #f59e0b);
  flex-shrink: 0;
  margin-left: 2px;
}

.section-preview {
  flex: 1;
  font-size: 12px;
  color: var(--admin-text-muted, #9ca3af);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  margin-left: 8px;
}

.section-body {
  padding: 12px;
  border-top: 1px solid var(--admin-border-color, #e5e7eb);
  background: var(--admin-bg-surface);
}

.section-editor {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 13px;
  line-height: 1.7;
}

.section-char-count {
  margin-top: 6px;
  font-size: 11px;
  color: var(--admin-text-muted, #9ca3af);
  text-align: right;
}
</style>
