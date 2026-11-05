<script setup lang="ts">
/**
 * ChatMessageList — reusable scrollable message list.
 * Renders a list of messages with avatars, timestamps, markdown, and retry support.
 * Designed to work inside a container that provides its own scroll (e.g. .tutor__scroll, .chat__scroll).
 */
import { nextTick, ref } from 'vue';
import { useIsDark } from '@/composables/useIsDark';

const isDark = useIsDark();
import { cachedMessageHtml } from '@/utils/messageMarkdown';

export interface ChatMessage {
  id?: string;
  role: 'user' | 'ai';
  text: string;
  time?: string;
  streaming?: boolean;
  failed?: boolean;
  confusion?: string[];
}

withDefaults(defineProps<{
  messages: ChatMessage[];
  aiLabel?: string;
  showAvatar?: boolean;
}>(), {
  aiLabel: '问流',
  showAvatar: true,
});

const emit = defineEmits<{
  retry: [];
}>();

const scrollEl = ref<HTMLElement | null>(null);

/** Streaming-render memoisation: avoids re-running markdown + DOMPurify on every delta（共享工具） */
const htmlFor = (m: { text: string }) => cachedMessageHtml(m);

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

function nowTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

defineExpose({ scrollEl, scrollDown, jumpToBottom, nearBottom });
</script>

<template>
  <div ref="scrollEl" class="chat-msg-list" @scroll="updateNearBottom">
    <slot />

    <template v-for="m in messages" :key="m.id">
      <div v-if="m.role === 'user'" class="msg msg--user">
        <div class="msg__bubble">{{ m.text }}</div>
        <div class="msg__meta">你 · {{ m.time || nowTime() }}</div>
      </div>
      <div v-else class="msg msg--ai">
        <span v-if="showAvatar" class="msg__avatar"><img :src="isDark ? '/favicon-dark.png' : '/favicon.png'" :alt="aiLabel" /></span>
        <div class="msg__content">
          <div class="msg__bubble msg__bubble--html" v-html="htmlFor(m)"></div>
          <span v-if="m.confusion?.length" class="msg__chip msg__chip--confuse">
            <span class="msg__chip-tag">发现卡点</span>
            <span class="msg__chip-text">「{{ m.confusion.join('、') }}」· 导师会在这里多做确认</span>
          </span>
          <div class="msg__meta">
            {{ aiLabel }} · {{ m.time || nowTime() }}
            <button v-if="m.failed" type="button" class="msg__retry" @click="emit('retry')">重试</button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.chat-msg-list {
  display: flex;
  flex-direction: column;
  gap: 18px;
  overflow-y: auto;
  /* 内层聊天流不再画原生粗滚动槽（2026-11-06 审计 §6）：Windows Chromium 的经典
     滚动条（灰杠 + 上下箭头）会把气泡文字挤窄一截，和滚动容器自身的内边距叠成错位。
     滚轮 / 触控 / 键盘滚动、焦点滚入视野均不变；外层容器若另有细滑块，由宿主决定。 */
  scrollbar-width: none;
}
.chat-msg-list::-webkit-scrollbar { width: 0; height: 0; }
/* 「发现卡点」的状态标签（2026-11-06 审计 §1 / 复核修正）：20px 小方签只套在短标签上——
   后半句「「X」· 导师会在这里多做确认」是可换行的说明文字，跟着标签一起塞进 20px 定高
   会溢出压到下方 meta 行。现在改为「标签 + 说明」两段：标签固定 20px，说明正常换行。 */
.msg__chip {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  align-self: flex-start;
  max-width: 100%;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.5;
  color: var(--muted);
}
.msg__chip-tag {
  flex: none;
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 1px 6px;
  border-radius: var(--mk-radius-xs);
  background: color-mix(in srgb, var(--wf-color-warning) 14%, transparent);
  color: var(--amber-ink);
  font-weight: 700;
  white-space: nowrap;
}
.msg__chip-text { min-width: 0; }
.msg__chip--confuse .msg__chip-text { color: var(--amber-ink); }
/* 发送失败重试：真按钮（父页 scoped 样式够不到本组件，这里自带 reset 兜底） */
.msg__retry {
  margin-left: 8px;
  color: var(--mk-red);
  font-weight: 700;
  text-decoration: underline;
  cursor: pointer;
  border: 0;
  background: none;
  padding: 0;
  font: inherit;
}
</style>
