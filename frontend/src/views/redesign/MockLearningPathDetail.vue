<template>
  <div class="detail">
    <MockNav active="paths" />

    <main class="detail__main">
      <!-- 面包屑 -->
      <div class="crumbs">
        <span class="crumbs__back" @click="labGo('paths')">‹ 路径列表</span>
        <span class="crumbs__sep">/</span>
        <span class="crumbs__current">{{ mainPath.title }}</span>
      </div>

      <!-- 头部 Hero -->
      <section class="hero card">
        <div class="hero__main">
          <div class="hero__tags">
            <span class="kicker">路径详情</span>
            <span class="badge badge--blue">进行中</span>
          </div>
          <h1>{{ mainPath.title }}</h1>
          <p>{{ mainPath.desc }}</p>
          <div class="hero__metrics">
            <span class="metric"><b>2 / 4</b>当前阶段</span>
            <span class="metric"><b>{{ mainPath.hours }} 小时</b>预计投入</span>
            <span class="metric"><b>4 / 13</b>任务进度</span>
            <span class="metric"><b>每天 1 小时</b>计划节奏</span>
          </div>
          <div class="hero__actions">
            <span class="btn-primary" @click="labGo('learning')">
              <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
              继续当前任务
            </span>
            <span class="btn-ghost">调整路径</span>
          </div>
        </div>
        <div class="hero__ring">
          <svg viewBox="0 0 120 120" width="120" height="120">
            <circle cx="60" cy="60" r="52" fill="none" stroke="#edf1f8" stroke-width="10" />
            <circle
              cx="60" cy="60" r="52" fill="none"
              stroke="url(#ringGrad)" stroke-width="10" stroke-linecap="round"
              :stroke-dasharray="326.7" :stroke-dashoffset="326.7 * (1 - mainPath.percent / 100)"
              transform="rotate(-90 60 60)"
            />
            <defs>
              <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stop-color="#3478f6" />
                <stop offset="100%" stop-color="#43b0d8" />
              </linearGradient>
            </defs>
          </svg>
          <div class="hero__ring-text"><b>{{ mainPath.percent }}%</b><small>整体进度</small></div>
        </div>
      </section>

      <div class="detail__grid">
        <!-- 阶段列表 -->
        <div class="stages">
          <section v-for="stage in mainPath.stages" :key="stage.no" class="stage card" :class="`stage--${stage.status}`">
            <button type="button" class="stage__head" @click="toggleStage(stage.no)">
              <span class="stage__no" :class="`stage__no--${stage.status}`">
                <svg v-if="stage.status === 'done'" viewBox="0 0 24 24" width="13" height="13"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
                <template v-else>{{ stage.no }}</template>
              </span>
              <span class="stage__title">
                <strong>阶段 {{ stage.no }} · {{ stage.title }}</strong>
                <small>{{ stage.goal }}</small>
              </span>
              <span class="stage__prog">{{ stageProgress(stage) }}</span>
              <span class="stage__chev" :class="{ 'stage__chev--open': openStages.includes(stage.no) }">⌄</span>
            </button>

            <div v-if="openStages.includes(stage.no)" class="stage__body">
              <div
                v-for="task in stage.tasks"
                :key="task.id"
                class="task"
                :class="`task--${task.status}`"
              >
                <span class="task__icon">
                  <svg v-if="task.status === 'completed'" viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
                  <svg v-else-if="task.status === 'locked'" viewBox="0 0 24 24" width="11" height="11"><path fill="currentColor" d="M12 17a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm6-6h-1V9a5 5 0 0 0-10 0v2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2zM9 9a3 3 0 0 1 6 0v2H9V9z"/></svg>
                  <i v-else></i>
                </span>
                <div class="task__body">
                  <strong>{{ task.title }}</strong>
                  <small>{{ task.kind }} · 约 {{ task.minutes }} 分钟</small>
                </div>
                <span v-if="task.status === 'current'" class="task__cta" @click="labGo('learning')">开始学习</span>
                <span v-else-if="task.status === 'completed'" class="task__done-label">查看反馈</span>
                <span v-else-if="task.status === 'locked'" class="task__lock-label">待解锁</span>
                <span v-else class="task__todo-label">待开始</span>
              </div>
            </div>
          </section>
        </div>

        <!-- 侧栏 -->
        <aside class="side">
          <section class="card sidecard sidecard--current">
            <span class="kicker">当前任务</span>
            <strong>{{ currentTask.title }}</strong>
            <p>阶段 2 的第 2 个任务。完成后还剩 2 个任务进入阶段 3。</p>
            <div class="sidecard__meta">
              <span class="tag tag--blue">约 {{ currentTask.minutes }} 分钟</span>
              <span class="tag">{{ currentTask.kind }}</span>
            </div>
            <span class="btn-primary btn-primary--block" @click="labGo('learning')">开始学习</span>
          </section>

          <section class="card sidecard">
            <span class="kicker">接下来 3 个任务</span>
            <ol class="next-list">
              <li><strong>看懂 read_excel 的 3 个常用参数</strong><small>15 分钟 · 概念巩固</small></li>
              <li><strong>阶段小测：读出并描述你的报表</strong><small>10 分钟 · 检查点</small></li>
              <li><strong>concat 合并多个 DataFrame</strong><small>20 分钟 · 阶段 3</small></li>
            </ol>
            <div class="sidecard__sum">预计共 45 分钟</div>
          </section>

          <section class="card sidecard">
            <span class="kicker">设计意图</span>
            <p class="sidecard__text">先拿到「能读出报表」的小成果，再学写入和封装。每个阶段都有可运行的小结果，避免一开始陷进语法细节。</p>
          </section>
        </aside>
      </div>
    </main>
    <MockFooter />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import MockNav from './MockNav.vue';
