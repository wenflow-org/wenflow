import {
  PROMPT_READ_ONLY_CODE,
  rejectAgentPromptMutation,
  rejectPromptLabFileMutation,
  rejectPromptMutation,
  rejectPromptOpsRuntimeMutation
} from '../prompt-file-truth.middleware'

function createResponse() {
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(body: unknown) {
      this.body = body
      return this
    }
  }
  return res
}

describe('Prompt File-as-Truth mutation guards', () => {
  it('统一返回稳定的只读错误', () => {
    const res = createResponse()
    rejectPromptMutation({} as any, res, jest.fn())
    expect(res.statusCode).toBe(409)
    expect(res.body).toEqual(expect.objectContaining({
      success: false,
      code: PROMPT_READ_ONLY_CODE
    }))
  })

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('agent-prompts 拒绝 %s', method => {
    const res = createResponse()
    const next = jest.fn()
    rejectAgentPromptMutation({ method } as any, res, next)
    expect(res.statusCode).toBe(409)
    expect(next).not.toHaveBeenCalled()
  })

  it('agent-prompts 允许 GET', () => {
    const next = jest.fn()
    rejectAgentPromptMutation({ method: 'GET' } as any, createResponse(), next)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it.each([
    '/sync',
    '/skill%3Agoal-conversation/recompile',
    '/skill%3Agoal-conversation/source',
    '/skill%3Agoal-conversation/fields'
  ])('prompt-ops 拒绝正式运行态写入 %s', path => {
    const res = createResponse()
    const next = jest.fn()
    rejectPromptOpsRuntimeMutation({ method: 'POST', path } as any, res, next)
    expect(res.statusCode).toBe(409)
    expect(next).not.toHaveBeenCalled()
  })

  it.each(['/eval-cases', '/run-eval', '/compile-skill'])('保留评测或 Dry Run 操作 %s', path => {
    const next = jest.fn()
    rejectPromptOpsRuntimeMutation({ method: 'POST', path } as any, createResponse(), next)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it.each([
    '/source/goal-conversation',
    '/manifest/goal-conversation',
    '/source/goal-conversation/create',
    '/publish'
  ])('prompt-lab 拒绝文件或发布写入 %s', path => {
    const res = createResponse()
    const next = jest.fn()
    rejectPromptLabFileMutation({ method: path.includes('/source/') && !path.endsWith('/create') ? 'PUT' : 'POST', path } as any, res, next)
    expect(res.statusCode).toBe(409)
    expect(next).not.toHaveBeenCalled()
  })

  it.each(['/compile-source', '/compile-skill', '/validate-config'])('prompt-lab 允许纯 Dry Run %s', path => {
    const next = jest.fn()
    rejectPromptLabFileMutation({ method: 'POST', path } as any, createResponse(), next)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it.each(['/source/goal-conversation', '/manifest/goal-conversation', '/goal-conversation/fields'])('只读 GET 继续放行 %s', path => {
    const next = jest.fn()
    const middleware = path.endsWith('/fields') ? rejectPromptOpsRuntimeMutation : rejectPromptLabFileMutation
    middleware({ method: 'GET', path } as any, createResponse(), next)
    expect(next).toHaveBeenCalledTimes(1)
  })
})
