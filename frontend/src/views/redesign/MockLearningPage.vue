<template>
  <div class="learn">
    <!-- 沉浸式头部 -->
    <header class="learn__head">
      <span class="learn__back" @click="labGo('path-detail')">‹ 返回路径详情</span>
      <div class="learn__title">
        <span class="learn__task-pill">当前任务 · 阶段 2</span>
        <strong>用 pandas 读取销售报表，预览前 5 行数据</strong>
        <small>来自路径「Excel 报表自动化」</small>
      </div>
      <div class="learn__head-right">
        <span class="learn__live">学习中</span>
        <span class="learn__menu" title="更多">⋯</span>
      </div>
    </header>

    <div class="learn__body">
      <!-- 左：知识点面板 -->
      <aside class="kp">
        <div class="kp__head">
          <strong>本节知识点</strong>
          <span>{{ masteredCount }} / {{ kps.length }} 已掌握</span>
        </div>
        <div class="kp__bar"><i :style="{ width: (masteredCount / kps.length) * 100 + '%' }"></i></div>
        <ol class="kp__list">
          <li v-for="(kp, i) in kps" :key="kp.name" class="kp__item" :class="kpCls(i)">
            <span class="kp__mark">
              <svg v-if="i < step" viewBox="0 0 24 24" width="10" height="10"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
              <i v-else></i>
            </span>
            <div class="kp__name">
              <strong>{{ kp.name }}</strong>
              <small>{{ i < step ? '已掌握' : i === step ? (phase === 'checkpoint' ? '待检查' : '学习中') : '待学习' }}</small>
            </div>
          </li>
          <li class="kp__item" :class="{ 'kp__item--current': phase === 'checkpoint', 'kp__item--done': phase === 'done' }">
            <span class="kp__mark">
              <svg v-if="phase === 'done'" viewBox="0 0 24 24" width="10" height="10"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
              <i v-else></i>
            </span>
            <div class="kp__name">
              <strong>检查点：读出你的报表</strong>
              <small>{{ phase === 'done' ? '已通过' : phase === 'checkpoint' ? '进行中' : '待开始' }}</small>
            </div>
          </li>
        </ol>
        <div class="kp__time">本节已学 18 分钟</div>
      </aside>

      <!-- 中：导师对话 -->
      <section class="tutor">
        <div ref="scrollEl" class="tutor__scroll">
          <template v-for="(m, i) in msgs" :key="i">
            <div v-if="m.role === 'user'" class="msg msg--user">
              <div class="msg__bubble">{{ m.text }}</div>
              <div class="msg__meta">你 · {{ m.time }}</div>
            </div>
            <div v-else class="msg msg--ai">
              <span class="msg__avatar"><img src="/favicon.png" alt="问流" /></span>
              <div class="msg__content">
                <div class="msg__bubble">
                  <p v-for="(p, j) in m.paras" :key="j">{{ p }}</p>
                  <pre v-if="m.code" class="msg__code"><code>{{ m.code }}</code></pre>
                </div>
                <div class="msg__meta">问流导师 · {{ m.time }}</div>
              </div>
            </div>
          </template>

          <!-- typing -->
          <div v-if="typing" class="msg msg--ai">
            <span class="msg__avatar"><img src="/favicon.png" alt="问流" /></span>
            <div class="msg__bubble msg__bubble--typing"><i></i><i></i><i></i></div>
          </div>
        </div>

        <!-- 知识点操作 -->
        <div v-if="phase === 'teaching' && !typing" class="kp-actions">
          <span class="kp-actions__label">关于「{{ kps[step].name }}」</span>
          <div class="kp-actions__row">
            <span class="btn-primary" @click="mastered">我掌握了，继续</span>
            <span class="btn-ghost" @click="needMore">没完全理解，换种方式再讲</span>
          </div>
        </div>

        <!-- 检查点 -->
        <div v-if="phase === 'checkpoint' && !typing" class="checkpoint">
          <div class="checkpoint__head">
            <span class="checkpoint__badge">检查点</span>
            <strong>小试一下：写出读取 <code>sales.xlsx</code> 并预览前 5 行的代码（两行）</strong>
          </div>
          <textarea v-model="answer" class="checkpoint__input" rows="3" placeholder="import pandas as pd…"></textarea>
          <div class="checkpoint__actions">
            <span class="btn-primary" :class="{ 'btn-primary--off': !answer.trim() }" @click="submitAnswer">提交</span>
            <span class="btn-ghost" @click="hint">给个提示</span>
          </div>
        </div>

        <!-- 输入区 -->
        <div class="composer">
          <div class="composer__box" :class="{ 'composer__box--active': input.trim() }">
            <textarea
              v-model="input"
              class="composer__textarea"
              rows="1"
              maxlength="800"
              placeholder="随时提问，比如：read_excel 和 read_csv 有什么区别…"
              @keydown.enter.exact.prevent="ask"
            ></textarea>
            <span class="composer__count">{{ input.length }} / 800</span>
            <span class="composer__send" :class="{ 'composer__send--off': !input.trim() || typing }" @click="ask">
              <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M3 20v-6l8-2-8-2V4l19 8z"/></svg>
            </span>
          </div>
          <div class="composer__hint">Enter 发送 · 导师回复为演示脚本 · 正式版由真实授课 skill 驱动</div>
        </div>

        <!-- 完成浮层 -->
        <div v-if="phase === 'done'" class="finish">
          <div class="finish__card">
            <span class="finish__ring">
              <svg viewBox="0 0 24 24" width="26" height="26"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
            </span>
            <h2>本节完成</h2>
            <p>掌握了 {{ kps.length }} 个知识点，通过检查点。建议休息 5 分钟再继续下一个任务。</p>
            <div class="finish__stats">
              <span><b>{{ kps.length }}/{{ kps.length }}</b>知识点</span>
              <span><b>18</b>分钟</span>
              <span><b>1 次</b>检查点</span>
            </div>
            <div class="finish__actions">
              <span class="btn-primary" @click="labGo('path-detail')">回到路径详情</span>
              <span class="btn-ghost">查看学习反馈</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { labGo } from './labStore';

