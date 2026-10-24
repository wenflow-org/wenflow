import { describe, expect, it } from 'vitest'
import {
  avatarInitial,
  displayNameOf,
  emailSubline,
  isIdentifierLike,
  sanitizeDisplayName,
} from '../avatarName'

describe('sanitizeDisplayName', () => {
  it('剔除替换字符、孤立代理项与控制字符，保留合法 CJK 与 emoji', () => {
    expect(sanitizeDisplayName('走查\uFFFD用户')).toBe('走查用户')
    expect(sanitizeDisplayName('a\uD800b')).toBe('ab')
    expect(sanitizeDisplayName('a\u0007b\tc')).toBe('ab c')
    expect(sanitizeDisplayName('张\uD83D\uDE00三')).toBe('张\uD83D\uDE00三')
  })

  it('非字符串输入与空白回落空串', () => {
    expect(sanitizeDisplayName(null)).toBe('')
    expect(sanitizeDisplayName(undefined)).toBe('')
    expect(sanitizeDisplayName('  \n ')).toBe('')
    expect(sanitizeDisplayName(42)).toBe('42')
  })
})

describe('displayNameOf', () => {
  it('清洗后昵称为空时回落邮箱 local part，再回落「用」', () => {
    expect(displayNameOf('走查用户', 'a@wenflow.local')).toBe('走查用户')
    expect(displayNameOf('\uFFFD', 'audit-user-d@wenflow.local')).toBe('audit-user-d')
    expect(displayNameOf('', '')).toBe('用')
  })
})

describe('avatarInitial', () => {
  it('按码点取首字，emoji 不被劈成半个代理项', () => {
    expect(avatarInitial('走查用户')).toBe('走')
    expect(avatarInitial('\uD83D\uDE00张三')).toBe('\uD83D\uDE00')
  })

  it('跳过开头的组合附加符并支持邮箱降级', () => {
    expect(avatarInitial('\u0301Élodie')).toBe('É')
    expect(avatarInitial('\uFFFD', 'audit-user-d@wenflow.local')).toBe('a')
    expect(avatarInitial('')).toBe('用')
  })
})

describe('emailSubline', () => {
  it('local part 与昵称同值时返回空串，避免逐行复读', () => {
    expect(emailSubline('e2e_long_1792549861398@wenflow.local', 'e2e_long_1792549861398')).toBe('')
    expect(emailSubline('audit-user-c@wenflow.local', '走查用户丙')).toBe('audit-user-c@wenflow.local')
    expect(emailSubline('', '走查用户丙')).toBe('')
  })
})

describe('isIdentifierLike', () => {
  it('识别机器 ID，但中文名与带空格文本不算', () => {
    expect(isIdentifierLike('e2e_long_1792549861398')).toBe(true)
    expect(isIdentifierLike('0cacbe7f-c2b3-4da8-af42-6364d550e180')).toBe(true)
    expect(isIdentifierLike('走查用户丙')).toBe(false)
    expect(isIdentifierLike('audit user')).toBe(false)
  })
})
