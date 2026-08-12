<template>
  <Teleport to="body">
    <div v-if="open" class="agd" @keydown.esc="close">
      <div class="agd__mask" @click="close"></div>
      <aside class="agd__panel" role="dialog" aria-label="运营术语表">
        <div class="agd__head">
          <div class="agd__title">
            <strong>这是什么 · 运营术语表</strong>
            <span class="agd__subtitle">不懂的词在这里查一句话人话</span>
          </div>
          <button type="button" class="agd__close" aria-label="关闭" @click="close">✕</button>
        </div>

        <div class="agd__search">
          <input v-model="keyword" type="search" class="agd__input" placeholder="搜索术语 / 定义…" />
          <div class="agd__cats">
            <button
              v-for="c in categories"
              :key="c.id"
              type="button"
              class="agd__cat"
              :class="{ 'is-active': category === c.id }"
              @click="category = c.id"
            >{{ c.label }}（{{ countOf(c.id) }}）</button>
          </div>
        </div>

        <div class="agd__body">
          <template v-if="dataSource === 'live' && !loaded">
            <div class="agd__loading">加载术语表中…</div>
          </template>
          <template v-else>
            <!-- 角色与流转 -->
            <section v-if="showCategory('flow')" class="agd__section">
              <h4 class="agd__section-title">角色与流转</h4>
              <ul class="agd__list">
                <li v-for="m in filteredRoles" :key="m.id" class="agd__term">
                  <span class="agd__term-name">
                    {{ m.label }}<span class="agd__term-en mono">{{ m.id }}</span>
                  </span>
                  <span class="agd__term-def">{{ m.hint }}</span>
                </li>
                <li v-if="filteredRoles.length" class="agd__term">
                  <span class="agd__term-name">render</span>
                  <span class="agd__term-def">字段是否对外可见：visible=会出现在对外交付，hidden=仅内部流转</span>
                </li>
                <li v-if="filteredRoles.length" class="agd__term">
                  <span class="agd__term-name">handoff（移交）</span>
                  <span class="agd__term-def">字段产完后交给谁：可交给下一阶段（如 path）或指定 agent/skill；空=不转交</span>
                </li>
                <li v-if="filteredRoles.length" class="agd__term">
                  <span class="agd__term-name">internal（内部信令）</span>
                  <span class="agd__term-def">仅供平台内部/UI 控制使用，不进业务状态的字段标记</span>
                </li>
                <li v-if="filteredRoles.length" class="agd__term">
                  <span class="agd__term-name">accumulate（累积）</span>
                  <span class="agd__term-def">值会累积进学习者状态（画像/上下文），供后续阶段持续使用</span>
                </li>
                <li v-if="filteredRoles.length === 0" class="agd__empty">无匹配词条</li>
              </ul>
            </section>

            <!-- 状态：完成度五档 + 三分语义 -->
            <section v-if="showCategory('status')" class="agd__section">
              <h4 class="agd__section-title">状态：完成度五档</h4>
              <ul class="agd__list">
                <li v-for="m in filteredCompletion" :key="m.status" class="agd__term">
                  <span class="agd__term-name">{{ m.label }}<span class="agd__term-en mono">{{ m.status }}</span></span>
                  <span class="agd__term-def">{{ m.hint }}</span>
                </li>
              </ul>
              <h4 class="agd__section-title">健康区三分语义</h4>
              <ul class="agd__list">
                <li v-for="s in filteredSemantics" :key="s.id" class="agd__term">
                  <span class="agd__term-name">{{ s.label }}<span class="agd__term-en mono">{{ s.id }}</span></span>
                  <span class="agd__term-def">{{ s.hint }}</span>
                </li>
              </ul>
            </section>

            <!-- 阶段 -->
            <section v-if="showCategory('stage')" class="agd__section">
              <h4 class="agd__section-title">五个阶段</h4>
              <ul class="agd__list">
                <li v-for="s in filteredStages" :key="s.id" class="agd__term">
                  <span class="agd__term-name">{{ s.label }}<span class="agd__term-en mono">{{ s.id }}</span></span>
                  <span class="agd__term-def">{{ s.hint }}</span>
                </li>
              </ul>
            </section>

            <!-- 概念 / 健康词条 -->
            <section v-for="c in CATEGORY_SECTIONS" :key="c.id" v-show="showCategory(c.id)" class="agd__section">
              <h4 class="agd__section-title">{{ c.label }}</h4>
              <ul class="agd__list">
                <li v-for="t in termsOf(c.id)" :key="t.term" class="agd__term">
                  <span class="agd__term-name">{{ t.term }}</span>
                  <span class="agd__term-def">{{ t.def }}<template v-if="t.where"> · <em class="agd__term-where">{{ t.where }}</em></template></span>
                </li>
                <li v-if="termsOf(c.id).length === 0" class="agd__empty">无匹配词条</li>
              </ul>
            </section>

            <!-- 文档链接 -->
            <section v-if="filteredDocs.length" class="agd__section">
              <h4 class="agd__section-title">文档链接</h4>
              <ul class="agd__list">
                <li v-for="d in filteredDocs" :key="d.path" class="agd__term">
                  <span class="agd__term-name">{{ d.title }}<span class="agd__term-en mono">{{ d.path }}</span></span>
                  <span class="agd__term-def">{{ d.desc }}</span>
                </li>
              </ul>
            </section>

            <p v-if="dataSource !== 'live'" class="agd__demo-note">
              演示模式：以下为内置精简词条；连接后端后自动加载完整术语表（GET /api/admin/glossary）。
            </p>
          </template>
        </div>
      </aside>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { adminGlossaryApi } from '@/api/adminApi'
