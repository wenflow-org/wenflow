import { onMounted, onUnmounted, ref } from 'vue';

/**
 * 浏览器联网状态（navigator.onLine + online/offline 事件）。
 * 这是浏览器视角的判定：服务端不可达但本机联网时仍为 online，
 * 请求级失败由各页面错误态承接，两层互补。
 */
export function useOnline() {
  const online = ref(navigator.onLine);
  const update = () => {
    online.value = navigator.onLine;
  };

  onMounted(() => {
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
  });
  onUnmounted(() => {
    window.removeEventListener('online', update);
    window.removeEventListener('offline', update);
  });

  return { online };
}
