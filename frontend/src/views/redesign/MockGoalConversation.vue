<template>
  <div class="goal">
    <!-- 应用导航 -->
    <header class="nav">
      <div class="nav__brand">
        <span class="nav__logo">W</span>
        <span class="nav__name">问流 WenFlow</span>
      </div>
      <nav class="nav__links">
        <a>学习台</a>
        <a class="active">目标规划</a>
        <a>学习路径</a>
        <a>学习状态</a>
        <a>成就</a>
      </nav>
      <div class="nav__right">
        <span class="nav__avatar"><i>1</i>123</span>
      </div>
    </header>

    <!-- ============ 初始态 ============ -->
    <main v-if="state === 'entry'" class="entry">
      <div class="entry__hero">
        <span class="entry__kicker">目标规划</span>
        <h1>从一件真实的小事开始</h1>
        <p>不用整理、不用说得很准。聊 2 分钟，问流帮你收敛出目标和第一阶段安排。</p>
      </div>

      <div class="entry__cards">
        <button v-for="c in scenes" :key="c.title" type="button" class="scene-card">
          <span class="scene-card__icon" :style="{ background: c.bg, color: c.ink }" v-html="c.icon"></span>
          <span class="scene-card__body">
            <strong>{{ c.title }}</strong>
            <small>{{ c.desc }}</small>
          </span>
          <span class="scene-card__meta">
            <span class="scene-card__time">约 2 分钟</span>
            <span class="scene-card__go">开始 ›</span>
          </span>
        </button>
      </div>

      <div class="composer composer--entry">
        <div class="composer__box">
          <span class="composer__placeholder">先说说你最近想解决什么，或现在卡在哪里…</span>
          <span class="composer__send composer__send--off">
            <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M3 20v-6l8-2-8-2V4l19 8z"/></svg>
          </span>
        </div>
        <div class="composer__hint">Enter 发送 · Shift+Enter 换行 · 点上方场景卡可直接开始</div>
      </div>
    </main>

    <!-- ============ 对话态 / 方案确认态 ============ -->
    <main v-else class="work">
      <!-- 左：信息清单 -->
      <aside class="panel">
        <div class="panel__head">
          <strong>目标信息</strong>
          <span class="panel__count">已收集 6 / 8</span>
        </div>
        <div class="panel__bar"><i style="width: 75%"></i></div>

        <ul class="checklist">
          <li v-for="f in fields" :key="f.label" class="field" :class="[`field--${f.status}`, { 'field--fresh': f.fresh }]">
            <span class="field__mark">
              <svg v-if="f.status === 'done'" viewBox="0 0 24 24" width="11" height="11"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
              <i v-else></i>
            </span>
            <div class="field__body">
              <div class="field__label">
                {{ f.label }}
                <span v-if="f.status === 'asking'" class="field__asking"><i></i>正在聊</span>
                <svg v-else-if="f.status === 'done'" class="field__edit" viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
              </div>
              <div v-if="f.value" class="field__value">{{ f.value }}</div>
              <div v-else class="field__value field__value--todo">{{ f.status === 'asking' ? '回答右侧问题后自动填入' : '待补充' }}</div>
            </div>
            <span v-if="f.fresh" class="field__fresh">刚收录</span>
          </li>
        </ul>

        <div class="panel__tip">点任意一条可修正，AI 会同步更新方案。</div>
      </aside>

      <!-- 右：聊天区 -->
      <section class="chat">
        <div class="chat__scroll" :class="{ 'chat__scroll--dim': state === 'proposal' }">
          <!-- 用户消息 -->
          <div class="msg msg--user">
            <div class="msg__bubble">是每天把销售报表数据复制到汇总表</div>
            <div class="msg__meta">你 · 20:42</div>
          </div>

          <!-- AI 消息 -->
          <div class="msg msg--ai">
            <span class="msg__avatar">问</span>
            <div class="msg__content">
              <div class="msg__bubble">
                明白了，核心重复操作就是这个。再确认最后一点——
                <b>你希望脚本跑成功后，每天看到的效果是什么？</b>
              </div>
              <div class="msg__meta">问流 · 20:45 · 已收录「紧迫程度」</div>
            </div>
          </div>

          <!-- 快捷回复 chips -->
          <div class="replies">
            <div class="replies__hint">点一下直接发送，点 ＋ 先放进输入框</div>
            <div class="replies__row">
              <button type="button" class="reply">
                完全自动，打开汇总表就是最新数据
                <span class="reply__plus" title="放进输入框">＋</span>
              </button>
              <button type="button" class="reply">
                只复制数据，其他我手动调整
                <span class="reply__plus" title="放进输入框">＋</span>
              </button>
              <button type="button" class="reply">
                还没想好，先给个建议
                <span class="reply__plus" title="放进输入框">＋</span>
              </button>
            </div>
          </div>
        </div>

        <!-- 输入区 -->
        <div class="composer">
          <div class="composer__box composer__box--active">
            <span class="composer__placeholder">回答上面的问题，或补充你的基础、时间和限制…</span>
            <span class="composer__send">
              <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M3 20v-6l8-2-8-2V4l19 8z"/></svg>
            </span>
          </div>
          <div class="composer__hint">Enter 发送 · Shift+Enter 换行</div>
        </div>

        <!-- 方案确认浮层 -->
        <div v-if="state === 'proposal'" class="overlay">
          <div class="proposal">
            <div class="proposal__eyebrow">路径预览 · 请确认</div>
            <h2 class="proposal__title">Excel 报表自动化 · 一周上手方案</h2>

            <div class="proposal__rows">
              <div class="proposal__row">
                <span>核心问题</span>
                <p>每天手动把销售报表复制到汇总表，重复耗时且易错，只需纯数据、无需格式。</p>
              </div>
              <div class="proposal__row">
                <span>预计产出</span>
                <p>手动运行一次脚本，成功把指定报表数据追加到汇总表。</p>
              </div>
            </div>

            <div class="proposal__stages">
              <span class="proposal__stages-label">路径大纲 · 4 个阶段</span>
              <ol>
                <li class="pstep"><i>1</i><div><strong>环境搭建</strong><small>Python 与基本概念</small></div></li>
                <li class="pstep"><i>2</i><div><strong>pandas 读取</strong><small>读出并预览报表</small></div></li>
                <li class="pstep"><i>3</i><div><strong>写入汇总表</strong><small>追加纯数据</small></div></li>
                <li class="pstep"><i>4</i><div><strong>封装测试</strong><small>可重复运行</small></div></li>
              </ol>
            </div>

            <div class="proposal__skip">先不学：样式保留、多文件合并、数据清洗、异常处理</div>

            <div class="proposal__actions">
              <span class="btn-primary btn-primary--lg">确认，生成我的路径</span>
              <span class="btn-ghost">再补充点信息</span>
            </div>
            <div class="proposal__note">确认后在本页生成，约 30 秒；万一失败可原地重试，信息不丢。</div>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
