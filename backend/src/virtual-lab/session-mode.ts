export class VirtualSessionModeError extends Error {
  readonly code = 'VIRTUAL_SESSION_MODE_MISMATCH'
  readonly statusCode = 409
  readonly retryable = false

  constructor(message: string) {
    super(message)
    this.name = 'VirtualSessionModeError'
  }
}

export function getVirtualSessionMode(stageResults: any): 'blackbox-api' | 'assisted' {
  return stageResults?.experiment?.mode === 'blackbox-api' ? 'blackbox-api' : 'assisted'
}

export function assertBlackboxSessionMode(stageResults: any) {
  if (getVirtualSessionMode(stageResults) !== 'blackbox-api') {
    throw new VirtualSessionModeError('当前会话不是 blackbox-api 实验')
  }
}

export function assertAssistedSessionMode(stageResults: any) {
  if (getVirtualSessionMode(stageResults) === 'blackbox-api') {
    throw new VirtualSessionModeError('blackbox-api 实验不能使用辅助模式接口')
  }
}
