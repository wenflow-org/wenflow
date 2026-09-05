<template>
  <div class="learn v2-page">
    <!-- 沉浸式头部 -->
    <header class="learn__head">
      <span class="learn__back" @click="goBack">‹ 返回路径详情</span>
      <div class="learn__title">
        <span class="learn__task-pill">当前任务</span>
        <strong>{{ taskTitle || '学习会话' }}</strong>
        <small>{{ pathName }}</small>
      </div>
      <div class="learn__head-right">
        <span class="learn__live">{{ session ? '学习中' : '连接中' }}</span>
        <span class="learn__menu-wrap">
          <span class="learn__menu" title="更多" @click="menuOpen = !menuOpen" :aria-expanded="menuOpen">⋯</span>
          <Transition name="pop">
            <div v-if="menuOpen" class="learn__menu-pop">
            <div class="learn__menu-group">
              <span class="learn__menu-label">结束本节课</span>
              <button type="button" class="learn__menu-item learn__menu-item--primary" @click="completeAndSettle">
                <span class="learn__menu-item-main"><strong>完成并结算任务</strong><small>计入进度 · 生成本次学习总结</small></span>
              </button>
              <button type="button" class="learn__menu-item" @click="endSession">
                <span class="learn__menu-item-main"><strong>结束学习（不计入完成）</strong><small>生成本次总结，不推进任务进度</small></span>
              </button>
            </div>
            <div class="learn__menu-sep"></div>
            <div class="learn__menu-group">
              <span class="learn__menu-label">暂离或重学</span>
              <button type="button" class="learn__menu-item" @click="pauseAndLeave">
                <span class="learn__menu-item-main"><strong>暂停并离开</strong><small>进度保留，下次从这继续</small></span>
              </button>
              <button type="button" class="learn__menu-item learn__menu-item--danger" @click="restart">
                <span class="learn__menu-item-main"><strong>重新开始</strong><small>清空当前进度与消息</small></span>
              </button>
            </div>
          </div>
        </Transition>
        </span>
      </div>
    </header>

    <!-- 初始化中 -->
    <Transition name="stage-switch" mode="out-in">
      <div v-if="initing" key="init" class="learn__stage">
      <div class="stage-card">
        <span class="spinner"></span>
        <h2>正在准备本节内容…</h2>
        <p>问流正在为「{{ taskTitle || '当前任务' }}」组织讲解和练习，一般几秒到十几秒。</p>
        <div class="stage-card__skeleton"><i style="width: 82%"></i><i style="width: 64%"></i><i style="width: 74%"></i></div>
      </div>
    </div>

    <!-- 初始化失败 -->
    <div v-else-if="initError" key="err" class="learn__stage">
      <div class="stage-card">
        <span class="stage-card__warn">!</span>
        <h2>本节暂时开不了课</h2>
        <p>{{ friendlyError }}</p>
        <div class="stage-card__actions">
          <button type="button" class="btn-primary" @click="boot">重新尝试</button>
          <button type="button" class="btn-ghost" @click="goBack">返回路径详情</button>
          <router-link to="/learning-paths" class="btn-ghost">查看路径列表</router-link>
        </div>
      </div>
    </div>

    <div v-else key="body" class="learn__body" :class="{ 'learn__body--no-kp': !knowledgePoints.length }">
      <!-- 左：知识点面板（移动端默认折叠为头部横条，点击展开；桌面恒展开） -->
      <aside v-if="knowledgePoints.length" class="kp" :class="{ 'kp--collapsed': !kpExpanded }">
        <button type="button" class="kp__head" :aria-expanded="kpExpanded" @click="toggleKp">
          <strong>本节知识点</strong>
          <span>{{ masteredCount }} / {{ knowledgePoints.length }} 已掌握</span>
          <span class="kp__caret" aria-hidden="true">{{ kpExpanded ? '▾' : '▸' }}</span>
        </button>
        <div class="kp__body">
          <div class="kp__bar"><i :style="{ width: (masteredCount / knowledgePoints.length) * 100 + '%' }"></i></div>
          <ol class="kp__list">
            <li v-for="(kp, i) in knowledgePoints" :key="kp.id || i" class="kp__item" :class="kpCls(kp)">
              <span class="kp__mark">
                <svg v-if="isMastered(kp)" viewBox="0 0 24 24" width="10" height="10"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
                <i v-else></i>
              </span>
              <div class="kp__name">
                <strong>{{ kp.name || kp.title }}</strong>
                <small>{{ kpStatusText(kp) }}</small>
              </div>
            </li>
          </ol>
        </div>
      </aside>

      <!-- 中：导师对话 -->
      <section class="tutor">
        <!-- 恢复进度横幅：续上历史时可见，明确「已恢复到上次进度」并提供重新开始出口 -->
        <div v-if="resumedNotice" class="tutor__resume">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M13 2 4.5 13.5H11L9.5 22 19 9.5h-6.5L13 2z"/></svg>
          <span class="tutor__resume-text">已恢复上次学习进度，接着继续</span>
          <button type="button" class="tutor__resume-restart" @click="restart">重新开始</button>
          <button type="button" class="tutor__resume-close" aria-label="关闭提示" @click="resumedNotice = false">
            <svg viewBox="0 0 24 24" width="10" height="10"><path fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>
          </button>
        </div>

        <!-- 开场景卡片：resumed / 接续 / 重学 / 复习 的结构化开场（取代模板双气泡的空转重复） -->
        <div v-if="openingScene && !openingSceneDone" class="oscene" :class="`oscene--${openingScene.kind || 'first'}`">
          <div class="oscene__tag">{{ sceneTag }}</div>
          <h3 class="oscene__title">{{ openingScene.title || sceneDefaultTitle }}</h3>
          <p v-if="sceneLead" class="oscene__lead">{{ sceneLead }}</p>
          <div v-if="openingScene.recap?.summary" class="oscene__summary">{{ openingScene.recap.summary }}</div>
          <div v-if="sceneUnresolved.length" class="oscene__chips">
            <span class="oscene__chip-label">上次还没完全掌握</span>
            <span v-for="(u, ui) in sceneUnresolved" :key="ui" class="oscene__chip">{{ u }}</span>
          </div>
          <div v-if="sceneMasteryWarn.length" class="oscene__warn">
            <span>前序基础提醒：</span>{{ sceneMasteryWarn }}
          </div>
          <div class="oscene__actions">
            <button type="button" class="btn-primary" :disabled="typing || actionBusy" @click="startFromScene">
              <span v-if="typing" class="spinner spinner--sm"></span>
              {{ scenePrimaryText }}
            </button>
            <button
              v-if="openingScene.kind === 'resume'"
              type="button"
              class="btn-ghost"
              :disabled="typing || actionBusy"
              @click="restart"
            >重新开始</button>
            <button type="button" class="btn-ghost" :disabled="typing || actionBusy" @click="openingSceneDone = true">先看看</button>
          </div>
        </div>

        <div ref="scrollEl" class="tutor__scroll" @scroll="updateNearBottom">
          <template v-for="m in msgs" :key="m.id">
            <div v-if="m.role === 'user'" class="msg msg--user" :class="{ 'msg--editing': editingMsgId === m.id }">
              <!-- 编辑态：textarea 替换气泡 -->
              <div v-if="editingMsgId === m.id" class="msg__edit">
                <textarea
                  v-model="editingText"
                  class="msg__edit-input"
                  rows="2"
                  maxlength="800"
                  @keydown.enter.exact.prevent="saveEdit(m)"
                  @keydown.esc="cancelEdit"
                ></textarea>
                <div class="msg__edit-actions">
                  <span class="msg__edit-save" role="button" tabindex="0" @click="saveEdit(m)" @keydown.enter="saveEdit(m)">保存</span>
                  <span class="msg__edit-cancel" role="button" tabindex="0" @click="cancelEdit" @keydown.enter="cancelEdit">取消</span>
                </div>
              </div>
              <template v-else>
                <div class="msg__bubble">{{ m.text }}</div>
                <button
                  v-if="canEditMessage(m)"
                  type="button"
                  class="msg__edit-btn"
                  title="编辑这条消息"
                  @click="startEdit(m)"
                ><svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg></button>
              </template>
              <div class="msg__meta">你 · {{ m.time }}</div>
            </div>
            <div v-else class="msg msg--ai">
              <span class="msg__avatar"><img src="/favicon.png" alt="问流" /></span>
              <div class="msg__content msg__content--actions"
                @mouseenter="onBubbleEnter(m.id || '')"
                @mouseleave="onBubbleLeave"
              >
                <div class="msg__bubble msg__bubble--html msg__bubble--relative" v-html="htmlFor(m)"></div>
                <MessageActions
                  :show="hoveredMsgId === m.id"
                  :streaming="typing && streamingBubbleIndex === msgs.indexOf(m)"
                  @regenerate="regenerateMessage(m)"
                  @copy="copyMessage(m.text)"
                  @feedback="(up) => sendMessageFeedback(m, up)"
                />
                <span v-if="m.confusion?.length" class="msg__chip msg__chip--confuse">捕获到卡点「{{ m.confusion.join('、') }}」· 导师会在这里多做确认</span>
                <div class="msg__meta">
                  问流导师 · {{ m.time }}
                  <span v-if="m.failed" class="msg__retry" @click="retryLast">重试</span>
                </div>
              </div>
            </div>
          </template>

          <div v-if="typing && streamingBubbleIndex === -1" class="msg msg--ai">
            <span class="msg__avatar"><img src="/favicon.png" alt="问流" /></span>
            <div class="msg__bubble msg__bubble--typing"><i></i><i></i><i></i></div>
          </div>
        </div>

        <!-- 回到底部浮标：用户上翻看旧内容期间显示，点击回到最新消息 -->
        <button
          v-if="!nearBottom && msgs.length > 3"
          type="button"
          class="tutor__jump-bottom"
          aria-label="回到底部"
          @click="jumpToBottom"
        >↓ 回到底部</button>

        <!-- 开场行动台：AI 给的「下一步动作」选项，点一下直接执行（即点即达） -->
        <div v-if="quickReplies.length && !typing && !checkpoint" class="replies">
          <div class="replies__head">
            <span class="replies__kicker">{{ quickReplyKicker }}</span>
            <span class="replies__hint">选一个，直接开始</span>
          </div>
          <div class="replies__row">
            <button
              v-for="(q, qi) in quickReplies"
              :key="q"
              type="button"
              class="reply"
              :class="`reply--${(qi % 3) + 1}`"
              @click="sendDirect(q)"
            >
              <span class="reply__mark" aria-hidden="true">{{ qi + 1 }}</span>
              <span class="reply__text">{{ q }}</span>
              <span class="reply__go" aria-hidden="true">→</span>
            </button>
          </div>
        </div>

        <!-- 知识点确认（动态行动台）：AI 讲完一个点、给出 confirmCheck 时出现 -->
        <div v-if="shouldAskSelfAssess && confirmCheck" class="kp-actions kp-actions--dynamic">
          <div class="kp-actions__head">
            <span class="kp-actions__kicker">{{ confirmCheck.prompt || '这个点感觉怎么样？' }}</span>
          </div>
          <div class="kp-actions__row kp-actions__row--stack">
            <button
              v-for="(a, ai) in confirmCheck.actions"
              :key="ai"
              type="button"
              class="kp-act"
              :class="`kp-act--${ai === 0 ? 'ok' : 'retry'}`"
              @click="sendDirect(a.message)"
            >
              <span class="kp-act__mark" aria-hidden="true">{{ ai === 0 ? '✓' : '↻' }}</span>
              <span class="kp-act__text">{{ a.label }}</span>
              <span class="kp-act__go" aria-hidden="true">→</span>
            </button>
          </div>
        </div>

        <!-- 检查点 -->
        <Transition name="cp">
          <div v-if="checkpoint && !completed" class="checkpoint">
          <div class="checkpoint__head">
            <span class="checkpoint__badge">检查点</span>
            <strong>{{ checkpoint.title || checkpoint.question }}</strong>
            <p v-if="checkpoint.title && checkpoint.question">{{ checkpoint.question }}</p>
          </div>
          <template v-if="checkpoint.options?.length">
            <label v-for="opt in checkpoint.options" :key="opt.id" class="checkpoint__option" :class="{ 'checkpoint__option--on': selectedOptions.includes(opt.id) }">
              <input
                :type="checkpoint.type === 'multi_choice' ? 'checkbox' : 'radio'"
                :value="opt.id"
                :checked="selectedOptions.includes(opt.id)"
                @change="toggleOption(opt.id)"
              />
              {{ opt.text }}
            </label>
          </template>
          <textarea v-else v-model="answerText" class="checkpoint__input" rows="3" placeholder="写下你的答案…"></textarea>
          <div v-if="checkpointFeedback" class="checkpoint__feedback" :class="{ 'checkpoint__feedback--ok': checkpointPassed }">
            {{ checkpointFeedback }}
          </div>
          <div class="checkpoint__actions">
            <span class="btn-primary" role="button" tabindex="0" @click="submitCheckpoint" @keydown.enter="submitCheckpoint">提交</span>
            <span v-if="checkpoint.allowSkip !== false" class="btn-ghost" role="button" tabindex="0" @click="skipCheckpoint" @keydown.enter="skipCheckpoint">跳过</span>
          </div>
          </div>
        </Transition>

        <!-- 输入区 -->
        <div class="composer">
          <div class="composer__box" :class="{ 'composer__box--active': input.trim() }">
            <textarea
              v-model="input"
              class="composer__textarea"
              rows="1"
              maxlength="800"
              placeholder="随时提问，或说说你的理解…"
              @input="interactionMeta.onInput(input.length)"
              @keydown.enter.exact.prevent="send"
            ></textarea>
            <span class="composer__count">{{ input.length }} / 800</span>
            <!-- 发送/停止 同位置切换：导师流式中变停止（checkpointPending 判定中不可停止，保持禁用） -->
            <span
              v-if="!typing"
              class="composer__send"
              :class="{ 'composer__send--off': !input.trim() || checkpointPending }"
              role="button"
              tabindex="0"
              @click="send"
              @keydown.enter="send"
            >
              <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M3 20v-6l8-2-8-2V4l19 8z"/></svg>
            </span>
            <span
              v-else
              class="composer__send composer__send--stop"
              role="button"
              tabindex="0"
              title="停止生成"
              @click="stopGeneration"
              @keydown.enter="stopGeneration"
            >
              <svg viewBox="0 0 24 24" width="13" height="13"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>
            </span>
          </div>
          <div class="composer__hint">
            <span>Enter 发送 · Shift+Enter 换行</span>
            <AiContentNote />
          </div>
        </div>

        <!-- 完成浮层 -->
        <Transition name="finish-pop">
          <div v-if="completed" class="finish">
          <div class="finish__card">
            <span class="finish__ring">
              <svg viewBox="0 0 24 24" width="26" height="26"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>
            </span>
            <h2>本节完成</h2>
            <p>{{ wrapupText || '这次学习已经记录。' }}</p>
            <div v-if="finishStats.length" class="finish__stats">
              <span v-for="(s, i) in finishStats" :key="i"><b>{{ s.value }}</b>{{ s.label }}</span>
            </div>
            <div class="finish__actions">
              <span class="btn-primary" role="button" tabindex="0" @click="goBack" @keydown.enter="goBack">回到路径详情</span>
              <span v-if="evaluationUrl" class="btn-ghost" role="button" tabindex="0" @click="goEvaluation" @keydown.enter="goEvaluation">查看学习反馈</span>
            </div>
          </div>
        </div>
        </Transition>
      </section>
    </div>
    </Transition>

    <!-- 伴学浮窗：小启（独立角色，暖橙系）；不占主对话区，可回复、可收起成悬浮球 -->
    <Transition name="peer-pop">
      <div v-if="peerOpen && peerItems.length" class="peerdock" role="dialog" aria-label="小启伴学" aria-live="polite">
        <div class="peerdock__head">
          <span class="peerdock__avatar" aria-hidden="true">
            <span class="peerdock__avatar-q">Q</span>
          </span>
          <div class="peerdock__title">
            <span class="peerdock__name">
              <strong>小启</strong>
              <span class="peerdock__tag">伴学伙伴</span>
            </span>
            <span class="peerdock__status">
              <i class="peerdock__status-dot"></i>{{ peerHeadline }}
            </span>
          </div>
          <span class="peerdock__min" title="收起" @click="minimizePeer" aria-label="收起伴学窗">
            <svg viewBox="0 0 24 24" width="12" height="12"><path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" d="M5 12h14"/></svg>
          </span>
        </div>
        <div ref="peerScrollEl" class="peerdock__scroll">
          <div v-for="(p, i) in peerItems" :key="i" class="peerdock__msg" :class="`peerdock__msg--${p.role}`">
            <div class="peerdock__bubble" v-html="formatMessage(p.text)"></div>
            <template v-if="p.role === 'peer'">
              <div v-if="p.followUps?.length" class="peerdock__follows">
                <button
                  v-for="(q, qi) in p.followUps"
                  :key="qi"
                  type="button"
                  class="peerdock__follow"
                  :disabled="peerSending"
                  @click="sendPeerDirect(q)"
                >{{ q }}</button>
              </div>
              <div class="peerdock__meta">
                <span v-if="strategyLabelOf(p)" class="peerdock__strategy">{{ strategyLabelOf(p) }}</span>
                <small>小启 · {{ p.time }}</small>
              </div>
            </template>
            <small v-else>你 · {{ p.time }}</small>
          </div>
          <div v-if="peerSending" class="peerdock__msg peerdock__msg--peer">
            <div class="peerdock__bubble peerdock__bubble--typing"><i></i><i></i><i></i></div>
          </div>
          <div class="peerdock__ai-note"><AiContentNote /></div>
        </div>
        <div class="peerdock__input">
          <input
            v-model="peerInput"
            type="text"
            maxlength="500"
            placeholder="和小启聊聊你的卡点…"
            @keydown.enter.exact.prevent="sendPeer"
          />
          <button type="button" :disabled="!peerInput.trim() || peerSending" @click="sendPeer">发送</button>
        </div>
      </div>
    </Transition>
    <button
      v-if="!peerOpen && peerItems.length"
      type="button"
      class="peerfab"
      aria-label="打开小启伴学"
      @click="openPeerByUser"
    >
      <span class="peerfab__q" aria-hidden="true">Q</span>
      <i v-if="peerUnread" class="peerfab__dot"></i>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import request, { API_BASE_URL } from '@/utils/api';