import { dataSource } from './store'
import { COMPLETION_META, SEMANTICS_META, DEMO_GLOSSARY_TERMS, DEMO_GLOSSARY_DOCS } from './glossaryMeta'
import { errMsg } from './live'

interface PromptRoleMeta { id: string; label: string; hint: string }
interface StageMeta { id: string; label: string; hint: string }

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const keyword = ref('')
const category = ref<CategoryId>('all')
const loaded = ref(false)

const promptRoles = ref<PromptRoleMeta[]>([])
const completionStates = ref(COMPLETION_META)
const semantics = ref(SEMANTICS_META)
const stages = ref<StageMeta[]>([])
const terms = ref(DEMO_GLOSSARY_TERMS)
const docs = ref(DEMO_GLOSSARY_DOCS)

const CATEGORY_SECTIONS = [
  { id: 'concept', label: '概念' },
  { id: 'health', label: '健康中心术语' },
] as const

type CategoryId = 'all' | 'concept' | 'flow' | 'status' | 'health' | 'stage'

const categories: Array<{ id: CategoryId; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'flow', label: '角色流转' },
  { id: 'status', label: '状态' },
  { id: 'concept', label: '概念' },
  { id: 'health', label: '健康' },
  { id: 'stage', label: '阶段' },
]

function showCategory(id: string) {
  if (category.value !== 'all' && category.value !== id) return false
  if (category.value === 'all') {
    if (id === 'concept' || id === 'health') return true
  }
  return true
}

function countOf(id: string) {
  if (id === 'all') return promptRoles.value.length + completionStates.value.length + semantics.value.length + stages.value.length + terms.value.length + docs.value.length
  if (id === 'flow') return promptRoles.value.length + 5
  if (id === 'status') return completionStates.value.length + semantics.value.length
  if (id === 'stage') return stages.value.length
  return terms.value.filter((t) => t.category === id).length
}

function termsOf(id: 'concept' | 'health') {
  const kw = keyword.value.trim().toLowerCase()
  return terms.value.filter((t) => t.category === id && (!kw || t.term.toLowerCase().includes(kw) || t.def.toLowerCase().includes(kw)))
}

const kwLower = computed(() => keyword.value.trim().toLowerCase())

const filteredRoles = computed(() => promptRoles.value.filter((m) =>
  !kwLower.value || m.id.includes(kwLower.value) || m.label.includes(kwLower.value) || m.hint.includes(kwLower.value)))
