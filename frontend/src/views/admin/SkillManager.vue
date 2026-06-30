<template>
  <div class="skill-manager-page">
    <header class="page-hero">
      <div class="hero-left">
        <span class="hero-pill">运营 · Skill 运行节点</span>
        <h1>Skill 管理中心</h1>
        <p class="hero-sub">
          管理所有主链 Skill（Goal / Path / Learn 内部能力）和外挂 Skill（检索、图片分析等）。
          <br />
          <span style="color: #8b5cf6; font-weight: 600;">
            如需编辑 Skill 的 Prompt 内容，请前往
            <a href="/admin/skills" style="color: #8b5cf6; text-decoration: underline; cursor: pointer;">Skill 运行节点</a>
          </span>
        </p>
      </div>
      <div class="hero-right">
        <el-button :icon="Refresh" :loading="loading" @click="loadAll">刷新</el-button>
      </div>
    </header>

    <section v-if="stats" class="health-strip">
      <div class="health-card health-card--total">
        <div class="health-card__label">Skill 总数</div>
        <div class="health-card__value">{{ stats.totalSkills }}</div>
        <div class="health-card__hint">已注册 skill</div>
      </div>
      <div class="health-card">
        <div class="health-card__label">总调用</div>
        <div class="health-card__value">{{ stats.totalCalls }}</div>
        <div class="health-card__hint">{{ stats.avgSuccessRate }}% 成功率</div>
      </div>
      <div class="health-card health-card--red">
        <div class="health-card__label">零引用</div>
        <div class="health-card__value">{{ zeroRefCount }}</div>
        <div class="health-card__hint">未被任何 Agent 引用</div>
      </div>
      <div class="health-card">
        <div class="health-card__label">分类数</div>
        <div class="health-card__value">{{ (categories || []).length }}</div>
        <div class="health-card__hint">不同能力域</div>
      </div>
    </section>

    <div class="filters">
      <el-input v-model="keyword" placeholder="搜索 Skill 名称 / 描述" clearable class="search" />
      <el-select v-model="categoryFilter" placeholder="分类" clearable>
        <el-option v-for="c in categories" :key="c.name" :label="c.label" :value="c.name" />
      </el-select>
      <el-checkbox v-model="onlyZeroRef">仅看零引用</el-checkbox>
    </div>

    <section class="skill-grid" v-loading="loading">
      <div class="category-group" v-for="group in groupedSkills" :key="group.category">
        <h3 class="category-name">{{ group.label }}</h3>
        <div class="skill-cards">
          <div
            v-for="skill in group.skills"
            :key="skill.name"
            class="skill-card"
            :class="{ 'skill-card--zero': !skill.agentRefCount, 'skill-card--active': selectedSkill?.name === skill.name }"
            @click="selectSkill(skill)"
          >
            <div class="skill-card__head">
              <span class="skill-card__name">{{ skill.name }}</span>
              <span class="skill-card__kind" :class="`skill-card__kind--${skill.category}`">
                {{ catLabel(skill.category) }}
              </span>
            </div>
            <div class="skill-card__desc">{{ skill.description || '暂无描述' }}</div>
            <div class="skill-card__meta">
              <div class="skill-card__stat" :class="{ 'skill-card__stat--zero': !skill.agentRefCount }">
                <span class="skill-card__stat-num">{{ skill.agentRefCount }}</span>
                <span>Agent 引用</span>
              </div>
              <div class="skill-card__stat">
                <span class="skill-card__stat-num">{{ fmtNum(skill.stats?.callCount || 0) }}</span>
                <span>调用</span>
              </div>
              <div class="skill-card__stat">
                <span class="skill-card__stat-num">{{ fmtPct(skill.stats?.successRate) }}</span>
                <span>成功率</span>
              </div>
            </div>
          </div>
          <div v-if="skillCards.length === 0" class="skill-grid__empty">没有符合条件的 Skill</div>
        </div>
      </div>
    </section>

    <el-drawer
      v-model="drawerVisible"
      :title="selectedSkill?.name || 'Skill 详情'"
      direction="rtl"
      size="720px"
    >
      <template v-if="selectedSkill">
        <div class="drawer-meta">
          <div class="drawer-meta__row">
            <span class="drawer-meta__k">分类</span>
            <span class="drawer-meta__v">{{ catLabel(selectedSkill.category) }}</span>
          </div>
          <div class="drawer-meta__row">
            <span class="drawer-meta__k">版本</span>
            <span class="drawer-meta__v">{{ selectedSkill.version }}</span>
          </div>
          <div class="drawer-meta__row">
            <span class="drawer-meta__k">能力</span>
            <span class="drawer-meta__v">{{ (selectedSkill.capabilities || []).join(', ') || '--' }}</span>
          </div>
        </div>

        <el-tabs v-model="drawerTab">
          <el-tab-pane label="概述" name="overview">
            <div class="drawer-section">
              <h4>描述</h4>
              <p>{{ selectedSkill.description || '无' }}</p>
            </div>
            <div class="drawer-section">
              <h4>输入 Schema</h4>
              <pre class="json-block">{{ fmtJson(selectedSkill.inputSchema) }}</pre>
            </div>
            <div class="drawer-section">
              <h4>输出 Schema</h4>
              <pre class="json-block">{{ fmtJson(selectedSkill.outputSchema) }}</pre>
            </div>
            <div class="drawer-section" v-if="selectedSkill.dependencies?.length">
              <h4>依赖</h4>
              <p>{{ selectedSkill.dependencies.join(', ') }}</p>
            </div>
          </el-tab-pane>

          <el-tab-pane label="Prompt" name="prompt">
            <div class="drawer-section">
              <div style="display: flex; gap: 8px; align-items: center;">
                <el-button size="small" :loading="promptLoading" @click="loadEffectivePrompt">
                  查看生效 Prompt
                </el-button>
                <el-button size="small" type="primary" @click="goToPromptEdit">
                  编辑 Prompt →
                </el-button>
              </div>
              <div v-if="effectivePrompt" class="prompt-info" style="margin-top:12px">
                <p><strong>状态：</strong>{{ effectivePrompt.source }}</p>
                <p v-if="effectivePrompt.prompt"><strong>版本：</strong>v{{ effectivePrompt.prompt.version }}</p>
                <pre class="json-block" v-if="effectivePrompt.prompt?.systemPrompt">{{ effectivePrompt.prompt.systemPrompt }}</pre>
              </div>
              <div v-if="effectivePrompt && effectivePrompt.promptDrift" style="margin-top:8px">
                <el-alert type="warning" :closable="false" show-icon title="DB ACTIVE 与代码默认 Prompt 不一致" />
              </div>
            </div>
          </el-tab-pane>

          <el-tab-pane label="关联 Agent" name="agents">
            <div class="drawer-section">
              <h4>引用此 Skill 的 Agent</h4>
              <div v-if="selectedAgentRefs.length" class="ref-list">
                <div v-for="ref in selectedAgentRefs" :key="ref" class="ref-chip">
                  {{ ref }}
                </div>
              </div>
              <p v-else class="empty-hint">未被任何 Agent 引用</p>
            </div>
            <div class="drawer-section" v-if="selectedOrchRefs.length">
              <h4>引用此 Skill 的 Agent</h4>
              <div class="ref-list">
                <div v-for="ref in selectedOrchRefs" :key="ref" class="ref-chip ref-chip--orch">
                  {{ ref }}
                </div>
              </div>
            </div>
          </el-tab-pane>

          <el-tab-pane label="调用日志" name="logs">
            <div class="drawer-section">
              <h4>运行统计</h4>
              <div class="stats-row">
                <div class="stats-item">
                  <span class="stats-item__v">{{ fmtNum(selectedSkill.stats?.callCount || 0) }}</span>
                  <span class="stats-item__k">总调用</span>
                </div>
                <div class="stats-item">
                  <span class="stats-item__v">{{ fmtPct(selectedSkill.stats?.successRate) }}</span>
                  <span class="stats-item__k">成功率</span>
                </div>
                <div class="stats-item">
                  <span class="stats-item__v">{{ selectedSkill.stats?.avgLatency || 0 }}ms</span>
                  <span class="stats-item__k">均值延迟</span>
                </div>
              </div>
            </div>
          </el-tab-pane>
        </el-tabs>
      </template>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Refresh } from '@element-plus/icons-vue'
