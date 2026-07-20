<template>
  <Teleport to="body">
    <div v-if="entity" class="msk" @mousedown.self="closeSkillDrawer">
      <aside class="msk__panel" role="dialog" aria-label="详情">
        <header class="msk__head">
          <div class="msk__title">
            <span class="mk-badge" :class="stat.errors ? 'mk-badge--bad' : 'mk-badge--ok'">
              {{ stat.errors ? `${stat.errors} 次失败` : '健康' }}
            </span>
            <h3>{{ entity.name }}</h3>
            <span class="msk__id">{{ entity.id }}</span>
          </div>
          <button type="button" class="msk__close" aria-label="关闭" @click="closeSkillDrawer">✕</button>
        </header>

        <div class="msk__body">
          <p class="msk__desc">{{ entity.description }}</p>

          <div class="msk__meta">
            <template v-if="skillProfile">
              <div><span>所属</span><strong>{{ skillProfile.agentName }}</strong></div>
              <div><span>类别</span><strong>{{ skillProfile.category }}</strong></div>
              <div><span>Prompt</span><strong class="mono">{{ skillProfile.promptVersion }}</strong></div>
            </template>
            <template v-else>
              <div><span>类型</span><strong>Agent</strong></div>
              <div><span>下辖 Skill</span><strong>{{ memberSkills.length }} 个</strong></div>
              <div><span>异常 Skill</span><strong :class="{ 'is-bad-text': memberErrors > 0 }">{{ memberErrors }}</strong></div>
            </template>
          </div>

          <div class="msk__stats">
            <div class="msk__stat">
              <span>调用</span>
              <strong>{{ stat.calls || '—' }}</strong>
            </div>
            <div class="msk__stat">
              <span>失败</span>
              <strong :class="{ 'is-bad': stat.errors > 0 }">{{ stat.calls ? stat.errors : '—' }}</strong>
            </div>
            <div class="msk__stat">
              <span>成功率</span>
              <strong>{{ successRate }}</strong>
            </div>
            <div class="msk__stat">
              <span>平均耗时</span>
              <strong>{{ stat.calls ? fmtMs(stat.avgMs) : '—' }}</strong>
            </div>
          </div>

          <!-- Agent 视图：下辖 Skill 清单 -->
          <section v-if="!skillProfile && memberSkills.length" class="msk__section">
            <h4>下辖 Skill</h4>
            <div class="msk__spans">
              <button
                v-for="s in memberSkills"
                :key="s.id"
                type="button"
                class="msk__span"
                @click="openSkillDrawer(s.id)"
              >
                <span class="msk__span-dot" :class="skillStatOf(s.id).errors ? 'is-err' : skillStatOf(s.id).calls ? 'is-ok' : 'is-idle'"></span>
                <span class="msk__span-title">{{ s.name }}</span>
                <span class="msk__span-dur mono">{{ skillStatOf(s.id).calls || '—' }}</span>
                <span class="msk__span-trace mono">{{ s.id }}</span>
              </button>
            </div>
          </section>

          <section class="msk__section">
            <h4>最近调用</h4>
            <div v-if="recent.length" class="msk__spans">
              <button
                v-for="s in recent"
                :key="s.id"
                type="button"
                class="msk__span"
                @click="goTrace(s.traceId)"
              >
                <span class="msk__span-dot" :class="`is-${s.status}`"></span>
                <span class="msk__span-title">{{ s.title }}</span>
                <span class="msk__span-dur mono">{{ fmtMs(s.durationMs) }}</span>
                <span class="msk__span-trace mono">{{ s.traceId }}</span>
              </button>
            </div>
            <p v-else class="msk__none">还没有调用记录。</p>
          </section>

          <section v-if="skillProfile" class="msk__section">
            <h4>Prompt 版本</h4>
            <div class="msk__prompt">
              <span class="mono">{{ skillProfile.promptVersion }}</span>
              <button type="button" class="mk-link" @click="goPromptLab">去 Prompt Lab 检视 →</button>
            </div>
          </section>
        </div>
      </aside>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  intent,
  skillProfiles,
  agentProfiles,
  skillsOfAgent,
  skillStatOf,
  recentSpansOf,
  openTrace,
  openSkillDrawer,
  closeSkillDrawer
} from './mockStore'

const skillProfile = computed(() => skillProfiles.find((p) => p.id === intent.skillDrawerId) || null)
const agentProfile = computed(() => agentProfiles.find((p) => p.id === intent.skillDrawerId) || null)
const entity = computed(() => skillProfile.value || agentProfile.value)