const filteredCompletion = computed(() => completionStates.value.filter((m) =>
  !kwLower.value || m.status.includes(kwLower.value) || m.label.includes(kwLower.value) || m.hint.includes(kwLower.value)))
const filteredSemantics = computed(() => semantics.value.filter((s) =>
  !kwLower.value || s.id.includes(kwLower.value) || s.label.includes(kwLower.value) || s.hint.includes(kwLower.value)))
const filteredStages = computed(() => stages.value.filter((s) =>
  !kwLower.value || s.id.includes(kwLower.value) || s.label.includes(kwLower.value) || s.hint.includes(kwLower.value)))
const filteredDocs = computed(() => docs.value.filter((d) =>
  !kwLower.value || d.title.includes(kwLower.value) || d.path.includes(kwLower.value) || d.desc.includes(kwLower.value)))

async function load() {
  if (dataSource.value !== 'live') return
  try {
    const res = await adminGlossaryApi.get()
    const data = res.data?.data
    if (!data) return
    promptRoles.value = data.promptRoles || []
    completionStates.value = data.completionStates || COMPLETION_META
    semantics.value = data.semantics || SEMANTICS_META
    stages.value = data.stages || []
    terms.value = data.terms || []
    docs.value = data.docs || []
  } catch (e) {
    console.warn('术语表加载失败（使用内置词条兜底）：', errMsg(e))
  } finally {
    loaded.value = true
  }
}

watch(() => props.open, (o) => {
  if (o) {
    loaded.value = false
    keyword.value = ''
    void load()
  }
})
onMounted(() => { if (props.open) void load() })

function close() { emit('close') }
</script>

