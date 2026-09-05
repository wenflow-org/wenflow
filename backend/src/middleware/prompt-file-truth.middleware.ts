import { Request, Response, NextFunction } from 'express'

export const PROMPT_READ_ONLY_CODE = 'PROMPT_FILE_AS_TRUTH_READ_ONLY'
const PROMPT_READ_ONLY_MESSAGE = 'Prompt 采用 File-as-Truth，只能通过 prompts/*.md、Git 审核和部署同步修改'

export function rejectPromptMutation(req: Request, res: Response, _next: NextFunction) {
  return res.status(409).json({
    success: false,
    code: PROMPT_READ_ONLY_CODE,
    message: PROMPT_READ_ONLY_MESSAGE,
    error: {
      message: PROMPT_READ_ONLY_MESSAGE
    }
  })
}

export function rejectAgentPromptMutation(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD') return next()
  return rejectPromptMutation(req, res, next)
}

const PROMPT_OPS_MUTATIONS = [
  // 仅拦截直接改写 DB prompt 的路径（File-as-Truth：真源是 prompts/*.md，经 Git 审核后部署同步）。
  // /sync（文件 → DB 镜像同步）与 /recompile（编译产物刷新）是"文件为真源"的衍生操作，放行。
  // i 标志：防止 PUT /SOURCE 等大小写变体绕过只读守卫。
  /^\/[^/]+\/source\/?$/i,
  /^\/[^/]+\/fields\/?$/i
]

export function rejectPromptOpsRuntimeMutation(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD') return next()
  if (!PROMPT_OPS_MUTATIONS.some(pattern => pattern.test(req.path))) return next()
  return rejectPromptMutation(req, res, next)
}

const PROMPT_LAB_FILE_MUTATIONS = [
  /^\/source\/[^/]+\/?$/i,
  /^\/manifest\/[^/]+\/?$/i,
  /^\/source\/[^/]+\/create\/?$/i,
  /^\/publish\/?$/i
]

export function rejectPromptLabFileMutation(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD') return next()
  if (!PROMPT_LAB_FILE_MUTATIONS.some(pattern => pattern.test(req.path))) return next()
  return rejectPromptMutation(req, res, next)
}
