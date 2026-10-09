/* 用无头 Edge 给 index.html 截图，肉眼核对排版。
   加 --demo   会注入几条批注，用来检查高亮 / 重叠 / 侧栏的实际观感。
   加 --img    会造一张模拟 QQ 聊天截图并灌进去画满标注，检查图片批改的观感。
   加 --dark   切到深色主题再截。
   加 --mobile 用手机宽度截，检查窄屏布局与底部导航。
   加 --view=ann|docs  指定窄屏下停在哪个视图。

   落盘位置：
     · 默认（干净首屏）→ 项目根目录 preview.png / preview-dark.png
     · 带 --demo / --img → src/_tmp/out/ 下的 shot-*.png（开发核查用，不污染根目录） */
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const OUT = path.join(root, 'src', '_tmp', 'out');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const argv = process.argv.slice(2);
const has = function (k) { return argv.indexOf(k) >= 0; };
const demo = has('--demo');
const imgDemo = has('--img');
const dark = has('--dark');
const mobile = has('--mobile');
const viewArg = argv.filter(function (a) { return a.indexOf('--view=') === 0; })[0];
const view = viewArg ? viewArg.split('=')[1] : 'main';

/* 截图用的样例文本。工具本身不内置任何示例（首次打开是干净的），
   所以夹具写在这里。 */
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

/* 主题与窄屏视图要在 load 之后再设一次：
   它们都在 boot() 里被读过一遍，晚一点覆盖才不会被 boot 的默认值顶回去。

   另外必须先把过渡和动画全关掉：headless 的 virtual-time 下 CSS 过渡这条时钟
   不跟着推进，截图会停在「过渡起始值」——深色主题于是拍出一堆浅色panel。
   这是量具的问题，不是样式的问题。 */
const baseCode = `
(function () {
  var Q = window.__QPR__;
  var st = document.createElement('style');
  st.textContent = '*,*::before,*::after{transition:none !important;animation:none !important;}';
  document.head.appendChild(st);
  var rootEl = document.documentElement;
  try { Q.applyTheme('${dark ? 'dark' : 'light'}', false); } catch (e) {}
  rootEl.setAttribute('data-theme', '${dark ? 'dark' : 'light'}');
  try { Q.setMView('${view}'); } catch (e) {}
})();
`;

/* 截图用固定的一组文档索引，免得截到上一次运行残留在 localStorage 里的数据 */
const tidyCode = `
  Q.store.setIndex([
    { id: 'demo_i1', kind: 'image', title: '招新宣讲会现场 · 截图批改',
      updatedAt: Date.now() - 3600000, annCount: 3 },
    { id: 'demo_t1', kind: 'text', title: '【通知】国庆假期安全提示',
      updatedAt: Date.now() - 2 * 86400000, annCount: 0 },
    { id: 'demo_t2', kind: 'text', title: '志愿服务月活动总结',
      updatedAt: Date.now() - 3 * 86400000, annCount: 5 }
  ]);
`;

const demoCode = `
(function () {
  var Q = window.__QPR__;

  Q.STATE.doc = Q.normalizeDoc({
    id: 'demo_text', kind: 'text',
    title: '【活动预告】智慧农业学院秋季趣味运动会',
    raw: ${JSON.stringify(SAMPLE)}, annotations: []
  });
  Q.STATE.mode = 'annotate';
  document.getElementById('docTitle').value = Q.STATE.doc.title;
  Q.setAnnotator('李小明');

  var raw = Q.STATE.doc.raw;
  function mk(type, quote, body, sug) {
    var i = raw.indexOf(quote);
    if (i < 0) return null;
    return { id: 'demo_' + i, start: i, end: i + quote.length, quote: quote,
             type: type, body: body, suggestion: sug || '', resolved: false };
  }
  var anns = [
    mk('typo',    '学校西区操场', '学校没有「西区操场」这个叫法，请核对场地全称', '学校卫岗校区田径场'),
    mk('wording', '本周五晚7点', '时间表述建议统一为 24 小时制', '本周五（10月16日）19:00'),
    mk('emoji',   '/呲牙', '这个表情和上一句的笑点重复了，建议只留一个'),
    mk('praise',  '[玫瑰]', '结尾用表情收束，情绪到位，保留'),
    mk('format',  '报名方式：请各班同学于周四中午12点前，在本班团支书处登记报名，并注明参加项目。',
                  '信息量较大，建议单独成段并分点列出', ''),
    mk('general', '', '整体节奏不错，开头可以用一句更有画面感的话引入', '')
  ].filter(Boolean);

  /* 制造一组重叠区间，检查区间切分后的多重着色 */
  var i1 = raw.indexOf('本次运动会设置了拔河');
  if (i1 >= 0) anns.push({ id: 'demo_ov1', start: i1, end: i1 + 8, quote: raw.slice(i1, i1 + 8),
    type: 'wording', body: '换一个更具体的说法', suggestion: '' });
  var i2 = raw.indexOf('拔河、两人三足');
  if (i2 >= 0) anns.push({ id: 'demo_ov2', start: i2, end: i2 + 8, quote: raw.slice(i2, i2 + 8),
    type: 'typo', body: '「两人三足」请核对规范写法', suggestion: '' });

  var gen = anns.pop();               /* 整体意见放到最后 */
  anns.push(gen);
  Q.STATE.doc.annotations = anns;
  Q.renderBodyUI();
  Q.renderSidebar();
${tidyCode}
  Q.setDirty(true);
  Q.renderDocListUI();
})();
`;

