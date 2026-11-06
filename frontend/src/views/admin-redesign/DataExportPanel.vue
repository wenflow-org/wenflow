<template>
  <!-- 数据导出面板（原「系统工具」页 Tab2；2026-10-16 用户拍板该场景解散并入运营中心：
       本组件作为运营中心宿主的一个页签体渲染，id/role=tabpanel/aria-labelledby 由宿主透传落到本根节点）。
       2026-10-27 用户「自由设计一下 tab 里面的内容」：范围胶囊改成按域分组的选择卡——
       每张表自带「导出什么字段」，日志组内联条数上限；底部固定已选数与唯一主按钮。
       时间范围 / JSONL 格式后端导出接口不支持，不渲染假控件。 -->
  <div class="exp-body">
    <section class="mk-card exp-panel">
      <div class="mk-card__head">
        <div class="exp-head">
          <h4 class="mk-card__title">数据导出</h4>
          <!-- 副标题（2026-11-06 文案排查 §7.2）：说清产物形态 + 业务表单表上限；
               原先只有「每张表生成一个 CSV 文件」，上限只散落在每张卡片里重复渲染，
               现统一收到这一句，卡片内不再复读「最近 20000 条 / 最近 1000 行」。 -->
          <span class="mk-card__meta">所选数据将分别导出为独立的 CSV 文件（业务数据单表上限 20,000 条）</span>
        </div>
      </div>

      <div class="exp-groups">
        <section v-for="g in exportGroups" :key="g.key" class="exp-group">
          <div class="exp-group__head">
            <h5 class="exp-group__title">{{ g.label }}</h5>
            <!-- 条数上限属于日志组自己的设置（2026-11-02 评审）：原先挤在底部操作条
                 「已选 N 项」旁边，看不出它只作用于日志表。单位统一为「条」（§7.2）。 -->
            <label v-if="g.key === 'logs'" class="exp-limit">
              <span class="exp-limit__label">条数上限</span>
              <MkSelect
                v-model="logLimit"
                :options="LOG_LIMIT_OPTIONS"
                size="sm"
                aria-label="日志条数上限"
                :disabled="exporting !== ''"
              />
            </label>
          </div>
          <div class="exp-grid">
            <label
              v-for="item in g.items"
              :key="item.key"
              class="exp-item"
              :class="{ 'exp-item--on': exportSel.includes(item.key), 'exp-item--busy': exporting !== '' }"
            >
              <input
                type="checkbox"
                class="exp-item__box"
                :checked="exportSel.includes(item.key)"
                :disabled="exporting !== ''"
                @change="toggleExport(item.key)"
              />
              <span class="exp-item__body">
                <span class="exp-item__title">{{ item.label }}</span>
                <span class="exp-item__desc">{{ item.desc }}</span>
              </span>
            </label>
          </div>
        </section>
      </div>

      <div class="exp-foot">
        <span class="exp-hint">已选 {{ exportSel.length }} 项</span>
        <!-- 2026-11-06 复核：任务单 §7.2 原拟改写为「已自动脱敏」，但导出链路并没有脱敏——
             用户 CSV 直出 email（backend/src/services/admin/export.repo.ts:15），审计 CSV 直出
             ip（同文件 :69），csvCell 只做转义与公式中和（backend/src/routes/admin/export.ts:26-42）。
             写「已自动脱敏」还会与本页确认框逐表列出的「账号档案与邮箱 / 管理操作审计与 IP」
             （本文件 EXPORT_DATA_NOTES）自相矛盾。故保留 2026-11-02 评审定下的真实说法；
             若要改成「已自动脱敏」，需先给后端导出补真脱敏。 -->
        <span class="exp-note">只读导出，不含密码与密钥</span>
        <!-- 未勾选时按钮置灰的前置条件，原为操作条上一行弱化小字（2026-11-02 评审补的
             置灰原因）。2026-11-02 走查：它是在教读者怎么操作导出钮，属「让布局自己说话」
             要收掉的那类；同一句改挂它描述的那枚主按钮的 title（仅在未勾选时挂上），
             屏上不再占一行，按钮保持右对齐。 -->
        <button
          type="button"
          class="mk-btn mk-btn--primary exp-go"
          :disabled="!exportSel.length || exporting !== ''"
          :title="!exportSel.length ? '先勾选要导出的表' : undefined"
          @click="runExport"
        >{{ exporting !== '' ? '导出中…' : '开始导出' }}</button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { errMsg } from './live'
