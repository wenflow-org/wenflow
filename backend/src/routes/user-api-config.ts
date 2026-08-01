// 用户 API 配置路由
import express from 'express';
import prisma from '../config/database';
import { randomUUID as uuidv4 } from 'crypto';
import { getAPIGateway } from '../gateway/api-gateway';
import apiConfigService from '../services/apiConfig.service';
import { safeHttpRequest } from '../utils/safe-http';
import { decryptSecret, encryptSecret } from '../utils/secret-crypto';
import { getRequestContext } from '../gateway/api-gateway/context';
import { endpointsMatch } from '../utils/endpoint-identity';

const SECRET_CONTEXT = 'main.user_api_configs.apiKey';

const router = express.Router();

// 获取平台默认配置
router.get('/platform-default', async (req, res) => {
  try {
    const platformDefault = await apiConfigService.getPlatformDefault();
    res.json({ success: true, data: platformDefault });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      error: { message: '获取平台默认配置失败', details: error.message }
    });
  }
});

// 获取用户配置
router.get('/', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const config = await prisma.user_api_configs.findUnique({ where: { userId } });
    
    if (!config) {
      return res.json({
        success: true,
        data: { 
          enabled: false, 
          endpoint: null, 
          apiKey: null, 
          chatModel: null, 
          reasoningModel: null 
        }
      });
    }
    
    // 不返回实际 apiKey，只返回状态
    res.json({
      success: true,
      data: {
        enabled: config.enabled,
        endpoint: config.endpoint,
        apiKey: '',
        hasApiKey: !!config.apiKey,
        apiKeyStatus: config.apiKey ? '已配置' : '未配置',
        chatModel: config.chatModel,
        reasoningModel: config.reasoningModel,
      }
    });
  } catch (error) {
    next(error);
  }
});

// 更新用户配置
router.put('/', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const body = req.body || {};
    const { endpoint, apiKey, chatModel, reasoningModel, enabled } = body;
    
    const existing = await prisma.user_api_configs.findUnique({ where: { userId } });
    const endpointProvided = Object.prototype.hasOwnProperty.call(body, 'endpoint');
    if (endpointProvided && endpoint !== null && typeof endpoint !== 'string') {
      return res.status(400).json({
        success: false,
        error: { message: 'endpoint 必须是字符串或 null' }
      });
    }
    const finalEndpoint = endpointProvided
      ? (typeof endpoint === 'string' ? endpoint.trim() || null : null)
      : existing?.endpoint || null;
    const providedApiKey = typeof apiKey === 'string' && apiKey.trim() ? apiKey.trim() : null;
    if (providedApiKey && !finalEndpoint) {
      return res.status(400).json({
        success: false,
        error: { message: '配置 apiKey 时必须同时提供 endpoint' }
      });
    }
    const finalApiKey = finalEndpoint
      ? providedApiKey
        || (endpointsMatch(finalEndpoint, existing?.endpoint)
          ? decryptSecret(existing?.apiKey, SECRET_CONTEXT) || null
          : null)
      : null;
    const finalEnabled = typeof enabled === 'boolean' ? enabled : existing?.enabled ?? false;
    const finalChatModel = chatModel !== undefined ? chatModel : existing?.chatModel;
    const finalReasoningModel = reasoningModel !== undefined
      ? reasoningModel || finalChatModel
      : existing?.reasoningModel || finalChatModel;

    // 仅当 Endpoint 未变化时，空 apiKey 才表示保留已保存密钥。
    if (finalEnabled && (!finalEndpoint || !finalApiKey || !finalChatModel)) {
      return res.status(400).json({
        success: false,
        error: { message: '启用时必须提供 endpoint、apiKey 和 chatModel' }
      });
    }
    
    if (existing) {
      await prisma.user_api_configs.update({
        where: { userId },
        data: {
          endpoint: finalEndpoint,
          apiKey: encryptSecret(finalApiKey, SECRET_CONTEXT),
          chatModel: finalChatModel,
          reasoningModel: finalReasoningModel,
          enabled: finalEnabled,
          updatedAt: new Date(),
        }
      });
    } else {
      await prisma.user_api_configs.create({
        data: {
          id: uuidv4(),
          userId,
          endpoint: finalEndpoint,
          apiKey: encryptSecret(finalApiKey, SECRET_CONTEXT),
          chatModel: finalChatModel,
          reasoningModel: finalReasoningModel,
          enabled: finalEnabled,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      });
    }
    
    getAPIGateway().invalidateCache(userId);
    
    res.json({ 
      success: true, 
      data: { 
        enabled: finalEnabled,
        endpoint: finalEndpoint,
        chatModel: finalChatModel,
        reasoningModel: finalReasoningModel
      } 
    });
  } catch (error) {
    next(error);
  }
});

// 禁用用户配置
router.delete('/', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    
    const existing = await prisma.user_api_configs.findUnique({ where: { userId } });
    
    if (existing) {
      await prisma.user_api_configs.update({
        where: { userId },
        data: { enabled: false, updatedAt: new Date() }
      });
      
      getAPIGateway().invalidateCache(userId);
    }
    
    res.json({ success: true, message: '已禁用用户配置，将使用平台默认' });
  } catch (error) {
    next(error);
  }
});

// 测试连接
router.post('/test', async (req, res, next) => {
  try {
    const { endpoint, apiKey, model } = req.body;
    const userId = req.user.userId;
    const existing = await prisma.user_api_configs.findUnique({ where: { userId } });
    const requestedEndpoint = typeof endpoint === 'string' ? endpoint.trim() : '';
    const resolvedApiKey = typeof apiKey === 'string' && apiKey.trim()
      ? apiKey.trim()
      : endpointsMatch(requestedEndpoint, existing?.endpoint)
        ? decryptSecret(existing?.apiKey, SECRET_CONTEXT)
        : null;

    if (!requestedEndpoint || !resolvedApiKey) {
      return res.status(400).json({
        success: false,
        error: { message: '需要提供 endpoint 和 apiKey' }
      });
    }
    
    const normalizedEndpoint = requestedEndpoint.replace(/\/+$/, '').replace(/\/v1$/, '');
    
    try {
      const resolvedModel = (model || process.env.AI_MODEL || '').trim();
      if (!resolvedModel) {
        return res.status(400).json({
          success: false,
          error: { message: '未提供 model，且系统未配置 AI_MODEL' }
        });
      }

      const response = await safeHttpRequest<any>(`${normalizedEndpoint}/v1/chat/completions`, {
        method: 'POST',
        body: {
          model: resolvedModel,
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 10
        },
        headers: {
          'Authorization': `Bearer ${resolvedApiKey}`,
          'Content-Type': 'application/json'
        },
        timeoutMs: 10000,
        privateNetworkPolicy: 'public-only',
        signal: getRequestContext().abortSignal
      });

      if (response.status < 200 || response.status >= 300) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      res.json({ 
        success: true, 
        message: '连接成功', 
        data: { model: response.data.model }
      });
    } catch (error: any) {
      res.status(400).json({
        success: false,
        error: { 
          message: '连接失败', 
          details: error.message
        }
      });
    }
  } catch (error) {
    next(error);
  }
});

export default router;