let url = 'file:///' + path.join(root, 'index.html').replace(/\\/g, '/');

/* 造一张模拟 QQ 聊天窗口的截图，灌进工具里，再画满各类标注，
   用来肉眼核对图片批改这一整套（渲染 / 编号 / 侧栏）的观感。 */
const imgDemoCode = `
(function () {
  var Q = window.__QPR__;
  var W = 620, H = 920;

  function rr(x, px, py, w, h, r) {
    x.beginPath();
    x.moveTo(px + r, py);
    x.arcTo(px + w, py, px + w, py + h, r);
    x.arcTo(px + w, py + h, px, py + h, r);
    x.arcTo(px, py + h, px, py, r);
    x.arcTo(px, py, px + w, py, r);
    x.closePath();
  }

  function makeShot() {
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var x = c.getContext('2d');
    x.fillStyle = '#EDEDED'; x.fillRect(0, 0, W, H);

    x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, W, 72);
    x.fillStyle = '#1F2329';
    x.font = '600 24px sans-serif';
    x.fillText('智慧农业学院团委', 24, 46);
    x.fillStyle = '#12B7F5'; x.fillRect(0, 70, W, 2);

    x.fillStyle = '#FFFFFF';
    rr(x, 22, 92, W - 44, 800, 14); x.fill();

    x.fillStyle = '#1F2329';
    x.font = '700 27px sans-serif';
    x.fillText('【活动预告】智慧农业学院', 46, 190);
    x.fillText('秋季趣味运动会', 46, 226);
    x.fillStyle = '#9198A3';
    x.font = '19px sans-serif';
    x.fillText('团委组织部 · 10 月 9 日', 46, 258);

    x.fillStyle = '#1F2329';
    x.font = '23px sans-serif';
    var lines = [
      [310, '各位同学：'],
      [374, '金秋十月，正是运动好时节！学院将于'],
      [418, '本周五晚7点，在学校西区操场举办秋季'],
      [462, '趣味运动会，现面向全院同学开放报名。'],
      [526, '本次运动会设置了拔河、两人三足、趣味接力'],
      [570, '等六个项目，既有团队协作，也有个人挑战。'],
      [634, '报名方式：请各班同学于周四中午12点前，'],
      [678, '在本班团支书处登记报名，并注明参加项目。'],
      [742, '期待在操场上见到你的身影，'],
      [786, '让我们一起奔跑、一起欢笑！']
    ];
    lines.forEach(function (l) { x.fillText(l[1], 46, l[0]); });

    x.fillStyle = '#B9BFC8';
    x.font = '18px sans-serif';
    x.fillText('19:04', W - 76, 866);
    return c;
  }

  var durl = makeShot().toDataURL('image/png');
  var bin = atob(durl.split(',')[1]);
  var u8 = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);

  /* 先落到干净的文字稿，避免上一轮留在 localStorage 里的图片文档被读回来 */
  Q.STATE.doc = Q.normalizeDoc({ id: 'seed_text', title: '文字稿', raw: '', annotations: [] });
  Q.STATE.mode = 'edit';
  Q.importImage(new File([u8], 'QQ推送截图.png', { type: 'image/png' }));

  var waited = 0;
  (function tick() {
    if (Q.STATE.doc && Q.STATE.doc.kind === 'image' && Q.STATE.doc.image) { paint(); return; }
    waited += 50;
    if (waited > 12000) return;
    setTimeout(tick, 50);
  })();

  function ny(py) { return Math.round(py / H * 10000) / 10000; }
  function nx(px) { return Math.round(px / W * 10000) / 10000; }

  function paint() {
    var d = Q.STATE.doc;
    var marks = [
      { id: 'm1', tool: 'rect', color: '#FF3B30', width: 'mid',
        geo: { x0: nx(38), y0: ny(156), x1: nx(604), y1: ny(266) },
        type: 'typo',
        body: '学院名称请使用全称「智慧农业学院（人工智能学院）」',
        suggestion: '【活动预告】智慧农业学院（人工智能学院）秋季趣味运动会' },

      { id: 'm2', tool: 'ellipse', color: '#FF9500', width: 'mid',
        geo: { x0: nx(40), y0: ny(396), x1: nx(210), y1: ny(432) },
        type: 'wording',
        body: '时间表述建议统一为 24 小时制，与通知口径保持一致',
        suggestion: '本周五 19:00' },

      { id: 'm3', tool: 'arrow', color: '#FF3B30', width: 'mid',
        geo: { x0: nx(560), y0: ny(716), x1: nx(430), y1: ny(646) },
        type: 'format',
        body: '报名信息较长，建议分点列出，同学一眼能看清' },

      { id: 'm4', tool: 'highlight', color: '#FF9500', width: 'mid',
        geo: { x0: nx(40), y0: ny(506), x1: nx(608), y1: ny(548) },
        type: 'format', body: '项目名称建议加顿号分隔，读起来更顺' },

      { id: 'm5', tool: 'pen', color: '#34C759', width: 'mid',
        pts: [[nx(44), ny(800)], [nx(180), ny(802)], [nx(320), ny(802)], [nx(470), ny(800)]],
        type: 'praise', body: '结尾用词有画面感，保留' },

      { id: 'm6', tool: 'pin', color: '#007AFF', width: 'mid',
        geo: { x0: nx(566), y0: ny(330), x1: nx(566), y1: ny(330) },
        type: 'general', body: '整体节奏不错，开头可以加一句更有画面感的引入' }
    ];

    marks.forEach(function (m, i) {
      m.seq = i + 1; m.start = i + 1; m.end = i + 1;
      m.resolved = false; m.lost = false; m.createdAt = Date.now();
      m.quote = Q.quoteOf(m);
    });
    d.marks = marks;
    d.title = '【活动预告】秋季趣味运动会 · 截图批改';

    Q.paintMarks();
    Q.renderSidebar();
    document.getElementById('docTitle').value = d.title;
${tidyCode}
    Q.setDirty(true);
    Q.renderDocListUI();
  }
})();
`;