import MockFooter from './MockFooter.vue';
import { labGo } from './labStore';
import { mainPath, currentTask, type MockStage } from './mockData';

const openStages = ref<number[]>([1, 2]);

function toggleStage(no: number) {
  const i = openStages.value.indexOf(no);
  if (i >= 0) openStages.value.splice(i, 1);
  else openStages.value.push(no);
}

function stageProgress(stage: MockStage) {
  const done = stage.tasks.filter((t) => t.status === 'completed').length;
  return `${done} / ${stage.tasks.length}`;
}
</script>

<style scoped>
.detail__main {
  max-width: 1080px; margin: 0 auto;
  padding: 20px 28px 48px;
  display: grid; gap: 16px;
}
.crumbs { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--faint); }
.crumbs__back { font-weight: 600; color: var(--muted); cursor: pointer; }
.crumbs__back:hover { color: var(--blue-deep); }
.crumbs__current { color: var(--ink); font-weight: 700; }

.card {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: 0 1px 2px rgba(23, 32, 51, 0.04), 0 10px 28px rgba(23, 32, 51, 0.05);
}
.kicker { font-size: 12px; font-weight: 800; letter-spacing: .06em; color: var(--blue-deep); }
.badge { padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 800; }
.badge--blue { color: var(--blue-deep); background: rgba(52, 120, 246, 0.1); }

.hero { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 24px; padding: 26px 28px; align-items: center; }
.hero__tags { display: flex; align-items: center; gap: 10px; }
.hero h1 { margin: 8px 0 6px; font-size: 28px; letter-spacing: -0.01em; }
.hero p { margin: 0; font-size: 14px; color: var(--muted); line-height: 1.7; max-width: 56ch; }
.hero__metrics { display: flex; gap: 10px; margin-top: 16px; flex-wrap: wrap; }
.metric {
  display: grid; gap: 2px;
  padding: 9px 14px;
  background: #f7faff; border: 1px solid #e8eefb;
  border-radius: 12px;
  font-size: 11.5px; color: var(--faint);
}
.metric b { font-size: 14px; color: var(--ink); }
.hero__actions { display: flex; gap: 12px; margin-top: 18px; flex-wrap: wrap; }
.btn-primary {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 11px 22px; border-radius: 12px;
  background: linear-gradient(135deg, var(--blue), var(--blue-deep));
  color: #fff; font-size: 14px; font-weight: 700;
  box-shadow: 0 10px 22px rgba(52, 120, 246, 0.3);
  cursor: pointer; text-decoration: none;
}
.btn-primary--block { justify-content: center; width: 100%; }
.btn-ghost {
  padding: 10px 18px; border-radius: 12px;
  border: 1px solid var(--line); background: #fff;
  font-size: 14px; font-weight: 700; color: var(--muted);
  cursor: pointer;
}
.hero__ring { position: relative; width: 120px; height: 120px; }
.hero__ring circle[stroke="url(#ringGrad)"] { transition: stroke-dashoffset .6s ease; }
.hero__ring-text {
  position: absolute; inset: 0;
  display: grid; place-content: center; text-align: center; gap: 2px;
}
.hero__ring-text b { font-size: 22px; }
.hero__ring-text small { font-size: 11px; color: var(--faint); }

