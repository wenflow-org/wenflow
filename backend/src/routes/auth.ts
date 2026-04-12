// 璁よ瘉璺敱
import express from 'express';
import { z } from 'zod';
import authService from '../services/auth/auth.service';
import { getPlatformSettings } from '../services/platform-settings.service';

const router = express.Router();

// 娉ㄥ唽鐘舵€侊紙鍏紑锛?
router.get('/registration-status', async (req, res, next) => {
  try {
    const settings = await getPlatformSettings();
    res.status(200).json({
      success: true,
      data: {
        registrationEnabled: settings.registrationEnabled
      }
    });
  } catch (error: any) {
    next(error);
  }
});

// 楠岃瘉schema
const registerSchema = z.object({
  email: z.string().email('鏃犳晥鐨勯偖绠卞湴鍧€'),
  password: z.string().min(6, '瀵嗙爜鑷冲皯6浣?),
  name: z.string().optional()
});

const loginSchema = z.object({
  email: z.string().email('鏃犳晥鐨勯偖绠卞湴鍧€'),
  password: z.string().min(1, '瀵嗙爜涓嶈兘涓虹┖')
});

// 娉ㄥ唽
router.post('/register', async (req, res, next) => {
  try {
    const settings = await getPlatformSettings();
    if (!settings.registrationEnabled) {
      return res.status(403).json({
        success: false,
        error: {
          message: '骞冲彴娉ㄥ唽宸插叧闂紝璇疯仈绯荤鐞嗗憳',
          status: 403
        }
      });
    }

    // 楠岃瘉璇锋眰鏁版嵁
    const data = registerSchema.parse(req.body) as { name: string; password: string };

    // 璋冪敤鏈嶅姟
    const result = await authService.register(data);

    res.status(201).json({
      success: true,
      data: result
    });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        error: {
          message: '鏁版嵁楠岃瘉澶辫触',
          details: error.errors
        }
      });
    }

    next(error);
  }
});

// 鐧诲綍
router.post('/login', async (req, res, next) => {
  try {
    // 楠岃瘉璇锋眰鏁版嵁
    const data = loginSchema.parse(req.body) as { name: string; password: string };

    // 璋冪敤鏈嶅姟
    const result = await authService.login(data);

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error: any) {
    if (error.name === 'ZodError') {
      return res.status(400).json({
        success: false,
        error: {
          message: '鏁版嵁楠岃瘉澶辫触',
          details: error.errors
        }
      });
    }

    next(error);
  }
});

// 楠岃瘉Token (protected endpoint)
router.post('/verify', async (req, res, next) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        error: { message: 'Token涓嶈兘涓虹┖' }
      });
    }

    const user = await authService.verifyToken(token);

    res.status(200).json({
      success: true,
      data: { user }
    });
  } catch (error: any) {
    next(error);
  }
});

export default router;