/* 首次打开的样子：一份干净的图片批改草稿（这是新的默认功能），列表里还没有任何文档 */
const plainCode = `
(function () {
  var Q = window.__QPR__;
  Q.setAnnotator('');
  Q.store.setIndex([]);
  Q.STATE.doc = Q.defaultDraft();
  document.getElementById('docTitle').value = Q.STATE.doc.title;
  /* 不能先手改 STATE.mode 再调 switchMode('edit')：它开头有一条
     "mode 没变就直接返回"的短路，会连带着跳过重渲染。
     先挪到一个不同的值，短路就不会命中。 */
  Q.STATE.mode = 'annotate';
  Q.switchMode('edit');
  Q.setDirty(false);
  Q.renderDocListUI();
})();
`;

function inject(code, fileName) {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const idx = html.lastIndexOf('</body>');
  const injected = html.slice(0, idx) +
    '<script>window.addEventListener("load",function(){' + baseCode + code + '});<\/script>\n' +
    html.slice(idx);
  const tmpDir = path.join(root, 'src', '_tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmp = path.join(tmpDir, fileName);
  fs.writeFileSync(tmp, injected, 'utf8');
  return 'file:///' + tmp.replace(/\\/g, '/');
}

if (imgDemo) {
  url = inject(imgDemoCode, 'img-demo-view.html');
} else if (demo) {
  url = inject(demoCode, 'demo-view.html');
} else {
  url = inject(plainCode, 'plain-view.html');
}

/* 干净首屏是给用户看的，放根目录；带批注的核查图放进 src/_tmp/out，别污染根目录 */
const opts = [dark ? 'dark' : '', mobile ? 'mobile' : '', view !== 'main' ? view : '']
  .filter(Boolean);
let out;
if (!imgDemo && !demo) {
  out = path.join(root, 'preview' + (opts.length ? '-' + opts.join('-') : '') + '.png');
} else {
  fs.mkdirSync(OUT, { recursive: true });
  out = path.join(OUT, 'shot-' + (imgDemo ? 'img' : 'demo') +
    (opts.length ? '-' + opts.join('-') : '') + '.png');
}

try {
  execFileSync(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars',
    '--user-data-dir=' + path.join(os.tmpdir(), 'qpr-shot-profile'),
    /* 注意：headless Edge 的窗口宽度有 500px 下限。请求更小的值不会报错，
       但页面仍按 500 排版，截图却按请求值裁剪 —— 看起来就像"内容溢出"。
       所以窄屏统一用 500 宽，它照样落在 980px 这个断点内。 */
    '--window-size=' + (mobile ? '500,940' : (imgDemo ? '1680,1220' : '1680,1000')),
    '--virtual-time-budget=' + (imgDemo ? 20000 : 6000),
    '--screenshot=' + out,
    url
  ], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
  console.log('截图已生成 → ' + path.relative(root, out));
} catch (e) {
  console.error('截图失败：' + e.message);
  process.exit(1);
}