import { adminAxios } from '@/api/adminApi'
import { toast } from '@/utils/toast'
import { askConfirm } from './useConfirm'
import MkSelect from '@/components/mk/MkSelect.vue'

/* 数据导出（原「系统工具」页 Tab2 整体迁入，2026-10-16）：多表 CSV 快照导出。
   各列表页有就地导出（导出本页/选中项），这里是「一次勾多张表打包拿快照」的唯一入口。 */

interface ExportDef {
  key: string
  label: string
  desc: string
}

/* 卡片描述统一「含 A、B、C 及 D」的自然句式（§7.2）：去掉「会话：」「反馈：」这类
   冒号前缀与「A / B / C」斜杠罗列；卡片标题已经说明导出的是哪张表，描述只讲字段。 */
const exportDefs: ExportDef[] = [
  { key: 'users', label: '用户', desc: '含基础账号信息、角色等级、XP 及注册登录记录（不含虚拟学习者）' },
  { key: 'teaching-sessions', label: '教学会话', desc: '含学科、主题、任务类型、模式、状态、时长及起止时间' },
  { key: 'feedback', label: '用户反馈', desc: '含评分、难度、评论、处理状态及提交时间' },
  { key: 'goal-conversations', label: '目标对话', desc: '含状态、阶段、描述及创建与更新时间' },
  { key: 'agent-logs', label: '执行日志', desc: '含调用状态、耗时、错误分类、模型及 Token 用量' },
  { key: 'audit-logs', label: '审计日志', desc: '含操作动作、对象、请求方法、路径、状态码及 IP' },
]

/** 只有日志类导出支持条数上限（后端 ?limit=）；业务表固定最近 20,000 条 */
const LOG_EXPORT_KEYS = new Set(['agent-logs', 'audit-logs'])
const logLimit = ref<number>(1000)
/** 单位统一为「条」（§7.2）；千分位让 20000 与 20,000 在全页只有一种写法 */
const LOG_LIMIT_OPTIONS = [
  { value: 1000, label: '1,000 条' },
  { value: 5000, label: '5,000 条' },
  { value: 20000, label: '20,000 条' }
]

/** 按「谁来看 / 解决什么问题」分组，而不是按表名字典序平铺六枚胶囊。
    组内卡片只说明导出字段，条数上限与快照范围由卡片头副标题和日志组设置统一交代。 */
const exportGroups = [
  { key: 'account', label: '账号与学习', keys: ['users', 'teaching-sessions'] },
  { key: 'ops', label: '运营与对话', keys: ['feedback', 'goal-conversations'] },
  { key: 'logs', label: '日志与审计', keys: ['agent-logs', 'audit-logs'] },
].map((g) => ({
  ...g,
  items: g.keys.map((k) => exportDefs.find((d) => d.key === k)!),
}))

/** 各表落进文件里的个人数据：确认框按本次勾选逐表列出，
    否则只勾「用户反馈」时也会声称文件含账号联系方式（2026-11 评审 OP2-4）。 */
const EXPORT_DATA_NOTES: Record<string, string> = {
  users: '账号档案与邮箱',
  'teaching-sessions': '课堂学习记录',
  feedback: '反馈评论',
  'goal-conversations': '学习目标描述',
  'agent-logs': 'Agent 调用日志',
  'audit-logs': '管理操作审计与 IP',
}

const exportSel = ref<string[]>([])
function toggleExport(key: string) {
  exportSel.value = exportSel.value.includes(key)
    ? exportSel.value.filter((k) => k !== key)
    : [...exportSel.value, key]
}

const exporting = ref('')

async function doExport(key: string) {
  exporting.value = key
  try {
    const params = LOG_EXPORT_KEYS.has(key) ? `?limit=${logLimit.value}` : ''
    const response = await adminAxios.get(`/admin/export/${key}${params}`, { responseType: 'blob' })
    const disposition = String(response.headers['content-disposition'] || '')
    const match = disposition.match(/filename\*=UTF-8''([^;]+)/)
    const filename = match ? decodeURIComponent(match[1]) : `${key}-${Date.now()}.csv`
    const url = URL.createObjectURL(new Blob([response.data]))
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    toast.success('导出成功，已开始下载')
  } catch (e) {
    toast.error(`导出失败：${errMsg(e)}`)
  } finally {
    exporting.value = ''
  }
}

/** 顺序导出所选项（共用 exporting 守卫，按钮同时禁用防并发）。
    审核 #177：先快照数组再遍历——此前 for…of 直接迭代 ref，导出中途改选会改到本次导出集，
    与实时变的「已选 N 项」提示不一致（chips 现已随 exporting 禁用，快照是第二道保险）。 */