import { adminSkillsApi } from '@/api/adminApi'
import { toast } from '@/utils/toast'

const router = useRouter()

interface SkillItem {
  name: string
  version: string
  category: string
  description: string
  capabilities: string[]
  dependencies: string[]
  stats: { callCount: number; successRate: number; avgLatency: number; lastCalledAt: string | null }
  agentRefCount: number
  agentRefs: string[]
  orchRefs: string[]
  inputSchema?: any
  outputSchema?: any
}

const loading = ref(false)
const skills = ref<SkillItem[]>([])
const stats = ref<any>(null)
const categories = ref<any[]>([])
const agentRelations = ref<Record<string, { agents: string[]; orchestrators: string[] }>>({})

const keyword = ref('')
const categoryFilter = ref('')
const onlyZeroRef = ref(false)

const selectedSkill = ref<SkillItem | null>(null)
const drawerVisible = ref(false)
const drawerTab = ref('overview')
const promptLoading = ref(false)
const effectivePrompt = ref<any>(null)

const zeroRefCount = computed(() => skills.value.filter(s => !s.agentRefCount).length)

const catLabelMap: Record<string, string> = {
  parsing: '解析', generation: '生成', analysis: '分析', retrieval: '检索', computation: '计算'
}
function catLabel(cat: string) { return catLabelMap[cat] || cat }

