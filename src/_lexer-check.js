/* 单元验证：直接加载 src/app.js 的解析逻辑，不依赖浏览器 */
const path = require('path');
const app = require(path.join(__dirname, 'app.js'));
const { lex, buildRenderPlan, recoverEmojiFromHTML } = app;

let fail = 0;
function check(title, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + title);
  if (!ok) {
    console.log('        期望: ' + JSON.stringify(expected));
    console.log('        实际: ' + JSON.stringify(actual));
  }
}

function emojisOf(raw) {
  return lex(raw).filter(t => t.type === 'emoji').map(t => t.name || t.char);
}

function structureOk(raw) {
  const toks = lex(raw);
  if (!toks.length) return raw.length === 0;
  let contiguous = toks[0].start === 0;
  for (let i = 1; i < toks.length; i++) if (toks[i].start !== toks[i - 1].end) contiguous = false;
  return contiguous && toks[toks.length - 1].end === raw.length;
}

console.log('\n=== 1. 表情识别 ===');
check('中括号 [微笑]', emojisOf('本周五晚7点[微笑]学院见'), ['微笑']);
check('斜杠 /呲牙 + 标点', emojisOf('找到乐趣/呲牙，欢迎参加'), ['呲牙']);
check('斜杠 /呲牙 + 换行', emojisOf('找到乐趣/呲牙\n欢迎参加'), ['呲牙']);
check('斜杠 /呲牙 + 行尾', emojisOf('欢迎参加/呲牙'), ['呲牙']);
check('em 标签 e100', emojisOf('开始[em]e100[/em]结束'), ['e100']);
check('em 标签 e204', emojisOf('开始[em]e204[/em]结束'), ['e204']);
check('emoji 单字', emojisOf('点🙂学院'), ['🙂']);
check('emoji 变体选择符 ❤️', emojisOf('爱心❤️送你'), ['❤️']);
check('emoji 三连', emojisOf('你好😀😀😀三位'), ['😀', '😀', '😀']);
check('最长优先 /左太极', emojisOf('来一个/左太极，走起'), ['左太极']);

console.log('\n=== 2. 防误伤（这些必须一个都不认）===');
check('分数 3/4', emojisOf('本题3/4的同学都答对了'), []);
check('未收录 [重要]', emojisOf('[重要]通知：明天放假'), []);
check('数字中括号 [1]', emojisOf('请于[1]号门集合'), []);
check('斜杠夹字母 x/y', emojisOf('坐标 x/y 与 a/b 的关系'), []);
check('时间 19:00', emojisOf('时间是 19:00，地点西区操场'), []);
check('分数 95/100', emojisOf('总分 95/100，排名 3/50'), []);
check('「优点/弱点」不可被吞', emojisOf('这个人优点/弱点都很明显'), []);
check('「效率/强度」不可被吞', emojisOf('训练效率/强度都要兼顾'), []);
check('尺寸 1024×768', emojisOf('窗口大小 1024×768 px'), []);

console.log('\n=== 2b. 刻意的安全取舍：斜杠形式后紧跟中文时不识别 ===');
console.log('     原因："/弱点" 若被吃掉，正文会静默变成一张图片，用户察觉不到；');
console.log('           而漏认时 /微笑 仍以文字显示，用户能看见也能改用 [微笑] 修正。');
console.log('           两害相权，选择漏认。');
check('/左太极走起 不识别（后接中文）', emojisOf('来一个/左太极走起'), []);
check('改用中括号可正常识别', emojisOf('来一个[左太极]走起'), ['左太极']);

console.log('\n=== 3. Token 结构完整性（必须全覆盖且无缝）===');
const structCases = [
  '本周五晚7点[微笑]学院见',
  '本周五晚/呲牙，学院见🙂',
  '本题3/4的同学都答对了',
  '[重要]通知：明天放假',
  '总分 95/100，排名 3/50',
  '你好😀😀😀连着三个',
  '❤️ 玫瑰 🌹 和 ☀️ 太阳',
  '这个人优点/弱点都很明显'
];
structCases.forEach(c => check('结构: ' + c.slice(0, 18), structureOk(c), true));

console.log('\n=== 4. 区间切分（批注锚定）===');
{
  const raw = '本周五晚7点[微笑]学院见';
  const toks = lex(raw);
  const anns = [
    { id: 'a1', start: 0, end: 3, type: 'typo' },
    { id: 'a2', start: 2, end: 6, type: 'wording' }
  ];
  const plan = buildRenderPlan(raw, toks, anns);
  const joined = plan.map(p => raw.slice(p.start, p.end)).join('');
  check('切分后拼回等于原文', joined === raw, true);
  const overlapping = plan.filter(p => p.covers.length > 1);
  check('存在重叠覆盖片段', overlapping.length > 0, true);
  const boundary = plan.filter(p => p.start === 3 || p.start === 2);
  check('切分点落在 2 与 3', boundary.length >= 2, true);
  const emojiSeg = plan.filter(p => p.emoji);
  check('表情片段被识别', emojiSeg.length === 1, true);
}

console.log('\n=== 5. 剪贴板 HTML 还原 ===');
{
  const html = '<span>欢迎参加</span><img src="http://qzonestyle.gtimg.cn/qzone/em/e100.gif" alt="微笑"><span>哦</span>';
  const r = recoverEmojiFromHTML(html);
  check('从 img src 还原 e100', /\[微笑\]/.test(r || ''), true);
}
{
  const html = '<div>明天见<img alt="[呲牙]"></div>';
  const r = recoverEmojiFromHTML(html);
  check('从 img alt 还原 [呲牙]', /\[呲牙\]/.test(r || ''), true);
}
{
  const r = recoverEmojiFromHTML('<p>普通文本，无表情</p>');
  check('无表情时返回 null（走纯文本兜底）', r, null);
}

console.log('\n' + (fail === 0 ? '全部通过 ✓' : '失败 ' + fail + ' 项 ✗'));
process.exit(fail === 0 ? 0 : 1);