defineProps<{ state: 'entry' | 'chatting' | 'proposal' }>();

const scenes = [
  {
    title: '用 Python 自动化 Excel 报表',
    desc: '每天省下的复制粘贴时间，一周就能看到',
    bg: 'rgba(52,120,246,.12)', ink: '#1f57cc',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>'
  },
  {
    title: '提升职场沟通表达',
    desc: '从下一次周会发言开始练，场景化拆解',
    bg: 'rgba(141,107,255,.13)', ink: '#6b4ae0',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zM7 9h10v2H7V9zm6 5H7v-2h6v2zm4-6H7V6h10v2z"/></svg>'
  },
  {
    title: '用 AI 做自媒体副业',
    desc: '围绕你的账号定位，搭一条内容生产流程',
    bg: 'rgba(67,176,216,.14)', ink: '#3593b5',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h4a2 2 0 0 1 2 2v1.28c.6.35 1 .98 1 1.72a2 2 0 0 1-1 1.73V17a2 2 0 0 1-2 2h-4v1.27c.6.34 1 .99 1 1.73a2 2 0 1 1-4 0c0-.74.4-1.39 1-1.73V19H7a2 2 0 0 1-2-2v-3.27A2 2 0 0 1 4 12c0-.74.4-1.38 1-1.72V9a2 2 0 0 1 2-2h4V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"/></svg>'
  }
];