function fmtNum(n: number) { return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n) }
function fmtPct(r: number | undefined) { return r != null ? `${(r * 100).toFixed(0)}%` : '--' }
function fmtJson(obj: any) { return obj ? JSON.stringify(obj, null, 2) : '--' }

const groupedSkills = computed(() => {
  const map: Record<string, { category: string; label: string; skills: SkillItem[] }> = {}
  for (const s of skillCards.value) {
    if (!map[s.category]) map[s.category] = { category: s.category, label: catLabel(s.category), skills: [] }
    map[s.category].skills.push(s)
  }
  return Object.values(map).sort((a, b) => a.label.localeCompare(b.label))
})

const skillCards = computed(() => {
  let result = skills.value
  const kw = keyword.value.trim().toLowerCase()
  if (kw) result = result.filter(s => s.name.toLowerCase().includes(kw) || (s.description || '').toLowerCase().includes(kw))
  if (categoryFilter.value) result = result.filter(s => s.category === categoryFilter.value)
  if (onlyZeroRef.value) result = result.filter(s => !s.agentRefCount)
  return result
})

const selectedAgentRefs = computed(() =>
  selectedSkill.value ? (agentRelations.value[selectedSkill.value.name]?.agents || []) : [])
const selectedOrchRefs = computed(() =>
  selectedSkill.value ? (agentRelations.value[selectedSkill.value.name]?.orchestrators || []) : [])