import { aiTeachingAPI } from '@/api/aiTeaching';
import { feedbackApi } from '@/api/feedback';
import AiContentNote from '@/components/AiContentNote.vue';
import MessageActions from '@/components/chat/MessageActions.vue';
import { toast } from '@/utils/toast';
import { useInteractionMeta } from '@/composables/useInteractionMeta';
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts';
import { cachedMessageHtml, plainMessageHtml } from '@/utils/messageMarkdown';
import { askConfirm } from '@/views/admin-redesign/useConfirm';
import { unwrap } from './unwrap';

const route = useRoute();
const router = useRouter();
const taskId = String(route.params.taskId || '');
const isReviewMode = computed(() => route.query.mode === 'review');
const interactionMeta = useInteractionMeta();

/* 移动端知识点面板折叠：桌面（>900px）恒展开，窄屏默认折叠，点击面板头部展开/收起 */
const narrowMq = typeof window !== 'undefined' ? window.matchMedia('(max-width: 900px)') : null;
const isNarrow = ref(narrowMq?.matches ?? false);
const kpOpen = ref(false);
const kpExpanded = computed(() => !isNarrow.value || kpOpen.value);
function toggleKp() {
  if (!isNarrow.value) return;
  kpOpen.value = !kpOpen.value;
}
function onNarrowChange(e: MediaQueryListEvent) {
  isNarrow.value = e.matches;
}

/* ---------- 键盘快捷键 ---------- */
useKeyboardShortcuts([
  {
    key: 'Escape',
    handler: () => {
      if (completed.value) return;
      // 流式生成中：中止
      if (typing.value && streamAbort) {
        streamAbort.abort();
        streamAbort = null;
        return;
      }
      // 检查点可见：跳过
      if (checkpoint.value && !checkpointSubmitting.value) {
        skipCheckpoint();
        return;
      }
    },
    description: '停止生成 / 跳过检查点',
  },
]);

/* ---------- 基础 ---------- */
const taskTitle = ref('');
const pathName = ref('');
const pathId = ref('');
const session = ref<{ sessionId: string; revision: number } | null>(null);
const initing = ref(true);
const initError = ref('');
const typing = ref(false);
/** 菜单危险动作（结束/重新开始）in-flight 防重 */
const actionBusy = ref(false);
const menuOpen = ref(false);

const friendlyError = computed(() => {
  const raw = initError.value || '';
  if (/429|Insufficient|insufficient|余额|额度|quota/i.test(raw)) {
    return 'AI 服务额度暂时不足，恢复后再试。你的任务和进度都还在，也可以先去别的页面看看。';
  }
  if (/not found|不存在|404/i.test(raw)) {
    return '没有找到这个学习任务，它可能已被删除或重建。';
  }
  return raw || '开课失败，请重试。';
});

interface ChatMsg { role: 'ai' | 'user'; text: string; time: string; failed?: boolean; confusion?: string[]; id?: string }
const msgs = ref<ChatMsg[]>([]);
let msgSeq = 0;
function pushMsg(m: ChatMsg): ChatMsg {
  const withId: ChatMsg = { ...m, id: m.id ?? `lm_${Date.now().toString(36)}_${++msgSeq}` };
  msgs.value.push(withId);
  return withId;
}
const quickReplies = ref<string[]>([]);
/** 开场景卡片（后端 session.scene）：resumed/new 的恢复·接续·重学·复习信息，取代模板双气泡 */
const openingScene = ref<Record<string, any> | null>(null);
/** 卡片已被用户处理（点主按钮/关闭）后不再展示 */
const openingSceneDone = ref(false);
const knowledgePoints = ref<Array<Record<string, any>>>([]);
/**
 * 「快选确认」出现条件：AI 本轮抛出了需要学习者表态的确认点（当前知识点的掌握边界）
 * - 有 checkpoint 客观验证时不出（避免与验证题重复）
 * - 当前点已 mastered 或没有 learning/pending 的点时不出（无需表态）
 * - 开场建议 / 输入中 / 完成态 / 检查点态都不出
 */
const assessTarget = ref<{ name: string } | null>(null); // 待确认知识点名（本轮 AI 讲完的点）
/** teaching-turn 输出的动态确认动作组（讲完一个点让学生表态）；未输出则回退固定双按钮 */
const confirmCheck = ref<{ prompt: string; actions: Array<{ label: string; message: string }> } | null>(null);
const shouldAskSelfAssess = computed(() => {
  // 动态确认动作组（teaching-turn 明确输出 confirmCheck）→ 显示；
  // 模型未输出则视为本轮不需要表态（新版 prompt 已由 AI 自主决定），不再弹固定按钮，
  // 避免"问环境/给操作指令"这类轮次也弹"掌握了/再讲一遍"的过触发。
  if (typing.value || completed.value || checkpoint.value || quickReplies.value.length) return false;
  return !!confirmCheck.value;
});

const checkpoint = ref<Record<string, any> | null>(null);
const selectedOptions = ref<string[]>([]);
const answerText = ref('');
const checkpointFeedback = ref('');
const checkpointPassed = ref(false);
/** 检查点提交 in-flight：与导师流式（typing）分离，避免「停止生成」按钮误显、结算等待遗漏 */
const checkpointPending = ref(false);
/** 检查点通过后的展示窗口内锁：防止 1.6s 内重复提交同一检查点 */
const checkpointSubmitting = ref(false);

const completed = ref(false);
/** 恢复会话提示条：mode=resumed 且回填到历史时显示「已恢复上次进度」，附重新开始出口 */
const resumedNotice = ref(false);

/* ---------- 开场景卡片（resumed / continuation / relearn / review） ---------- */
const SCENE_META: Record<string, { tag: string; primary: string }> = {
  resume: { tag: '继续上课', primary: '从这继续' },
  continuation: { tag: '接着学', primary: '开始本节' },
  relearn: { tag: '重新学', primary: '重新开始本节' },
  review: { tag: '今日复习', primary: '开始复习' },
  first: { tag: '开始上课', primary: '开始' },
};
const sceneTag = computed(() => SCENE_META[openingScene.value?.kind]?.tag || '开始上课');
const scenePrimaryText = computed(() => SCENE_META[openingScene.value?.kind]?.primary || '开始');
const sceneDefaultTitle = computed(() => {
  const k = openingScene.value?.kind;
  if (k === 'resume') return '继续这节课，从上次离开的地方接着学';
  if (k === 'continuation') return '接着上一课往下学';
  if (k === 'relearn') return '重新学这一课，把上次没掌握的补上';
  if (k === 'review') return '今日复习：回捞快忘的知识点';
  return '开始这节课';
});
/** 副文案：依据 kind 给一句人话引导 */
const sceneLead = computed(() => {
  const sc = openingScene.value;
  if (!sc) return '';
  const k = sc.kind;
  if (k === 'resume') return '你的进度还在，接着上次的内容继续，不用从头开始。';
  if (k === 'continuation') {
    const rel = sc.recap?.relation;
    if (rel === 'prev-milestone') return `上节课在「${sc.recap?.sourceTitle || '上一阶段'}」结束，这节课是它的下一步。`;
    return '上一课刚结束，这节课接着往下推进。';
  }
  if (k === 'relearn') return sc.attempt && sc.attempt > 1 ? `这是你第 ${sc.attempt} 次学这节课，重点补上次没掌握的。` : '从头再学一遍这节课。';
  if (k === 'review') return '把快到遗忘点的知识先捞回来，再继续新内容。';
  return '';
});
const sceneUnresolved = computed<string[]>(() => {
  const r = openingScene.value?.recap;
  return Array.isArray(r?.unresolved) ? (r.unresolved as string[]).slice(0, 3) : [];
});
/** 前序掌握较弱的阶段提醒（at-risk / partial） */
const sceneMasteryWarn = computed(() => {
  const list: Array<{ stage: number; title: string; state: string }> = openingScene.value?.mastery || [];
  const weak = list.filter((m) => m.state === 'at-risk' || m.state === 'partial').slice(0, 2);
  if (!weak.length) return '';
  return weak.map((m) => `第 ${m.stage} 阶段「${m.title}」还不太稳`).join('；');
});

