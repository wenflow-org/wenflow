import express from 'express';

const router = express.Router();

router.get('/overview', async (req, res) => {
  const userId = req.user?.userId || 'unknown';

  res.json({
    success: true,
    data: {
      authMode: 'jwt-bearer',
      userId,
      baseUrl: '/api',
      docsPath: '/docs',
      sdkStatus: 'planned',
      webhookStatus: 'planned',
      pluginMarketplaceStatus: 'planned',
      availableScopes: [
        'goal-conversation:read',
        'goal-conversation:write',
        'agents:invoke',
        'learning-paths:read',
        'learning-paths:write'
      ],
      endpointGroups: [
        {
          name: 'Goal Conversation',
          basePath: '/api/goal-conversation',
          endpoints: ['POST /start', 'POST /:conversationId/reply', 'GET /:conversationId']
        },
        {
          name: 'Learning Paths',
          basePath: '/api/learning/paths',
          endpoints: ['GET /', 'GET /:id', 'POST /create']
        },
        {
          name: 'User Capability',
          basePath: '/api/user',
          endpoints: ['GET /agents', 'GET /skills', 'GET /api-config', 'GET /mcp']
        }
      ]
    }
  });
});

router.get('/quickstart', async (req, res) => {
  const quickstart = [
    '# Developer Quickstart',
    '',
    '1. 在个人中心 > 开发者接入中查看可用 API 组。',
    '2. 使用当前登录态 JWT 作为 Bearer Token 调用接口。',
    '3. 先从 Goal Conversation API 完成一次端到端联调。',
    '4. 再接入 Learning Paths API 完成结果落库与回显。',
    '',
    '```bash',
    'curl -X POST "http://localhost:3001/api/goal-conversation/start" \\',
    '  -H "Authorization: Bearer <YOUR_JWT_TOKEN>" \\',
    '  -H "Content-Type: application/json" \\',
    '  -d "{\"goal\":\"我想做一个可复用的问流 AI 学习助手\"}"',
    '```',
    '',
    '> 当前版本说明：SDK、Webhook、Plugin Marketplace 处于规划中；Agent 由平台托管发布，用户侧仅支持选择与启停。'
  ].join('\n');

  res.json({ success: true, data: { quickstart } });
});

export default router;
