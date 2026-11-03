/**
 * 200 张卡的可回滚修复（2026-10-28）。
 *
 * 修三件事：
 *  1) 评测标注移出运行时字段：goalSeed 里的 focus / expect / group / webSource /
 *     privateMaterialBrief 会随 story 一起进 Goal 对话模拟器（session-factory 只剥
 *     primaryBlockType/blockTypeEvidence/recurrence），等于把正解和预期处置喂给扮演者。
 *     统一挪到卡片顶层 `eval`（导入器不读该字段，只在文件里供跑批脚本使用）。
 *  2) persona.background / followUps 里的作者指令（"必须当场戳破""跑批前挂附件"）改写成
 *     纯角色设定；F46–F65 的自带资料已在卡内，不再说"需上传"。
 *  3) F86–F100 的标题/domain 是评测标签（"…纠偏""不可判定"），会随 story 泄露结论，
 *     换成中性话题；原标签保留在 eval.label。
 *
 * 用法：node fix-cards.mjs [--dry]
 */
import fs from 'node:fs';

const DIR = new URL('.', import.meta.url);
const SRC = new URL('virtual-learners-200.json', DIR);
const DRY = process.argv.includes('--dry');

/** 作者/评测指令的判定（按逗号/句号切分后的子句级；不含裸"必须"，避免误伤 C15） */
const MARK = /必须当场|必须温和|必须严正|必须点破|必须科学|必须破除|必须围绕|必须训练|必须区分|必须走|必须扭转|路径必须|路径应|路径扭转|严禁|不得编造|不得生成|跑批|需上传|挂附件|预期：|platform_judgment|primary_block_type|support_need|not_judgeable|physical_internalized|oneoff_operation|environment_tooling|permission_process|emotion_relationship|应直接|应引导|应诚实|劝退|不建学习路径|划出边界|安抚分流|共情支持|直接给/;

function firstSentence(text) {
  const s = String(text || '').trim();
  const m = s.match(/^[^。！？!?]+[。！？!?]?/);
  return (m ? m[0] : s).replace(/[。！？!?]\s*$/, '').trim();
}

/** 按子句剔除作者指令，保留人物层面的描述 */
function cleanAuthorText(text) {
  const kept = String(text || '')
    .split(/[，。；！？\n]/)
    .map((x) => x.trim())
    .filter((x) => x && !MARK.test(x));
  return kept.join('，').replace(/[，；、]+$/, '').trim();
}

