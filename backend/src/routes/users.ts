// 用户路由
import express from 'express';
import bcrypt from 'bcryptjs';
import {
  findCurrentUserProfile,
  findActivePathIdByUpdatedAt,
  updateUser,
  findUserForDeactivation,
  listUserAchievements,
  listUserTeachingSessions,
  countUserTeachingSessions,
  findSubtasksByIds,
  listUserAgentLogsForGrouping,
  listUserAgentLogsForExport,
  findUserAgentLogById,
  markOnboardingCompleted,
} from '../services/users/user.repo';
import {
  parseAgentLogGroupId,
  collapseAgentLogGroups,
} from '../services/users/agent-log-grouping';
import { rejectProjectionAccess } from '../middleware/projection-access.middleware';
import { learnerSnapshotRefreshService } from '../services/learner/LearnerSnapshotRefreshService';
import { getLevelFromXp } from '../services/learner/level.util';
import { normalizeSessionDurationMinutes } from '../services/learning/learning.helpers';
import { listAgentManifest, listUserListedAgentIds, type MonitoringGroupName } from '../services/agent-manifest.service';
import { parseDayKeyRange } from '../services/time/day-boundary';
import { loadTeachingMessagesForIds } from '../services/ai-teaching/teaching-session-message-store';

// 与 auth.service 等价的假哈希：密码比对失败时保持恒定时间，防时序探测
const INVALID_LOGIN_PASSWORD_HASH = '$2b$10$OAioDMuBkv4OiDj1OPaJse/r3xbZoGaxLWtBNBD6VSlBa5T4nwkdG';

const router = express.Router();

// capabilityType（前端「活动类型」筛选键）→ manifest 监控组。
// agent id 的单一事实源是 manifest：此前这里是一张手写 id 表，teaching/tutoring/profile
// 挂的是已废弃 id（ai-teaching-agent / ai-tutor / learner-model-agent，线上 0 行），
// 真实授课 id 是 skill:teaching-turn（Teaching 组），于是按这三类筛选恒空。
const CAPABILITY_MONITORING_GROUPS: Record<string, MonitoringGroupName> = {
  goal: 'Goal',
  path: 'Path',
  teaching: 'Teaching',
  profile: 'Profile'
};

function buildCapabilityAgentMap(): Record<string, string[]> {
  const manifest = listAgentManifest();
  const userListed = new Set(listUserListedAgentIds());
  const map: Record<string, string[]> = {};
  for (const [capabilityType, group] of Object.entries(CAPABILITY_MONITORING_GROUPS)) {
    // #226：能力筛选 = 在用户可见集内再按能力筛。此前这里直接取整个监控组，
    // 于是 profile 把 userListed=false 的内部 skill（skill:adaptive-guidance-copy 等）
    // 全放出来——默认视图 0 行、筛选视图 86 行，两个视图各有各的可见集。
    map[capabilityType] = manifest
      .filter((entry) => entry.monitoringGroup === group && userListed.has(entry.id))
      .map((entry) => entry.id);
  }
  // tutoring / tracking 在 manifest 里没有对应监控组（没有辅导、进度追踪 Agent），
  // 显式保留空数组，维持「筛该项返回空」的既有行为：若删掉键，请求会因不命中
  // `capabilityType in capabilityAgents` 而退化成不筛选，反而返回全部日志。
  map.tutoring = [];
  map.tracking = [];
  // 平台底层调用不是 manifest 里的 agent/skill（也就不在 userListed 白名单里），
  // 「系统底层调用」是刻意独立于默认视图的显式范围（同 includeSystem），保持原有口径
  map.system = ['system-call', 'unknown'];
  return map;
}