<style scoped>
.agd { position: fixed; inset: 0; z-index: var(--mk-z-modal, 900); }
.agd__mask { position: absolute; inset: 0; background: rgba(15, 23, 42, 0.35); backdrop-filter: blur(2px); }
.agd__panel {
  position: absolute;
  top: 0; right: 0; bottom: 0;
  width: min(460px, 92vw);
  display: grid;
  grid-template-rows: auto auto 1fr;
  background: #fff;
  box-shadow: -12px 0 32px rgba(15, 23, 42, 0.16);
  animation: agd-in 0.18s ease;
}
@keyframes agd-in { from { transform: translateX(24px); opacity: 0; } to { transform: none; opacity: 1; } }
.agd__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; padding: 16px 18px 10px; }
.agd__title { display: grid; gap: 2px; }
.agd__title strong { font-size: 15px; color: var(--mk-ink, #1a2a44); }
.agd__subtitle { font-size: 11.5px; color: var(--mk-faint, #71809a); }
.agd__close { border: 0; background: #f1f5fb; color: #5b6577; width: 26px; height: 26px; border-radius: 8px; cursor: pointer; font-size: 12px; }
.agd__close:hover { background: #e2eaf7; color: #1a2a44; }
.agd__search { display: grid; gap: 8px; padding: 6px 18px 12px; border-bottom: 1px solid var(--mk-line, #e6ebf4); }
.agd__input {
  width: 100%; box-sizing: border-box;
  padding: 8px 12px; border: 1px solid var(--mk-line, #e6ebf4); border-radius: 9px;
  font: inherit; font-size: 12.5px; outline: none;
}
.agd__input:focus { border-color: var(--mk-blue, #3478f6); }
.agd__cats { display: flex; flex-wrap: wrap; gap: 6px; }
.agd__cat {
  padding: 3px 10px; border: 1px solid var(--mk-line, #e6ebf4); border-radius: 999px;
  background: #fff; color: var(--mk-muted, #5b6577); font: inherit; font-size: 11.5px; font-weight: 600; cursor: pointer;
}
.agd__cat.is-active { background: #eef5ff; color: #1f57cc; border-color: rgba(52, 120, 246, 0.4); }
.agd__body { overflow-y: auto; padding: 6px 18px 20px; }
.agd__loading { padding: 30px 0; text-align: center; color: var(--mk-faint, #71809a); font-size: 12.5px; }
.agd__section { margin-top: 14px; }
.agd__section-title {
  margin: 0 0 6px; font-size: 11px; font-weight: 800; letter-spacing: 0.06em;
  text-transform: uppercase; color: var(--mk-faint, #71809a);
}
.agd__list { margin: 0; padding: 0; list-style: none; display: grid; gap: 5px; }
.agd__term { display: grid; gap: 1px; padding: 7px 10px; border-radius: 9px; background: #f8fafd; }
.agd__term-name { font-size: 12.5px; font-weight: 700; color: var(--mk-ink, #1a2a44); display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.agd__term-en { font-size: 10.5px; color: var(--mk-faint, #71809a); font-weight: 600; }
.agd__term-def { font-size: 11.5px; color: var(--mk-muted, #5b6577); line-height: 1.5; }
.agd__term-where { font-style: normal; color: var(--mk-blue, #3478f6); }
.agd__empty { padding: 8px 0; color: var(--mk-faint, #71809a); font-size: 12px; }
.agd__demo-note { margin-top: 16px; padding: 8px 12px; border: 1px dashed rgba(52, 120, 246, 0.4); border-radius: 9px; background: #f0f5ff; color: var(--mk-blue, #3478f6); font-size: 11.5px; }

@media (min-width: 2000px) {
  .agd__panel { width: 560px; }
  .agd__head { padding: 20px 24px 12px; }
  .agd__title strong { font-size: 17px; }
  .agd__subtitle { font-size: 13.5px; }
  .agd__close { width: 30px; height: 30px; font-size: 14px; }
  .agd__search { padding: 8px 24px 14px; }
  .agd__input { padding: 9px 14px; font-size: 14px; }
  .agd__cat { font-size: 13.5px; }
  .agd__body { padding: 8px 24px 24px; }
  .agd__loading { font-size: 14.5px; }
  .agd__section-title { font-size: 13px; }
  .agd__term-name { font-size: 15px; }
  .agd__term-en { font-size: 12.5px; }
  .agd__term-def { font-size: 13.5px; }
  .agd__empty { font-size: 14px; }
  .agd__demo-note { font-size: 13.5px; }
}
@media (min-width: 2800px) {
  .agd__panel { width: 700px; }
  .agd__head { padding: 24px 30px 14px; }
  .agd__title strong { font-size: 19px; }
  .agd__subtitle { font-size: 16px; }
  .agd__close { width: 36px; height: 36px; font-size: 16.5px; }
  .agd__search { padding: 10px 30px 16px; }
  .agd__input { padding: 11px 16px; font-size: 16.5px; }
  .agd__cat { font-size: 16px; }
  .agd__body { padding: 10px 30px 30px; }
  .agd__loading { font-size: 17px; }
  .agd__section-title { font-size: 15.5px; }
  .agd__term-name { font-size: 18px; }
  .agd__term-en { font-size: 15px; }
  .agd__term-def { font-size: 16px; }
  .agd__empty { font-size: 16.5px; }
  .agd__demo-note { font-size: 16px; }
}
@media (min-width: 3600px) {
  .agd__panel { width: 880px; }
  .agd__head { padding: 28px 36px 16px; }
  .agd__title strong { font-size: 22px; }
  .agd__subtitle { font-size: 19px; }
  .agd__close { width: 42px; height: 42px; font-size: 19.5px; }
  .agd__search { padding: 12px 36px 18px; }
  .agd__input { padding: 13px 19px; font-size: 19px; }
  .agd__cat { font-size: 19px; }
  .agd__body { padding: 12px 36px 36px; }
  .agd__loading { font-size: 20px; }
  .agd__section-title { font-size: 18.5px; }
  .agd__term-name { font-size: 21.5px; }
  .agd__term-en { font-size: 17.5px; }
  .agd__term-def { font-size: 19px; }
  .agd__empty { font-size: 19.5px; }
  .agd__demo-note { font-size: 19px; }
}
</style>