/** 卡片主按钮：把用户"从这继续/开始"作为一条消息发给导师，触发教学回合 */
function startFromScene() {
  if (typing.value || actionBusy.value || !session.value) return;
  const quick = quickReplies.value[0];
  const sendText = quick || (openingScene.value?.kind === 'review' ? '开始复习' : '继续上次进度');
  openingSceneDone.value = true;
  resumedNotice.value = false;
  void sendDirect(sendText);
}
const wrapupText = ref('');
const finishStats = ref<Array<{ label: string; value: string | number }>>([]);
const evaluationUrl = ref('');

const input = ref('');
const scrollEl = ref<HTMLElement | null>(null);

/* ---------- 伴学浮窗（角色「小启」，dock 式不占主对话区） ---------- */
interface PeerChatItem {
  role: 'peer' | 'me';
  text: string;
  time: string;
  /** 伴学策略（英文枚举），展示为学法标签；主动消息/失败兜底为 null */
  strategy?: string | null;
  /** 小启消息自带的后续追问快选（skill followUpQuestions） */
  followUps?: string[];
}
const peerOpen = ref(false);
const peerUnread = ref(false);
/** 伴学窗打开来源：'trigger'（AI 侦测卡点自动推）| 'user'（用户点 FAB 主动开聊）
    驱动头部状态行文案（不再固定死「看到你卡了一下」） */
const peerEntry = ref<'trigger' | 'user'>('user');
/** 触发频控：相邻触发的冷却窗口（ms），防止每轮对话都强制弹窗打扰 */
const PEER_TRIGGER_COOLDOWN = 60_000;
/** 距上次自动展开的时间戳：冷却期内仅累计未读红点，不强制展开 */
let lastPeerAutoOpen = 0;
/** 用户手动收起过：本轮会话内不再自动展开（尊重用户意图，仅红点提示） */
let peerManuallyMinimized = false;
const peerItems = ref<PeerChatItem[]>([]);
const peerInput = ref('');
const peerSending = ref(false);
const peerScrollEl = ref<HTMLElement | null>(null);

/** 伴学策略 → 学法标签（与 peer-reinforcement skill 枚举对齐） */
const PEER_STRATEGY_LABEL: Record<string, string> = {
  feynman: '费曼讲解',
  debate: '观点辩论',
  counterexample: '反例挑战',
  analogy: '类比迁移',
  'error-analysis': '错因复盘',
};
/** 最近一条小启消息的策略：头部状态行展示「正在用 XX 陪你练」 */
const peerLastStrategy = ref<string | null>(null);

/** 头部状态行文案：随打开来源 + 最近策略动态变化 */
const peerHeadline = computed(() => {
  const base = peerEntry.value === 'trigger'
    ? '看到你在这里卡了一下，来搭把手'
    : '随时找我聊卡点，陪你理一理';
  const s = peerLastStrategy.value ? PEER_STRATEGY_LABEL[peerLastStrategy.value] : null;
  return s ? `${base} · ${s}` : base;
});

function strategyLabelOf(p: PeerChatItem) {
  return p.strategy ? PEER_STRATEGY_LABEL[p.strategy] || null : null;
}

async function scrollPeerDown() {
  await nextTick();
  if (peerScrollEl.value) peerScrollEl.value.scrollTop = peerScrollEl.value.scrollHeight;
}

function openPeer() {
  peerOpen.value = true;
  peerUnread.value = false;
  scrollPeerDown();
}

/** 用户主动点 FAB 开聊：来源标记为 user，清掉旧的「自动触发」状态文案 */
function openPeerByUser() {
  peerEntry.value = 'user';
  openPeer();
}

/** AI 侦测卡点自动推消息并展开（受频控与「手动收起过」约束） */
function openPeerByTrigger() {
  peerEntry.value = 'trigger';
  peerUnread.value = true;
  const now = Date.now();
  const inCooldown = now - lastPeerAutoOpen < PEER_TRIGGER_COOLDOWN;
  if (!inCooldown && !peerManuallyMinimized) {
    peerOpen.value = true;
    lastPeerAutoOpen = now;
    scrollPeerDown();
  }
}

/** 用户手动收起：本轮会话内不再自动展开（仅红点），避免「收起又被弹开」的打扰循环；
    收起视为已读（红点清除，用户已看到内容） */
function minimizePeer() {
  peerOpen.value = false;
  peerUnread.value = false;
  peerManuallyMinimized = true;
}

/** 记录伴学消息并更新「最近策略」（驱动头部状态行）；新回合消息则清除入口标记 */
function pushPeerItem(item: PeerChatItem) {
  peerItems.value.push(item);
  if (item.role === 'peer') {
    if (item.strategy) peerLastStrategy.value = item.strategy;
  } else {
    // 用户发言后，下一条小启回复前保持「正在陪你聊」
    peerLastStrategy.value = null;
    peerEntry.value = 'user';
  }
}

async function sendPeerCore(text: string) {
  if (peerSending.value || !session.value) return;
  peerInput.value = '';
  pushPeerItem({ role: 'me', text, time: nowTime() });
  scrollPeerDown();
  peerSending.value = true;
  // peer skill 为 JSON 输出（无 delta）：等待期间仅显示 typing 指示器，final 后一次性上屏
  try {
    let r: Record<string, any>;
    try {
      peerStreamAbort = new AbortController();
      r = await aiTeachingAPI.streamSendPeerMessage(session.value.sessionId, text, { signal: peerStreamAbort.signal }) as unknown as Record<string, any>;
    } catch (peerError) {
      // 传输层失败且未收到任何内容：回退非流式重发；业务失败交给外层报错；
      // 用户离页触发的 abort 不重发
      const pe = peerError as { cancelled?: boolean; transport?: boolean };
      if (pe.cancelled) throw peerError;
      if (!pe.transport) throw peerError;
      r = await aiTeachingAPI.sendPeerMessage(session.value.sessionId, text) as unknown as Record<string, any>;
    } finally {
      peerStreamAbort = null;
    }
    if (r?.peerResponse) {
      pushPeerItem({
        role: 'peer',
        text: String(r.peerResponse),
        time: nowTime(),
        strategy: r.peerStrategy || null,
        followUps: Array.isArray(r.peerFollowUpQuestions)
          ? r.peerFollowUpQuestions.filter((q: unknown) => typeof q === 'string' && q.trim()).slice(0, 3)
          : [],
      });
    }
  } catch (e) {
    // 离页中止：静默丢弃
    if ((e as { cancelled?: boolean })?.cancelled) return;
    pushPeerItem({ role: 'peer', text: '这次没接上，等下再跟我说一句试试。', time: nowTime() });
  } finally {
    peerSending.value = false;
    scrollPeerDown();
  }
}

async function sendPeer(e?: unknown) {
  // IME 组合期守卫：拼音选词回车不发送
  const ke = e as KeyboardEvent | undefined;
  if (ke && (ke.isComposing || ke.keyCode === 229)) return;
  const t = peerInput.value.trim();
  if (!t) return;
  await sendPeerCore(t);
}

/** 点击小启给的追问快选：直接发送该追问 */
async function sendPeerDirect(text: string) {
  const t = String(text || '').trim();
  if (!t || peerSending.value || !session.value) return;
  await sendPeerCore(t);
}

const formatMessage = (text: string) => plainMessageHtml(text);

/* 流式渲染记忆化：v-html 直接调函数会在每个 delta 触发全列表重渲染 + 全部历史消息重跑
   markdown/DOMPurify（50 条消息 × 每秒数十 delta 开销显著）。
   共享工具按消息对象缓存渲染结果，仅文本变化时惰性重算 */
const htmlFor = (m: { text: string }) => cachedMessageHtml(m);

function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* 贴底跟随：用户上翻看旧内容时暂停自动滚动（避免被持续拽回底部），
   并在滚动到底部时清除「回到底部」浮标 */
const nearBottom = ref(true);
function updateNearBottom() {
  const el = scrollEl.value;
  if (!el) return;
  nearBottom.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 48;
}

async function scrollDown() {
  await nextTick();
  if (scrollEl.value) {
    scrollEl.value.scrollTop = scrollEl.value.scrollHeight;
    nearBottom.value = true;
  }
}

function jumpToBottom() {
  scrollDown();
}

/* ---------- 启动 ---------- */
async function boot() {
  initing.value = true;
  initError.value = '';
  resumedNotice.value = false;
  assessTarget.value = null;
  confirmCheck.value = null;
  try {
    try {
      const task = unwrap<Record<string, any>>(await request.get(`/learning/tasks/${taskId}`));
      taskTitle.value = task?.title || task?.displayLabel || '';
      pathName.value = task?.pathTitle || task?.learningPathTitle || task?.learningPath?.title || '';
      pathId.value = task?.learningPathId || task?.pathId || task?.learningPath?.id || '';
    } catch { /* 任务信息拿不到也能上课 */ }

    const s = (isReviewMode.value
      ? await aiTeachingAPI.startReviewSession(taskId)
      : await aiTeachingAPI.startSession(taskId)) as unknown as Record<string, any>;
    session.value = { sessionId: s.sessionId, revision: s.revision ?? 0 };
    // 开场景卡片数据（scene 驱动；resume/复习/重学/接续的结构化开场）
    const sceneRaw = s?.scene && typeof s.scene === 'object' ? s.scene : null;
    // 首课（first）不需要卡片：AI 真实开场白已足够，避免双重介绍
    openingScene.value = sceneRaw && sceneRaw.kind !== 'first' ? sceneRaw : null;
    openingSceneDone.value = !openingScene.value;
    const openingText = s.opening?.message || s.welcomeMessage;
    if (s.mode === 'resumed') {
      // 恢复：不再 push 模板双气泡（"已恢复…我们继续"），由场景卡片承接；
      // 快选也由卡片主按钮承担，避免「卡片按钮 + 底部开场建议」两处重复
      quickReplies.value = [];
    } else {
      // 新开课（含接续/重学/首课）：保留 AI 的真实教学开场白（承接上节/切入本节）
      if (openingText) pushMsg({ role: 'ai', text: openingText, time: nowTime() });
      if (s.opening?.question) pushMsg({ role: 'ai', text: s.opening.question, time: nowTime() });
      quickReplies.value = (s.opening?.quickReplies || []).map((q: Record<string, any>) => q.text || q).filter(Boolean);
    }
    if (Array.isArray(s.knowledgePoints) && s.knowledgePoints.length) {
      knowledgePoints.value = s.knowledgePoints;
    }
    // 会话来源提示：恢复上次课堂 / 已学完重开（避免「从头开始」困惑）
    if (s.mode === 'resumed') {
      // 恢复上下文：回填历史对话与待处理检查点，避免刷新后课堂记忆断裂
      try {
        const detail = await aiTeachingAPI.getSessionDetail(s.sessionId);
        if (detail) {
          let restoredCount = 0;
          if (Array.isArray(detail.messages)) {
            // 主对话历史（user/assistant 非 peer 标记）
            const restored = detail.messages
              .filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.peer)
              .map((m) => pushMsg({
                role: m.role === 'user' ? 'user' : 'ai',
                text: String(m.content || ''),
                time: nowTime(),
              }));
            restoredCount = restored.length;
            if (restored.length) scrollDown();
            // 伴学历史回填进小启浮窗（刷新后不丢失）：
            // ① 主动伴学 = peer 标记消息；② 自动触发伴学 = assistant 消息内嵌的 peerMessage
            const peerRestored: Array<{ role: 'me' | 'peer'; text: string; strategy: string | null }> = [];
            for (const m of detail.messages) {
              if (m.peer) {
                peerRestored.push({
                  role: m.role === 'user' ? 'me' : 'peer',
                  text: String(m.content || ''),
                  strategy: m.role === 'assistant' ? m.peerStrategy || null : null,
                });
              } else if (m.role === 'assistant' && m.peerTriggered && m.peerMessage) {
                peerRestored.push({
                  role: 'peer',
                  text: String(m.peerMessage),
                  strategy: m.peerStrategy || null,
                });
              }
            }
            if (peerRestored.length) {
              peerItems.value = peerRestored.map((m) => ({
                ...m,
                time: nowTime(),
                followUps: [],
              }));
              // 恢复入口标记为 trigger（历史里可能含自动伴学）
              peerEntry.value = 'trigger';
              // 回填最近策略（驱动头部「正在用 XX 陪你练」）
              const lastPeerStrategy = [...peerRestored].reverse().find((m) => m.role === 'peer' && m.strategy)?.strategy;
              peerLastStrategy.value = lastPeerStrategy || null;
            }
          }
          // 有可续历史才显示恢复横幅（附「重新开始」出口）；全新无历史则不必打扰。
          // 有开场景卡片时横幅让位给卡片（卡片已含恢复信息与重新开始出口），避免重复提示
          resumedNotice.value = restoredCount > 0 && !openingScene.value;
          if (detail.pendingCheckpoint) {
            checkpoint.value = detail.pendingCheckpoint;
            checkpointFeedback.value = '';
            selectedOptions.value = [];
            answerText.value = '';
            checkpointSubmitting.value = false;
          }
          if (Array.isArray(detail.knowledgePoints) && detail.knowledgePoints.length) {
            knowledgePoints.value = detail.knowledgePoints;
          }
          session.value.revision = typeof detail.revision === 'number' ? detail.revision : session.value.revision;
        }
      } catch { /* 历史回填失败不阻断上课 */ }
    } else if (s.mode === 'new') {
      aiTeachingAPI.getLatestTaskEvaluation(taskId)
        .then((latest) => {
          if (latest?.sessionId) toast.info('本课已学过，本次将重新开始');
        })
        .catch(() => {});
    }
    initing.value = false;
  } catch (e: any) {
    initError.value = e?.message || e?.response?.data?.error?.message || '开课失败，请重试';
    initing.value = false;
  }
}

