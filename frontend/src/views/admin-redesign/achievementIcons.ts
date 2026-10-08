/**
 * 成就类型 → 图标 / 色调 / 名称。
 *
 * 管理端 AchIcon.vue 与用户侧 V2Achievements.vue 共用同一份映射：两页的图标位
 * 是同一类型域（里程碑/连续/完成度/掌握/社交），此前各维护一份「首字标」字表
 * （管理端单字、用户侧两字），既容易漂移、又都不是图标——见 AchIcon.vue 顶部说明。
 */
import { Award, Brain, Flag, Flame, SquareCheckBig, Users } from 'lucide-vue-next'

export interface AchIconMeta {
  /** lucide 图标组件（交给 <component :is> 渲染） */
  icon: unknown
  /** 色块色调，对应各页自己的 --tone 类 */
  tone: string
  /** 类型名，同时作为 title / aria-label */
  label: string
}

export const ACH_TYPE_ICON: Record<string, AchIconMeta> = {
  milestone: { icon: Flag, tone: 'info', label: '里程碑' },
  streak: { icon: Flame, tone: 'warn', label: '连续' },
  completion: { icon: SquareCheckBig, tone: 'ok', label: '完成度' },
  mastery: { icon: Brain, tone: 'mastery', label: '掌握' },
  social: { icon: Users, tone: 'muted', label: '社交' },
}

/** 未知 type 的兜底（后端随时可能下发新成就类型）：奖章 + 中性灰。 */
export const ACH_ICON_FALLBACK: AchIconMeta = { icon: Award, tone: 'muted', label: '成就' }

export function achIconMeta(type?: string): AchIconMeta {
  return ACH_TYPE_ICON[type || ''] || ACH_ICON_FALLBACK
}
