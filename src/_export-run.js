/**
 * 导出稿验证：在真浏览器里跑 buildExportHTML，取出两种样式的成品，
 * 落盘后再截图，确认导出文件脱离工具也能正常打开、排版正常。
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUT = path.join(root, 'src', '_tmp', 'out');

/* 测试自带的样例文本。工具本身已经不内置任何示例了（首次打开是干净的），
   所以夹具放在这里，而不是从页面里取。 */
const SAMPLE = [
  '【活动预告】智慧农业学院秋季趣味运动会',
  '',
  '各位同学：',
  '',
  '金秋十月，正是运动好时节！[微笑] 学院将于本周五晚7点，在学校西区操场举办秋季趣味运动会，现面向全院同学开放报名。',
  '',
  '本次运动会设置了拔河、两人三足、趣味接力等六个项目，既有团队协作，也有个人挑战。无论你是运动达人，还是只想轻松参与，都能找到属于自己的乐趣。/呲牙',
  '',
  '报名方式：请各班同学于周四中午12点前，在本班团支书处登记报名，并注明参加项目。🙂',
  '',
  '期待在操场上见到你的身影，让我们一起奔跑、一起欢笑！[玫瑰]'
].join('\n');

const genCode = `
(function () {
  var Q = window.__QPR__;

  /* 固定落到夹具文字稿上，避免上一轮残留在 localStorage 里的文档
     让示例批注全部挂空——那样导出结果会「看起来通过」，实际什么都没测到。 */
  Q.STATE.doc = Q.normalizeDoc({
    id: 'exp_text', kind: 'text',
    title: '【活动预告】智慧农业学院秋季趣味运动会',
    raw: ${JSON.stringify(SAMPLE)}, annotations: []
  });
  Q.setAnnotator('李小明');

  var raw = Q.STATE.doc.raw;
  var anns = [];
  function mk(type, quote, body, sug) {
    var i = raw.indexOf(quote);
    if (i < 0) return;
    anns.push({ id: 'e_' + i, start: i, end: i + quote.length, quote: quote,
                type: type, body: body, suggestion: sug || '', resolved: false });
  }
  mk('typo',    '学校西区操场', '学校没有「西区操场」这个叫法，请核对场地全称', '学校卫岗校区田径场');
  mk('wording', '本周五晚7点', '时间表述建议统一为 24 小时制', '本周五（10月16日）19:00');
  mk('emoji',   '/呲牙', '这个表情和上一句的笑点重复了，建议只留一个');
  mk('praise',  '[玫瑰]', '结尾用表情收束，情绪到位，保留');
  mk('format',  '报名方式：请各班同学于周四中午12点前，在本班团支书处登记报名，并注明参加项目。',
                '信息量较大，建议单独成段并分点列出');
  mk('general', '本次运动会设置了拔河', '整体节奏不错，开头可以用一句更有画面感的话引入');
  Q.STATE.doc.annotations = anns;
  Q.STATE.doc.title = '【活动预告】智慧农业学院秋季趣味运动会';

  function b64(s) { return btoa(unescape(encodeURIComponent(s))); }
  var a = document.createElement('pre');
  a.id = '__EXP_LIST__'; a.textContent = b64(Q.buildExportHTML(Q.STATE.doc, 'list'));
  var b = document.createElement('pre');
  b.id = '__EXP_INLINE__'; b.textContent = b64(Q.buildExportHTML(Q.STATE.doc, 'inline'));
  var c = document.createElement('pre');
  c.id = '__EXP_ANNCOUNT__'; c.textContent = String(anns.length);
  document.body.appendChild(a);
  document.body.appendChild(b);
  document.body.appendChild(c);
})();
`;

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const idx = html.lastIndexOf('</body>');
const injected = html.slice(0, idx) +
  '<script>window.addEventListener("load",function(){' + genCode + '});<\/script>\n' +
  html.slice(idx);