async function runExport() {
  const keys = [...exportSel.value]
  if (!keys.length) return
  /* 导出范围写进确认框：勾选多表时用户未必记得「日志随条数上限、业务表固定 2 万条」的差异，
     且导出文件含邮箱/IP 等个人数据，落盘前明确范围与用途。单位与卡片文案统一为「条」。 */
  const labels = keys.map((k) => exportDefs.find((d) => d.key === k)?.label || k)
  const logKeys = keys.filter((k) => LOG_EXPORT_KEYS.has(k))
  const ranges: string[] = []
  if (logKeys.length) ranges.push(`日志类最近 ${logLimit.value.toLocaleString('en-US')} 条`)
  if (keys.length > logKeys.length) ranges.push('业务表最近 20,000 条')
  // 按勾选顺序列出本次会落盘的个人数据（Set 去重：两张日志表说明不同，但未来加表可能撞词）
  const contents = [...new Set(keys.map((k) => EXPORT_DATA_NOTES[k] || k))]
  const ok = await askConfirm({
    title: '确认导出',
    message: `将导出 ${labels.join('、')}（共 ${keys.length} 项，${ranges.join('，')}）。文件包含${contents.join('、')}，请按数据安全规范保存。`,
    confirmText: '开始导出',
    // 导出是只读取数、不改动任何数据，不该沿用破坏性操作的红色警示按钮
    danger: false,
  })
  if (!ok) return
  for (const key of keys) {
    if (exporting.value !== '') return
    await doExport(key)
  }
}
</script>

<style scoped>
/* 内衬归宿主（2026-11-06 同上）：16px 是独立页面时代的遗留，嵌入「系统设置」后
   卡片比同页其它页签窄 32px、整体右下错 16px。 */
.exp-body {
  display: grid;
  gap: 16px;
  align-content: start;
}
/* 卡片头：标题 + 一句口径说明（不再用一个大号「导出范围」标签占一整行） */
.exp-head { display: grid; gap: 2px; }
/* 分组：三列并排（账号 / 运营 / 日志），窄屏自动落成两列 / 单列；
   组内卡片纵向排列，整块表单在 720px 高度内不用滚动即可看到主按钮 */
.exp-groups {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(270px, 1fr));
  gap: 18px;
  padding: 14px 16px 4px;
  align-items: start;
}
.exp-group { min-width: 0; }
.exp-group__head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  min-height: 24px;
  margin-bottom: 8px;
}
.exp-group__title {
  margin: 0;
  font-size: var(--mk-fs-micro);
  font-weight: 700;
  color: var(--mk-muted);
  letter-spacing: 0.03em;
}
.exp-limit {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-right: 4px;
}
.exp-limit__label { font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.exp-grid { display: grid; gap: 8px; }
.exp-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--mk-line);
  border-radius: var(--mk-radius-lg);
  background: var(--mk-surface);
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s;
}
/* hover 只微抬描边（2026-10-31 外部评审二轮：--mk-muted 全亮灰在暗色下读成「蓝色焦点框/
   已选中」，截图指针停过就穿帮）——用 line→muted 的中间值，可感知但不抢选中态（蓝框专属） */
.exp-item:hover { border-color: color-mix(in srgb, var(--mk-muted) 45%, var(--mk-line)); }
.exp-item--on { border-color: var(--mk-blue); background: var(--mk-blue-bg); }
.exp-item--busy { cursor: default; opacity: 0.7; }
.exp-item__box {
  flex: none;
  width: 15px;
  height: 15px;
  margin-top: 3px;
  accent-color: var(--mk-blue);
  cursor: pointer;
}
.exp-item__body { display: grid; gap: 3px; min-width: 0; }
.exp-item__title { font-size: var(--mk-fs-body); font-weight: 600; color: var(--mk-ink); }
.exp-item__desc { font-size: var(--mk-fs-micro); line-height: 1.45; color: var(--mk-muted); }
.exp-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 12px 16px 16px;
  padding-top: 12px;
  border-top: 1px solid var(--mk-line);
}
.exp-go { margin-left: auto; }
.exp-hint { font-size: var(--mk-fs-micro); font-weight: 600; color: var(--mk-ink); }
.exp-note { font-size: var(--mk-fs-micro); color: var(--mk-muted); }
.exp-note::before { content: '·'; margin-right: 6px; color: var(--mk-faint); }
</style>
