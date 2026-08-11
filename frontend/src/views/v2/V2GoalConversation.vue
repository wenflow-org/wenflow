<template>
  <div class="goal v2-page">
    <!-- 应用导航（共享组件，带真实 AI 标识） -->
    <V2Nav />

    <!-- 未登录 -->
    <main v-if="!loggedIn" class="entry">
      <div class="login-gate">
        <img src="/favicon.png" alt="问流" class="login-gate__logo" />
        <h1>登录后体验真实对话</h1>
        <p>登录后，和问流聊聊你最近想解决的事。两三分钟的对话，就能收敛出你的第一版学习计划。</p>
        <a class="btn-primary btn-primary--lg" href="/login?redirect=/goal-conversation">去登录</a>
      </div>
    </main>

    <!-- 初始态 -->
    <main v-else-if="!live.started" class="entry">
      <div class="entry__hero">
        <div class="entry__hero-text">
          <h1>从一件真实的小事开始</h1>
          <p>不用整理、不用说得很准。聊 2 分钟，问流帮你收敛出目标和第一阶段安排。</p>
        </div>
        <button v-if="live.hasSession()" type="button" class="resume" @click="doResume">
          <span class="resume__dot"></span>
          <span class="resume__body">
            <strong>继续上次的规划</strong>
            <small>{{ live.failed === 'resume' ? '恢复失败，点这里重试' : '会话已保存在本地，点这里恢复' }}</small>
          </span>
          <span class="resume__go">继续 ›</span>
        </button>
      </div>

      <div v-if="live.failed === 'start'" class="errorbar">
        连接失败，没能开始对话。<span class="errorbar__retry" @click="doRetry">重试</span>
      </div>

      <div class="entry__cards">
          <div class="entry__cards-head">
            <span class="entry__cards-title">试试这些方向</span>
            <button type="button" class="cards-nav__btn" title="换一批" :disabled="live.sending" @click="shuffleScenes">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
            </button>
          </div>
        <button v-for="c in displayScenes" :key="c.title" type="button" class="scene-card" :disabled="live.sending" :title="c.desc" @click="startWith(c.seed)">
          <span class="scene-card__icon" :style="{ background: c.bg, color: c.ink }" v-html="c.icon"></span>
          <span class="scene-card__body">
            <strong>{{ c.title }}</strong>
          </span>
          <span class="scene-card__go" aria-hidden="true">›</span>
        </button>
      </div>

      <div class="composer composer--entry">
        <div class="composer__box" :class="{ 'composer__box--active': input.trim() }">
          <textarea
            v-model="input"
            class="composer__textarea"
            rows="1"
            maxlength="500"
            placeholder="先说说你最近想解决什么，或现在卡在哪里…"
            @input="live.meta.onInput(input.length)"
            @keydown.enter.exact.prevent="doSend"
          ></textarea>
          <span class="composer__send" :class="{ 'composer__send--off': !input.trim() || live.sending }" @click="doSend">
            <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M3 20v-6l8-2-8-2V4l19 8z"/></svg>
          </span>
        </div>
      </div>
    </main>

    <!-- 会话态 -->
    <main v-else class="work">
      <!-- 左：信息清单 -->
      <aside class="panel">
        <div class="panel__head">
          <strong>目标信息</strong>
          <span class="panel__count">已收集 {{ live.filledCount }} / {{ live.totalFields }}</span>
        </div>
        <div class="panel__bar"><i :style="{ width: (live.filledCount / live.totalFields) * 100 + '%' }"></i></div>
        <div class="panel__confidence">{{ stageLabel }}</div>

        <ul class="checklist">
          <li v-for="f in live.fields" :key="f.key" class="field" :class="[`field--${f.status}`, { 'field--fresh': f.fresh }]">
            <span class="field__mark">
              <svg v-if="f.status === 'done'" viewBox="0 0 24 24" width="11" height="11"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
              <i v-else></i>
            </span>
            <div class="field__body">
              <div class="field__label">{{ f.label }}</div>
              <div v-if="f.value" class="field__value">{{ f.value }}</div>
              <div v-else class="field__value field__value--todo">待补充</div>
            </div>
            <span v-if="f.fresh" class="field__fresh">刚收录</span>
          </li>
        </ul>

        <div class="panel__tip">信息由问流从对话中自动整理，会随对话逐步完善。</div>
      </aside>

      <!-- 右：聊天区 -->
      <section class="chat">
        <div class="chat__head">
          <ol class="stage-nav">
            <li class="stage-nav__item" :class="stageCls(1)"><i>1</i>澄清问题</li>
            <li class="stage-nav__item" :class="stageCls(2)"><i>2</i>确认方案</li>
            <li class="stage-nav__item" :class="stageCls(3)"><i>3</i>生成路径</li>
          </ol>
          <span class="chat__clear" @click="doReset">清空重聊</span>
        </div>

        <!-- 会话态内 start 失败：错误条 + 重试（初始态 errorbar 在此视图不渲染） -->
        <div v-if="live.failed === 'start'" class="errorbar chat__errorbar">
          连接失败，没能开始对话。<span class="errorbar__retry" @click="doRetry">重试</span>
        </div>

        <div ref="scrollEl" class="chat__scroll" :class="{ 'chat__scroll--dim': showProposal }">
          <template v-for="(m, i) in live.messages" :key="i">
            <div v-if="m.role === 'user'" class="msg msg--user">
              <div class="msg__bubble">{{ m.content }}</div>
              <div class="msg__meta">你 · {{ m.time }}</div>
            </div>
            <div v-else class="msg msg--ai">
              <span class="msg__avatar"><img src="/favicon.png" alt="问流" /></span>
              <div class="msg__content">
                <div class="msg__bubble msg__bubble--html" v-html="formatMessage(m.content)"></div>
                <div class="msg__meta">
                  问流 · {{ m.time }}
                  <span v-if="m.failed" class="msg__retry" @click="doRetry">重试</span>
                </div>
              </div>
            </div>
          </template>

          <!-- typing -->
          <div v-if="live.sending" class="msg msg--ai">
            <span class="msg__avatar"><img src="/favicon.png" alt="问流" /></span>
            <div class="msg__bubble msg__bubble--typing"><i></i><i></i><i></i></div>
          </div>

          <!-- 快捷回复 -->
          <div v-if="!live.sending && live.quickReplies.length && live.stageIndex < 3" class="replies">
            <div v-if="!live.quickReplyHintShown" class="replies__hint">点一下直接发送，点 ＋ 先放进输入框</div>
            <div class="replies__row">
              <button v-for="q in live.quickReplies" :key="q.text" type="button" class="reply" @click="sendDirect(q.text)">
                {{ q.text }}
                <span class="reply__plus" title="放进输入框" @click.stop="appendToInput(q.text)">＋</span>
              </button>
            </div>
          </div>
        </div>

        <!-- 输入区 -->
        <div class="composer">
          <div class="composer__box" :class="{ 'composer__box--active': input.trim() }">
            <textarea
              v-model="input"
              class="composer__textarea"
              rows="1"
              maxlength="500"
              placeholder="回答上面的问题，或补充你的基础、时间和限制…"
              @keydown.enter.exact.prevent="doSend"
            ></textarea>
            <span class="composer__count">{{ input.length }} / 500</span>
            <span class="composer__send" :class="{ 'composer__send--off': !input.trim() || live.sending }" @click="doSend">
              <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M3 20v-6l8-2-8-2V4l19 8z"/></svg>
            </span>
          </div>
          <div class="composer__hint">
            <span>Enter 发送 · Shift+Enter 换行</span>
            <AiContentNote />
          </div>
        </div>

        <!-- 方案确认浮层 -->
        <div v-if="showProposal" class="overlay">
          <!-- 预览 -->
          <div v-if="phase === 'preview' && live.proposal" class="proposal">
            <div class="proposal__eyebrow">路径预览 · 请确认</div>
            <h2 class="proposal__title">为你整理的学习方向</h2>

            <div class="proposal__rows">
              <div v-if="live.proposal.problem" class="proposal__row">
                <span>核心问题</span>
                <p>{{ live.proposal.problem }}</p>
              </div>
              <div v-if="live.proposal.outcome" class="proposal__row">
                <span>预计产出</span>
                <p>{{ live.proposal.outcome }}</p>
              </div>
            </div>

            <div v-if="live.proposal.stages.length" class="proposal__stages">
              <span class="proposal__stages-label">路径大纲 · {{ live.proposal.stages.length }} 个阶段</span>
              <ol>
                <li v-for="(s, i) in live.proposal.stages" :key="i" class="pstep"><i>{{ i + 1 }}</i><div><strong>{{ s }}</strong></div></li>
              </ol>
            </div>

            <div v-if="live.proposal.skip.length" class="proposal__skip">先不学：{{ live.proposal.skip.join('、') }}</div>

            <div v-if="confirmError" class="errorbar">
              确认失败，请重试。<span class="errorbar__retry" @click="doConfirm">重试</span>
            </div>

            <div v-if="!supplementMode" class="proposal__actions">
              <span class="btn-primary btn-primary--lg" @click="doConfirm">确认，生成我的路径</span>
              <span class="btn-ghost" @click="supplementMode = true">再补充点信息</span>
            </div>
            <div v-else class="proposal__supplement">
              <textarea
                v-model="supplementText"
                class="proposal__supplement-input"
                rows="2"
                maxlength="300"
                placeholder="比如：我只有 Windows 电脑，Excel 是 2016 版…"
              ></textarea>
              <div class="proposal__actions">
                <span class="btn-primary" :class="{ 'btn-primary--off': !supplementText.trim() || live.sending }" @click="doSupplement">
                  {{ live.sending ? '提交中…' : '提交补充，更新方案' }}
                </span>
                <span class="btn-ghost" @click="supplementMode = false">取消</span>
              </div>
            </div>
            <div class="proposal__note">
              <span>确认后在本页生成，约 30 秒。失败可原地重试，信息不会丢。</span>
              <AiContentNote />
            </div>
          </div>

          <!-- 生成中 -->
          <div v-else-if="phase === 'generating'" class="proposal proposal--center">
            <span class="spinner"></span>
            <h2 class="proposal__title">正在生成你的路径…</h2>
            <p class="proposal__generating-note">根据 {{ live.filledCount }} 条已确认信息拆解阶段，一般 30 秒内完成。</p>
            <div class="skeleton"><i style="width: 82%"></i><i style="width: 64%"></i><i style="width: 74%"></i></div>
            <div class="proposal__note">可以离开本页，生成进度会保留。</div>
          </div>

          <!-- 生成成功 -->
          <div v-else-if="phase === 'done'" class="proposal proposal--center">
            <span class="done-ring">
              <svg viewBox="0 0 24 24" width="26" height="26"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
            </span>
            <h2 class="proposal__title">路径已生成</h2>
            <p class="proposal__generating-note">阶段与任务正在后台组装，稍后即可查看。</p>
            <div class="proposal__actions proposal__actions--center">
              <span class="btn-primary btn-primary--lg" @click="goPaths">查看我的路径</span>
              <span class="btn-ghost" @click="phase = 'preview'">返回方案</span>
            </div>
          </div>
        </div>
      </section>
    </main>

    <!-- AI 生成提示：置于页面底部、靠近页脚 -->
    <div v-if="!live.started" class="goal__ai-note">
      <AiContentNote />
    </div>

    <V2Footer v-if="!live.started" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useGoalLive } from './useGoalLive';
