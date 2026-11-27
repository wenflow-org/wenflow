-- 公告受众（2026-11-26 全站 UI 走查：LD-07 / LS-08 / LM-14 三份报告同一处）
-- 此前 announcements 只有 status/severity，没有「给谁看」这一维：运维巡检公告
-- （如「夜间体检」）会原样推到学习者顶部横幅。加受众列，与 status 正交：
--   all     = 全部用户（默认，存量行语义不变）
--   learner = 只给学习者
--   admin   = 只给管理员/运营（运维、巡检、内部变更）
ALTER TABLE `announcements` ADD COLUMN `audience` TEXT NOT NULL DEFAULT 'all';
