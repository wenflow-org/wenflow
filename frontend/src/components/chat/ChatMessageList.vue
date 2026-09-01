<script setup lang="ts">
/**
 * ChatMessageList — reusable scrollable message list.
 * Renders a list of messages with avatars, timestamps, markdown, and retry support.
 * Designed to work inside a container that provides its own scroll (e.g. .tutor__scroll, .chat__scroll).
 */
import { nextTick, ref } from 'vue';
import { renderAiMessageHtml } from '@/utils/sanitize';

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

/** Streaming-render memoisation: avoids re-running markdown + DOMPurify on every delta */
const htmlCache = new WeakMap<object, { text: string; html: string }>();
function htmlFor(m: { text: string }): string {
  const hit = htmlCache.get(m);
  if (hit && hit.text === m.text) return hit.html;
  const html = renderAiMessageHtml(m.text);
  htmlCache.set(m, { text: m.text, html });
  return html;
}

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
        <span v-if="showAvatar" class="msg__avatar"><img src="/favicon.png" :alt="aiLabel" /></span>
        <div class="msg__content">
          <div class="msg__bubble msg__bubble--html" v-html="htmlFor(m)"></div>
          <span v-if="m.confusion?.length" class="msg__chip msg__chip--confuse">捕获到卡点「{{ m.confusion.join('、') }}」· 导师会在这里多做确认</span>
          <div class="msg__meta">
            {{ aiLabel }} · {{ m.time || nowTime() }}
            <span v-if="m.failed" class="msg__retry" @click="emit('retry')">重试</span>
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
}
</style>