function buildAgentLogWhere(userId: string, query: any) {
  const agentId = query.agentId as string;
  const capabilityType = query.capabilityType as string;
  const success = query.success as string;
  const includeSystem = query.includeSystem as string;
  const startDate = query.startDate as string;
  const endDate = query.endDate as string;
  const where: any = { userId };

  const capabilityAgents = buildCapabilityAgentMap();

  if (agentId) {
    where.agentId = agentId;
  } else if (capabilityType && capabilityType in capabilityAgents) {
    where.agentId = { in: capabilityAgents[capabilityType] };
  }

  if (success !== undefined) {
    where.success = success === 'true';
  }

  if (includeSystem !== 'true' && !agentId && !capabilityType) {
    // 默认「AI 任务记录」口径：只放行真实写日志的业务动作（manifest userListed）。
    // 不能用 userVisible：它表示「是否顶层编排器」——goal-agent/teaching-agent 被放行却全表
    // 0 行（真实调用记在 skill:goal-conversation / skill:teaching-turn 名下），默认视图结构性
    // 只剩 path-agent。也不能用「排除内部 skill」的黑名单：清单外的网关/历史 id 会漏进来，
    // 才需要 executionLayer 补丁。此处白名单同时天然排除 api-gateway / system-call / unknown。
    where.agentId = { in: listUserListedAgentIds() };
  }

  if (startDate || endDate) {
    // 日期键按应用时区本地日解析（P0-3：此前 startDate 走 UTC 零点、endDate 走机器本地 23:59:59，
    // 起止口径不对称，UTC+8 用户 00:00–08:00 的记录会被整段漏掉）
    const range = parseDayKeyRange(startDate, endDate);
    where.calledAt = {};
    if (range.from) {
      where.calledAt.gte = range.from;
    }
    if (range.to) {
      where.calledAt.lte = range.to;
    }
  }

  return where;
}

const directUserSessionOnly = rejectProjectionAccess('投影视角不允许修改账户信息');

// 获取当前用户信息
router.get('/me', async (req, res, next) => {
  try {
    const userId = req.user.userId;

    const user = await findCurrentUserProfile(userId);

    if (user?.deletedAt) {
      return res.status(401).json({
        success: false,
        error: { message: '账号已被删除', status: 401 }
      });
    }

    if (!user) {
      return res.status(404).json({
        success: false,
        error: { message: '用户不存在' }
      });
    }

    // 计算用户等级（基于XP，单点公式 level.util）
    const calculatedLevel = getLevelFromXp(user.xp);

    const { deletedAt: _deletedAt, ...userPayload } = user;

    res.json({
      success: true,
      data: {
        ...userPayload,
        level: calculatedLevel,
        xpToNextLevel: (calculatedLevel * calculatedLevel * 100) - user.xp
      }
    });
  } catch (error) {
    next(error);
  }
});

router.get('/me/learner-center', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const requestedPathId = typeof req.query.pathId === 'string' ? req.query.pathId : undefined;
    const scope = req.query.scope === 'path' || req.query.scope === 'teaching' ? req.query.scope : 'global';

    let pathId = requestedPathId;

    // 用户侧全局快照默认补一条活跃路径，避免账户页等入口误判为“暂无进行中路径”。
    if (!pathId && scope === 'global') {
      const activePath = await findActivePathIdByUpdatedAt(userId);

      pathId = activePath?.id;
    }

    const snapshot = await learnerSnapshotRefreshService.refresh({
      userId,
      pathId,
      scope,
    });

    res.json({
      success: true,
      data: snapshot,
    });
  } catch (error) {
    next(error);
  }
});

// 更新用户信息
router.put('/me', directUserSessionOnly, async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { name } = req.body;

    // G8：name 校验——非空、长度 ≤64、字符集白名单（与注册一致）；users.name 非唯一（仅 email 唯一），按设计不做重名校验
    const USERNAME_PATTERN = /^[\p{L}\p{N}_-]+$/u;
    let normalizedName: string | undefined;
    if (name !== undefined) {
      if (typeof name !== 'string') {
        return res.status(400).json({ success: false, error: { message: 'name 必须为字符串' } });
      }
      const trimmed = name.trim();
      if (!trimmed) {
        return res.status(400).json({ success: false, error: { message: 'name 不能为空' } });
      }
      if (trimmed.length > 64) {
        return res.status(400).json({ success: false, error: { message: 'name 不能超过 64 字符' } });
      }
      if (!USERNAME_PATTERN.test(trimmed)) {
        return res.status(400).json({ success: false, error: { message: '用户名仅支持字母、数字、下划线和连字符' } });
      }
      normalizedName = trimmed;
    }

    const user = await updateUser({
      where: { id: userId },
      data: {
        ...(normalizedName ? { name: normalizedName } : {})
      },
      select: {
        id: true,
        email: true,
        name: true,
        xp: true,
        role: true,
        currentLevel: true,
        updatedAt: true
      }
    });

    res.json({
      success: true,
      data: user
    });
  } catch (error) {
    next(error);
  }
});

