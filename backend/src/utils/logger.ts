import winston from 'winston';
import 'dotenv/config';
import { mkdirSync } from 'fs';
import { isAbsolute, resolve } from 'path';
import { getRequestContext } from '../gateway/api-gateway/context';
import { redactLogValue, redactSecretText } from './secret-redaction';

if (process.platform !== 'win32') process.umask(0o077);
const backendRoot = resolve(__dirname, '..', '..');
const configuredLogDir = (process.env.LOG_DIR || '').trim();
const logDir = configuredLogDir
  ? (isAbsolute(configuredLogDir) ? configuredLogDir : resolve(backendRoot, configuredLogDir))
  : resolve(backendRoot, 'logs');
mkdirSync(logDir, { recursive: true, mode: 0o700 });

const requestContextFormat = winston.format((info) => {
  const context = getRequestContext();
  if (context.traceId && !info.traceId) info.traceId = context.traceId;
  if (context.userId && !info.userId) info.userId = context.userId;
  if (context.sourceEntry && !info.sourceEntry) info.sourceEntry = context.sourceEntry;
  if (context.callerAgent && !info.callerAgent) info.callerAgent = context.callerAgent;
  if (context.userRole && !info.userRole) info.userRole = context.userRole;
  if (context.agentId && !info.agentId) info.agentId = context.agentId;
  if (context.skillId && !info.skillId) info.skillId = context.skillId;
  if (context.action && !info.action) info.action = context.action;
  if (context.experimentId && !info.experimentId) info.experimentId = context.experimentId;
  if (context.runId && !info.runId) info.runId = context.runId;
  return info;
});

const secretRedactionFormat = winston.format((info) => {
  for (const key of Object.keys(info)) {
    if (key === 'level' || key === 'timestamp') continue;
    info[key] = key === 'message' && typeof info[key] === 'string'
      ? redactSecretText(info[key] as string)
      : redactLogValue(info[key]);
  }
  return info;
});

const logFormat = winston.format.combine(
  requestContextFormat(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  secretRedactionFormat(),
  winston.format.json()
);

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { service: 'wenflow' },
  transports: [
    // 写入所有日志到combined.log
    new winston.transports.File({ filename: resolve(logDir, 'error.log'), level: 'error' }),
    new winston.transports.File({ filename: resolve(logDir, 'combined.log') })
  ]
});

// 容器和服务管理器依赖 stdout；生产保持 JSON，开发使用可读格式。
if (process.env.NODE_ENV === 'production') {
  logger.add(new winston.transports.Console({ format: logFormat }));
} else {
  logger.add(
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...metadata }) => {
          let msg = `${timestamp} [${level}]: ${message}`;
          if (Object.keys(metadata).length > 0) {
            msg += ` ${JSON.stringify(metadata)}`;
          }
          return msg;
        })
      )
    })
  );
}