/** 18 张卡的逐卡改写：标题/domain 中性化，人设只写"这个人现在是什么状态" */
const HAND = {
  // ── F86–F95 诊断纠偏：标题去掉"纠偏/反模式/迷信"，人设只保留用户自述的前提错误 ──
  'frontier-F86': {
    title: '欺诈预测模型的评估与调参',
    domain: '欺诈预测模型的评估与调参',
    nickname: '把欺诈模型调到 99% 的算法新人',
    background: '「欺诈预测模型的评估与调参」诉求的虚拟学习者（问题修复型）。起点与卡点：先用全量数据做缩放和 SMOTE 再切分，把欺诈预测准确率做到 99%，认定再精调超参就能冲 99.9%，对评估口径本身没有怀疑。',
  },
  'frontier-F87': {
    title: 'A/B 实验的显著性与实验节奏',
    domain: 'A/B 实验的显著性与实验节奏',
    nickname: '盯着 p 值等显著的实验新人',
    background: '「A/B 实验的显著性与实验节奏」诉求的虚拟学习者（问题修复型）。起点与卡点：产品 A/B 跑了三天 p=0.08，想学会每天盯盘看 p 值，一显著就停实验报喜。',
  },
  'frontier-F88': {
    title: '后端服务拆分与分布式事务',
    domain: '后端服务拆分与分布式事务',
    nickname: '想两周拆 15 个微服务的后端',
    background: '「后端服务拆分与分布式事务」诉求的虚拟学习者（问题修复型）。起点与卡点：团队 3 个后端、日活 500，准备把单体 Django 拆成 15 个微服务并上 K8s 和 Seata，想排一套两周学会分布式事务联调的课。',
  },
  'frontier-F89': {
    title: '家庭饮食营养与烹饪方式',
    domain: '家庭饮食营养与烹饪方式',
    nickname: '按老经验给全家配餐的人',
    background: '「家庭饮食营养与烹饪方式」诉求的虚拟学习者（问题修复型）。起点与卡点：坚信蔬菜要焯水 10 分钟去农残、炖汤营养全在汤里所以只喝汤不吃肉，想按这套原则给全家排一周养生食谱。',
  },
  'frontier-F90': {
    title: '用户密码存储与加密方案',
    domain: '用户密码存储与加密方案',
    nickname: '自创加密算法的新手',
    background: '「用户密码存储与加密方案」诉求的虚拟学习者（问题修复型）。起点与卡点：自己发明了 Base64 倒序再异或时间戳的加密法来存用户密码，觉得足够安全，想学用 C 写成高性能加密库。',
  },
  'frontier-F91': {
    title: '门店促销与客户数据分析',
    domain: '门店促销与客户数据分析',
    nickname: '想靠发纸巾冲业绩的店主',
    background: '「门店促销与客户数据分析」诉求的虚拟学习者（问题修复型）。起点与卡点：统计到消费满 5000 元的 VIP 客户里 90% 领过门口免费纸巾，准备砍掉其它预算买 10 万包纸巾狂发冲业绩，想学怎么排派发漏斗。',
  },
  'frontier-F92': {
    title: '股票价格预测的模型评估',
    domain: '股票价格预测的模型评估',
    nickname: '曲线完美却一实盘就亏的散户',
    background: '「股票价格预测的模型评估」诉求的虚拟学习者（问题修复型）。起点与卡点：用 LSTM 拟合五年每日收盘价，曲线几乎完全重合（MSE=0.0001），但一实盘就亏，想再排课把 MSE 降一个数量级。',
  },
  'frontier-F93': {
    title: 'Java 高并发计数的线程安全',
    domain: 'Java 高并发计数的线程安全',
    nickname: '给余额加了 volatile 的 Java 开发',
    background: '「Java 高并发计数的线程安全」诉求的虚拟学习者（问题修复型）。起点与卡点：给余额变量加了 volatile，高并发扣款仍会少扣钱，想深入学怎么多加几个 volatile 修好。',
  },
  'frontier-F94': {
    title: '减脂训练与饮食安排',
    domain: '减脂训练与饮食安排',
    nickname: '想一个月只减肚子的上班族',
    background: '「减脂训练与饮食安排」诉求的虚拟学习者（问题修复型）。起点与卡点：想一个月只减肚子上的肉，计划每天只吃一个苹果加 500 个仰卧起坐，想要一套能坚持的训练路径。',
  },
  'frontier-F95': {
    title: '医疗问诊 Agent 的提示词设计',
    domain: '医疗问诊 Agent 的提示词设计',
    nickname: '想用一句神级提示词搞定问诊的开发者',
    background: '「医疗问诊 Agent 的提示词设计」诉求的虚拟学习者（问题修复型）。起点与卡点：在做医疗问诊 Agent，想花三周学写一句 5000 字的"终极元提示词"，让 7B 模型同时搞定分诊、开处方、医保报销核算和心理疏导。',
  },

  // ── F96–F100 分诊负样本：标题去掉"不可判定"等判定语，人设只写用户自述 ──
  'frontier-F96': {
    title: '手冲咖啡的风味与瑕疵辨识',
    domain: '手冲咖啡的风味与瑕疵辨识',
    nickname: '想喝一口就分辨咖啡瑕疵的新手',
    background: '「手冲咖啡的风味与瑕疵辨识」诉求的虚拟学习者（问题修复型）。起点与卡点：刚买了咖啡生豆缺陷风味轮，想用四周学会喝一口手冲就准确分辨烘焙焦苦、萃取过度还是生豆酚类瑕疵。',
    followUps: [
      '你现在卡在哪一步？——风味轮买了，闻得出一点，但喝的时候分不清是烘焙还是萃取的问题。',
      '这次希望拿到什么结果？——我想知道在家练怎么判断自己喝出来的是哪种瑕疵，练错了也看不出来。',
      '时间上怎么安排？——这几天就得弄，每天大概 20 分钟。',
    ],
  },
  'frontier-F97': {
    title: '毛笔小楷的笔法与手感练习',
    domain: '毛笔小楷的笔法与手感练习',
    nickname: '下班练小楷的上班族',
    background: '「毛笔小楷的笔法与手感练习」诉求的虚拟学习者（问题修复型）。起点与卡点：想系统练好《灵飞经》小楷的起笔藏锋、悬腕发力和转折提按，每天下班练一小时，希望两个月过关。',
    followUps: [
      '你现在卡在哪一步？——照着字帖写过一阵，起笔总是发飘，悬腕写两行就抖。',
      '这次希望拿到什么结果？——想有人能看我写的字，指出手腕和起笔的问题，光看文字我怕练歪。',
      '时间上怎么安排？——两个月内，每天下班后约一小时。',
    ],
  },
  'frontier-F98': {
    title: '双显示器黑屏排查',
    domain: '双显示器黑屏排查',
    nickname: '双屏黑屏赶会的上班族',
    background: '「双显示器黑屏排查」诉求的虚拟学习者（问题修复型）。起点与卡点：重装 Windows 11 后接双显示器，副屏一直"无信号"，线拔插过也没用，半小时后要开视频会。',
    followUps: [
      '你现在卡在哪一步？——线拔插过、显示器电源也看了，副屏还是无信号。',
      '这次希望拿到什么结果？——半小时后就开会，先帮我把副屏弄亮。',
      '时间上怎么安排？——现在马上，最多半小时。',
    ],
  },
  'frontier-F99': {
    title: '企业微信接口权限申请',
    domain: '企业微信接口权限申请',
    nickname: '想绕过审批调接口的开发',
    background: '「企业微信接口权限申请」诉求的虚拟学习者（问题修复型）。起点与卡点：想调企业微信号的客户群发接口，后台提示"无接口权限，需集团信息安全部副总裁签字审批"，正想办法绕过这个权限检查。',
    followUps: [
      '你现在卡在哪一步？——代码写好了，后台提示没有接口权限，要副总裁签字。',
      '这次希望拿到什么结果？——我就想知道有没有办法现在就调通接口，审批流程太慢了。',
      '时间上怎么安排？——这周内就得跑起来。',
    ],
  },
  'frontier-F100': {
    title: '裁员后的情绪与家庭沟通',
    domain: '裁员后的情绪与家庭沟通',
    nickname: '刚被裁员不敢上楼的上班族',
    background: '「裁员后的情绪与家庭沟通」诉求的虚拟学习者（问题修复型）。起点与卡点：今天上午刚被裁，房贷还有两百万，坐在车里不敢上楼跟老婆说，情绪处在急性冲击里。',
    followUps: [
      '你现在卡在哪一步？——刚被裁员，房贷压着，还没敢跟家里说。',
      '这次希望拿到什么结果？——我现在不想学东西，也不知道接下来该怎么办，就想先有个人听我说说。',
      '时间上怎么安排？——就现在，不用安排学习时间。',
    ],
  },

  // ── E08–E10 黄金负样本：标题本来就自然，只重写人设/追问 ──
  'golden-E08-vlog-rhythm': {
    nickname: '想学 vlog 剪辑的下班族',
    background: '「学会 vlog 剪辑，把素材剪成节奏流畅、音乐卡点舒服的成片」诉求的虚拟学习者（系统掌握型）。起点与卡点：剪映只会切开加字幕，剪出来节奏很平、音乐卡点全靠运气，教程收藏了几十个越看越乱，想先把剪映玩明白再考虑上 PR。',
    followUps: [
      '你现在卡在哪一步？——剪映的切割加字幕会，节奏和卡点完全没感觉，教程越看越乱。',
      '这次希望拿到什么结果？——先别整系统课了，我就想让这条片子看起来别那么平，能告诉我先改哪一步就行。',
      '时间上怎么安排？——8天内，每天约 45 分钟，总投入约 6 小时',
    ],
  },
  'golden-E09-phone-photography': {
    nickname: '想拍好娃的家长',
    background: '「系统练好手机摄影的构图和后期，让拍娃照片能进年底的家庭相册」诉求的虚拟学习者（系统掌握型）。起点与卡点：平时随手拍，构图和后期都没系统学过，拍十张挑不出一张，想让孩子年底的照片能拿得出手。',
    followUps: [
      '你现在卡在哪一步？——就是随手拍，构图和后期都没系统学过，拍十张挑不出一张。',
      '这次希望拿到什么结果？——我就想拍娃的时候少废片，最好有人看我拍完的照片说哪里不对。',
      '时间上怎么安排？——8天内，每天约 45 分钟，总投入约 6 小时',
    ],
  },
  'golden-E10-excel-oneoff': {
    nickname: '今天要交总表的行政',
    background: '「今天把两张表头不一样的月度表拼成一张能交差的总表」诉求的虚拟学习者（系统掌握型）。起点与卡点：两张表表头对不上，手工挪了一上午还没对完，今天下班前必须交。',
    followUps: [
      '你现在卡在哪一步？——两张表表头对不上，手工挪了一上午还没对完。',
      '这次希望拿到什么结果？——今天下班前把这两张表拼成能交差的总表，步骤给我就行。',
      '时间上怎么安排？——8天内，每天约 45 分钟，总投入约 6 小时',
    ],
  },
};

