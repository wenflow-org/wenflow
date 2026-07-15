import winston from 'winston';
import { getRequestContext } from '../gateway/api-gateway/context';

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

const logFormat = winston.format.combine(
  requestContextFormat(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  defaultMeta: { service: 'wenflow' },
  transports: [
    // 写入所有日志到combined.log
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' })
  ]
});

// 如果不是生产环境，同时输出到控制台
if (process.env.NODE_ENV !== 'production') {
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
