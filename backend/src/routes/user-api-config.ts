// 用户 API 配置路由
import express from 'express';
import prisma from '../config/database';
import { authMiddleware } from '../middleware/auth.middleware';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { clearUserProviderCache } from '../gateway/openai-client';
import apiConfigService from '../services/apiConfig.service';

const router = express.Router();

router.use(authMiddleware);

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
    
    // 验证必填字段（如果启用）
    if (enabled && (!endpoint || !apiKey || !chatModel)) {
      return res.status(400).json({
        success: false,
        error: { message: '启用时必须提供 endpoint、apiKey 和 chatModel' }
      });
    }
    
    const existing = await prisma.user_api_configs.findUnique({ where: { userId } });
    
    // 如果 apiKey 为空字符串，保留原有的 apiKey
    const finalApiKey = apiKey || existing?.apiKey || null;
    
    if (existing) {
      await prisma.user_api_configs.update({
        where: { userId },
        data: {
          endpoint,
          apiKey: finalApiKey,
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
          apiKey: finalApiKey,
          chatModel,
          reasoningModel: reasoningModel || chatModel,
          enabled,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      });
    }
    
    clearUserProviderCache(userId);
    
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
      
      clearUserProviderCache(userId);
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
    
    if (!endpoint || !apiKey) {
      return res.status(400).json({
        success: false,
        error: { message: '需要提供 endpoint 和 apiKey' }
      });
    }
    
    const normalizedEndpoint = endpoint.replace(/\/+$/, '').replace(/\/v1$/, '');
    
    try {
      const response = await axios.post(
        `${normalizedEndpoint}/v1/chat/completions`,
        {
          model: model || 'deepseek-chat',
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 10
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );
      
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
          details: error.response?.data?.error?.message || error.message 
        }
      });
    }
  } catch (error) {
    next(error);
  }
});

export default router;