<template>
  <Transition name="offline-bar">
    <div v-if="!online" class="offline-bar" role="status">
      <WifiOff :size="14" :stroke-width="2" aria-hidden="true" />
      <span>网络已断开，页面可能不是最新内容；恢复后可继续操作。</span>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { watch } from 'vue';
import { WifiOff } from 'lucide-vue-next';
import { useOnline } from '@/composables/useOnline';
import { toast } from '@/utils/toast';

const { online } = useOnline();

/* 断网→恢复：横条退场的同时给一句确认，用户不必猜「刚才是断网吗」。
   toast 自带 1.2s 去重，网络抖动不会连环弹。 */
watch(online, (val, old) => {
  if (old === false && val) toast.success('网络已恢复');
});
</script>

<style scoped>
/* 全局覆盖条：fixed 顶部，不挤动布局（挤动会让滚动中的页面跳一截）。
   z 高于页面级弹层（v2 详情弹窗用到 1200），网络状态是全站前提，任何层之下都不该"看不见"。 */
.offline-bar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 2400;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 34px;
  padding: 6px 16px;
  background: color-mix(in srgb, var(--mk-amber) 14%, var(--mk-surface));
  color: var(--amber-ink);
  border-bottom: 1px solid color-mix(in srgb, var(--mk-amber) 32%, transparent);
  font-size: 13px;
  font-weight: 600;
  text-align: center;
}

.offline-bar-enter-active,
.offline-bar-leave-active {
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
}
.offline-bar-enter-from,
.offline-bar-leave-to {
  transform: translateY(-100%);
  opacity: 0;
}
</style>
