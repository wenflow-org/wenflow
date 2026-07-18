// 用户 API 配置路由
import express from 'express';
import prisma from '../config/database';
import { randomUUID as uuidv4 } from 'crypto';
import { getAPIGateway } from '../gateway/api-gateway';
import apiConfigService from '../services/apiConfig.service';
import { safeHttpRequest } from '../utils/safe-http';
import { decryptSecret, encryptSecret } from '../utils/secret-crypto';

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
    const { endpoint, apiKey, chatModel, reasoningModel, enabled } = req.body;
    
    const existing = await prisma.user_api_configs.findUnique({ where: { userId } });
    const finalApiKey = typeof apiKey === 'string' && apiKey.trim()
      ? apiKey.trim()
      : decryptSecret(existing?.apiKey, SECRET_CONTEXT) || null;

    // 空 apiKey 表示保留已保存密钥。
    if (enabled && (!endpoint || !finalApiKey || !chatModel)) {
      return res.status(400).json({
        success: false,
        error: { message: '启用时必须提供 endpoint、apiKey 和 chatModel' }
      });
    }
    
    if (existing) {
      await prisma.user_api_configs.update({
        where: { userId },
        data: {
          endpoint,
          apiKey: encryptSecret(finalApiKey, SECRET_CONTEXT),
          chatModel,
          reasoningModel: reasoningModel || chatModel,  // 默认推理模型同对话模型
          enabled,
          updatedAt: new Date(),
        }
      });
    } else {
      await prisma.user_api_configs.create({
        data: {
          id: uuidv4(),
          userId,
          endpoint,
          apiKey: encryptSecret(finalApiKey, SECRET_CONTEXT),
          chatModel,
          reasoningModel: reasoningModel || chatModel,
          enabled,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      });
    }
    
    getAPIGateway().invalidateCache(userId);
    
    res.json({ 
      success: true, 
      data: { 
        enabled, 
        endpoint, 
        chatModel, 
        reasoningModel: reasoningModel || chatModel 
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
    const resolvedApiKey = typeof apiKey === 'string' && apiKey.trim()
      ? apiKey.trim()
      : decryptSecret(existing?.apiKey, SECRET_CONTEXT);

    if (!endpoint || !resolvedApiKey) {
      return res.status(400).json({
        success: false,
        error: { message: '需要提供 endpoint 和 apiKey' }
      });
    }
    
    const normalizedEndpoint = endpoint.replace(/\/+$/, '').replace(/\/v1$/, '');
    
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
        timeoutMs: 10000
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