interface TutorMsg {
  role: 'ai' | 'user';
  text?: string;
  paras?: string[];
  code?: string;
  time: string;
}

const kps = [
  { name: 'DataFrame 是什么', alt: false },
  { name: 'read_excel 基础用法', alt: false },
  { name: '用 head() 预览数据', alt: false }
];

const lessons: Array<{ paras: string[]; code?: string; altParas: string[]; altCode?: string }> = [
  {
    paras: ['先说最核心的概念：DataFrame 就是 pandas 里的「一张表」。', '它有行有列，和你在 Excel 里看到的表格一一对应。你的销售报表读进来之后，就变成了一个 DataFrame。'],
    code: 'import pandas as pd\n# df 就是一个 DataFrame（表格）',
    altParas: ['换个角度理解：把 DataFrame 想成一个「可编程的 Excel 工作表」。', 'Excel 里你用手点格子，pandas 里你用代码操作同一张表——能做 Excel 的事，还能自动重复做。'],
    altCode: '# DataFrame ≈ 可用代码操作的 Excel 表'
  },
  {
    paras: ['读 Excel 只需要一个函数：pd.read_excel()。', '把文件路径交给它，它就返回一个 DataFrame。注意路径里的反斜杠要写成 / 或 \\\\ 。'],
    code: "import pandas as pd\ndf = pd.read_excel('D:/报表/sales.xlsx')",
    altParas: ['打个比方：read_excel 就像「双击打开文件」的代码版。', '你告诉它文件在哪（路径），它把表格内容搬进内存，交给你一个 df 变量。'],
    altCode: "df = pd.read_excel('D:/报表/sales.xlsx')  # 打开文件"
  },
  {
    paras: ['读进来之后，先看一眼对不对：用 head()。', 'head(5) 会返回前 5 行数据，print 出来就能确认报表读对了没有。'],
    code: 'print(df.head(5))  # 预览前 5 行',
    altParas: ['head() 就像打开文件后「先扫一眼前几行」。', '确认列名、数据格式都正常，再往下做处理——这是专业选手的习惯动作。'],
    altCode: 'print(df.head(5))  # 先扫一眼'
  }
];

function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const step = ref(0);
const phase = ref<'teaching' | 'checkpoint' | 'done'>('teaching');
const typing = ref(false);
const input = ref('');
const answer = ref('');
const scrollEl = ref<HTMLElement | null>(null);

const msgs = ref<TutorMsg[]>([
  { role: 'ai', paras: ['今天我们搞定「读取 Excel」这一节。我会分 3 个知识点讲，每讲完一个你说"掌握了"我们再继续。', '第一个知识点——'], time: nowTime() },
  { role: 'ai', paras: lessons[0].paras, code: lessons[0].code, time: nowTime() }
]);