// 用户自助注销：密码确认后软删除本人账号（deletedBy 记本人），并吊销全部旧 JWT
router.post('/me/deactivate', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!password) {
      return res.status(400).json({
        success: false,
        error: { message: '请输入密码以确认注销' }
      });
    }

    const user = await findUserForDeactivation(userId);
    if (!user || user.deletedAt) {
      return res.status(404).json({
        success: false,
        error: { message: '账号不存在' }
      });
    }

    const isValid = await bcrypt.compare(password, user.password || INVALID_LOGIN_PASSWORD_HASH);
    if (!isValid) {
      return res.status(400).json({
        success: false,
        error: { message: '密码不正确' }
      });
    }

    await updateUser({
      where: { id: userId },
      data: {
        deletedAt: new Date(),
        deletedBy: userId,
        // 递增 tokenVersion：注销后旧 JWT 立即失效（middleware 也会因 deletedAt 拒绝）
        tokenVersion: { increment: 1 }
      }
    });

    // 清除 HttpOnly Cookie
    res.clearCookie('wenflow_token', { httpOnly: true, sameSite: 'strict', path: '/' });

    res.json({
      success: true,
      data: { message: '账号已注销，感谢使用' }
    });
  } catch (error) {
    next(error);
  }
});
router.get('/me/achievements', async (req, res, next) => {
  try {
    const userId = req.user.userId;

    const achievements = await listUserAchievements(userId);

    res.json({
      success: true,
      data: achievements,
      total: achievements.length
    });
  } catch (error) {
    next(error);
  }
});

// 获取用户学习会话历史
router.get('/me/sessions', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    // limit 钳制（1-500），防止无上限分页拉全表；上限对齐调用方——V2Dashboard 近 90 天
    // streak/节奏窗口与 Profile 均按 500 拉取，旧 100 上限会静默截断重度用户（>100 条会话）
    // 导致跨月窗口缺数（2026-10-05 评审收敛）
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 100, 1), 500);
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    // 排除 superseded（stale/failed 行被回收重开：无真实进展，openKey 被新会话接管），
    // 但保留 discarded —— 它是用户点「重新开始」后的旧会话，duration 是真实有效时长，属于学习记录。
    // 需要原始全量（含 superseded）时传 includeInternal=1。
    const includeInternal = req.query.includeInternal === '1' || req.query.includeInternal === 'true';

    // 构建查询条件
    const where: any = { userId };
    if (!includeInternal) {
      where.status = { notIn: ['superseded'] };
    }
    
    // 日期范围过滤：日期键按应用时区本地日解析（2026-10-31 走查 P0-3——
    // 此前 startDate 解析成 UTC 零点（本地 08:00）、endDate 用机器本地 23:59:59，
    // 导致「今天 54 分钟」与「本月 0 分钟」同页并存、月历一格不上色）
    if (startDate || endDate) {
      const range = parseDayKeyRange(startDate, endDate);
      where.startTime = {};
      if (range.from) {
        where.startTime.gte = range.from;
      }
      if (range.to) {
        where.startTime.lte = range.to;
      }
    }

    const sessions = await listUserTeachingSessions(
      where,
      // page 分页：此前前端传 page 但后端忽略（无 skip），导致「加载更多」永远拿回同一页
      (Math.max(parseInt(req.query.page as string) || 1, 1) - 1) * limit,
      limit
    );

    // 全量总数（含日期过滤，与列表同 where）：供前端统计卡使用，避免分页后统计失真
    const total = await countUserTeachingSessions(where);

    const taskIds = Array.from(new Set(sessions.map((session) => session.taskId).filter(Boolean))) as string[];
    const tasks = taskIds.length > 0
      ? await findSubtasksByIds(taskIds)
      : [];

    const taskMap = new Map(tasks.map((task) => [task.id, task]));

    /* 时长同源（2026-10-31 复验）：无 duration 的会话（暂停/中止）此前在列表侧算 0 分钟，
       而 /learning/stats 侧会先水合旁表消息再估出真实分钟——同一节课两处不同
       （页头「累计 63 分钟」/ 本月卡「54 分钟」/ 列表那条显示「—」）。列表侧补同一份水合。 */
    const needMessages = sessions
      .filter((session) => !(Number(session.duration) > 0) && !session.messages)
      .map((session) => session.id);
    const messagesById = needMessages.length ? await loadTeachingMessagesForIds(needMessages) : null;
    const durationSessions = messagesById
      ? sessions.map((session) => (messagesById.has(session.id) ? { ...session, messages: messagesById.get(session.id) ?? session.messages } : session))
      : sessions;

    const enrichedSessions = durationSessions.map((session) => {
      const task = session.taskId ? taskMap.get(session.taskId) : null;
      let parsedState: any = null;

      if (session.teachingState) {
        try {
          parsedState = JSON.parse(session.teachingState);
        } catch {
          parsedState = null;
        }
      }

      // 时长统一口径（与 /learning/stats、学习状态聚合同源）：优先 duration 列（已扣暂停/idle），
      // 无值才用 endTime−startTime 兜底并封顶 30 分钟。此前这里裸算 endTime−startTime 且不封顶，
      // 导致跨天未收束的会话把日历单日算成几千甚至两万分钟（如 25729 分钟）。
      const durationMinutes = normalizeSessionDurationMinutes(session);

      return {
        ...session,
        durationMinutes,
        taskTitle: task?.title || null,
        taskStatus: task?.status || null,
        estimatedMinutes: task?.estimatedMinutes || null,
        parsedState
      };
    });

    res.json({
      success: true,
      data: enrichedSessions,
      total
    });
  } catch (error) {
    next(error);
  }
});

