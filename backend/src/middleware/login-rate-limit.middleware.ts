import { Request, Response, NextFunction } from 'express';

interface LoginAttempt {
  username: string;
  ip: string;
  timestamp: Date;
  success: boolean;
}

const MAX_ATTEMPTS = parseInt(process.env.LOGIN_MAX_ATTEMPTS || '5');
const LOCK_DURATION = parseInt(process.env.LOGIN_LOCK_DURATION || '900000');

const loginAttempts: Map<string, LoginAttempt[]> = new Map();

export const loginRateLimitMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const { name } = req.body;
  const clientIP = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  const key = `${name}:${clientIP}`;
  
  const attempts = loginAttempts.get(key) || [];
  const recentFailures = attempts.filter(
    a => !a.success && Date.now() - a.timestamp.getTime() < LOCK_DURATION
  );
  
  if (recentFailures.length >= MAX_ATTEMPTS) {
    const lastAttempt = recentFailures[recentFailures.length - 1];
    const remainingTime = Math.ceil(
      (LOCK_DURATION - (Date.now() - lastAttempt.timestamp.getTime())) / 1000
    );
    
    return res.status(429).json({
      success: false,
      error: {
        message: `登录失败次数过多，请 ${remainingTime} 秒后重试`,
        code: 'ACCOUNT_LOCKED',
        remainingTime
      }
    });
  }
  
  next();
};

export const recordLoginAttempt = (
  username: string,
  ip: string,
  success: boolean
) => {
  const key = `${username}:${ip}`;
  const attempts = loginAttempts.get(key) || [];
  
  attempts.push({
    username,
    ip,
    timestamp: new Date(),
    success
  });
  
  if (attempts.length > 20) {
    attempts.splice(0, attempts.length - 20);
  }
  
  loginAttempts.set(key, attempts);
};