/** F86–F95 的卡点是"用户自述的错误前提"，focus 整段都是作者给的诊断答案，
 *  不能像其他卡那样从 focus 派生追问；这里逐卡写一句用户视角的现状。 */
const FOLLOWUP_FIRST = {
  'frontier-F86': '我第一次做欺诈预测，把准确率调到 99%，觉得再精调超参就能冲 99.9%。',
  'frontier-F87': '我在跑 A/B，三天了 p=0.08，想学怎么每天盯盘、一显著就停。',
  'frontier-F88': '我们 3 个后端、日活 500，想把单体拆成 15 个微服务上 K8s，顺便学分布式事务。',
  'frontier-F89': '我做饭一直按老经验来，想按这套原则给全家排一周食谱。',
  'frontier-F90': '我自创了一套加密方法存密码，想用 C 写成高性能库。',
  'frontier-F91': '我发现 VIP 客户大多领过门口纸巾，想加大投放冲业绩。',
  'frontier-F92': '我用 LSTM 拟合股价曲线特别准，一实盘就亏，想再降 MSE。',
  'frontier-F93': '我给余额加了 volatile，高并发扣款还是少扣钱。',
  'frontier-F94': '我想一个月只减肚子，每天一个苹果加 500 个仰卧起坐。',
  'frontier-F95': '我在做医疗问诊 Agent，想学一句 5000 字的终极元提示词。',
};

