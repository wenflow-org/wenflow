-- 下线冗余遗留表：旧 Agent 日志体系（已迁 agent_call_logs/prompt_call_logs/llm_execution_attempts）
DROP TABLE IF EXISTS "agent_instances";
DROP TABLE IF EXISTS "agent_execution_logs";
DROP TABLE IF EXISTS "agent_logs";

-- 下线旧链路：目标对话/路径分解（已迁 goal_conversations + learning_paths/milestones/subtasks）
DROP TABLE IF EXISTS "path_decompositions";
DROP TABLE IF EXISTS "dialogue_sessions";

-- 下线 Arena 实验套件（实验性功能，已无代码引用）
DROP TABLE IF EXISTS "arena_agent_logs";
DROP TABLE IF EXISTS "arena_personas";
DROP TABLE IF EXISTS "arena_optimizations";
DROP TABLE IF EXISTS "arena_generations";
DROP TABLE IF EXISTS "arena_extractions";
DROP TABLE IF EXISTS "arena_evaluations";
DROP TABLE IF EXISTS "arena_dialogues";
DROP TABLE IF EXISTS "arena_sessions";

-- 下线 A/B 实验（功能与路由均已下线）
DROP TABLE IF EXISTS "ab_test_result";
DROP TABLE IF EXISTS "ab_test";

-- 下线调试沙箱表
DROP TABLE IF EXISTS "debug_learning_paths";
DROP TABLE IF EXISTS "debug_requirements";
DROP TABLE IF EXISTS "debug_proposals";
DROP TABLE IF EXISTS "debug_snapshots";

-- 下线旧公告表（已由 announcements 取代）
DROP TABLE IF EXISTS "system_announcements";