const fields = [
  { label: '想解决的问题', value: '每天手动把销售报表复制到汇总表，耗时易错', status: 'done' },
  { label: '学习动机', value: '节省时间，提升效率', status: 'done' },
  { label: '当前水平', value: '零基础', status: 'done' },
  { label: '期望周期', value: '1 周', status: 'done', fresh: true },
  { label: '可用时间', value: '每天 1 小时', status: 'done' },
  { label: '紧迫程度', value: '日常重复耗时，希望尽快', status: 'done' },
  { label: '过往卡点', value: '', status: 'asking' },
  { label: '成功标准', value: '', status: 'todo' }
];
</script>

<style scoped>
/* ---------- 导航 ---------- */
.nav {
  display: flex;
  align-items: center;
  gap: 28px;
  padding: 0 28px;
  height: 60px;
  background: rgba(255, 255, 255, 0.86);
  backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--line);
}
.nav__brand { display: flex; align-items: center; gap: 9px; }
.nav__logo {
  width: 28px; height: 28px; border-radius: 9px;
  background: linear-gradient(135deg, var(--blue), var(--accent));
  color: #fff; font-size: 14px; font-weight: 800;
  display: grid; place-items: center;
}
.nav__name { font-weight: 700; font-size: 14px; }
.nav__links { display: flex; gap: 4px; flex: 1; }
.nav__links a {
  padding: 7px 12px; border-radius: 9px;
  font-size: 13px; font-weight: 600; color: var(--muted); cursor: pointer;
}
.nav__links a.active { color: var(--blue-deep); background: rgba(52, 120, 246, 0.09); }
.nav__right { display: flex; align-items: center; gap: 12px; }
.nav__avatar { display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 700; }
.nav__avatar i {
  width: 26px; height: 26px; border-radius: 50%;
  background: var(--blue-deep); color: #fff;
  font-style: normal; font-size: 12px;
  display: grid; place-items: center;
}

/* ---------- 初始态 ---------- */
.entry {
  max-width: 860px;
  margin: 0 auto;
  padding: 52px 28px 40px;
  display: grid;
  gap: 26px;
}
.entry__hero { text-align: center; display: grid; gap: 10px; justify-items: center; }
.entry__kicker {
  font-size: 12px; font-weight: 800; letter-spacing: .08em;
  color: var(--blue-deep);
  background: rgba(52, 120, 246, 0.09);
  padding: 5px 12px; border-radius: 999px;
}
.entry__hero h1 { margin: 0; font-size: 34px; letter-spacing: -0.01em; }
.entry__hero p { margin: 0; font-size: 14px; color: var(--muted); max-width: 52ch; line-height: 1.7; }

.entry__cards { display: grid; gap: 10px; }
.scene-card {
  display: grid;
  grid-template-columns: 44px 1fr auto;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: .16s ease;
}
.scene-card:hover {
  border-color: rgba(52, 120, 246, 0.45);
  box-shadow: 0 10px 26px rgba(52, 120, 246, 0.12);
  transform: translateY(-1px);
}
.scene-card__icon {
  width: 44px; height: 44px; border-radius: 13px;
  display: grid; place-items: center;
}
.scene-card__body strong { display: block; font-size: 14.5px; }
.scene-card__body small { display: block; margin-top: 3px; font-size: 12.5px; color: var(--faint); }
.scene-card__meta { display: grid; gap: 6px; justify-items: end; }
.scene-card__time {
  font-size: 11px; font-weight: 700; color: var(--muted);
  background: #f1f5fb; border: 1px solid var(--line);
  padding: 3px 9px; border-radius: 999px;
}
.scene-card__go { font-size: 12.5px; font-weight: 800; color: var(--blue-deep); }