const memberSkills = computed(() => (agentProfile.value ? skillsOfAgent(agentProfile.value.id) : []))
const memberErrors = computed(() => memberSkills.value.filter((s) => skillStatOf(s.id).errors > 0).length)

const stat = computed(() => {
  if (skillProfile.value) return skillStatOf(skillProfile.value.id)
  // Agent：聚合下辖 Skill 的统计
  const members = memberSkills.value.map((s) => skillStatOf(s.id))
  const calls = members.reduce((a, m) => a + m.calls, 0)
  const errors = members.reduce((a, m) => a + m.errors, 0)
  const avgMs = calls ? Math.round(members.reduce((a, m) => a + m.avgMs * m.calls, 0) / calls) : 0
  return { calls, errors, avgMs, lastAt: calls ? '刚刚' : '从未' }
})

const recent = computed(() => (entity.value ? recentSpansOf(entity.value.id) : []))

const successRate = computed(() => {
  if (!stat.value.calls) return '—'
  const r = ((stat.value.calls - stat.value.errors) / stat.value.calls) * 100
  return `${r.toFixed(1)}%`
})

const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`)

// 抽屉是覆盖层：跳瀑布前先收起，保证动线连贯
function goTrace(traceId: string) {
  closeSkillDrawer()
  openTrace(traceId)
}

function goPromptLab() {
  closeSkillDrawer()
  intent.scene = 'prompt-lab'
}
</script>

<style scoped>
.msk {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(15, 23, 42, 0.36);
  display: flex;
  justify-content: flex-end;
}
.msk__panel {
  width: min(440px, 100vw);
  height: 100%;
  background: #fff;
  box-shadow: -16px 0 48px rgba(15, 23, 42, 0.18);
  display: grid;
  grid-template-rows: auto 1fr;
  animation: msk-in 0.2s ease;
}
@keyframes msk-in {
  from { transform: translateX(30px); opacity: 0; }
}

.msk__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 16px 18px;
  border-bottom: 1px solid #e1e8f2;
}
.msk__title { display: grid; gap: 6px; justify-items: start; }
.msk__title h3 { margin: 0; font-size: 18px; }
.msk__id { font-family: 'JetBrains Mono', monospace; font-size: 11.5px; color: #8492ab; }
.msk__close {
  border: 0;
  background: #f0f2f5;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  cursor: pointer;
  color: #5b6577;
  font-size: 13px;
}

.msk__body { padding: 16px 18px; display: grid; gap: 16px; align-content: start; overflow-y: auto; }
.msk__desc { margin: 0; color: #5b6577; font-size: 13px; line-height: 1.6; }

.msk__meta {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.msk__meta > div { display: grid; gap: 2px; }
.msk__meta span { font-size: 11px; color: #8492ab; font-weight: 600; }
.msk__meta strong { font-size: 12.5px; }

.msk__stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.msk__stat {
  display: grid;
  gap: 2px;
  padding: 10px;
  border: 1px solid #e1e8f2;
  border-radius: 10px;
  text-align: center;
}
.msk__stat span { font-size: 10.5px; color: #8492ab; font-weight: 600; }
.msk__stat strong { font-size: 16px; font-variant-numeric: tabular-nums; }
.msk__stat strong.is-bad { color: #dc2626; }

.msk__section { display: grid; gap: 8px; }
.msk__section h4 {
  margin: 0;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #8492ab;
}

.msk__spans { display: grid; gap: 4px; }
.msk__span {
  display: grid;
  grid-template-columns: 10px 1fr auto auto;
  gap: 10px;
  align-items: center;
  padding: 8px 10px;
  border: 1px solid #e1e8f2;
  border-radius: 8px;
  background: #fff;
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.msk__span:hover { border-color: rgba(52, 120, 246, 0.35); }
.msk__span-dot { width: 8px; height: 8px; border-radius: 50%; }
.msk__span-dot.is-ok { background: #15803d; }
.msk__span-dot.is-warn { background: #b45309; }
.msk__span-dot.is-err { background: #dc2626; }
.msk__span-dot.is-idle { background: #c3cede; }
.is-bad-text { color: #dc2626; }
.msk__span-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.msk__span-dur { color: #5b6577; font-size: 11px; }
.msk__span-trace { color: #b45309; font-size: 11px; }
.mono { font-family: 'JetBrains Mono', monospace; }
.msk__none { margin: 0; color: #8492ab; font-size: 12.5px; }

.msk__prompt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border: 1px dashed #e1e8f2;
  border-radius: 8px;
}
.mk-link {
  border: 0;
  background: transparent;
  color: #3478f6;
  font: inherit;
  font-weight: 700;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
</style>