const masteredCount = computed(() => step.value);

function kpCls(i: number) {
  return {
    'kp__item--done': i < step.value,
    'kp__item--current': i === step.value && phase.value !== 'done'
  };
}

async function scrollDown() {
  await nextTick();
  if (scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight;
}

function tutorSay(paras: string[], code?: string, delay = 1100) {
  typing.value = true;
  scrollDown();
  window.setTimeout(() => {
    msgs.value.push({ role: 'ai', paras, code, time: nowTime() });
    typing.value = false;
    scrollDown();
  }, delay);
}

function mastered() {
  msgs.value.push({ role: 'user', text: '我掌握了，继续', time: nowTime() });
  scrollDown();
  if (step.value < kps.length - 1) {
    step.value += 1;
    const l = lessons[step.value];
    const intro = [`好，第 ${step.value + 1} 个知识点——`];
    typing.value = true;
    scrollDown();
    window.setTimeout(() => {
      msgs.value.push({ role: 'ai', paras: intro, time: nowTime() });
      typing.value = false;
      tutorSay(l.paras, l.code, 700);
    }, 700);
  } else {
    phase.value = 'checkpoint';
    tutorSay(['三个知识点都过了。最后来个「检查点」，确认你真的能上手——']);
  }
}

function needMore() {
  msgs.value.push({ role: 'user', text: '没完全理解，换种方式再讲', time: nowTime() });
  scrollDown();
  const l = lessons[step.value];
  tutorSay(l.altParas, l.altCode);
}

function submitAnswer() {
  if (!answer.value.trim()) return;
  msgs.value.push({ role: 'user', text: answer.value, time: nowTime() });
  answer.value = '';
  scrollDown();
  tutorSay([
    '完全正确。pd.read_excel 负责读文件，head(5) 负责预览——你已经掌握了本节的核心操作。',
    '这也说明你具备了进入下一阶段「写入汇总表」的基础。'
  ], undefined, 1400);
  window.setTimeout(() => {
    phase.value = 'done';
  }, 1600);
}

function hint() {
  tutorSay(['提示：第一行读文件（read_excel），第二行 print 出 df.head(5)。试着默写出来。'], undefined, 700);
}

function ask() {
  const t = input.value.trim();
  if (!t || typing.value) return;
  msgs.value.push({ role: 'user', text: t, time: nowTime() });
  input.value = '';
  scrollDown();
  tutorSay(['好问题。简单说：read_excel 读 .xlsx，read_csv 读 .csv；用法几乎一样，参数略有不同。', '（正式版这里由真实授课 skill 针对你的问题展开讲解。）']);
}
</script>

<style scoped>
.learn { min-height: 100vh; display: flex; flex-direction: column; background: var(--canvas); }

/* ---------- 头部 ---------- */
.learn__head {
  display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 18px;
  padding: 12px 24px;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--line);
}
.learn__back { font-size: 13px; font-weight: 600; color: var(--muted); cursor: pointer; white-space: nowrap; }
.learn__back:hover { color: var(--blue-deep); }
.learn__title { display: grid; gap: 3px; min-width: 0; }
.learn__title strong { font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.learn__title small { font-size: 11.5px; color: var(--faint); }
.learn__task-pill {
  font-size: 10.5px; font-weight: 800; letter-spacing: .05em;
  color: var(--blue-deep);
}
.learn__head-right { display: flex; align-items: center; gap: 10px; }
.learn__live {
  font-size: 11px; font-weight: 800; color: var(--green);
  background: rgba(49, 177, 111, 0.1);
  border: 1px solid rgba(49, 177, 111, 0.3);
  padding: 4px 10px; border-radius: 999px;
}
.learn__menu { color: var(--faint); font-size: 18px; cursor: pointer; padding: 0 6px; }

/* ---------- 布局 ---------- */
.learn__body {
  flex: 1;
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 16px;
  padding: 16px 20px;
  max-width: 1180px;
  width: 100%;
  margin: 0 auto;
}

/* ---------- 知识点面板 ---------- */
.kp {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 16px;
  display: flex; flex-direction: column; gap: 12px;
  align-self: start;
  position: sticky; top: 16px;
}
.kp__head { display: flex; align-items: center; justify-content: space-between; font-size: 13px; }
.kp__head span { font-size: 11.5px; font-weight: 800; color: var(--blue-deep); }
.kp__bar { height: 6px; border-radius: 99px; background: #edf1f8; overflow: hidden; }
.kp__bar i { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--blue), var(--cyan)); transition: width .4s ease; }
.kp__list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.kp__item {
  display: grid; grid-template-columns: 20px 1fr; gap: 9px;
  padding: 8px;
  border-radius: 10px;
  border: 1px solid transparent;
}
.kp__item--current { background: rgba(52, 120, 246, 0.06); border-color: rgba(52, 120, 246, 0.2); }
.kp__mark {
  width: 18px; height: 18px; border-radius: 50%;
  margin-top: 2px;
  border: 2px dashed #cfdaee;
  display: grid; place-items: center;
}
.kp__item--done .kp__mark { background: var(--green); border: 0; color: #fff; }
.kp__item--current .kp__mark { border: 2px solid var(--blue); border-style: solid; }
.kp__name strong { display: block; font-size: 13px; line-height: 1.45; }
.kp__name small { display: block; margin-top: 2px; font-size: 11px; color: var(--faint); }
.kp__item--current .kp__name small { color: var(--blue-deep); font-weight: 700; }
.kp__time { font-size: 11.5px; color: var(--faint); border-top: 1px solid var(--line); padding-top: 10px; }

/* ---------- 导师对话 ---------- */
.tutor {
  position: relative;
  display: flex; flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  overflow: hidden;
  min-height: 560px;
  max-height: calc(100vh - 120px);
}
.tutor__scroll {
  flex: 1; overflow-y: auto;
  padding: 20px;
  display: flex; flex-direction: column; gap: 18px;
}
.msg { display: flex; flex-direction: column; gap: 5px; max-width: 85%; }
.msg--user { align-self: flex-end; align-items: flex-end; }
.msg--user .msg__bubble {
  background: linear-gradient(135deg, var(--blue), var(--blue-deep));
  color: #fff;
  border-radius: 16px 16px 4px 16px;
  white-space: pre-wrap;
}
.msg__bubble {
  padding: 11px 15px;
  font-size: 14px; line-height: 1.65;
  border-radius: 4px 16px 16px 16px;
  background: #f2f6fc; color: var(--ink);
}
.msg__bubble p { margin: 0 0 8px; }
.msg__bubble p:last-child { margin-bottom: 0; }
.msg--ai { flex-direction: row; align-items: flex-start; gap: 10px; max-width: 94%; }
.msg--ai .msg__content { display: grid; gap: 5px; min-width: 0; }
.msg__avatar {
  width: 30px; height: 30px; border-radius: 10px;
  background: linear-gradient(135deg, var(--blue), var(--accent));
  color: #fff; font-size: 13px; font-weight: 800;
  display: grid; place-items: center;
  flex: 0 0 auto; margin-top: 2px;
}
.msg__meta { font-size: 11px; color: var(--faint); }
.msg__code {
  margin: 8px 0 0;
  background: #182338;
  color: #d6e4ff;
  border-radius: 10px;
  padding: 12px 14px;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 12.5px; line-height: 1.6;
  overflow-x: auto;
}
.msg__bubble--typing { display: inline-flex; gap: 5px; align-items: center; padding: 14px 16px; }
.msg__bubble--typing i {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--faint);
  animation: learn-typing 1.2s ease-in-out infinite;
}
.msg__bubble--typing i:nth-child(2) { animation-delay: .15s; }
.msg__bubble--typing i:nth-child(3) { animation-delay: .3s; }
@keyframes learn-typing { 0%, 60%, 100% { opacity: .3; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }

/* ---------- 知识点操作 ---------- */
.kp-actions {
  padding: 12px 16px;
  border-top: 1px solid var(--line);
  background: #fbfdff;
  display: grid; gap: 9px;
}
.kp-actions__label { font-size: 11.5px; font-weight: 700; color: var(--faint); }
.kp-actions__row { display: flex; gap: 10px; flex-wrap: wrap; }

/* ---------- 检查点 ---------- */
.checkpoint {
  margin: 0 16px;
  padding: 14px 16px;
  border: 1px solid rgba(244, 170, 70, 0.4);
  background: rgba(244, 170, 70, 0.06);
  border-radius: 14px;
  display: grid; gap: 11px;
}
.checkpoint__head { display: grid; gap: 6px; }
.checkpoint__head strong { font-size: 13.5px; line-height: 1.5; }
.checkpoint__head code { background: rgba(52, 120, 246, 0.1); color: var(--blue-deep); padding: 1px 6px; border-radius: 6px; font-size: 12.5px; }
.checkpoint__badge {
  width: fit-content;
  font-size: 11px; font-weight: 800; color: #b3540a;
  background: rgba(244, 170, 70, 0.18);
  border: 1px solid rgba(244, 170, 70, 0.4);
  padding: 3px 9px; border-radius: 999px;
}
.checkpoint__input {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 12px;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 13px;
  resize: none; outline: none;
  background: #fff;
}
.checkpoint__input:focus { border-color: rgba(52, 120, 246, 0.5); }
.checkpoint__actions { display: flex; gap: 10px; }

/* ---------- 输入区 ---------- */
.composer { display: grid; gap: 7px; padding: 12px 14px; border-top: 1px solid var(--line); background: #fbfdff; }
.composer__box {
  display: flex; align-items: flex-end; gap: 10px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 6px 6px 6px 14px;
  min-height: 50px;
}
.composer__box--active { border-color: rgba(52, 120, 246, 0.4); }
.composer__textarea {
  flex: 1; border: 0; outline: none; resize: none;
  font: inherit; font-size: 14px; line-height: 1.5;
  color: var(--ink); background: transparent;
  padding: 10px 0; max-height: 120px; align-self: center;
}
.composer__count { font-size: 11px; color: var(--faint); align-self: center; }
.composer__send {
  width: 38px; height: 38px; border-radius: 11px;
  display: grid; place-items: center;
  background: linear-gradient(135deg, var(--blue), var(--blue-deep));
  color: #fff; cursor: pointer;
  box-shadow: 0 8px 16px rgba(52, 120, 246, 0.3);
  flex: 0 0 auto;
}
.composer__send--off { background: #e3eaf5; color: var(--faint); box-shadow: none; cursor: default; }
.composer__hint { font-size: 11px; color: var(--faint); padding-left: 4px; }

.btn-primary {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 10px 20px; border-radius: 12px;
  background: linear-gradient(135deg, var(--blue), var(--blue-deep));
  color: #fff; font-size: 13.5px; font-weight: 700;
  box-shadow: 0 10px 22px rgba(52, 120, 246, 0.3);
  cursor: pointer; text-decoration: none;
}
.btn-primary--off { opacity: .55; cursor: default; box-shadow: none; }
.btn-ghost {
  padding: 9px 16px; border-radius: 12px;
  border: 1px solid var(--line); background: #fff;
  font-size: 13.5px; font-weight: 700; color: var(--muted);
  cursor: pointer;
}

/* ---------- 完成浮层 ---------- */
.finish {
  position: absolute; inset: 0;
  display: grid; place-items: center;
  padding: 24px;
  background: rgba(244, 247, 252, 0.72);
  backdrop-filter: blur(2px);
  z-index: 5;
}
.finish__card {
  width: min(480px, 100%);
  background: var(--surface);
  border: 1px solid rgba(49, 177, 111, 0.3);
  border-radius: 20px;
  box-shadow: 0 28px 70px rgba(23, 32, 51, 0.16);
  padding: 28px;
  display: grid; gap: 14px; justify-items: center; text-align: center;
}
.finish__ring {
  width: 52px; height: 52px; border-radius: 50%;
  background: rgba(49, 177, 111, 0.12);
  color: var(--green);
  display: grid; place-items: center;
  box-shadow: 0 0 0 8px rgba(49, 177, 111, 0.07);
}
.finish__card h2 { margin: 0; font-size: 22px; }
.finish__card p { margin: 0; font-size: 13.5px; color: var(--muted); line-height: 1.7; }
.finish__stats { display: flex; gap: 18px; font-size: 12px; color: var(--muted); }
.finish__stats b { color: var(--ink); font-size: 15px; margin-right: 3px; }
.finish__actions { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }

@media (max-width: 900px) {
  .learn__body { grid-template-columns: 1fr; }
  .kp { position: static; }
  .learn__back { display: none; }
  .tutor { max-height: none; }
}
</style>

<style scoped>
/* logo 头像 */
.msg__avatar {
  background: #fff !important;
  border: 1px solid var(--line);
  box-shadow: 0 2px 6px rgba(23, 32, 51, 0.08);
}
.msg__avatar img {
  width: 20px;
  height: 20px;
  object-fit: contain;
}
</style>