/* ---------- 输入区 ---------- */
.composer { display: grid; gap: 7px; }
.composer__box {
  display: flex; align-items: center; gap: 10px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 8px 8px 8px 16px;
  min-height: 54px;
  box-shadow: 0 6px 20px rgba(23, 32, 51, 0.06);
}
.composer__box--active { border-color: rgba(52, 120, 246, 0.4); }
.composer__placeholder { flex: 1; font-size: 14px; color: var(--faint); }
.composer__send {
  width: 40px; height: 40px; border-radius: 12px;
  display: grid; place-items: center;
  background: linear-gradient(135deg, var(--blue), var(--blue-deep));
  color: #fff; cursor: pointer;
  box-shadow: 0 8px 16px rgba(52, 120, 246, 0.3);
}
.composer__send--off { background: #e3eaf5; color: var(--faint); box-shadow: none; }
.composer__hint { font-size: 11.5px; color: var(--faint); padding-left: 6px; }

/* ---------- 工作台布局 ---------- */
.work {
  position: relative;
  max-width: 1180px;
  margin: 0 auto;
  padding: 16px 20px 20px;
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  gap: 16px;
  min-height: calc(100vh - 60px);
}

/* ---------- 左：信息清单 ---------- */
.panel {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-self: start;
  position: sticky;
  top: 16px;
  max-height: calc(100vh - 100px);
  overflow: auto;
}
.panel__head { display: flex; align-items: center; justify-content: space-between; }
.panel__head strong { font-size: 14px; }
.panel__count { font-size: 12px; font-weight: 800; color: var(--blue-deep); }
.panel__bar { height: 6px; border-radius: 99px; background: #edf1f8; overflow: hidden; }
.panel__bar i { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--blue), var(--cyan)); }

