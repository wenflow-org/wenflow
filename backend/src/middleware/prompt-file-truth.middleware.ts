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
  /^\/sync\/?$/,
  /^\/[^/]+\/recompile\/?$/,
  /^\/[^/]+\/source\/?$/,
  /^\/[^/]+\/fields\/?$/
]

export function rejectPromptOpsRuntimeMutation(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD') return next()
  if (!PROMPT_OPS_MUTATIONS.some(pattern => pattern.test(req.path))) return next()
  return rejectPromptMutation(req, res, next)
}

const PROMPT_LAB_FILE_MUTATIONS = [
  /^\/source\/[^/]+\/?$/,
  /^\/manifest\/[^/]+\/?$/,
  /^\/source\/[^/]+\/create\/?$/,
  /^\/publish\/?$/
]

export function rejectPromptLabFileMutation(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD') return next()
  if (!PROMPT_LAB_FILE_MUTATIONS.some(pattern => pattern.test(req.path))) return next()
  return rejectPromptMutation(req, res, next)
}