import V2Nav from './V2Nav.vue';
import V2Footer from './V2Footer.vue';
import AiContentNote from '@/components/AiContentNote.vue';
import { hasUserSession } from '@/utils/api';
import { renderAiMessageHtml } from '@/utils/sanitize';
import { ElMessageBox } from 'element-plus';
import './v2.css';

const route = useRoute();
const router = useRouter();
const live = useGoalLive();
const loggedIn = hasUserSession();

onMounted(() => {
  window.addEventListener('v2:new-goal', onNewGoalEvent);
  // 每次进入页面随机展示一批场景
  shuffleScenes();
  const cid = typeof route.params.conversationId === 'string' ? route.params.conversationId : '';
  if (cid && cid !== live.conversationId) {
    live.resumeById(cid).catch(() => {});
  } else if (!cid && live.started) {
    // SPA 内从旧会话切换回来（如路径页点「规划新目标」）：清掉模块级残留的上一轮对话，
    // 回到初始态；localStorage 保留，仍可「继续上次的规划」恢复。
    resetToEntry();
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('v2:new-goal', onNewGoalEvent);
});

/** 清回初始态（内存 + 组件局部状态；live.resetView 保留 localStorage 恢复入口） */
function resetToEntry() {
  live.resetView();
  phase.value = 'preview';
  supplementMode.value = false;
  supplementText.value = '';
  input.value = '';
}

/** 页面内点击导航「规划新目标」：重置为全新初始态（保留本地恢复入口） */
function onNewGoalEvent() {
  resetToEntry();
  // 清掉 URL 中残留的旧会话参数，避免刷新后按旧 conversationId 恢复
  if (typeof route.params.conversationId === 'string') {
    router.replace({ name: 'V2GoalConversation' });
  }
}

// 会话 ID 变化时同步视图状态（分享链接 / 恢复旧会话）
watch(
  () => route.params.conversationId,
  (cid) => {
    const next = typeof cid === 'string' ? cid : '';
    if (next && next !== live.conversationId) {
      live.resumeById(next).catch(() => {});
    } else if (!next && live.started) {
      // 导航到无参路由（如「规划新目标」）时组件被复用、onMounted 不重跑：
      // 这里清掉模块级残留的上一轮对话回到初始态；localStorage 保留，仍可恢复
      resetToEntry();
    }
  }
);

/* 会话开始后同步 URL（可刷新恢复、可分享） */
watch(
  () => live.conversationId,
  (cid) => {
    const cur = typeof route.params.conversationId === 'string' ? route.params.conversationId : '';
    if (cid && cid !== cur) {
      router.replace({ name: 'V2GoalConversation', params: { conversationId: cid } });
    }
  }
);

function goPaths() {
  router.push(`/learning-paths?from=goal&auto=1&conversationId=${live.conversationId}`);
}

const input = ref('');
const scrollEl = ref<HTMLElement | null>(null);
const phase = ref<'preview' | 'generating' | 'done'>('preview');
const supplementMode = ref(false);
const supplementText = ref('');
const confirmError = ref(false);

const formatMessage = (text: string) => renderAiMessageHtml(text);

const stageLabel = computed(() => {
  if (live.stageIndex === 3) return '可生成路径';
  if (live.stageIndex === 2) return '方案确认中';
  return '继续澄清中';
});

const showProposal = computed(
  () => (live.stage === 'proposing' && !!live.proposal) || phase.value === 'generating' || phase.value === 'done'
);

function stageCls(i: number) {
  return {
    'stage-nav__item--current': live.stageIndex === i,
    'stage-nav__item--done': live.stageIndex > i
  };
}

async function scrollToBottom() {
  await nextTick();
  if (scrollEl.value) scrollEl.value.scrollTop = scrollEl.value.scrollHeight;
}

watch(() => live.messages.length, scrollToBottom);
watch(() => live.sending, scrollToBottom);

// 快捷回复提示只展示一次：首次出现快捷回复时置位
watch(
  () => live.quickReplies.length,
  (count) => {
    if (count > 0 && !live.quickReplyHintShown) live.quickReplyHintShown = true;
  }
);

async function doSend() {
  const t = input.value.trim();
  if (!t || live.sending) return;
  input.value = '';
  try {
    await live.send(t);
  } catch {
    /* 失败态由 live.failed 呈现 */
  }
}

async function sendDirect(text: string) {
  if (live.sending) return;
  try {
    await live.send(text);
  } catch {
    /* ignore */
  }
}

async function startWith(seed: string) {
  if (live.sending) return;
  try {
    await live.send(seed);
  } catch {
    /* ignore */
  }
}

function appendToInput(text: string) {
  input.value = input.value ? `${input.value}\n${text}` : text;
}

async function doConfirm() {
  if (live.sending) return;
  confirmError.value = false;
  phase.value = 'generating';
  try {
    await live.confirm();
    phase.value = live.isCompleted || live.stage === 'completed' || live.stage === 'ready' ? 'done' : 'preview';
  } catch {
    confirmError.value = true;
    phase.value = 'preview';
  }
}

async function doSupplement() {
  const t = supplementText.value.trim();
  if (!t || live.sending) return;
  confirmError.value = false;
  try {
    await live.supplement(t);
    supplementText.value = '';
    supplementMode.value = false;
    // supplement 走 /regenerate（同步生成路径）：成功后直接进入 done 态展示路径入口，
    // 避免响应无 confirmedProposal 导致方案浮层消失的死胡同与重复确认生成的重复路径
    if (live.learningPath || live.isCompleted || live.stage === 'completed' || live.stage === 'ready') {
      phase.value = 'done';
    } else {
      phase.value = 'preview';
    }
  } catch {
    /* ignore */
  }
}

async function doRetry() {
  try {
    await live.retry();
  } catch {
    /* ignore */
  }
}

async function doResume() {
  await live.resume();
}

function doReset() {
  ElMessageBox.confirm(
    '清空后本机保存的对话记录将被删除，此操作不可恢复。',
    '清空重聊',
    { confirmButtonText: '清空', cancelButtonText: '取消', type: 'warning' }
  ).then(() => {
    live.reset();
    resetToEntry();
    // 清掉 URL 中残留的 conversationId，避免刷新后 resumeById 恢复旧会话
    if (typeof route.params.conversationId === 'string') {
      router.replace({ name: 'V2GoalConversation' });
    }
  }).catch(() => {
    // 用户取消
  });
}

const SCENE_BATCH_SIZE = 3;
const scenePool = [
  {
    title: '用 Python 自动化 Excel 报表',
    desc: '每天省下的复制粘贴时间，一周就能看到',
    seed: '我想用 Python 自动化处理 Excel 报表，每天能节省时间',
    bg: 'rgba(52,120,246,.12)', ink: '#1f57cc',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>'
  },
  {
    title: '提升职场沟通表达',
    desc: '从下一次周会发言开始练，场景化拆解',
    seed: '我想学会沟通技巧，提高职场表达和人际交往能力',
    bg: 'rgba(141,107,255,.13)', ink: '#6b4ae0',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zM7 9h10v2H7V9zm6 5H7v-2h6v2zm4-6H7V6h10v2z"/></svg>'
  },
  {
    title: '用 AI 做自媒体副业',
    desc: '围绕你的账号定位，搭一条内容生产流程',
    seed: '我想做自媒体副业，用 AI 工具提高内容创作效率',
    bg: 'rgba(67,176,216,.14)', ink: '#3593b5',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h4a2 2 0 0 1 2 2v1.28c.6.35 1 .98 1 1.72a2 2 0 0 1-1 1.73V17a2 2 0 0 1-2 2h-4v1.27c.6.34 1 .99 1 1.73a2 2 0 1 1-4 0c0-.74.4-1.39 1-1.73V19H7a2 2 0 0 1-2-2v-3.27A2 2 0 0 1 4 12c0-.74.4-1.38 1-1.72V9a2 2 0 0 1 2-2h4V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"/></svg>'
  },
  {
    title: '零基础学前端开发',
    desc: '从第一个网页到能独立做一个小项目',
    seed: '我想从零开始学前端开发，能独立做出网页',
    bg: 'rgba(240,101,149,.12)', ink: '#d1456f',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M14.6 16.6 19.2 12l-4.6-4.6 1.4-1.4L22 12l-5.9 5.9-1.5-1.3zm-5.2 0L7.8 18l-5.8-6 5.8-6 1.6 1.4L4.8 12l4.6 4.6z"/></svg>'
  },
  {
    title: '用 SQL 做数据分析',
    desc: '能从数据库里查数、会看数、会讲数',
    seed: '我想学会 SQL 数据分析，能自己从数据库里查数据',
    bg: 'rgba(67,176,216,.14)', ink: '#2a8fb3',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 2C7.6 2 4 3.8 4 6v12c0 2.2 3.6 4 8 4s8-1.8 8-4V6c0-2.2-3.6-4-8-4zm0 2c3.9 0 6 1.5 6 2s-2.1 2-6 2-6-1.5-6-2 2.1-2 6-2zm6 14c0 .5-2.1 2-6 2s-6-1.5-6-2v-3.2C7.7 17.5 9.8 18 12 18s4.3-.5 6-1.2V18zm0-5.5c0 .5-2.1 2-6 2s-6-1.5-6-2V9.3C7.7 10.5 9.8 11 12 11s4.3-.5 6-1.2V12.5z"/></svg>'
  },
  {
    title: '掌握 Git 版本控制',
    desc: '提交、分支、回滚，代码管理不再手忙脚乱',
    seed: '我想掌握 Git 版本控制，工作中代码管理不再混乱',
    bg: 'rgba(244,170,70,.14)', ink: '#c97f1e',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M7 2a3 3 0 0 0-1 5.83v8.34A3.001 3.001 0 1 0 9 16.17V12h4a3 3 0 0 0 3-3V7.83A3 3 0 1 0 14 8v1a1 1 0 0 1-1 1H8V7.83A3 3 0 0 0 7 2zm0 2a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm10 8a1 1 0 1 1 0 2 1 1 0 0 1 0-2zM7 16a1 1 0 1 1 0 2 1 1 0 0 1 0-2z"/></svg>'
  },
  {
    title: '学会写工作总结汇报',
    desc: '把做的事说清楚，让成果被看见',
    seed: '我想学会写工作总结和汇报，让领导看到我的成果',
    bg: 'rgba(49,177,111,.12)', ink: '#218a56',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm9 1.5V8h4.5L15 3.5zM8 13h8v-1.5H8V13zm0 4h8v-1.5H8V17z"/></svg>'
  },
  {
    title: '搭建个人知识库',
    desc: '学过的内容沉淀下来，能真正用起来',
    seed: '我想搭建自己的知识管理系统，学过的内容能真正用起来',
    bg: 'rgba(52,120,246,.12)', ink: '#1f57cc',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M4 4h7v7H4V4zm2 2v3h3V6H6zm7-2h7v7h-7V4zm2 2v3h3V6h-3zM4 13h7v7H4v-7zm2 2v3h3v-3H6zm7-2h7v7h-7v-7zm2 2v3h3v-3h-3z"/></svg>'
  },
  {
    title: '掌握 Linux 命令行',
    desc: '文件、权限、进程，命令行操作行云流水',
    seed: '我想掌握 Linux 命令行操作，能熟练处理文件和权限管理',
    bg: 'rgba(49,177,111,.12)', ink: '#218a56',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM7.8 15.6 6.4 14.2 9.6 11l-3.2-3.2 1.4-1.4L12.4 11l-4.6 4.6zM12 17h6v-2h-6v2z"/></svg>'
  },
  {
    title: '学习时间管理',
    desc: '一天的事排得明明白白，告别忙乱',
    seed: '我想学习时间管理，把每天的工作安排得有条不紊',
    bg: 'rgba(67,176,216,.14)', ink: '#3593b5',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm1-12h-2v6l5 3 1-1.6-4-2.4V8z"/></svg>'
  },
  {
    title: '学会基础理财规划',
    desc: '工资存得住、钱能生钱，从记账开始',
    seed: '我想学会基础理财规划，工资能存得住、钱能生钱',
    bg: 'rgba(244,170,70,.14)', ink: '#c97f1e',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M21 7H6a1 1 0 0 1 0-2h13V3H6a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h15a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1zm-6 7.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/></svg>'
  },
  {
    title: '学会写技术文档',
    desc: '结构、示例、可读性，让文档真正有人读',
    seed: '我想学会写技术文档，把知识表达清楚让别人能看懂',
    bg: 'rgba(141,107,255,.13)', ink: '#6b4ae0',
    icon: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M21 4H3a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1zM7 6h12v2H7V6zm0 5h12v2H7v-2zm0 5h8v2H7v-2z"/></svg>'
  }
];

/** 场景展示：默认展示前 3 个，点「换一批」从全部场景中随机抽 3 个不重复 */
const shuffledScenes = ref<typeof scenePool | null>(null);
const displayScenes = computed(() => shuffledScenes.value ?? scenePool.slice(0, SCENE_BATCH_SIZE));

function shuffleScenes() {
  shuffledScenes.value = [...scenePool].sort(() => Math.random() - 0.5).slice(0, SCENE_BATCH_SIZE);
}
</script>

<style scoped>
/* ---------- 导航 ---------- */
.nav {
  display: flex; align-items: center; gap: 28px;
  padding: 0 28px; height: 60px;
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
  font-size: 13px; font-weight: 600; color: var(--muted);
  cursor: pointer; text-decoration: none;
}
.nav__links a.active { color: var(--blue-deep); background: rgba(52, 120, 246, 0.09); }
.nav__right { display: flex; align-items: center; gap: 12px; }
.live-badge {
  font-size: 11px; font-weight: 800;
  color: var(--green);
  background: rgba(49, 177, 111, 0.1);
  border: 1px solid rgba(49, 177, 111, 0.3);
  padding: 3px 9px; border-radius: 999px;
}
.nav__avatar { display: flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 700; }
.nav__avatar i {
  width: 26px; height: 26px; border-radius: 50%;
  background: var(--blue-deep); color: #fff;
  font-style: normal; font-size: 12px;
  display: grid; place-items: center;
}

/* ---------- 初始态 / 登录门 ---------- */
.entry {
  flex: 1; width: 100%;
  max-width: 1080px; margin: 0 auto;
  /* 顶部留白与学习路径/学习状态页统一（24px） */
  padding: 24px 28px 12px;
  display: flex; flex-direction: column; gap: 16px;
  /* 内容紧凑靠上，输入框紧跟场景卡 */
  justify-content: flex-start;
}
.entry .composer--entry {
  max-width: 640px; width: 100%; margin: 0 auto;
  /* 与卡片组保持约一张卡片的高度（gap 16px + margin 46px ≈ 62px） */
  margin-top: 46px;
}

.goal__ai-note {
  display: flex; justify-content: center;
  padding: 0 28px 14px;
}
.goal__ai-note :deep(.ai-note) { font-size: 11px; opacity: 0.75; }
.login-gate {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 20px;
  padding: 48px 32px;
  display: grid; gap: 14px; justify-items: center; text-align: center;
}
.login-gate h1 { margin: 0; font-size: 26px; }
.login-gate p { margin: 0; font-size: 14px; color: var(--muted); max-width: 52ch; line-height: 1.7; }

.resume {
  display: inline-flex; align-items: center; gap: 10px;
  padding: 11px 16px;
  background: linear-gradient(135deg, rgba(52, 120, 246, 0.07), rgba(141, 107, 255, 0.05));
  border: 1px solid rgba(52, 120, 246, 0.25);
  border-radius: 14px;
  font: inherit; text-align: left; cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.15s ease;
}
.resume:hover { border-color: rgba(52, 120, 246, 0.5); box-shadow: 0 8px 20px rgba(52, 120, 246, 0.12); }
.resume__dot {
  width: 9px; height: 9px; border-radius: 50%;
  background: var(--blue);
  box-shadow: 0 0 0 4px rgba(52, 120, 246, 0.18);
  flex: 0 0 auto;
  animation: pulse 1.6s ease-in-out infinite;
}
.resume__body { display: grid; gap: 1px; }
.resume__body strong { font-size: 13.5px; }
.resume__body small { font-size: 11.5px; color: var(--muted); }
.resume__go { font-size: 13px; font-weight: 800; color: var(--blue-deep); }

.entry__hero {
  display: flex; align-items: flex-end; justify-content: space-between;
  gap: 20px; flex-wrap: wrap;
}
.entry__hero-text { display: grid; gap: 10px; }
.entry__hero h1 { margin: 0; font-size: 28px; letter-spacing: -0.01em; }
.entry__hero p { margin: 0; font-size: 13.5px; color: var(--muted); max-width: 52ch; line-height: 1.7; }

.errorbar {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px;
  border-radius: 12px;
  background: rgba(239, 117, 120, 0.08);
  border: 1px solid rgba(239, 117, 120, 0.3);
  color: #c0454a;
  font-size: 13px; font-weight: 600;
}
.errorbar__retry { text-decoration: underline; cursor: pointer; font-weight: 800; }
.chat__errorbar { margin: 10px 14px 0; }

.entry__cards {
  display: grid; grid-template-columns: 1fr; gap: 12px;
  max-width: 640px; width: 100%; margin: 0 auto;
}
.entry__cards-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.entry__cards-title { font-size: 12px; font-weight: 700; color: var(--faint); }
.cards-nav__btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 30px; height: 30px; padding: 0;
  border: 0; border-radius: 8px;
  background: transparent; color: var(--faint);
  font: inherit; cursor: pointer;
  transition: color .15s ease, background .15s ease;
}
.cards-nav__btn:hover:not(:disabled) {
  color: var(--muted); background: rgba(23, 32, 51, 0.05);
}
.cards-nav__btn:disabled { opacity: .4; cursor: default; }
.scene-card {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 14px;
  font: inherit; text-align: left; cursor: pointer;
  transition: background 0.16s ease, border-color 0.16s ease, color 0.16s ease, transform 0.16s ease;
}
.scene-card:hover:not(:disabled) {
  border-color: rgba(52, 120, 246, 0.45);
  box-shadow: 0 10px 26px rgba(52, 120, 246, 0.12);
  transform: translateY(-1px);
}
.scene-card:disabled { opacity: .55; cursor: default; }
.scene-card__icon { width: 36px; height: 36px; border-radius: 11px; display: grid; place-items: center; flex: 0 0 auto; }
.scene-card__body { flex: 1; min-width: 0; }
.scene-card__body strong {
  display: block; font-size: 14px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.scene-card__go {
  font-size: 18px; line-height: 1;
  color: var(--faint); flex: 0 0 auto;
  transition: color 0.16s ease, transform 0.16s ease;
}
.scene-card:hover:not(:disabled) .scene-card__go { color: var(--blue-deep); transform: translateX(2px); }

/* ---------- 输入区 ---------- */
.composer { display: grid; gap: 7px; }
.composer__box {
  display: flex; align-items: flex-end; gap: 10px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 8px 8px 8px 16px;
  min-height: 54px;
  box-shadow: 0 6px 20px rgba(23, 32, 51, 0.06);
}
.composer__box--active { border-color: rgba(52, 120, 246, 0.4); }
.composer__textarea {
  flex: 1;
  border: 0; outline: none; resize: none;
  font: inherit; font-size: 14px; line-height: 1.5;
  color: var(--ink);
  background: transparent;
  padding: 10px 0;
  max-height: 120px;
  align-self: center;
}
.composer__count { font-size: 11px; color: var(--faint); align-self: center; }
.composer__send {
  width: 40px; height: 40px; border-radius: 12px;
  display: grid; place-items: center;
  background: linear-gradient(135deg, var(--blue), var(--blue-deep));
  color: #fff; cursor: pointer;
  box-shadow: 0 8px 16px rgba(52, 120, 246, 0.3);
  flex: 0 0 auto;
}
.composer__send--off { background: #e3eaf5; color: var(--faint); box-shadow: none; cursor: default; }
.composer__hint {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-wrap: wrap;
  font-size: 11.5px; color: var(--faint); padding-left: 6px;
}

/* ---------- 工作台布局 ---------- */
.work {
  position: relative;
  flex: 1;
  min-height: 0;
  width: 100%;
  max-width: 1080px;
  margin: 0 auto;
  padding: 12px 20px 16px;
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  gap: 16px;
  align-content: stretch;
  align-items: stretch;
  box-sizing: border-box;
}

/* ---------- 左：信息清单 ---------- */
.panel {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 16px;
  display: flex; flex-direction: column; gap: 12px;
  min-height: 0;
  overflow: auto;
}
.panel__head { display: flex; align-items: center; justify-content: space-between; }
.panel__head strong { font-size: 14px; }
.panel__count { font-size: 12px; font-weight: 800; color: var(--blue-deep); }
.panel__bar { height: 6px; border-radius: 99px; background: #edf1f8; overflow: hidden; }
.panel__bar i { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--blue), var(--cyan)); transition: width .4s ease; }
.panel__confidence { font-size: 11px; color: var(--faint); }

.checklist { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
.field {
  position: relative;
  display: grid; grid-template-columns: 20px 1fr; gap: 9px;
  padding: 8px;
  border-radius: 10px;
  border: 1px solid transparent;
  transition: background .15s ease;
}
.field--done:hover { background: #f6f9ff; }
.field__mark {
  width: 18px; height: 18px; border-radius: 50%;
  margin-top: 2px;
  display: grid; place-items: center;
}
.field--done .field__mark { background: var(--green); color: #fff; }
.field--todo .field__mark { border: 2px dashed #cfdaee; }
.field__label { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; color: var(--muted); }
.field__value { margin-top: 3px; font-size: 13px; line-height: 1.5; color: var(--ink); }
.field__value--todo { color: var(--faint); font-size: 12px; }
.field--todo { opacity: .7; }
.field--fresh { background: rgba(49, 177, 111, 0.07); }
/* 刚收录闪显：值写入时一次绿色高亮脉冲（reduced-motion 下被全局规则压掉） */
@media (prefers-reduced-motion: no-preference) {
  .field--fresh { animation: field-flash 1.4s ease-out 1; }
  .field--fresh .field__value { animation: field-value-flash 1.4s ease-out 1; }
  .field__fresh { animation: field-badge-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
}
@keyframes field-flash {
  0% { box-shadow: inset 0 0 0 999px rgba(49, 177, 111, 0.22); }
  100% { box-shadow: inset 0 0 0 999px rgba(49, 177, 111, 0); }
}
@keyframes field-value-flash {
  0%, 30% { color: var(--green); }
  100% { color: var(--ink); }
}
@keyframes field-badge-pop {
  from { opacity: 0; transform: scale(0.6); }
  to { opacity: 1; transform: scale(1); }
}
.field__fresh {
  position: absolute; top: 8px; right: 8px;
  font-size: 10px; font-weight: 800; color: var(--green);
  background: rgba(49, 177, 111, 0.12);
  padding: 2px 7px; border-radius: 999px;
}
.panel__tip {
  font-size: 11.5px; color: var(--faint); border-top: 1px solid var(--line); padding-top: 10px;
  margin-top: auto;
}
</style>

<style scoped>
/* ---------- 右：聊天区 ---------- */
.chat {
  position: relative;
  display: flex; flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 16px;
  overflow: hidden;
  min-height: 0;
  height: 100%;
}
.chat__head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--line);
  background: #fbfdff;
}
.stage-nav { list-style: none; margin: 0; padding: 0; display: flex; gap: 6px; }
.stage-nav__item {
  display: inline-flex; align-items: center; gap: 7px;
  font-size: 12px; font-weight: 700; color: var(--faint);
  padding: 5px 10px; border-radius: 999px;
}
.stage-nav__item i {
  width: 17px; height: 17px; border-radius: 50%;
  background: #e3eaf5; color: var(--faint);
  font-size: 10.5px; font-weight: 800; font-style: normal;
  display: grid; place-items: center;
}
.stage-nav__item--current { color: var(--blue-deep); background: rgba(52, 120, 246, 0.09); }
.stage-nav__item--current i { background: var(--blue); color: #fff; }
.stage-nav__item--done { color: var(--green); }
.stage-nav__item--done i { background: var(--green); color: #fff; }
.chat__clear { font-size: 12px; font-weight: 600; color: var(--faint); cursor: pointer; }
.chat__clear:hover { color: #c0454a; }

.chat__scroll {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  display: flex; flex-direction: column; gap: 18px;
  transition: filter .2s ease, opacity .2s ease;
}
.chat__scroll--dim { filter: blur(2px); opacity: .45; pointer-events: none; }

.msg { display: flex; flex-direction: column; gap: 5px; max-width: 82%; }
/* 消息入场：新气泡浮出 */
@media (prefers-reduced-motion: no-preference) {
  .msg { animation: msg-in 0.28s cubic-bezier(0.16, 1, 0.3, 1) both; }
}
@keyframes msg-in {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
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
.msg--ai { flex-direction: row; align-items: flex-start; gap: 10px; max-width: 92%; }
.msg--ai .msg__content { display: grid; gap: 5px; min-width: 0; }
.msg--ai .msg__bubble b, .msg--ai .msg__bubble strong { color: var(--blue-deep); }
.msg__bubble--html :deep(p) { margin: 0 0 8px; }
.msg__bubble--html :deep(p:last-child) { margin-bottom: 0; }
.msg__bubble--html :deep(ul), .msg__bubble--html :deep(ol) { margin: 4px 0; padding-left: 18px; }
.msg__bubble--html :deep(li) { margin: 2px 0; }
.msg__bubble--html :deep(code) {
  background: rgba(52, 120, 246, 0.1);
  color: var(--blue-deep);
  padding: 1px 6px; border-radius: 6px;
  font-size: 12.5px;
}
.msg__bubble--typing { display: inline-flex; gap: 5px; align-items: center; padding: 14px 16px; }
.msg__bubble--typing i {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--faint);
  animation: typing 1.2s ease-in-out infinite;
}
.msg__bubble--typing i:nth-child(2) { animation-delay: .15s; }
.msg__bubble--typing i:nth-child(3) { animation-delay: .3s; }
@keyframes typing { 0%, 60%, 100% { opacity: .3; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }
.msg__avatar {
  width: 30px; height: 30px; border-radius: 10px;
  background: linear-gradient(135deg, var(--blue), var(--accent));
  color: #fff; font-size: 13px; font-weight: 800;
  display: grid; place-items: center;
  flex: 0 0 auto; margin-top: 2px;
}
.msg__meta { font-size: 11px; color: var(--faint); }
.msg__retry {
  margin-left: 8px;
  color: #c0454a; font-weight: 800;
  text-decoration: underline; cursor: pointer;
}

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
  cursor: pointer; transition: .15s ease;
}
.reply:hover { background: rgba(52, 120, 246, 0.12); }
.reply__plus {
  width: 18px; height: 18px; border-radius: 50%;
  border: 1px solid rgba(52, 120, 246, 0.45);
  font-size: 12px; line-height: 1;
  display: grid; place-items: center;
  color: var(--blue-deep); background: #fff;
}
.chat .composer {
  padding: 12px 14px;
  border-top: 1px solid var(--line);
  background: #fbfdff;
  flex: 0 0 auto;
}

/* ---------- 方案确认浮层 ---------- */
.overlay {
  position: absolute; inset: 0;
  display: grid; place-items: center;
  padding: 24px;
  background: rgba(244, 247, 252, 0.55);
  backdrop-filter: blur(1px);
  z-index: 5;
}
.proposal {
  width: min(620px, 100%);
  max-height: 100%;
  overflow-y: auto;
  background: var(--surface);
  border: 1px solid rgba(52, 120, 246, 0.22);
  border-radius: 20px;
  box-shadow: 0 28px 70px rgba(23, 32, 51, 0.16);
  padding: 26px 28px;
  display: grid; gap: 16px;
}
.proposal--center { justify-items: center; text-align: center; gap: 12px; }
.proposal__eyebrow { font-size: 12px; font-weight: 800; letter-spacing: .06em; color: var(--blue-deep); }
.proposal__title { margin: 0; font-size: 21px; letter-spacing: -0.01em; }
.proposal__generating-note { margin: 0; font-size: 13px; color: var(--muted); line-height: 1.7; max-width: 44ch; }
.proposal__rows { display: grid; gap: 10px; width: 100%; }
.proposal__row {
  display: grid; gap: 4px;
  padding: 11px 14px;
  border-radius: 12px;
  background: #f7faff;
  border: 1px solid #e8eefb;
  text-align: left;
}
.proposal__row span { font-size: 11.5px; font-weight: 800; color: var(--blue-deep); }
.proposal__row p { margin: 0; font-size: 13.5px; line-height: 1.6; color: var(--ink); }
.proposal__stages { display: grid; gap: 10px; width: 100%; text-align: left; }
.proposal__stages-label { font-size: 11.5px; font-weight: 800; color: var(--muted); }
.proposal__stages ol {
  list-style: none; margin: 0; padding: 0;
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px;
}
.proposal__stages ol:has(> :nth-child(5)) { grid-template-columns: repeat(3, 1fr); }
.pstep {
  display: grid; gap: 8px; align-content: start;
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
.pstep strong { display: block; font-size: 12.5px; line-height: 1.45; }
.proposal__skip {
  width: 100%;
  font-size: 12px; color: var(--muted);
  border: 1px dashed var(--line);
  border-radius: 10px;
  padding: 9px 12px;
  background: #fafcff;
  text-align: left;
}
.proposal__actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.proposal__actions--center { justify-content: center; }
.btn-primary {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 11px 22px; border-radius: 12px;
  background: linear-gradient(135deg, var(--blue), var(--blue-deep));
  color: #fff; font-size: 14px; font-weight: 700;
  box-shadow: 0 10px 22px rgba(52, 120, 246, 0.3);
  cursor: pointer; text-decoration: none;
}
.btn-primary--lg { padding: 13px 26px; font-size: 15px; }
.btn-primary--off { opacity: .55; cursor: default; box-shadow: none; }
.btn-ghost {
  padding: 11px 18px; border-radius: 12px;
  border: 1px solid var(--line); background: #fff;
  font-size: 14px; font-weight: 700; color: var(--muted);
  cursor: pointer;
}
.proposal__note {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-wrap: wrap;
  font-size: 11.5px; line-height: 1.5; color: var(--faint);
}
.proposal__note :deep(.ai-note) {
  font-size: 11.5px; line-height: 1.5;
}
.proposal__supplement { display: grid; gap: 12px; width: 100%; }
.proposal__supplement-input {
  border: 1px solid rgba(244, 170, 70, 0.45);
  background: rgba(244, 170, 70, 0.07);
  border-radius: 12px;
  padding: 12px 14px;
  font: inherit; font-size: 13px; color: var(--ink);
  resize: none; outline: none;
  min-height: 56px;
}

/* 生成中 */
.spinner {
  width: 44px; height: 44px; border-radius: 50%;
  border: 4px solid rgba(52, 120, 246, 0.15);
  border-top-color: var(--blue);
  animation: spin 0.9s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
.skeleton { display: grid; gap: 8px; width: 100%; }
.skeleton i {
  height: 12px; border-radius: 6px;
  background: linear-gradient(90deg, #edf1f8 25%, #f7faff 50%, #edf1f8 75%);
  background-size: 200% 100%;
  animation: shimmer 1.4s ease infinite;
}
@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

/* 成功 */
.done-ring {
  width: 52px; height: 52px; border-radius: 50%;
  background: rgba(49, 177, 111, 0.12);
  color: var(--green);
  display: grid; place-items: center;
  box-shadow: 0 0 0 8px rgba(49, 177, 111, 0.07);
}

/* ---------- 响应式 ---------- */
@media (max-width: 900px) {
  .nav__links { display: none; }
  .work {
    grid-template-columns: 1fr;
    padding: 12px 14px 88px;
    overflow: auto;
  }
  .panel {
    max-height: none;
    overflow: visible;
  }
  .chat { min-height: min(70vh, 560px); height: auto; }
  .msg { max-width: 96%; }
  .replies { margin-left: 0; }
  .proposal__stages ol { grid-template-columns: repeat(2, 1fr); }
  .entry__hero { align-items: stretch; flex-direction: column; }
  .entry__hero h1 { font-size: 22px; }
  .resume { width: 100%; justify-content: flex-start; }
  .entry__cards { grid-template-columns: 1fr; }
  .entry { padding: 28px 16px; }
  .stage-nav__item { padding: 4px 7px; }
  .chat__clear { display: none; }
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

<style scoped>
.login-gate__logo {
  width: 56px;
  height: 56px;
  object-fit: contain;
  border-radius: 16px;
  box-shadow: 0 10px 24px rgba(23, 32, 51, 0.12);
}
</style>