// 获取用户 Agent 调用日志
router.get('/me/agent-logs', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    // limit 钳制（1-100），防止无上限分页拉全表
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 20, 1), 100);
    const where = buildAgentLogWhere(userId, req.query);

    // #214 分页/总数须与「dedupe→会话折叠」后的组同口径：原始行数≠折叠组数。
    // 因此先取该用户全量（有上限）原始行，折叠成组后再对组做 slice/total。
    const logs = await listUserAgentLogsForGrouping(where);

    // #225：折叠管线单一事实源在 agent-log-grouping；详情端点用同一个 where 取数后
    // 调用同一个函数，两处 groupCount/groupItems/model 由构造保证一致。
    const sortedGroups = collapseAgentLogGroups(logs);

    // total 与 logs 同口径：total = 折叠后的组数，分页切片也落在组上
    const total = sortedGroups.length;
    const normalizedLogs = sortedGroups.slice((page - 1) * limit, (page - 1) * limit + limit);

    res.json({
      success: true,
      data: {
        logs: normalizedLogs,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// 导出日志
router.get('/me/agent-logs/export', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const format = (req.query.format as string) || 'json';
    const where = buildAgentLogWhere(userId, req.query);

    const logs = await listUserAgentLogsForExport(where);

    if (format === 'csv') {
      const headers = ['id', 'agentId', 'success', 'durationMs', 'tokensUsed', 'error', 'calledAt'];
      const csv = [
        headers.join(','),
        ...logs.map(log => 
          headers.map(h => {
            const value = (log as any)[h];
            if (typeof value === 'string' && /[",\r\n]/.test(value)) {
              return `"${value.replace(/"/g, '""')}"`;
            }
            return value ?? '';
          }).join(',')
        )
      ].join('\n');

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=agent-logs-${userId}.csv`);
      res.send(csv);
    } else {
      res.json({
        success: true,
        data: logs
      });
    }
  } catch (error) {
    next(error);
  }
});

// 获取单条日志详情。参数路由必须放在 /export 之后，避免把 export 当作 logId。
router.get('/me/agent-logs/:logId', async (req, res, next) => {
  try {
    const userId = req.user.userId;
    const { logId } = req.params;

    // #220：列表把同一会话折叠成一条，`id` 是合成组键（`path:`/`goal:<conversationId>`），
    // 不是 agent_call_logs 主键，直接 findFirst 必然 404。这里用与列表**完全相同**的
    // 取数口径与折叠管线（同一个 buildAgentLogWhere + 同一个 collapseAgentLogGroups），
    // 再从结果里取该组键，让列表返回的 id 稳定可详查。
    // #225：只共享 where 不够——列表的去重是跨会话的（key 不含会话），且模型名要从
    // 不带会话 id 的网关行补。任何一处单独实现都会让同一条折叠行的 groupCount /
    // groupItems / model 在列表与详情之间漂移，因此折叠只保留一份实现。
    const groupId = parseAgentLogGroupId(logId);
    if (groupId) {
      const scopeWhere = buildAgentLogWhere(userId, req.query);
      const logs = await listUserAgentLogsForGrouping(scopeWhere);
      const group = collapseAgentLogGroups(logs).find((entry) => entry.id === logId);
      if (!group) {
        return res.status(404).json({
          success: false,
          error: { message: '日志不存在' }
        });
      }
      return res.json({
        success: true,
        data: group
      });
    }

    const log = await findUserAgentLogById(logId, userId);

    if (!log) {
      return res.status(404).json({
        success: false,
        error: { message: '日志不存在' }
      });
    }

    res.json({
      success: true,
      data: log
    });
  } catch (error) {
    next(error);
  }
});

// 标记引导完成
router.post('/me/onboarding', async (req, res, next) => {
  try {
    await markOnboardingCompleted(req.user.userId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: { message: '标记引导完成失败' } });
  }
});

export default router;
