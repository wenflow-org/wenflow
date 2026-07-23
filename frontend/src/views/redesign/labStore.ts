import { reactive } from 'vue';

export type LabScene =
  | 'dashboard'
  | 'goal'
  | 'paths'
  | 'path-detail'
  | 'learning'
  | 'state'
  | 'achievements';

/** 重设计稿内部场景导航：所有 mock 页面之间的跳转都走这里，不跳正式页面 */
export const labStore = reactive({
  scene: 'dashboard' as LabScene
});

export function labGo(scene: LabScene) {
  labStore.scene = scene;
}