.checklist { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.field {
  position: relative;
  display: grid;
  grid-template-columns: 20px 1fr;
  gap: 9px;
  padding: 8px 8px;
  border-radius: 10px;
  transition: background .15s ease;
}
.field--done:hover { background: #f6f9ff; }
.field__mark {
  width: 18px; height: 18px; border-radius: 50%;
  margin-top: 2px;
  display: grid; place-items: center;
}
.field--done .field__mark { background: var(--green); color: #fff; }
.field--asking .field__mark,
.field--todo .field__mark { border: 2px dashed #cfdaee; }
.field--asking .field__mark { border-color: var(--blue); border-style: solid; }
.field__label {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; font-weight: 700; color: var(--muted);
}
.field__edit { color: var(--faint); }
.field--done:hover .field__edit { color: var(--blue-deep); }
.field__value { margin-top: 3px; font-size: 13px; line-height: 1.5; color: var(--ink); }
.field__value--todo { color: var(--faint); font-size: 12px; }
.field--asking { background: rgba(52, 120, 246, 0.06); border: 1px solid rgba(52, 120, 246, 0.18); }
.field--todo { opacity: .7; }
.field__asking {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11px; font-weight: 800; color: var(--blue-deep);
}
.field__asking i {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--blue);
  animation: pulse 1.2s ease-in-out infinite;
}
@keyframes pulse { 0%,100% { opacity: .35; } 50% { opacity: 1; } }
.field--fresh { background: rgba(49, 177, 111, 0.07); }
.field__fresh {
  position: absolute; top: 8px; right: 8px;
  font-size: 10px; font-weight: 800; color: var(--green);
  background: rgba(49, 177, 111, 0.12);
  padding: 2px 7px; border-radius: 999px;
}
.panel__tip { font-size: 11.5px; color: var(--faint); border-top: 1px solid var(--line); padding-top: 10px; }

/* ---------- 右：聊天区 ---------- */
.chat {
  position: relative;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  overflow: hidden;
}
.chat__scroll {
  flex: 1;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  transition: filter .2s ease, opacity .2s ease;
}
.chat__scroll--dim { filter: blur(2px); opacity: .45; pointer-events: none; }

.msg { display: flex; flex-direction: column; gap: 5px; max-width: 82%; }
.msg--user { align-self: flex-end; align-items: flex-end; }
.msg--user .msg__bubble {
  background: linear-gradient(135deg, var(--blue), var(--blue-deep));
  color: #fff;
  border-radius: 16px 16px 4px 16px;
}
.msg__bubble {
  padding: 11px 15px;
  font-size: 14px;
  line-height: 1.65;
  border-radius: 4px 16px 16px 16px;
  background: #f2f6fc;
  color: var(--ink);
}
.msg--ai { flex-direction: row; align-items: flex-start; gap: 10px; max-width: 92%; }
.msg--ai .msg__content { display: grid; gap: 5px; }
.msg--ai .msg__bubble b { color: var(--blue-deep); }
.msg__avatar {
  width: 30px; height: 30px; border-radius: 10px;
  background: linear-gradient(135deg, var(--blue), var(--accent));
  color: #fff; font-size: 13px; font-weight: 800;
  display: grid; place-items: center;
  flex: 0 0 auto; margin-top: 2px;
}
.msg__meta { font-size: 11px; color: var(--faint); }

/* ---------- 快捷回复 ---------- */
.replies { display: grid; gap: 8px; margin-left: 40px; }
.replies__hint { font-size: 11.5px; color: var(--faint); }
.replies__row { display: flex; flex-wrap: wrap; gap: 8px; }
.reply {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 9px 13px;
  border-radius: 999px;
  border: 1px solid rgba(52, 120, 246, 0.3);
  background: rgba(52, 120, 246, 0.06);
  color: var(--blue-deep);
  font: inherit; font-size: 13px; font-weight: 600;
  cursor: pointer;
  transition: .15s ease;
}
.reply:hover { background: rgba(52, 120, 246, 0.12); }
.reply__plus {
  width: 18px; height: 18px; border-radius: 50%;
  border: 1px solid rgba(52, 120, 246, 0.45);
  font-size: 12px; line-height: 1;
  display: grid; place-items: center;
  color: var(--blue-deep);
  background: #fff;
}
.chat .composer { padding: 12px 14px 12px; border-top: 1px solid var(--line); background: #fbfdff; }

/* ---------- 方案确认浮层 ---------- */
.overlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(244, 247, 252, 0.55);
  backdrop-filter: blur(1px);
}
.proposal {
  width: min(620px, 100%);
  background: var(--surface);
  border: 1px solid rgba(52, 120, 246, 0.22);
  border-radius: 20px;
  box-shadow: 0 28px 70px rgba(23, 32, 51, 0.16);
  padding: 26px 28px;
  display: grid;
  gap: 16px;
}
.proposal__eyebrow {
  font-size: 12px; font-weight: 800; letter-spacing: .06em;
  color: var(--blue-deep);
}
.proposal__title { margin: 0; font-size: 21px; letter-spacing: -0.01em; }
.proposal__rows { display: grid; gap: 10px; }
.proposal__row {
  display: grid; gap: 4px;
  padding: 11px 14px;
  border-radius: 12px;
  background: #f7faff;
  border: 1px solid #e8eefb;
}
.proposal__row span { font-size: 11.5px; font-weight: 800; color: var(--blue-deep); }
.proposal__row p { margin: 0; font-size: 13.5px; line-height: 1.6; color: var(--ink); }

.proposal__stages { display: grid; gap: 10px; }
.proposal__stages-label { font-size: 11.5px; font-weight: 800; color: var(--muted); }
.proposal__stages ol {
  list-style: none; margin: 0; padding: 0;
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;
}
.pstep {
  position: relative;
  display: grid; gap: 8px;
  padding: 12px 10px;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: #fbfcff;
}
.pstep i {
  width: 22px; height: 22px; border-radius: 8px;
  background: linear-gradient(135deg, var(--blue), var(--blue-deep));
  color: #fff; font-size: 12px; font-weight: 800; font-style: normal;
  display: grid; place-items: center;
}
.pstep strong { display: block; font-size: 12.5px; }
.pstep small { display: block; margin-top: 2px; font-size: 11px; color: var(--faint); }

.proposal__skip {
  font-size: 12px; color: var(--muted);
  border: 1px dashed var(--line);
  border-radius: 10px;
  padding: 9px 12px;
  background: #fafcff;
}
.proposal__actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.btn-primary {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 11px 22px; border-radius: 12px;
  background: linear-gradient(135deg, var(--blue), var(--blue-deep));
  color: #fff; font-size: 14px; font-weight: 700;
  box-shadow: 0 10px 22px rgba(52, 120, 246, 0.3);
  cursor: pointer;
}
.btn-primary--lg { padding: 13px 26px; font-size: 15px; }
.btn-ghost {
  padding: 11px 18px; border-radius: 12px;
  border: 1px solid var(--line); background: #fff;
  font-size: 14px; font-weight: 700; color: var(--muted);
  cursor: pointer;
}
.proposal__note { font-size: 11.5px; color: var(--faint); }

/* ---------- 响应式 ---------- */
@media (max-width: 900px) {
  .nav__links { display: none; }
  .work { grid-template-columns: 1fr; min-height: auto; }
  .panel { position: static; max-height: none; }
  .msg { max-width: 96%; }
  .replies { margin-left: 0; }
  .proposal__stages ol { grid-template-columns: repeat(2, 1fr); }
  .entry__hero h1 { font-size: 26px; }
  .entry { padding: 32px 16px; }
}
</style>
