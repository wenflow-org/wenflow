import { Router, type Request, type Response } from 'express';
import { mcpGateway, type IMcpToolConfig } from '../../core/mcp/McpGateway';
import { logger } from '../../utils/logger';
import { setAuditAction, setAuditAfter, setAuditBefore } from '../../middleware/audit-context';

const router = Router();

const TOOL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

/** 响应不回显 apiKey：仅返回是否已配置 */
function sanitizeToolResponse(tool: IMcpToolConfig) {
  return {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    type: tool.type,
    endpoint: tool.endpoint,
    enabled: tool.enabled,
    userAccessible: !!tool.userAccessible,
    hasApiKey: !!tool.apiKey,
  };
}

/** GET / — 平台 MCP 工具与服务（外挂能力页 ② MCP 服务区）；apiKey 等敏感字段脱敏 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const cfg = mcpGateway.getConfig();
    const status = mcpGateway.getStatus();
    res.json({
      success: true,
      data: {
        tools: cfg.tools.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          type: t.type,
          endpoint: t.endpoint,
          enabled: t.enabled,
          userAccessible: !!t.userAccessible,
          hasApiKey: !!t.apiKey,
        })),
        servers: status.servers,
        toolStatus: status.tools,
      },
    });
  } catch (error: any) {
    logger.error('[admin-mcp] list failed:', error);
    res.status(500).json({ success: false, error: '读取 MCP 配置失败' });
  }
});

/** POST /tools — 新增平台 MCP 工具 */
router.post('/tools', async (req: Request, res: Response) => {
  try {
    const { id, name, type = 'http', endpoint, description = '', enabled = true, userAccessible = false, apiKey, config } = req.body || {};
    if (!id || !String(id).trim() || !TOOL_ID_PATTERN.test(String(id))) {
      return res.status(400).json({ success: false, error: '工具 ID 必填，仅允许字母数字与 . _ : -' });
    }
    if (!name || !String(name).trim()) {
      return res.status(400).json({ success: false, error: '名称必填' });
    }
    if (!endpoint || !String(endpoint).trim()) {
      return res.status(400).json({ success: false, error: 'endpoint 必填' });
    }
    const cfg = mcpGateway.getConfig();
    if (cfg.tools.some((t) => t.id === id)) {
      return res.status(400).json({ success: false, error: `工具 ${id} 已存在` });
    }
    const next: IMcpToolConfig = {
      id,
      name: String(name).trim(),
      description: String(description || ''),
      type: String(type),
      endpoint: String(endpoint).trim(),
      ...(apiKey ? { apiKey: String(apiKey) } : {}),
      enabled: enabled !== false,
      ...(userAccessible ? { userAccessible: true } : {}),
      ...(config && typeof config === 'object' ? { config } : {}),
    };
    await mcpGateway.updateConfig({ tools: [...cfg.tools, next] });
    // 操作审计：新建快照新工具（apiKey 等敏感字段由审计中间件统一脱敏）
    setAuditAction(res, 'mcp-tool-create', { targetType: 'mcp-tool', targetId: id });
    setAuditAfter(res, next);
    res.json({ success: true, data: sanitizeToolResponse(next) });
  } catch (error: any) {
    logger.error('[admin-mcp] create tool failed:', error);
    res.status(500).json({ success: false, error: '新增 MCP 工具失败' });
  }
});

/** PUT /tools/:id — 更新平台 MCP 工具 */
router.put('/tools/:id', async (req: Request, res: Response) => {
  try {
    const cfg = mcpGateway.getConfig();
    const idx = cfg.tools.findIndex((t) => t.id === req.params.id);
    if (idx < 0) {
      return res.status(404).json({ success: false, error: '工具不存在' });
    }
    const cur = cfg.tools[idx];
    const { name, type, endpoint, description, enabled, userAccessible, apiKey, config } = req.body || {};
    const next: IMcpToolConfig = {
      ...cur,
      ...(name !== undefined ? { name: String(name).trim() } : {}),
      ...(type !== undefined ? { type: String(type) } : {}),
      ...(endpoint !== undefined ? { endpoint: String(endpoint).trim() } : {}),
      ...(description !== undefined ? { description: String(description) } : {}),
      ...(enabled !== undefined ? { enabled: enabled !== false } : {}),
      ...(userAccessible !== undefined ? { userAccessible: !!userAccessible } : {}),
      ...(apiKey ? { apiKey: String(apiKey) } : apiKey === '' ? { apiKey: undefined as unknown as string } : {}),
      ...(config && typeof config === 'object' ? { config } : config === null ? { config: undefined as unknown as Record<string, unknown> } : {}),
    };
    const tools = [...cfg.tools];
    tools[idx] = next;
    await mcpGateway.updateConfig({ tools });
    // 操作审计：更新前快照旧工具、更新后快照新工具
    setAuditAction(res, 'mcp-tool-update', { targetType: 'mcp-tool', targetId: req.params.id });
    setAuditBefore(res, cur);
    setAuditAfter(res, next);
    res.json({ success: true, data: sanitizeToolResponse(next) });
  } catch (error: any) {
    logger.error('[admin-mcp] update tool failed:', error);
    res.status(500).json({ success: false, error: '更新 MCP 工具失败' });
  }
});

/** DELETE /tools/:id — 删除平台 MCP 工具 */
router.delete('/tools/:id', async (req: Request, res: Response) => {
  try {
    const cfg = mcpGateway.getConfig();
    const removed = cfg.tools.find((t) => t.id === req.params.id);
    if (!removed) {
      return res.status(404).json({ success: false, error: '工具不存在' });
    }
    const tools = cfg.tools.filter((t) => t.id !== req.params.id);
    await mcpGateway.updateConfig({ tools });
    // 操作审计：删除前快照被删工具（apiKey 等敏感字段由审计中间件统一脱敏）
    setAuditAction(res, 'mcp-tool-delete', { targetType: 'mcp-tool', targetId: req.params.id });
    setAuditBefore(res, removed);
    res.json({ success: true });
  } catch (error: any) {
    logger.error('[admin-mcp] delete tool failed:', error);
    res.status(500).json({ success: false, error: '删除 MCP 工具失败' });
  }
});

/** POST /tools/:id/test — 连通性测试（本地工具用极简参数探测，远端工具按 endpoint 直连） */
router.post('/tools/:id/test', async (req: Request, res: Response) => {
  try {
    const tool = mcpGateway.getTool(req.params.id);
    if (!tool) {
      return res.status(404).json({ success: false, error: '工具不存在' });
    }
    const started = Date.now();
    try {
      const result = await mcpGateway.callTool(tool.id, { probe: true });
      res.json({
        success: true,
        data: {
          ok: true,
          latencyMs: Date.now() - started,
          preview: typeof result === 'string' ? result.slice(0, 120) : JSON.stringify(result).slice(0, 120),
        },
      });
    } catch (callError: any) {
      res.json({
        success: false,
        data: {
          ok: false,
          latencyMs: Date.now() - started,
          error: String(callError?.message || callError || '调用失败').slice(0, 200),
        },
      });
    }
  } catch (error: any) {
    logger.error('[admin-mcp] test tool failed:', error);
    res.status(500).json({ success: false, error: '测试 MCP 工具失败' });
  }
});

export default router;