/* ---------- 对话 ---------- */
let lastUserText = '';
/** 流式发送中的 AbortController：离页/卸载时中止，触发后端 res close 止损上游生成 */
let streamAbort: AbortController | null = null;
/** 伴学窗流式发送的独立 AbortController（与主对话互不干扰） */
let peerStreamAbort: AbortController | null = null;
/** 检查点通过后的自动关闭 timer（提交/卸载时清理，防竞态） */
let checkpointCloseTimer = 0;
/**
 * 流式内容气泡下标（-1 = 尚无气泡）：
 * teaching-turn 为 JSON 输出无 delta，期间仅显示 typing 指示器；首个 delta 到达时才建气泡，
 * 避免「空气泡 + typing 指示器」双气泡。
 */
const streamingBubbleIndex = ref(-1);

/* ---------- 消息操作 ---------- */
const hoveredMsgId = ref<string | null>(null);

function onBubbleEnter(id: string) { hoveredMsgId.value = id; }
function onBubbleLeave() { hoveredMsgId.value = null; }

async function copyMessage(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('已复制到剪贴板');
  } catch { toast.error('复制失败'); }
}

/** 消息级点赞/点踩上报：内容去重（后端按内容哈希 key），失败静默不打扰 */
async function sendMessageFeedback(m: ChatMsg, thumbsUp: boolean) {
  if (!session.value || !m.text) return;
  try {
    await feedbackApi.submitMessage({
      sessionId: session.value.sessionId,
      messageText: m.text,
      thumbsUp
    });
  } catch {
    /* 反馈失败不影响对话，静默 */
  }
}

/* ---------- 用户消息内联编辑（ChatGPT/Claude 标准能力） ----------
   仅允许编辑「最后一条用户消息」：编辑后替换文本 + 裁掉其后所有消息 + 重新发送。
   后端 teaching 会话为顺序追加，重发即新回合，无需后端改动。 */
const editingMsgId = ref<string | null>(null);
const editingText = ref('');

/** 可编辑条件：最后一条用户消息（且不在流式/结算中） */
function canEditMessage(m: ChatMsg): boolean {
  if (typing.value || completed.value || editingMsgId.value) return false;
  const lastUserIdx = msgs.value.map((x) => x.role).lastIndexOf('user');
  return lastUserIdx >= 0 && msgs.value[lastUserIdx] === m;
}

function startEdit(m: ChatMsg) {
  editingMsgId.value = m.id ?? null;
  editingText.value = m.text;
}

function cancelEdit() {
  editingMsgId.value = null;
  editingText.value = '';
}

/** 保存编辑：替换文本 → 裁掉其后所有消息 → 重新发送 */
async function saveEdit(m: ChatMsg) {
  const t = editingText.value.trim();
  if (!t || !session.value) { cancelEdit(); return; }
  if (t === m.text) { cancelEdit(); return; }
  const idx = msgs.value.indexOf(m);
  if (idx < 0) { cancelEdit(); return; }
  // 替换本条 + 裁掉其后（含 AI 回复）
  msgs.value.splice(idx, msgs.value.length - idx, { ...m, text: t });
  editingMsgId.value = null;
  editingText.value = '';
  // 重新发送（不重复 push 用户消息，消息已替换）
  await doSend(t, true, true);
}

async function regenerateMessage(m: ChatMsg) {
  if (typing.value || !session.value) return;
  // Find the user message preceding this AI message
  const idx = msgs.value.indexOf(m);
  let lastUser = '';
  for (let i = idx - 1; i >= 0; i--) {
    if (msgs.value[i].role === 'user') { lastUser = msgs.value[i].text; break; }
  }
  if (!lastUser) { toast.info('找不到对应的问题'); return; }
  // Remove the current AI message and re-send（不重复 push 用户消息）
  msgs.value.splice(idx, 1);
  await doSend(lastUser, true, true);
}

function stopGeneration() {
  streamAbort?.abort();
  streamAbort = null;
}

async function send(e?: unknown) {
  // IME 组合期守卫：拼音选词回车不发送
  const ke = e as KeyboardEvent | undefined;
  if (ke && (ke.isComposing || ke.keyCode === 229)) return;
  const t = input.value.trim();
  if (!t || typing.value || checkpointPending.value || !session.value) return;
  input.value = '';
  assessTarget.value = null; // 用户已表态/新回合开始，快选确认清除
  confirmCheck.value = null;
  await doSend(t);
}

async function sendDirect(text: string) {
  if (typing.value || !session.value) return;
  assessTarget.value = null; // 点击快选确认/开场建议即表态，清除待确认
  await doSend(text);
}

/** 开场行动台标题：跟随进入方式，避免每次都是冷冰冰的「开场建议」 */
const quickReplyKicker = computed(() => {
  const k = openingScene.value?.kind;
  if (k === 'review') return '复习方式';
  if (k === 'relearn') return '这次怎么学';
  if (k === 'continuation') return '接着怎么学';
  if (k === 'resume') return '从哪继续';
  return '怎么开始';
});

async function doSend(text: string, allowStaleRetry = true, skipUserPush = false) {
  if (!session.value) return;
  lastUserText = text;
  if (!skipUserPush) pushMsg({ role: 'user', text, time: nowTime() });
  quickReplies.value = [];
  confirmCheck.value = null;
  assessTarget.value = null;
  typing.value = true;
  scrollDown();
  const meta = interactionMeta.collect(text);
  try {
    let r: Record<string, any>;
    try {
      streamAbort = new AbortController();
      r = await aiTeachingAPI.streamSendMessage(session.value.sessionId, text, session.value.revision, {
        signal: streamAbort.signal,
        onDelta: (delta) => {
          // 首个 delta 到达时才建 AI 气泡，避免 JSON 输出（无 delta）产生空气泡
          let m = streamingBubbleIndex.value >= 0 ? msgs.value[streamingBubbleIndex.value] : undefined;
          if (!m || m.role !== 'ai') {
            pushMsg({ role: 'ai', text: '', time: nowTime() });
            streamingBubbleIndex.value = msgs.value.length - 1;
            m = msgs.value[streamingBubbleIndex.value];
          }
          if (m) {
            m.text += delta;
            // 仅贴底时自动跟随（用户上翻看旧内容时不打断）
            if (nearBottom.value) void scrollDown();
          }
        },
        onRestart: () => {
          const m = streamingBubbleIndex.value >= 0 ? msgs.value[streamingBubbleIndex.value] : undefined;
          if (m?.role === 'ai') m.text = '';
        },
      }, meta) as unknown as Record<string, any>;
    } catch (streamError) {
      // 用户离页触发的 abort：不重发、不当作失败
      if ((streamError as { cancelled?: boolean })?.cancelled) throw streamError;
      // 传输层失败且未收到任何内容：安全回退非流式重发；业务失败或已收到部分内容则交给外层报错
      if (!(streamError as { transport?: boolean })?.transport) throw streamError;
      if (streamingBubbleIndex.value >= 0) msgs.value.splice(streamingBubbleIndex.value, 1);
      streamingBubbleIndex.value = -1;
      r = await aiTeachingAPI.sendMessage(session.value.sessionId, text, session.value.revision, meta) as unknown as Record<string, any>;
    } finally {
      streamAbort = null;
    }
    session.value.revision = r.revision ?? session.value.revision + 1;
    interactionMeta.markAssistantLanded();
    // 导师回复（附带本轮捕获到的卡点，作为气泡下方的依据 chip）
    const confusion = Array.isArray(r.analysis?.confusionPoints)
      ? r.analysis.confusionPoints.map((p: unknown) => String(p || '').trim()).filter(Boolean).slice(0, 2)
      : [];
    const aiMsg = streamingBubbleIndex.value >= 0 ? msgs.value[streamingBubbleIndex.value] : undefined;
    if (aiMsg?.role === 'ai') {
      aiMsg.text = r.aiResponse || aiMsg.text;
      aiMsg.confusion = confusion;
    } else if (r.aiResponse) {
      pushMsg({ role: 'ai', text: r.aiResponse, time: nowTime(), confusion });
    }
    // 兜底：AI 全程未返回任何内容（空响应）时给占位气泡，避免本轮「无声消失」
    if (!r.aiResponse && (!aiMsg || !aiMsg.text.trim())) {
      if (aiMsg?.role === 'ai') {
        aiMsg.text = '（本轮没有收到回复，你可以换个说法再试一次。）';
      } else {
        pushMsg({ role: 'ai', text: '（本轮没有收到回复，你可以换个说法再试一次。）', time: nowTime() });
      }
    }
    // 伴学触发：进独立浮动窗，不占主对话区（角色小启，暖橙系）。
    // 频控：冷却期（60s）内或用户手动收起过 → 仅累计未读红点，不强制展开，避免打扰循环
    if (r.peerTriggered && r.peerMessage) {
      pushPeerItem({
        role: 'peer',
        text: String(r.peerMessage),
        time: nowTime(),
        strategy: r.peerStrategy || null,
        followUps: Array.isArray(r.peerFollowUpQuestions)
          ? r.peerFollowUpQuestions.filter((q: unknown) => typeof q === 'string' && q.trim()).slice(0, 3)
          : [],
      });
      openPeerByTrigger();
    }
    if (Array.isArray(r.knowledgePoints) && r.knowledgePoints.length) {
      knowledgePoints.value = r.knowledgePoints;
      // AI 本轮讲完后：若指向某个当前点且没有客观 checkpoint，则在该点形成待确认边界
      assessTarget.value = !r.checkpoint && r.knowledgePoint
        ? { name: String(r.knowledgePoint) }
        : null;
      // 动态确认动作组（teaching-turn 输出）优先；未输出则回退固定文案
      const cc = r.confirmCheck;
      confirmCheck.value = (cc && Array.isArray(cc.actions) && cc.actions.length === 2)
        ? {
            prompt: String(cc.prompt || '').trim(),
            actions: cc.actions
              .filter((a: any) => a && typeof a.label === 'string' && typeof a.message === 'string')
              .map((a: any) => ({ label: a.label, message: a.message })),
          }
        : null;
    } else {
      assessTarget.value = null;
      confirmCheck.value = null;
    }
    if (r.checkpoint) {
      checkpoint.value = r.checkpoint;
      checkpointFeedback.value = '';
      selectedOptions.value = [];
      answerText.value = '';
      checkpointSubmitting.value = false;
      assessTarget.value = null; // 有客观验证题，不再弹快选确认
      confirmCheck.value = null;
    }
    if (r.isCompletion) {
      await finish(isReviewMode.value ? 'complete_review' : 'complete_task');
    }
  } catch (e) {
    // 离页中止：静默丢弃，不重发也不展示失败气泡
    if ((e as { cancelled?: boolean })?.cancelled) return;
    // 流式气泡可能已有部分内容：移除后展示统一失败气泡
    if (streamingBubbleIndex.value >= 0) msgs.value.splice(streamingBubbleIndex.value, 1);
    // 陈旧 revision（多标签页/刷新竞态）：同步最新 revision 后重发一次，避免重试死循环
    const raw = e as any;
    const staleCode = raw?.response?.data?.error?.code || raw?.response?.data?.error || raw?.code || '';
    if (String(staleCode).includes('TEACHING_SESSION_STALE') && session.value && allowStaleRetry) {
      try {
        const fresh = (isReviewMode.value
          ? await aiTeachingAPI.startReviewSession(taskId)
          : await aiTeachingAPI.startSession(taskId)) as unknown as Record<string, any>;
        if (typeof fresh?.revision === 'number') session.value.revision = fresh.revision;
      } catch { /* 同步失败则直接展示失败气泡 */ }
      await doSend(text, false);
      return;
    }
    pushMsg({ role: 'ai', text: '这次回复失败了，点下方「重试」。', time: nowTime(), failed: true });
  } finally {
    streamingBubbleIndex.value = -1;
    typing.value = false;
    scrollDown();
  }
}

async function retryLast() {
  msgs.value = msgs.value.filter((m) => !m.failed);
  if (lastUserText) await doSend(lastUserText);
}