const tmpDir = path.join(root, 'src', '_tmp');
fs.mkdirSync(tmpDir, { recursive: true });
const tmp = path.join(tmpDir, 'export-gen.html');
fs.writeFileSync(tmp, injected, 'utf8');

let stdout = '';
try {
  stdout = execFileSync(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + path.join(os.tmpdir(), 'qpr-export-profile'),
    '--virtual-time-budget=5000', '--dump-dom',
    'file:///' + tmp.replace(/\\/g, '/')
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  stdout = e.stdout ? e.stdout.toString() : '';
}

function grab(id) {
  const re = new RegExp('<pre id="' + id + '">([\\s\\S]*?)<\\/pre>');
  const m = re.exec(stdout);
  if (!m) return null;
  const b64 = m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
  try { return Buffer.from(b64, 'base64').toString('utf8'); } catch (err) { return null; }
}

const list = grab('__EXP_LIST__');
const inline = grab('__EXP_INLINE__');

if (!list || !inline) {
  console.error('没能取到导出结果。');
  process.exit(1);
}

/* 先确认示例批注真的都挂上了。挂空的话下面的完整性检查会「空过」，
   看着全绿其实什么都没验到。 */
const annCount = Number((/__EXP_ANNCOUNT__">(\d+)</.exec(stdout) || [])[1] || 0);
console.log('示例批注挂载数：' + annCount + ' / 6');
if (annCount !== 6) {
  console.error('示例批注没有全部命中原文，导出内容不可信，中止。');
  process.exit(1);
}

const outList = path.join(OUT, '批改稿-编号清单式.html');
const outInline = path.join(OUT, '批改稿-段后批注式.html');
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(outList, list, 'utf8');
fs.writeFileSync(outInline, inline, 'utf8');

console.log('编号清单式：' + (list.length / 1024).toFixed(1) + ' KB');
console.log('段后批注式：' + (inline.length / 1024).toFixed(1) + ' KB');

/* 基本的成品完整性检查：必须是自包含文档，且用上了苹果风排版 */
function sanity(name, doc) {
  const checks = [
    ['完整 HTML 文档', /^<!DOCTYPE html>/i.test(doc)],
    ['内联样式（无外部依赖）', /<style>/.test(doc) && !/<link[^>]+stylesheet/i.test(doc)],
    ['无外部脚本', !/<script/i.test(doc)],
    ['含标题', /秋季趣味运动会/.test(doc)],
    ['含批注人署名', /批注人：李小明/.test(doc)],
    ['含批注条数统计', /共 \d+ 条意见/.test(doc)],
    ['样式走系统字体栈', /-apple-system/.test(doc)],
    ['强调色为系统蓝 #007AFF', /#007AFF/.test(doc)],
    ['标题带负字距', /letter-spacing:-\.0?2em/.test(doc)],
    ['正文 17px', /\.body\{font-size:17px/.test(doc)],
    ['不含旧版 QQ 蓝', !/#12B7F5/i.test(doc)]
  ];
  let bad = 0;
  checks.forEach(([label, ok]) => {
    if (!ok) bad++;
    console.log('  ' + (ok ? 'PASS  ' : 'FAIL  ') + name + ' · ' + label);
  });
  return bad;
}

let bad = 0;
bad += sanity('清单式', list);
bad += sanity('段后式', inline);

/* 截图两种样式 */
[['list', outList, 'export-list.png'], ['inline', outInline, 'export-inline.png']]
  .forEach(([tag, file, shot]) => {
    try {
      execFileSync(EDGE, [
        '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        '--hide-scrollbars',
        '--user-data-dir=' + path.join(os.tmpdir(), 'qpr-export-shot-' + tag),
        '--window-size=880,1400',
        '--virtual-time-budget=3000',
        '--screenshot=' + path.join(OUT, shot),
        'file:///' + file.replace(/\\/g, '/')
      ], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 90000 });
      console.log('截图 → src/_tmp/out/' + shot);
    } catch (e) {
      console.log('截图失败 ' + tag + '：' + e.message);
    }
  });

process.exit(bad ? 1 : 0);