async function loadAll() {
  loading.value = true
  try {
    const [skillsRes, catsRes, trendsRes, relsRes] = await Promise.all([
      adminSkillsApi.getSkills(),
      adminSkillsApi.getAgentRelations(),
      loadTrends(),
      adminSkillsApi.getAgentRelations()
    ])

    const rawSkills: any[] = skillsRes.data?.data || []
    const rels: Record<string, any> = relsRes.data?.data || {}

    const catsData = await adminSkillsApi.getAgentRelations()
    const uniqueCats = [...new Set(rawSkills.map(s => s.category))]
    categories.value = uniqueCats.map(c => ({ name: c, label: catLabel(c) }))

    skills.value = rawSkills.map(s => ({
      ...s,
      agentRefCount: (rels[s.name]?.agents?.length || 0) + (rels[s.name]?.orchestrators?.length || 0),
      agentRefs: rels[s.name]?.agents || [],
      orchRefs: rels[s.name]?.orchestrators || [],
    }))

    agentRelations.value = rels

    stats.value = {
      totalSkills: skills.value.length,
      totalCalls: skills.value.reduce((sum, s) => sum + (s.stats?.callCount || 0), 0),
      avgSuccessRate: skills.value.length
        ? (skills.value.reduce((sum, s) => sum + (s.stats?.callRate || s.stats?.successRate || 0), 0) / skills.value.length * 100).toFixed(1)
        : '0'
    }
  } catch (err: any) {
    toast.error(err?.response?.data?.error || '加载失败')
  } finally {
    loading.value = false
  }
}

async function loadTrends() {
  return adminSkillsApi.getAgentRelations()
}

function selectSkill(skill: SkillItem) {
  selectedSkill.value = skill
  drawerVisible.value = true
  drawerTab.value = 'overview'
  effectivePrompt.value = null
}

// 支持 URL 参数自动选中 Skill
onMounted(() => { 
  loadAll()
  
  // 检查 URL 参数
  const urlParams = new URLSearchParams(window.location.search)
  const skillId = urlParams.get('skillId')
  if (skillId) {
    // 等待数据加载后再选中
    setTimeout(() => {
      const targetSkill = skills.value.find(s => s.name === skillId)
      if (targetSkill) {
        selectSkill(targetSkill)
      }
    }, 500)
  }
})

function goToPromptEdit() {
  if (!selectedSkill.value) return
  router.push(`/admin/skills?agentId=${selectedSkill.value.name}`)
}

async function loadEffectivePrompt() {
  if (!selectedSkill.value) return
  promptLoading.value = true
  try {
    const res = await adminSkillsApi.getEffectiveSkillPrompt(selectedSkill.value.name)
    effectivePrompt.value = res.data?.data || null
  } catch {
    effectivePrompt.value = null
  } finally {
    promptLoading.value = false
  }
}
</script>

