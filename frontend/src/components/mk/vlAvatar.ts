/**
 * 虚拟学习者「身份哈希八色」头像（VirtualLearners 列表 / VirtualProfile 详情共用）。
 * 色值单源在 src/styles/main.css 的 --mk-vl-avatar-0..7（彩底白字对比度已调 ≥4.5:1，
 * 走查 2026-09-27）；此处只提供同一哈希 → 档位映射，保证同一人在列表与详情恒定同色。
 * （CM3：原先 TS 数组 + 两页 CSS 共三份拷贝，2026-10-05 收敛。）
 */
export const VL_AVATAR_TONE_COUNT = 8

export function vlAvatarIndexOf(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return h % VL_AVATAR_TONE_COUNT
}