/* ---------- 检查点 ---------- */
function toggleOption(id: string) {
  if (!checkpoint.value) return;
  if (checkpoint.value.type === 'multi_choice') {
    const i = selectedOptions.value.indexOf(id);
    if (i >= 0) selectedOptions.value.splice(i, 1);
    else selectedOptions.value.push(id);
  } else {
    selectedOptions.value = [id];
  }
}

async function submitCheckpoint() {
  if (!checkpoint.value || !session.value || typing.value || checkpointSubmitting.value) return;
  // 空值校验：空选项/空简答直接提示，不消耗一轮 AI 判定
  if (checkpoint.value.options?.length && !selectedOptions.value.length) {
    checkpointFeedback.value = '请先选择一个选项';
    return;
  }
  if (!checkpoint.value.options?.length && !answerText.value.trim()) {
    checkpointFeedback.value = '请先写下你的回答';
    return;
  }
  const payload: Record<string, any> = {};
  if (checkpoint.value.options?.length) payload.selectedOptionIds = selectedOptions.value;
  else payload.answerText = answerText.value;
  checkpointPending.value = true;
  try {
    const r = await aiTeachingAPI.submitCheckpoint(session.value.sessionId, checkpoint.value.id, payload, session.value.revision) as unknown as Record<string, any>;
    session.value.revision = r.revision ?? session.value.revision + 1;
    checkpointPassed.value = r.passed === true;
    checkpointFeedback.value = r.feedback || (r.passed ? '回答正确' : r.hint || '再想想');
    if (r.passed || r.nextAction === 'continue') {
      // 通过后立即锁住本次检查点（3s 展示窗口内不可重复提交）；
      // 延长自 1.6s：反馈需要时间阅读，避免「刚看到答对了就消失」
      checkpointSubmitting.value = true;
      // 记录 timer 并在下次提交/卸载时清理，避免前一次 timeout 清掉新反馈
      window.clearTimeout(checkpointCloseTimer);
      checkpointCloseTimer = window.setTimeout(() => {
        checkpoint.value = null;
        checkpointFeedback.value = '';
        checkpointSubmitting.value = false;
      }, 3000);
    }
  } catch {
    checkpointFeedback.value = '提交失败，再试一次';
  } finally {
    checkpointPending.value = false;
  }
}

async function skipCheckpoint() {
  if (!checkpoint.value || !session.value || typing.value || checkpointPending.value || checkpointSubmitting.value) return;
  const cp = checkpoint.value;
  checkpoint.value = null;
  checkpointPending.value = true;
  try {
    const r = await aiTeachingAPI.submitCheckpoint(session.value.sessionId, cp.id, { skip: true }, session.value.revision) as unknown as Record<string, any>;
    session.value.revision = typeof r?.revision === 'number' ? r.revision : session.value.revision + 1;
  } catch (e: any) {
    toast.error(e?.message || e?.response?.data?.error?.message || '跳过检查点失败');
    // 失败恢复检查点，允许用户重试或改作答
    checkpoint.value = cp;
  } finally {
    checkpointPending.value = false;
  }
}

/* ---------- 结束 ---------- */
async function finish(action: 'complete_task' | 'end_only' | 'complete_review') {
  if (!session.value || completed.value) return;
  try {
    const r = await aiTeachingAPI.finalizeSessionReliably(session.value.sessionId, {
      action,
      revision: session.value.revision,
      // 三种 action 的收尾原因统一为 manual-end（task-completed 由后端 task 完成事件单独判定）
      reason: 'manual-end'
    }) as unknown as Record<string, any>;
    completed.value = true;
    const wrapup = r.wrapup;
    // 收尾寄语兜底链：topicSummary → learningEvaluation → practiceAdvice → knowledgeSummary，
    // 最后才落「这次学习已经记录。」（避免 wrapup 缺字段时干巴巴收尾）
    wrapupText.value =
      wrapup?.summary?.topicSummary ||
      wrapup?.summary?.learningEvaluation ||
      wrapup?.summary?.practiceAdvice ||
      wrapup?.summary?.knowledgeSummary ||
      '';
    const stats: Array<{ label: string; value: string | number }> = [];
    if (wrapup?.progress?.newlyMastered?.length) stats.push({ label: '新掌握知识点', value: wrapup.progress.newlyMastered.length });
    if (wrapup?.evaluation?.duration) stats.push({ label: '分钟', value: Math.round(wrapup.evaluation.duration) });
    if (wrapup?.evaluation?.messageCount) stats.push({ label: '次对话', value: wrapup.evaluation.messageCount });
    finishStats.value = stats;
    evaluationUrl.value = `/learn/${taskId}/evaluation/${session.value.sessionId}${pathId.value ? `?pathId=${encodeURIComponent(pathId.value)}` : ''}`;
  } catch (e: any) {
    // 结算失败不冒充完成：保留重试入口，用户仍可去学习反馈页查看
    const msg = e?.message || e?.response?.data?.error?.message || '结算失败';
    toast.error(`课堂收束未完成：${msg}`);
    evaluationUrl.value = `/learn/${taskId}/evaluation/${session.value.sessionId}${pathId.value ? `?pathId=${encodeURIComponent(pathId.value)}` : ''}`;
    // 会话可能已收束但轮询异常：提供进入反馈页的途径（完成浮层不弹，直接弹全局确认引导，
    // 不再用 setTimeout（此前 timer 未在卸载清理，路由离开后弹窗会出现在下一个页面上））
    if (session.value) {
      const go = await askConfirm({
        title: '收束未完成',
        message: '课堂收束遇到问题。你可以稍后重试，或直接查看学习反馈（反馈可能仍在生成中）。',
        confirmText: '查看学习反馈',
        danger: false,
      });
      if (go && evaluationUrl.value) router.push(evaluationUrl.value);
    }
  }
}

