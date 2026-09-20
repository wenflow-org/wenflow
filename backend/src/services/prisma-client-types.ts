/**
 * 租户库 Prisma 类型的服务层出口。
 *
 * routes 层需要少量 Prisma 类型（如 teaching_sessionsWhereInput、goal_conversations 行类型）时
 * 经此模块引用，避免直接 import '@prisma/client'——边界棘轮会把任何形式的该模块导入
 * 计入违规文件清单（type-only 也不例外）。
 */
export type { Prisma, goal_conversations } from '@prisma/client';