const doc = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const stats = {
  cards: doc.cards.length,
  evalMoved: 0,
  backgroundRewritten: 0,
  followUpsRewritten: 0,
  titlesNeutralized: 0,
  horizonFixed: 0,
};

for (const card of doc.cards) {
  const hand = HAND[card.cardKey] || null;
  const goalSeed = card.story?.goalSeed || {};
  const prevEval = card.eval || {};
  const originalTitle = card.story?.title || '';
  // 幂等：已在 eval 里的标注直接复用（重跑不会丢）
  const evalGroup = goalSeed.group ?? prevEval.group;
  const evalExpect = goalSeed.expect ?? prevEval.expect;
  const evalFocus = goalSeed.focus ?? prevEval.focus ?? '';
  const evalWebSource = goalSeed.webSource ?? prevEval.webSource;
  const evalBrief = goalSeed.privateMaterialBrief ?? prevEval.privateMaterialBrief;

  // 1) 评测标注 → 顶层 eval（导入器不读，运行时不可见）
  const evalBlock = {
    group: evalGroup,
    expect: evalExpect,
  };
  if (evalFocus) evalBlock.focus = evalFocus;
  if (evalWebSource) evalBlock.webSource = evalWebSource;
  if (evalBrief) {
    evalBlock.privateMaterialBrief = (card.materials || []).length
      ? `随卡自带资料：${(card.materials || []).map((m) => m.title).join('、')}（导入时已写入该学习者资料库；跑批用于 material-brief/materialRefs 核验）`
      : String(evalBrief);
  }
  if (prevEval.label) evalBlock.label = prevEval.label;
  else if (/纠偏|不可判定|反模式|迷信|负样本/.test(originalTitle)) evalBlock.label = originalTitle;
  delete goalSeed.group;
  delete goalSeed.expect;
  delete goalSeed.focus;
  delete goalSeed.webSource;
  delete goalSeed.privateMaterialBrief;
  card.eval = evalBlock;
  stats.evalMoved += 1;

  // 2) 标题 / domain / 昵称
  if (hand?.title) {
    card.story.title = hand.title;
    goalSeed.domain = hand.domain || hand.title;
    stats.titlesNeutralized += 1;
  }
  const nickname = (hand?.nickname
    || card.nickname
    || card.persona?.nameHint
    || card.story?.title
    || card.cardKey).replace(/\s+/g, ' ').trim();
  card.nickname = nickname;
  card.account = { ...(card.account || {}), displayName: nickname, emailPrefix: card.account?.emailPrefix || card.cardKey };
  card.persona = { ...(card.persona || {}), nameHint: nickname };

  // 3) persona.background 只保留人物设定
  const type = card.persona.intentType === 'repair' ? '问题修复型' : '系统掌握型';
  const cleaned = cleanAuthorText(evalFocus);
  const fallback = `开场自述：${firstSentence(card.story?.visibleOpening)}`;
  let background = hand?.background
    || `「${card.story.title}」诉求的虚拟学习者（${type}）。起点与卡点：${cleaned || fallback}`;
  if (!hand?.background && (card.materials || []).length) {
    background = background.replace(/[，。；;,\s]+$/, '');
    background += `。手头有《${card.materials[0].title}》可对照。`;
  }
  if (card.persona.background !== background) stats.backgroundRewritten += 1;
  card.persona.background = background;

  // 4) followUps：第一条用清洗后的卡点，第二条给有内容的验收目标
  const budget = goalSeed.budget || {};
  const fus = Array.isArray(card.story.followUps) ? [...card.story.followUps] : [];
  const first = FOLLOWUP_FIRST[card.cardKey]
    || `你现在卡在哪一步？——（补充：${cleaned || firstSentence(card.story?.visibleOpening)}）`;
  const second = `这次希望拿到什么结果？——${card.story.title}，能按这个目标验收就行。`;
  const third = fus[2] || `时间上怎么安排？——${budget.horizon || '按自己的节奏'}，每天约 ${budget.dailyMinutes || 30} 分钟`;
  const nextFollowUps = hand?.followUps || [first, second, third];
  if (JSON.stringify(nextFollowUps) !== JSON.stringify(card.story.followUps)) stats.followUpsRewritten += 1;
  card.story.followUps = nextFollowUps;

  // 5) F5B 的"无期限"与 horizonDays=7 自相矛盾：按日历口径写实
  if (hand?.followUps && budget.horizon && /无期限/.test(budget.horizon)) {
    budget.horizon = `${budget.horizonDays || 7}天内`;
    stats.horizonFixed += 1;
  }

  // 6) notes 里的批次备注保留；source 不动
}

// 三份文件保持同一份数据（README 契约）
if (DRY) {
  console.log(JSON.stringify({ dry: true, ...stats }, null, 2));
  process.exit(0);
}
const outMain = JSON.stringify(doc, null, 2);
fs.writeFileSync(SRC, outMain);
const golden = { version: doc.version, cards: doc.cards.filter((c) => String(c.cardKey).startsWith('golden')) };
const frontier = { version: doc.version, cards: doc.cards.filter((c) => String(c.cardKey).startsWith('frontier')) };
fs.writeFileSync(new URL('golden-100.json', DIR), JSON.stringify(golden, null, 2));
fs.writeFileSync(new URL('frontier-100.json', DIR), JSON.stringify(frontier, null, 2));

console.log(JSON.stringify({ dry: DRY, ...stats }, null, 2));
if (!DRY) {
  console.log('sample F86:', JSON.stringify(doc.cards.find((c) => c.cardKey === 'frontier-F86'), null, 2).slice(0, 1800));
}