<style scoped>
.skill-manager-page {
  display: grid;
  gap: 18px;
  padding: 24px 28px 36px;
  background: linear-gradient(180deg, #f7f9fd 0%, #fafbfe 60%, #ffffff 100%);
  min-height: 100vh;
}

.page-hero {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 24px;
  align-items: end;
  padding: 22px 26px;
  border-radius: 22px;
  background: linear-gradient(135deg, rgba(141, 107, 255, 0.05), rgba(52, 120, 246, 0.05));
  border: 1px solid rgba(205, 216, 238, 0.7);
}
.hero-pill {
  display: inline-flex;
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(141, 107, 255, 0.1);
  color: #6d28d9;
  font-size: 11px;
  font-weight: 700;
}
.page-hero h1 {
  margin: 10px 0 8px;
  font-size: 1.5rem;
  font-weight: 800;
  color: #1a2a44;
}
.hero-sub { margin: 0; color: #62758f; line-height: 1.7; font-size: 13px; }
.hero-right { display: flex; gap: 8px; align-items: center; }

.health-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
}
.health-card {
  padding: 14px 16px;
  border-radius: 14px;
  border: 1px solid rgba(205, 216, 238, 0.9);
  background: var(--admin-bg-surface);
  display: grid;
  gap: 4px;
}
.health-card__label { font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
.health-card__value { font-size: 28px; font-weight: 800; font-family: 'JetBrains Mono', Consolas, monospace; color: #1a2a44; }
.health-card__hint { font-size: 11px; color: #94a3b8; }
.health-card--total { background: linear-gradient(180deg, rgba(141, 107, 255, 0.04), white); }
.health-card--red { background: linear-gradient(180deg, rgba(220, 38, 38, 0.04), white); }
.health-card--red .health-card__value { color: #b91c1c; }

.filters {
  display: flex;
  gap: 10px;
  align-items: center;
}
.filters .search { width: 280px; }

.category-name {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 800;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding: 8px 0;
  border-bottom: 2px solid rgba(141, 107, 255, 0.12);
}

.skill-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}

.skill-card {
  padding: 16px;
  border-radius: 14px;
  border: 1px solid rgba(205, 216, 238, 0.7);
  background: var(--admin-bg-surface);
  cursor: pointer;
  display: grid;
  gap: 10px;
  transition: all 0.15s ease;
}
.skill-card:hover { border-color: #8b6dff; box-shadow: 0 0 0 3px rgba(141, 107, 255, 0.06); }
.skill-card--active { border-color: #8b6dff; background: rgba(141, 107, 255, 0.04); }
.skill-card--zero { border-color: rgba(220, 38, 38, 0.3); background: rgba(220, 38, 38, 0.02); }

.skill-card__head { display: flex; justify-content: space-between; align-items: center; }
.skill-card__name { font-weight: 700; font-size: 14px; color: #1a2a44; }
.skill-card__kind { font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 999px; }
.skill-card__kind--parsing { background: rgba(14, 165, 233, 0.1); color: #0369a1; }
.skill-card__kind--generation { background: rgba(34, 197, 94, 0.1); color: #15803d; }
.skill-card__kind--analysis { background: rgba(168, 85, 247, 0.1); color: #7c3aed; }
.skill-card__kind--retrieval { background: rgba(245, 158, 11, 0.1); color: #b45309; }
.skill-card__kind--computation { background: rgba(239, 68, 68, 0.1); color: #b91c1c; }

.skill-card__desc { font-size: 12px; color: #64748b; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.skill-card__meta { display: flex; gap: 14px; }
.skill-card__stat { display: grid; gap: 2px; }
.skill-card__stat-num { font-size: 16px; font-weight: 800; font-family: 'JetBrains Mono', Consolas, monospace; color: #1a2a44; }
.skill-card__stat span:last-child { font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.03em; }
.skill-card__stat--zero .skill-card__stat-num { color: #dc2626; }

.skill-grid__empty { padding: 32px; text-align: center; color: #94a3b8; font-size: 13px; }

.drawer-meta { display: grid; gap: 8px; margin-bottom: 16px; }
.drawer-meta__row { display: flex; gap: 8px; }
.drawer-meta__k { font-weight: 700; font-size: 12px; color: #64748b; min-width: 60px; }
.drawer-meta__v { font-size: 13px; color: #1a2a44; }

.drawer-section { margin-bottom: 20px; }
.drawer-section h4 { margin: 0 0 8px; font-size: 13px; font-weight: 800; color: #64748b; text-transform: uppercase; }
.json-block {
  background: #1e293b;
  color: #e2e8f0;
  padding: 14px;
  border-radius: 10px;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
  overflow-x: auto;
  max-height: 400px;
  white-space: pre-wrap;
  word-break: break-all;
}

.ref-list { display: flex; flex-wrap: wrap; gap: 8px; }
.ref-chip { padding: 4px 10px; border-radius: 999px; background: rgba(52, 120, 246, 0.08); color: #1d4ed8; font-size: 12px; font-weight: 600; }
.ref-chip--orch { background: rgba(141, 107, 255, 0.08); color: #6d28d9; }
.empty-hint { font-size: 13px; color: #94a3b8; }

.stats-row { display: flex; gap: 20px; }
.stats-item { display: grid; gap: 2px; }
.stats-item__v { font-size: 18px; font-weight: 800; font-family: 'JetBrains Mono', Consolas, monospace; color: #1a2a44; }
.stats-item__k { font-size: 11px; color: #94a3b8; }

.prompt-info p { margin: 4px 0; font-size: 13px; }
</style>
