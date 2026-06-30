import { ref } from 'vue';

export const isTestMode = ref(false);

export function setDebugMode(enabled: boolean): void {
  isTestMode.value = enabled;
}

export function isDevOverlayVisible(): boolean {
  return isTestMode.value;
}
