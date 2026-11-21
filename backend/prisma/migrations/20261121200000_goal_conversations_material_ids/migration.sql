-- 资料挂载语义重构（资料跟路径生成走）：goal_conversations 增列 materialIds。
-- 语义：null=存量会话与虚拟学习者链路，沿用资料库自动扫库；[]=用户显式不挂载
--（路径生成零注入）；非空 JSON 数组=只注入这些资料。SQLite 允许 ALTER TABLE 增可空列。
ALTER TABLE `goal_conversations` ADD COLUMN `materialIds` TEXT;