.detail__grid { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 16px; align-items: start; }
.stages { display: grid; gap: 12px; }

.stage { overflow: hidden; }
.stage__head {
  display: grid; grid-template-columns: 34px 1fr auto 24px;
  align-items: center; gap: 12px;
  width: 100%;
  padding: 15px 18px;
  background: transparent; border: 0;
  font: inherit; text-align: left; cursor: pointer;
}
.stage__no {
  width: 30px; height: 30px; border-radius: 10px;
  background: #eef2f8; color: var(--faint);
  font-size: 13px; font-weight: 800;
  display: grid; place-items: center;
}
.stage__no--done { background: var(--green); color: #fff; }
.stage__no--current { background: linear-gradient(135deg, var(--blue), var(--blue-deep)); color: #fff; box-shadow: 0 0 0 4px rgba(52, 120, 246, 0.13); }
.stage__title strong { display: block; font-size: 14.5px; }
.stage__title small { display: block; margin-top: 2px; font-size: 12px; color: var(--faint); }
.stage__prog { font-size: 12px; font-weight: 800; color: var(--muted); }
.stage--current .stage__prog { color: var(--blue-deep); }
.stage__chev { color: var(--faint); font-size: 15px; transition: transform .18s ease; justify-self: end; }
.stage__chev--open { transform: rotate(180deg); }

.stage__body { border-top: 1px solid var(--line); padding: 8px 12px 12px; display: grid; gap: 4px; }
.task {
  display: grid; grid-template-columns: 24px 1fr auto;
  align-items: center; gap: 11px;
  padding: 9px 10px;
  border-radius: 11px;
  border: 1px solid transparent;
}
.task--current { background: rgba(52, 120, 246, 0.06); border-color: rgba(52, 120, 246, 0.2); }
.task--locked { opacity: .62; }
.task__icon {
  width: 20px; height: 20px; border-radius: 50%;
  display: grid; place-items: center;
}
.task--completed .task__icon { background: var(--green); color: #fff; }
.task--current .task__icon { border: 2px solid var(--blue); box-shadow: 0 0 0 3px rgba(52, 120, 246, 0.14); }
.task--todo .task__icon { border: 2px dashed #cfdaee; }
.task--locked .task__icon { color: var(--faint); background: #eef2f8; }
.task__body strong { display: block; font-size: 13.5px; }
.task__body small { display: block; margin-top: 2px; font-size: 11.5px; color: var(--faint); }
.task__cta {
  font-size: 12px; font-weight: 800; color: #fff;
  background: linear-gradient(135deg, var(--blue), var(--blue-deep));
  padding: 6px 13px; border-radius: 9px;
  cursor: pointer;
  box-shadow: 0 6px 14px rgba(52, 120, 246, 0.25);
}
.task__done-label { font-size: 12px; font-weight: 600; color: var(--green); cursor: pointer; }
.task__lock-label, .task__todo-label { font-size: 12px; color: var(--faint); }

.side { display: grid; gap: 12px; position: sticky; top: 16px; }
.sidecard { padding: 16px 18px; display: grid; gap: 10px; align-content: start; }
.sidecard strong { font-size: 14.5px; line-height: 1.5; }
.sidecard p { margin: 0; font-size: 12.5px; color: var(--muted); line-height: 1.65; }
.sidecard__meta { display: flex; gap: 8px; flex-wrap: wrap; }
.sidecard--current { border-color: rgba(52, 120, 246, 0.3); }
.tag {
  padding: 4px 10px; border-radius: 999px;
  background: #f1f5fb; border: 1px solid var(--line);
  font-size: 11.5px; font-weight: 600; color: var(--muted);
}
.tag--blue { background: rgba(52, 120, 246, 0.09); border-color: rgba(52, 120, 246, 0.3); color: var(--blue-deep); }
.next-list { margin: 0; padding: 0 0 0 18px; display: grid; gap: 9px; }
.next-list strong { display: block; font-size: 13px; line-height: 1.45; }
.next-list small { display: block; margin-top: 2px; font-size: 11.5px; color: var(--faint); }
.sidecard__sum { font-size: 12px; font-weight: 700; color: var(--muted); border-top: 1px dashed var(--line); padding-top: 9px; }
.sidecard__text { font-size: 13px; }

@media (max-width: 900px) {
  .detail__main { padding: 14px 14px 32px; }
  .hero { grid-template-columns: 1fr; }
  .hero__ring { justify-self: center; }
  .hero h1 { font-size: 22px; }
  .detail__grid { grid-template-columns: 1fr; }
  .side { position: static; }
}
</style>