/** 完成并结算（拍板 2026-08-21 方案 B 主路径）：计入任务/里程碑/路径完成进度 */
async function completeAndSettle() {
  menuOpen.value = false;
  if (actionBusy.value) return;
  const ok = await askConfirm({
    title: '完成并结算任务',
    message: '确认当前任务已学完？将结算任务并计入里程碑与路径进度，同时生成本次学习总结。',
    confirmText: '完成并结算',
    danger: false,
  });
  if (!ok) return;
  actionBusy.value = true;
  try {
    // 流式回复或检查点判定 in-flight：先中止在途请求并等待收尾，避免「完成浮层已弹但会话实际未结束」的假完成
    if (typing.value || checkpointPending.value) {
      streamAbort?.abort();
      streamAbort = null;
      for (let i = 0; i < 20 && (typing.value || checkpointPending.value); i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    await finish('complete_task');
  } finally {
    actionBusy.value = false;
  }
}

async function endSession() {
  menuOpen.value = false;
  if (actionBusy.value) return;
  const ok = await askConfirm({
    title: '结束学习（不计入完成）',
    message: '结束本次学习？将生成本次学习总结，但当前任务不会计入完成进度（里程碑/路径进度不动）。',
    confirmText: '结束学习',
    danger: false,
  });
  if (!ok) return;
  actionBusy.value = true;
  try {
    // 流式回复或检查点判定 in-flight：先中止在途请求并等待收尾，避免「完成浮层已弹但会话实际未结束」的假完成
    if (typing.value || checkpointPending.value) {
      streamAbort?.abort();
      streamAbort = null;
      for (let i = 0; i < 20 && (typing.value || checkpointPending.value); i++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    await finish('end_only');
  } finally {
    actionBusy.value = false;
  }
}

async function pauseAndLeave() {
  menuOpen.value = false;
  if (session.value) {
    try {
      const rev = await aiTeachingAPI.pauseSession(session.value.sessionId, 'manual', session.value.revision);
      if (typeof rev === 'number' && session.value) session.value.revision = rev;
    } catch { /* ignore */ }
  }
  goBack();
}

async function restart() {
  menuOpen.value = false;
  resumedNotice.value = false;
  openingSceneDone.value = true;
  assessTarget.value = null;
  confirmCheck.value = null;
  if (actionBusy.value) return;
  if (!session.value) return;
  const ok = await askConfirm({
    title: '重新开始',
    message: '重新开始将清空当前学习进度与消息记录，此操作不可恢复。',
    confirmText: '重新开始',
    danger: true,
  });
  if (!ok) return;
  actionBusy.value = true;
  try {
    // 流式生成中先中止，避免与 reset 竞态
    streamAbort?.abort();
    streamAbort = null;
    const rev = await aiTeachingAPI.resetSession(session.value.sessionId, session.value.revision);
    session.value.revision = typeof rev === 'number' ? rev : session.value.revision + 1;
    msgs.value = [];
    checkpoint.value = null;
    checkpointPending.value = false;
    completed.value = false;
    // 伴学窗同步重置（B7：上一会话内容不残留到新开课）
    peerItems.value = [];
    peerUnread.value = false;
    peerOpen.value = false;
    peerManuallyMinimized = false;
    lastPeerAutoOpen = 0;
    await boot();
  } catch (e: any) {
    toast.error(e?.message || e?.response?.data?.error?.message || '重新开始失败，请稍后重试');
  } finally {
    actionBusy.value = false;
  }
}

/* ---------- 知识点 ---------- */
function isMastered(kp: Record<string, any>) {
  return ['mastered', 'completed', 'done'].includes(String(kp.status || '').toLowerCase());
}
function isCurrent(kp: Record<string, any>) {
  return ['learning', 'in_progress', 'current', 'teaching'].includes(String(kp.status || '').toLowerCase());
}
function kpCls(kp: Record<string, any>) {
  return { 'kp__item--done': isMastered(kp), 'kp__item--current': isCurrent(kp) };
}
function kpStatusText(kp: Record<string, any>) {
  if (isMastered(kp)) return '已掌握';
  if (isCurrent(kp)) return '学习中';
  return '待学习';
}
const masteredCount = computed(() => knowledgePoints.value.filter(isMastered).length);

/* ---------- 导航 ---------- */
function goBack() {
  if (pathId.value) router.push(`/learning-path/${pathId.value}`);
  else router.push('/learning-paths');
}
function goEvaluation() {
  if (evaluationUrl.value) router.push(evaluationUrl.value);
}

/* 关闭标签页/整页刷新时 Vue 不会走 onBeforeUnmount，
   用 pagehide + sendBeacon 兜底记暂停，避免时长统计把闲置时间算进去。 */
function onPageHide() {
  streamAbort?.abort();
  peerStreamAbort?.abort();
  if (!session.value || completed.value) return;
  const payload = JSON.stringify({ reason: 'pagehide', revision: session.value.revision });
  const blob = new Blob([payload], { type: 'application/json' });
  navigator.sendBeacon?.(`${API_BASE_URL}/ai-teaching/sessions/${session.value.sessionId}/pause`, blob);
}

/* 切换标签页/窗口：隐藏时暂停、切回可见时恢复，学习时长只计页面激活时间。
   pause/resume 返回值（服务端 revision+1 后的新值）写回 session.value.revision，
   避免本地 revision 落后导致 resume/后续请求触发 TEACHING_SESSION_STALE 409 后会话永久卡死。
   操作串行化：先等 pause 落定并回写 revision，再发 resume，杜绝并发导致的 expectedRevision 冲突。 */
let lifecycleChain: Promise<void> = Promise.resolve();

/** resume 失败后的会话恢复：重新 startSession 拿新 revision（服务端会 resume 同一会话），
    无法恢复时明确提示刷新，绝不静默忽略。 */
async function recoverSession(sid: string) {
  const cur = session.value;
  if (!cur || cur.sessionId !== sid || completed.value) return;
  try {
    const s = (isReviewMode.value
      ? await aiTeachingAPI.startReviewSession(taskId)
      : await aiTeachingAPI.startSession(taskId)) as unknown as Record<string, any>;
    if (!session.value || session.value.sessionId !== sid) return;
    session.value = { sessionId: s.sessionId, revision: s.revision ?? 0 };
    if (s.mode === 'resumed') {
      // 同一会话在后端恢复：本地消息仍有效，仅同步新 revision 与知识点状态
      if (Array.isArray(s.knowledgePoints) && s.knowledgePoints.length) {
        knowledgePoints.value = s.knowledgePoints;
      }
      toast.info('已恢复课堂连接');
    } else {
      // 旧会话已失效、服务端重新开课：清空本地展示并按新开场白初始化
      msgs.value = [];
      checkpoint.value = null;
      checkpointFeedback.value = '';
      checkpointPending.value = false;
      completed.value = false;
      quickReplies.value = (s.opening?.quickReplies || []).map((q: Record<string, any>) => q.text || q).filter(Boolean);
      if (Array.isArray(s.knowledgePoints) && s.knowledgePoints.length) {
        knowledgePoints.value = s.knowledgePoints;
      }
      const openingText = s.opening?.message || s.welcomeMessage;
      if (openingText) msgs.value.push({ role: 'ai', text: openingText, time: nowTime() });
      if (s.opening?.question) msgs.value.push({ role: 'ai', text: s.opening.question, time: nowTime() });
      toast.info('已重新开课');
    }
  } catch {
    toast.error('课堂连接恢复失败，请刷新页面后继续');
  }
}

function onVisibilityChange() {
  if (!session.value || completed.value) return;
  const sid = session.value.sessionId;
  const hidden = document.hidden;
  lifecycleChain = lifecycleChain.then(async () => {
    const s = session.value;
    if (!s || s.sessionId !== sid || completed.value) return;
    try {
      if (hidden) {
        const rev = await aiTeachingAPI.pauseSession(sid, 'hidden', s.revision);
        if (typeof rev === 'number' && session.value?.sessionId === sid) session.value.revision = rev;
      } else {
        try {
          const rev = await aiTeachingAPI.resumeSession(sid, s.revision);
          if (typeof rev === 'number' && session.value?.sessionId === sid) session.value.revision = rev;
        } catch (resumeError) {
          await recoverSession(sid);
        }
      }
    } catch {
      // pause 失败不致命：会话仍可交互，下次 visible 时由 resume/恢复逻辑兜底
    }
  });
}

onMounted(() => {
  boot();
  narrowMq?.addEventListener('change', onNarrowChange);
  window.addEventListener('pagehide', onPageHide);
  document.addEventListener('visibilitychange', onVisibilityChange);
});
onBeforeUnmount(() => {
  narrowMq?.removeEventListener('change', onNarrowChange);
  streamAbort?.abort();
  peerStreamAbort?.abort();
  window.clearTimeout(checkpointCloseTimer);
  window.removeEventListener('pagehide', onPageHide);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  if (session.value && !completed.value) {
    aiTeachingAPI.pauseSession(session.value.sessionId, 'pagehide', session.value.revision).catch(() => {});
  }
});
</script>

<style scoped>
.learn { min-height: 100vh; display: flex; flex-direction: column; background: var(--canvas); }

/* ---------- 头部 ---------- */
.learn__head {
  display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 18px;
  padding: 12px 24px;
  background: color-mix(in srgb, var(--surface) 92%, transparent);
  backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--line);
  /* backdrop-filter 创建堆叠上下文：若不设 z-index 会按文档顺序排，位于其后的 .tutor 将盖住「⋯」弹层。显式提升，让头部与菜单弹层始终在对话框之上。 */
  position: relative;
  z-index: 50;
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
.learn__state-link {
  font-size: 11.5px; font-weight: 700;
  color: var(--muted);
  text-decoration: none;
  padding: 4px 11px; border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--surface);
  transition: color 0.14s ease, border-color 0.14s ease, background 0.14s ease;
}
.learn__state-link:hover { color: var(--blue-deep); border-color: rgba(52, 120, 246, 0.4); background: rgba(52, 120, 246, 0.06); }
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
.kp__head {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  font-size: 13px;
  border: 0; background: transparent; padding: 0; margin: 0;
  font: inherit; color: inherit; text-align: left; cursor: default;
}
.kp__head span { font-size: 11.5px; font-weight: 800; color: var(--blue-deep); }
.kp__caret { display: none; font-size: 11px; color: var(--faint); flex-shrink: 0; }
.kp__body { display: flex; flex-direction: column; gap: 12px; min-height: 0; }
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
/* 恢复进度横幅：续上历史时的可见确认（替代一次性 toast） */
.tutor__resume {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 10px 14px 0;
  padding: 8px 10px 8px 14px;
  border: 1px solid rgba(52, 120, 246, 0.3);
  border-radius: 12px;
  background: linear-gradient(135deg, rgba(52, 120, 246, 0.08), rgba(141, 107, 255, 0.05));
  color: var(--blue-deep);
  font-size: 12.5px;
  flex: 0 0 auto;
}
.tutor__resume-text { flex: 1; font-weight: 600; }
.tutor__resume-restart {
  border: 1px solid rgba(44, 99, 208, 0.35);
  background: var(--surface);
  color: var(--blue-deep);
  font: inherit; font-size: 12px; font-weight: 700;
  padding: 4px 12px; border-radius: 999px; cursor: pointer;
}
.tutor__resume-restart:hover { background: rgba(52, 120, 246, 0.1); }
.tutor__resume-close {
  display: grid; place-items: center;
  width: 22px; height: 22px;
  border: 0; border-radius: 6px;
  background: transparent; color: var(--faint);
  cursor: pointer; flex: 0 0 auto;
}
.tutor__resume-close:hover { background: rgba(23, 32, 51, 0.06); color: var(--muted); }
/* 开场景卡片：resumed / 接续 / 重学 / 复习 的结构化开场 */
.oscene {
  margin: 10px 14px 0;
  padding: 16px 18px;
  border: 1px solid rgba(141, 107, 255, 0.28);
  border-radius: 14px;
  background:
    radial-gradient(120% 160% at 0% 0%, rgba(141, 107, 255, 0.10), transparent 46%),
    var(--surface);
  box-shadow: 0 6px 22px rgba(23, 32, 51, 0.06);
  display: grid; gap: 8px;
  flex: 0 0 auto;
}
.oscene--review { border-color: rgba(52, 120, 246, 0.3); }
.oscene__tag {
  justify-self: start;
  font-size: 10.5px; font-weight: 800;
  letter-spacing: 0.04em;
  color: #6b4ae0;
  background: rgba(141, 107, 255, 0.12);
  border: 1px solid rgba(141, 107, 255, 0.3);
  padding: 2px 9px; border-radius: 999px;
}
.oscene--review .oscene__tag { color: #1f57cc; background: rgba(52, 120, 246, 0.12); border-color: rgba(52, 120, 246, 0.32); }
.oscene__title { margin: 0; font-size: 15.5px; font-weight: 800; color: var(--ink, #1c2b45); }
.oscene__lead { margin: 0; font-size: 12.5px; line-height: 1.65; color: var(--muted); }
.oscene__summary {
  margin: 0;
  font-size: 12.5px; line-height: 1.7;
  color: var(--muted);
  background: rgba(23, 32, 51, 0.035);
  border-radius: 10px; padding: 8px 11px;
}
.oscene__chips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.oscene__chip-label { font-size: 11px; font-weight: 700; color: var(--faint); }
.oscene__chip {
  font-size: 11px; font-weight: 700;
  color: #b3540a;
  background: rgba(244, 170, 70, 0.15);
  border: 1px solid rgba(244, 170, 70, 0.32);
  padding: 2px 9px; border-radius: 999px;
}
.oscene__warn { font-size: 11.5px; line-height: 1.6; color: #b3540a; }
.oscene__warn span { font-weight: 700; }
.oscene__actions { display: flex; gap: 8px; margin-top: 4px; flex-wrap: wrap; }
.oscene__actions .btn-ghost { font-size: 12.5px; }
[data-theme='dark'] .oscene { border-color: rgba(141, 107, 255, 0.35); background: radial-gradient(120% 160% at 0% 0%, rgba(141, 107, 255, 0.12), transparent 46%), #141c2b; }
[data-theme='dark'] .oscene__summary { background: rgba(15, 22, 32, 0.5); }
[data-theme='dark'] .oscene__title { color: #e6edf7; }
.tutor__jump-bottom {
  position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%);
  z-index: 5;
  padding: 7px 14px; border: 1px solid var(--line); border-radius: 999px;
  background: var(--surface); color: var(--muted);
  font: inherit; font-size: 12px; font-weight: 700;
  cursor: pointer; box-shadow: 0 4px 14px rgba(23, 32, 51, 0.12);
  transition: transform 0.15s ease, color 0.15s ease;
}
.tutor__jump-bottom:hover { color: var(--blue); transform: translateX(-50%) translateY(-1px); }
.msg { display: flex; flex-direction: column; gap: 5px; max-width: 85%; }
.msg--user { align-self: flex-end; align-items: flex-end; position: relative; }
.msg--user .msg__bubble {
  background: linear-gradient(135deg, var(--blue), var(--blue-deep));
  color: #fff;
  border-radius: 16px 16px 4px 16px;
  white-space: pre-wrap;
}
/* 用户消息编辑按钮（hover 显示；触屏常显） */
.msg--user .msg__edit-btn {
  position: absolute;
  top: 2px; right: 100%;
  margin-right: 6px;
  width: 24px; height: 24px;
  display: grid; place-items: center;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  color: var(--faint);
  font-size: 12px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.msg--user:hover .msg__edit-btn { opacity: 1; }
.msg--user .msg__edit-btn:hover { color: var(--blue-deep); border-color: rgba(52, 120, 246, 0.4); }
@media (hover: none) {
  .msg--user .msg__edit-btn { opacity: 1; }
}
/* 编辑态 */
.msg--editing { align-self: flex-end; align-items: flex-end; }
.msg__edit {
  display: grid; gap: 6px;
  min-width: min(320px, 70vw);
}
.msg__edit-input {
  width: 100%;
  border: 1px solid rgba(52, 120, 246, 0.4);
  border-radius: 12px;
  padding: 9px 12px;
  font: inherit; font-size: 13.5px; line-height: 1.6;
  color: var(--ink);
  background: var(--surface);
  resize: vertical;
  outline: none;
}
.msg__edit-actions { display: flex; gap: 8px; justify-content: flex-end; }
.msg__edit-save, .msg__edit-cancel {
  font-size: 12px; font-weight: 700;
  padding: 5px 14px;
  border-radius: 999px;
  cursor: pointer;
}
.msg__edit-save {
  color: #fff;
  background: linear-gradient(135deg, var(--blue), var(--blue-deep));
}
.msg__edit-cancel {
  color: var(--muted);
  border: 1px solid var(--line);
  background: var(--surface);
}
.msg__bubble {
  padding: 11px 15px;
  font-size: 14px; line-height: 1.65;
  border-radius: 4px 16px 16px 16px;
  background: color-mix(in srgb, var(--surface) 72%, var(--blue) 4%); color: var(--ink);
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

/* 消息入场：新气泡浮出（typing 圆点除外） */
@media (prefers-reduced-motion: no-preference) {
  .msg { animation: msg-in 0.28s cubic-bezier(0.16, 1, 0.3, 1) both; }

  /* 更多菜单：弹出 */
  .pop-enter-active, .pop-leave-active { transition: opacity .18s ease, transform .18s cubic-bezier(0.16, 1, 0.3, 1); }
  .pop-enter-from { opacity: 0; transform: scale(.96) translateY(4px); }
  .pop-leave-to { opacity: 0; transform: scale(.97) translateY(-2px); }

  /* 初始化/错误/课堂 三态切换：淡入淡出 */
  .stage-switch-enter-active, .stage-switch-leave-active { transition: opacity .2s ease; }
  .stage-switch-enter-from, .stage-switch-leave-to { opacity: 0; }

  /* 检查点：上浮淡入 / 收缩淡出 */
  .cp-enter-active { transition: opacity .25s ease, transform .25s cubic-bezier(0.16, 1, 0.3, 1); }
  .cp-leave-active { transition: opacity .2s ease, transform .2s ease; }
  .cp-enter-from { opacity: 0; transform: translateY(10px); }
  .cp-leave-to { opacity: 0; transform: scale(.98) translateY(-4px); }

  /* 完成浮层：遮罩淡入 + 卡片弹簧弹入 + 对勾弹性 pop */
  .finish-pop-enter-active { transition: opacity .2s ease; }
  .finish-pop-leave-active { transition: opacity .15s ease; }
  .finish-pop-enter-from, .finish-pop-leave-to { opacity: 0; }
  .finish-pop-enter-active .finish__card { animation: finish-card-in .35s cubic-bezier(0.34, 1.56, 0.64, 1) .05s both; }
  .finish-pop-enter-active .finish__ring svg { animation: finish-check-pop .4s cubic-bezier(0.34, 1.56, 0.64, 1) .2s both; }

  /* 知识点状态过渡：标记底色渐变 + 勾号弹性 pop */
  .kp__mark { transition: background .2s ease, border-color .2s ease; }
  .kp__mark svg { animation: kp-check-pop .25s cubic-bezier(0.34, 1.56, 0.64, 1) both; }

  /* 检查点反馈条：淡入上浮 */
  .checkpoint__feedback { animation: cp-fb-in .2s ease both; }
}
@keyframes msg-in {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes finish-card-in {
  from { opacity: 0; transform: scale(.92) translateY(10px); }
  to { opacity: 1; transform: none; }
}
@keyframes finish-check-pop {
  from { transform: scale(.4) rotate(-30deg); opacity: 0; }
  to { transform: none; opacity: 1; }
}
@keyframes kp-check-pop {
  from { transform: scale(.4); }
  to { transform: none; }
}
@keyframes cp-fb-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}

/* 卡点依据 chip */
.msg__chip {
  display: inline-flex; align-items: center; gap: 5px;
  width: fit-content; padding: 4px 10px; border-radius: 999px;
  font-size: 11px; font-weight: 700; line-height: 1.5;
}
.msg__chip--confuse { color: #b3540a; background: rgba(244, 170, 70, 0.12); border: 1px solid rgba(244, 170, 70, 0.2); margin-top: 6px; }

/* ---------- 伴学浮窗（角色「小启」· 暖橙系，dock 式不占主对话区） ---------- */
.peerdock {
  position: fixed; right: 22px; bottom: 132px; z-index: 60;
  /* bottom 抬升避开底部输入区（composer ≈104px + 间距 28px），
     否则 dock 内容高时（长消息）覆盖发送按钮 */
  width: min(340px, calc(100vw - 32px));
  display: grid; grid-template-rows: auto minmax(0, 1fr) auto;
  max-height: 440px;
  background: var(--surface);
  border: 1px solid rgba(244, 149, 66, 0.28);
  border-radius: 18px;
  box-shadow: 0 24px 60px rgba(190, 92, 26, 0.16);
  overflow: hidden;
}
.peer-pop-enter-active { transition: opacity 0.28s ease, transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1); }
.peer-pop-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.peer-pop-enter-from,
.peer-pop-leave-to { opacity: 0; transform: translateY(16px) scale(0.96); }
.peerdock__head {
  display: flex; align-items: center; gap: 10px;
  padding: 11px 14px;
  background: linear-gradient(135deg, rgba(255, 152, 67, 0.12), rgba(244, 170, 70, 0.05));
  border-bottom: 1px solid rgba(244, 149, 66, 0.18);
}
/* 小启 Q 头像：暖橙渐变 + 白字 Q，与导师问流（蓝紫 favicon）明确区分 */
.peerdock__avatar {
  width: 32px; height: 32px; border-radius: 50%; flex: 0 0 auto;
  background: linear-gradient(135deg, #ff9d4d, #f4791f);
  box-shadow: 0 6px 14px rgba(244, 121, 31, 0.35);
  display: grid; place-items: center;
}
.peerdock__avatar-q {
  color: #fff; font-size: 17px; font-weight: 800; font-style: italic;
  font-family: Georgia, 'Times New Roman', serif;
  line-height: 1;
  transform: translateX(-0.5px);
}
.peerdock__title { flex: 1; min-width: 0; display: grid; gap: 2px; }
.peerdock__name { display: flex; align-items: center; gap: 6px; min-width: 0; }
.peerdock__name strong { font-size: 13.5px; color: var(--ink); }
.peerdock__tag {
  flex: 0 0 auto;
  font-size: 10px; font-weight: 700; color: #c05e14;
  background: rgba(244, 170, 70, 0.16);
  border: 1px solid rgba(244, 170, 70, 0.35);
  padding: 1px 7px; border-radius: 999px;
  line-height: 1.6;
}
.peerdock__status {
  display: flex; align-items: center; gap: 5px; min-width: 0;
  font-size: 11px; color: var(--muted);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.peerdock__status-dot {
  flex: 0 0 auto; width: 6px; height: 6px; border-radius: 50%;
  background: #2fbe6e;
  box-shadow: 0 0 0 2px rgba(47, 190, 110, 0.18);
}
.peerdock__min {
  width: 24px; height: 24px; border-radius: 8px;
  display: grid; place-items: center;
  color: var(--muted); cursor: pointer;
}
.peerdock__min:hover { background: rgba(244, 149, 66, 0.12); color: var(--ink); }
.peerdock__scroll {
  overflow-y: auto; padding: 12px;
  display: grid; gap: 10px; align-content: start;
  background: var(--canvas, #fafbff);
}
.peerdock__msg { display: grid; gap: 3px; justify-items: start; max-width: 100%; }
.peerdock__msg--me { justify-items: end; }
.peerdock__bubble {
  max-width: 100%; padding: 9px 12px;
  font-size: 13px; line-height: 1.6;
  border-radius: 4px 14px 14px 14px;
  background: rgba(255, 152, 67, 0.09); color: var(--ink);
  border: 1px solid rgba(244, 149, 66, 0.18);
}
.peerdock__msg--me .peerdock__bubble {
  border-radius: 14px 14px 4px 14px;
  background: linear-gradient(135deg, var(--blue, #3478f6), var(--blue-deep, #1f57cc));
  color: #fff; border: 0;
}
.peerdock__bubble :deep(p) { margin: 0 0 6px; }
.peerdock__bubble :deep(p:last-child) { margin-bottom: 0; }
.peerdock__bubble--typing { display: inline-flex; gap: 4px; align-items: center; }
.peerdock__bubble--typing i {
  width: 6px; height: 6px; border-radius: 50%; background: var(--faint);
  animation: learn-typing 1.2s ease-in-out infinite;
}
.peerdock__bubble--typing i:nth-child(2) { animation-delay: 0.15s; }
.peerdock__bubble--typing i:nth-child(3) { animation-delay: 0.3s; }
.peerdock__msg > small { font-size: 10.5px; color: var(--faint); padding: 0 2px; }
/* 小启消息元信息行：学法徽章 + 时间戳 */
.peerdock__meta {
  display: flex; align-items: center; gap: 8px; min-width: 0;
  padding: 0 2px;
}
.peerdock__meta small { font-size: 10.5px; color: var(--faint); }
.peerdock__strategy {
  font-size: 10px; font-weight: 700; color: #c05e14;
  background: rgba(244, 170, 70, 0.12);
  border: 1px solid rgba(244, 170, 70, 0.25);
  padding: 1px 7px; border-radius: 999px;
  line-height: 1.6;
}
/* 小启追问快选：轻量 chips，点一下直接发（与输入框发送等价） */
.peerdock__follows {
  display: flex; flex-direction: column; align-items: flex-start;
  gap: 6px; margin-top: 2px; padding: 0 2px; width: 100%;
}
.peerdock__follow {
  text-align: left;
  max-width: 92%; padding: 6px 11px;
  font: inherit; font-size: 12px; line-height: 1.5; color: #b3540a;
  background: color-mix(in srgb, #fff 82%, rgba(244, 170, 70, 0.35));
  border: 1px solid rgba(244, 149, 66, 0.35); border-radius: 12px;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}
[data-theme='dark'] .peerdock__follow {
  background: rgba(244, 170, 70, 0.08);
  color: #f0b063;
}
.peerdock__follow:hover { background: rgba(244, 170, 70, 0.16); border-color: rgba(244, 149, 66, 0.55); }
.peerdock__follow:disabled { opacity: 0.5; cursor: default; }
/* AI 生成合规提示：常驻滚动区底部，不打扰对话 */
.peerdock__ai-note {
  display: flex; justify-content: center;
  padding: 2px 0 0;
}
.peerdock__ai-note :deep(.ai-note) { font-size: 10px; color: var(--faint); opacity: 0.75; }
.peerdock__input {
  display: flex; gap: 8px; padding: 10px 12px;
  border-top: 1px solid var(--line, rgba(23, 32, 51, 0.08));
  background: var(--surface);
}
.peerdock__input input {
  flex: 1; min-width: 0; padding: 8px 12px;
  font: inherit; font-size: 13px;
  border: 1px solid var(--line, rgba(23, 32, 51, 0.08)); border-radius: 999px;
  outline: none;
  background: var(--surface);
  color: var(--ink);
}
.peerdock__input input:focus { border-color: rgba(244, 149, 66, 0.55); box-shadow: 0 0 0 3px rgba(244, 170, 70, 0.14); }
.peerdock__input button {
  padding: 8px 14px; border: 0; border-radius: 999px;
  font: inherit; font-size: 12.5px; font-weight: 700;
  color: #fff; background: linear-gradient(135deg, #ff9d4d, #ef7d1f);
  cursor: pointer;
  transition: filter 0.15s ease;
}
.peerdock__input button:hover:not(:disabled) { filter: brightness(1.05); }
.peerdock__input button:disabled { opacity: 0.45; cursor: default; }
/* 小启悬浮球：暖橙 Q（区别于导师品牌蓝紫） */
.peerfab {
  position: fixed; right: 22px; bottom: 22px; z-index: 59;
  width: 52px; height: 52px; border: 0; border-radius: 50%;
  background: linear-gradient(135deg, #ff9d4d, #ef7d1f);
  box-shadow: 0 14px 32px rgba(239, 125, 31, 0.4);
  display: grid; place-items: center; cursor: pointer;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}
.peerfab:hover { transform: translateY(-2px); box-shadow: 0 18px 38px rgba(239, 125, 31, 0.48); }
.peerfab__q {
  color: #fff; font-size: 26px; font-weight: 800; font-style: italic;
  font-family: Georgia, 'Times New Roman', serif;
  line-height: 1;
}
.peerfab__dot {
  position: absolute; top: 1px; right: 1px;
  width: 13px; height: 13px; border-radius: 50%;
  background: #ef7578; border: 2px solid #fff;
}
@media (max-width: 640px) {
  .peerdock { right: 12px; left: 12px; bottom: 12px; width: auto; max-height: 60dvh; }
  .peerfab { right: 14px; bottom: 14px; width: 46px; height: 46px; }
  .peerfab__q { font-size: 23px; }
}
/* 窄屏（平板/小窗）：dock 收窄并抬高，避免与底部输入区重叠（长消息上探场景） */
@media (min-width: 641px) and (max-width: 1100px) {
  .peerdock { width: min(300px, calc(100vw - 24px)); right: 12px; bottom: 140px; max-height: 380px; }
}
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
  background: color-mix(in srgb, var(--surface) 96%, transparent);
  display: grid; gap: 9px;
}
.kp-actions__label { font-size: 11.5px; font-weight: 700; color: var(--faint); }
.kp-actions__row { display: flex; gap: 10px; flex-wrap: wrap; }
/* 自我评估二选一：掌握 ✓ 绿实心 / 未理解 ✗ 琥珀描边——语义色一眼可辨 */
.kp-btn {
  display: inline-flex; align-items: center; gap: 6px;
  min-height: 40px; padding: 0 16px;
  border-radius: 999px; border: 1px solid transparent;
  font: inherit; font-size: 13px; font-weight: 700;
  cursor: pointer; transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}
.kp-btn:hover { transform: translateY(-1px); }
.kp-btn:active { transform: translateY(0) scale(0.98); }
.kp-btn__icon { font-size: 14px; line-height: 1; }
.kp-btn--mastered {
  color: #fff;
  background: linear-gradient(135deg, #1e9e58, #15803d);
  box-shadow: 0 10px 22px rgba(30, 158, 88, 0.22);
}
.kp-btn--mastered:hover { box-shadow: 0 12px 26px rgba(30, 158, 88, 0.3); }
.kp-btn--retry {
  color: var(--amber, #b45309);
  background: color-mix(in srgb, var(--amber, #f4aa46) 10%, transparent);
  border-color: rgba(180, 83, 9, 0.32);
}
.kp-btn--retry:hover { background: color-mix(in srgb, var(--amber, #f4aa46) 18%, transparent); }

/* 动态确认（teaching-turn 输出 confirmCheck）：行动台式纵向卡片按钮，与开场行动台呼应 */
.kp-actions--dynamic {
  border-top: 1px solid rgba(141, 107, 255, 0.18);
  background: linear-gradient(180deg, rgba(141, 107, 255, 0.045), rgba(52, 120, 246, 0.02));
}
.kp-actions__head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 0 2px 9px; }
.kp-actions__kicker { font-size: 12px; font-weight: 800; letter-spacing: 0.04em; color: #6b4ae0; }
.kp-actions__row--stack { display: grid; grid-template-columns: 1fr; gap: 7px; }
.kp-act {
  display: flex; align-items: center; gap: 10px;
  width: 100%;
  text-align: left;
  padding: 9px 12px;
  border-radius: 11px;
  border: 1px solid rgba(141, 107, 255, 0.22);
  background: var(--surface);
  color: var(--ink, #1c2b45);
  font: inherit; font-size: 13px; font-weight: 600; line-height: 1.4;
  cursor: pointer;
  transition: border-color 0.15s ease, transform 0.12s ease, box-shadow 0.15s ease;
}
.kp-act__mark {
  flex: 0 0 auto;
  display: grid; place-items: center;
  width: 22px; height: 22px;
  border-radius: 7px;
  font-size: 12px; font-weight: 800;
  color: #fff;
}
.kp-act--ok .kp-act__mark { background: linear-gradient(135deg, #1e9e58, #15803d); }
.kp-act--retry .kp-act__mark { background: linear-gradient(135deg, #f4aa46, #d97706); }
.kp-act__text { flex: 1; min-width: 0; }
.kp-act__go {
  flex: 0 0 auto;
  color: #9aa4b8;
  font-weight: 800;
  transition: transform 0.15s ease, color 0.15s ease;
}
.kp-act:hover {
  border-color: rgba(141, 107, 255, 0.5);
  box-shadow: 0 4px 14px rgba(23, 32, 51, 0.08);
  transform: translateY(-1px);
}
.kp-act:hover .kp-act__go { color: #6b4ae0; transform: translateX(2px); }
.kp-act:active { transform: translateY(0); }
[data-theme='dark'] .kp-actions--dynamic { border-top-color: rgba(141, 107, 255, 0.3); background: rgba(141, 107, 255, 0.07); }
[data-theme='dark'] .kp-act { background: #141c2b; border-color: rgba(141, 107, 255, 0.28); color: #e6edf7; }

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
  background: var(--surface);
}
.checkpoint__input:focus { border-color: rgba(52, 120, 246, 0.5); }
.checkpoint__actions { display: flex; gap: 10px; }

/* ---------- 输入区 ---------- */
.composer { display: grid; gap: 7px; padding: 12px 14px; border-top: 1px solid var(--line); background: color-mix(in srgb, var(--surface) 96%, transparent); }
.composer__box {
  display: flex; align-items: flex-end; gap: 10px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 6px 6px 6px 14px;
  min-height: 50px;
}
/* 有内容/聚焦：柔和提示 —— 细蓝边 + 淡外发光（替代原整圈硬蓝边） */
.composer__box--active {
  border-color: rgba(52, 120, 246, 0.55);
  box-shadow: 0 0 0 3px rgba(52, 120, 246, 0.12), 0 6px 20px rgba(23, 32, 51, 0.06);
}
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
  transition: background 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
}
.composer__send--off { background: #e3eaf5; color: var(--faint); box-shadow: none; cursor: default; }
/* 生成中：同一按钮切换为红色停止态（主流聊天交互，替代原独立 stop-btn） */
.composer__send--stop {
  background: linear-gradient(135deg, #e5484d, #c92a2f);
  box-shadow: 0 8px 16px rgba(229, 72, 77, 0.28);
}
.composer__send--stop:hover {
  background: linear-gradient(135deg, #ef5b60, #d43a40);
  box-shadow: 0 10px 20px rgba(229, 72, 77, 0.36);
  transform: translateY(-1px);
}
.composer__send--stop:active { transform: translateY(0) scale(0.97); }
.composer__hint {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; flex-wrap: wrap;
  font-size: 11px; line-height: 1.5; color: var(--faint); padding-left: 4px;
}
.composer__hint :deep(.ai-note) {
  font-size: 11px; line-height: 1.5;
}

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
  border: 1px solid var(--line); background: var(--surface);
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
  /* 锁定视口高度：整页不滚动，tutor 内部滚动、composer 吸底，消除底部空白。
     flex-grow:0 必须显式置零——.v2-page 全局 flex:1 会把 height:100dvh 拉伸到内容高度。
     padding-bottom:0 覆盖 v2.css 的移动端全局 .v2-page { padding-bottom:72px }（沉浸学习页无底部导航，72px 是纯空白）。 */
  .learn { height: 100dvh; min-height: 0; flex: 0 0 auto; padding-bottom: 0; }
  .learn__body {
    flex: 1;
    min-height: 0;
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 1fr);
    padding: 8px 10px;
    gap: 0;
  }
  .kp { position: static; }
  .learn__back { display: none; }
  /* 移动端 tutor 撑满可用高度：聊天区内部滚动、composer 吸底，消除滚动到底的底部空白 */
  .tutor { max-height: none; height: 100%; min-height: 0; }
  .learn__body--no-kp .tutor { max-height: none !important; height: 100% !important; }
  .tutor__scroll { flex: 1; min-height: 0; overflow-y: auto; }
  /* 移动端头部：单行紧凑 —— 返回隐藏、标题占主列可截断，右侧「学习中」+「⋯」同行，不再换行占第二行 */
  .learn__head {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-rows: auto;
    gap: 0 10px;
    padding: 8px 14px;
  }
  .learn__title { grid-column: 1; grid-row: 1; min-width: 0; }
  .learn__title strong { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .learn__title small { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .learn__head-right { grid-column: 2; grid-row: 1; display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
  .learn__live, .learn__state-link { white-space: nowrap; flex-shrink: 0; }
  .learn__live { padding: 3px 9px; font-size: 10.5px; }
  .learn__menu-wrap { position: relative; display: inline-flex; }
  .learn__menu { padding: 0 4px; font-size: 20px; line-height: 1; display: inline-flex; align-items: center; height: 28px; }
  /* 弹窗锚定在 ⋯ 按钮正下方、右对齐按钮 */
  .learn__menu-pop {
    top: calc(100% + 6px);
    right: 0;
    min-width: 0;
    width: min(250px, calc(100vw - 28px));
  }
  /* 移动端知识点面板默认折叠：头部横条可点，收起时隐藏进度条/清单 */
  .kp__head { cursor: pointer; }
  .kp__caret { display: inline; }
  .kp--collapsed .kp__body { display: none; }
}
</style>

<style scoped>
/* logo 头像 */
.msg__avatar {
  background: var(--surface) !important;
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
.learn__init {
  flex: 1; display: grid; place-content: center; justify-items: center; gap: 14px;
  color: var(--faint); font-size: 14px; padding: 80px 20px; text-align: center;
}
.learn__init-error { color: #c0454a; font-size: 14px; font-weight: 600; }
.learn__menu-pop {
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 40;
  background: var(--surface); border: 1px solid var(--line);
  border-radius: 12px; padding: 5px;
  box-shadow: 0 12px 30px rgba(23, 32, 51, 0.14);
  display: grid; min-width: 220px;
}
.learn__menu-group { display: grid; gap: 1px; }
.learn__menu-label {
  padding: 6px 12px 3px;
  font-size: 10.5px; font-weight: 800; letter-spacing: 0.06em;
  color: var(--faint);
}
.learn__menu-sep { height: 1px; background: var(--line); margin: 4px 6px; }
.learn__menu-item {
  padding: 8px 12px; border-radius: 8px;
  font-size: 13px; font-weight: 600; color: var(--muted);
  cursor: pointer; white-space: nowrap;
  text-align: left;
  transition: background 0.15s ease, color 0.15s ease;
}
.learn__menu-item-main { display: grid; gap: 2px; }
.learn__menu-item-main strong { font-size: 13px; font-weight: 700; color: inherit; }
.learn__menu-item-main small { font-size: 11px; font-weight: 500; color: var(--faint); white-space: normal; }
.learn__menu-item:hover { background: color-mix(in srgb, var(--surface) 96%, var(--ink)); color: var(--ink); }
.learn__menu-item--primary { color: var(--blue, #2c63d0); }
.learn__menu-item--primary:hover { background: #e8effc; color: var(--blue, #2c63d0); }
.learn__menu-item--danger { color: #c0454a; }
.learn__menu-item--danger:hover { background: rgba(239, 117, 120, 0.1); color: #c0454a; }
.learn__head-right { position: relative; }
.checkpoint__option {
  display: flex; align-items: center; gap: 9px;
  padding: 9px 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  font-size: 13.5px; cursor: pointer;
  background: var(--surface);
}
.checkpoint__option--on { border-color: rgba(52, 120, 246, 0.5); background: rgba(52, 120, 246, 0.06); }
.checkpoint__feedback {
  font-size: 13px; font-weight: 600; color: #b3540a;
  background: rgba(244, 170, 70, 0.1);
  border-radius: 10px; padding: 9px 12px;
}
.checkpoint__feedback--ok { color: #1d7a4c; background: rgba(49, 177, 111, 0.1); }
.msg__retry { margin-left: 8px; color: #c0454a; font-weight: 800; text-decoration: underline; cursor: pointer; }
.msg__bubble--html :deep(p) { margin: 0 0 8px; }
.msg__bubble--html :deep(p:last-child) { margin-bottom: 0; }
.msg__bubble--html :deep(ul), .msg__bubble--html :deep(ol) { margin: 4px 0; padding-left: 18px; }
.msg__bubble--html :deep(code) {
  background: rgba(52, 120, 246, 0.1); color: var(--blue-deep);
  padding: 1px 6px; border-radius: 6px; font-size: 12.5px;
}
.msg__bubble--html :deep(pre) {
  background: #182338; color: #d6e4ff;
  border-radius: 10px; padding: 12px 14px;
  font-size: 12.5px; line-height: 1.6; overflow-x: auto;
}
.msg__bubble--html :deep(pre code) { background: transparent; color: inherit; padding: 0; }
/* MessageActions 定位容器 */
.msg__content--actions { position: relative; }
.msg__bubble--relative { position: relative; }

.typing-fade-enter-active { transition: opacity 0.2s ease; }
.typing-fade-leave-active { transition: opacity 0.12s ease; }
.typing-fade-enter-from,
.typing-fade-leave-to { opacity: 0; }

.replies {
  margin: 4px 16px 0;
  padding: 12px 14px 14px;
  border: 1px solid rgba(141, 107, 255, 0.18);
  border-radius: 14px;
  background: linear-gradient(180deg, rgba(141, 107, 255, 0.045), rgba(52, 120, 246, 0.02));
}
.replies__head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 0 2px 9px; }
.replies__kicker {
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.04em;
  color: #6b4ae0;
}
.replies__hint { font-size: 11px; color: var(--faint); }
.replies__row { display: grid; grid-template-columns: 1fr; gap: 7px; }
.reply {
  display: flex; align-items: center; gap: 10px;
  width: 100%;
  text-align: left;
  padding: 9px 12px;
  border-radius: 11px;
  border: 1px solid rgba(141, 107, 255, 0.22);
  background: var(--surface);
  color: var(--ink, #1c2b45);
  font: inherit; font-size: 13px; font-weight: 600; line-height: 1.4;
  cursor: pointer;
  transition: border-color 0.15s ease, transform 0.12s ease, box-shadow 0.15s ease;
}
.reply__mark {
  flex: 0 0 auto;
  display: grid; place-items: center;
  width: 20px; height: 20px;
  border-radius: 7px;
  font-size: 11px; font-weight: 800;
  color: #fff;
  background: #6b4ae0;
}
.reply--2 .reply__mark { background: #2c63d0; }
.reply--3 .reply__mark { background: #0f9d6a; }
.reply__text { flex: 1; min-width: 0; }
.reply__go {
  flex: 0 0 auto;
  color: #9aa4b8;
  font-weight: 800;
  transition: transform 0.15s ease, color 0.15s ease;
}
.reply:hover {
  border-color: rgba(141, 107, 255, 0.5);
  box-shadow: 0 4px 14px rgba(23, 32, 51, 0.08);
  transform: translateY(-1px);
}
.reply:hover .reply__go { color: #6b4ae0; transform: translateX(2px); }
.reply:active { transform: translateY(0); }
[data-theme='dark'] .replies { border-color: rgba(141, 107, 255, 0.3); background: rgba(141, 107, 255, 0.07); }
[data-theme='dark'] .reply { background: #141c2b; border-color: rgba(141, 107, 255, 0.28); color: #e6edf7; }
</style>

<style scoped>
/* 开课准备/失败：整页居中大卡片，避免窄条感 */
.learn__stage {
  flex: 1;
  display: grid;
  place-items: center;
  padding: 40px 24px;
}
.stage-card {
  width: min(560px, 100%);
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 20px;
  box-shadow: 0 1px 2px rgba(23, 32, 51, 0.04), 0 16px 40px rgba(23, 32, 51, 0.07);
  padding: 36px 32px;
  display: grid;
  justify-items: center;
  gap: 14px;
  text-align: center;
}
.stage-card h2 { margin: 0; font-size: 20px; }
.stage-card p { margin: 0; font-size: 13.5px; color: var(--muted); line-height: 1.7; max-width: 44ch; }
.stage-card__warn {
  width: 44px; height: 44px; border-radius: 50%;
  background: rgba(244, 170, 70, 0.14);
  color: #b3540a;
  font-size: 22px; font-weight: 800;
  display: grid; place-items: center;
  border: 1px solid rgba(244, 170, 70, 0.35);
}
.stage-card__skeleton { display: grid; gap: 8px; width: 100%; margin-top: 6px; }
.stage-card__skeleton i {
  height: 12px; border-radius: 6px;
  background: linear-gradient(90deg, #edf1f8 25%, #f7faff 50%, #edf1f8 75%);
  background-size: 200% 100%;
  animation: stage-shimmer 1.4s ease infinite;
}
@keyframes stage-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
.stage-card__actions { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; margin-top: 4px; }
</style>

<style scoped>
/* 无知识点侧栏时：单列居中，避免对话区掉进 280px 首列变窄 */
.learn__body--no-kp {
  grid-template-columns: minmax(0, 900px);
  justify-content: center;
}
.learn__body--no-kp .tutor {
  max-height: calc(100vh - 120px);
}
</style>

<style scoped>
/* 暗色模式适配 */
:global([data-theme='dark']) .msg__bubble {
  background: color-mix(in srgb, var(--surface) 72%, var(--blue) 4%);
  color: var(--ink);
}
:global([data-theme='dark']) .msg--ai .msg__bubble b,
:global([data-theme='dark']) .msg--ai .msg__bubble strong {
  color: var(--blue-deep);
}
:global([data-theme='dark']) .msg__bubble--html :deep(code) {
  background: rgba(77, 139, 248, 0.15);
  color: var(--blue-deep);
}
:global([data-theme='dark']) .msg__bubble--html :deep(pre) {
  background: #0d1520;
  color: #c8daf0;
}
:global([data-theme='dark']) .msg__avatar {
  background: var(--surface) !important;
  border-color: var(--line);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
}
:global([data-theme='dark']) .tutor__jump-bottom {
  background: var(--surface);
  border-color: var(--line);
  color: var(--muted);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}
:global([data-theme='dark']) .learn__menu {
  background: var(--surface);
  border-color: var(--line);
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
}
:global([data-theme='dark']) .learn__menu-item:hover {
  background: rgba(255, 255, 255, 0.04);
  color: var(--ink);
}
:global([data-theme='dark']) .kp-bar {
  background: var(--surface);
  border-color: var(--line);
}
</style>
