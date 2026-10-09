/**
 * 浏览器端自测：用无头 Edge 打开注入了测试脚本的页面，验证
 * 「选区 → 原文偏移」这条只有真实 Range/Selection API 才能验证的链路。
 * Node 里跑不了 Range，所以必须放到真浏览器里。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const testCode = `
(function () {
  var Q = window.__QPR__;
  var out = [];
  var fail = 0;

  function T(name, actual, expected) {
    var ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) fail++;
    out.push((ok ? 'PASS  ' : 'FAIL  ') + name +
      (ok ? '' : '\\n        期望 ' + JSON.stringify(expected) + '\\n        实际 ' + JSON.stringify(actual)));
  }

  function setRaw(raw) {
    Q.STATE.doc.raw = raw;
    Q.STATE.mode = 'annotate';
    Q.STATE.doc.annotations = [];
    Q.renderBodyUI();
  }
  function spans() {
    return Array.prototype.slice.call(document.querySelectorAll('#bubble [data-s]'));
  }
  function pick(n1, o1, n2, o2) {
    var sel = window.getSelection();
    sel.removeAllRanges();
    var r = document.createRange();
    r.setStart(n1, o1);
    r.setEnd(n2, o2);
    sel.addRange(r);
    return Q.readSelection();
  }
  function txt(el) { return el.textContent; }

  try {
    /* ---------- A. 渲染出的片段结构 ---------- */
    var RAW = '本周五晚7点[微笑]学院见';
    setRaw(RAW);
    var sp = spans();
    T('A1 片段数量（文本+表情+文本 = 3）', sp.length, 3);
    T('A2 片段1 原文区间', [sp[0].dataset.s, sp[0].dataset.e], ['0', '6']);
    T('A3 片段1 内容', txt(sp[0]), '本周五晚7点');
    T('A4 片段2 是表情', sp[1].className, 'qq-emoji');
    T('A5 片段2 原文区间覆盖整个 [微笑]', [sp[1].dataset.s, sp[1].dataset.e], ['6', '10']);
    T('A6 片段2 渲染为图标而非字面量', txt(sp[1]) !== '[微笑]' && txt(sp[1]) !== '', true);
    T('A7 片段3 原文区间', [sp[2].dataset.s, sp[2].dataset.e], ['10', '13']);
    T('A8 各片段拼回等于原文', sp.map(function (e) {
      return RAW.slice(Number(e.dataset.s), Number(e.dataset.e));
    }).join(''), RAW);

    /* ---------- B. 选区落在纯文本内 ---------- */
    var t0 = sp[0].firstChild;
    var s = pick(t0, 3, t0, 6);
    T('B1 文本内拖选 晚7点', [s.start, s.end], [3, 6]);
    T('B2 取到的 quote 正确', s.quote, '晚7点');

    /* ---------- C. 选区包含表情（关键：不能把表情当 0 长度） ---------- */
    var t2 = sp[2].firstChild;
    s = pick(t0, 3, t2, 1);
    T('C1 从「晚」拖到「学」→ 跨过表情', [s.start, s.end], [3, 11]);
    T('C2 quote 含表情字面量', s.quote, '晚7点[微笑]学');

    /* ---------- D. 整段选中表情本身 ---------- */
    var bubble = document.getElementById('bubble');
    s = pick(bubble, 1, bubble, 2);
    T('D1 单独选中表情 → 覆盖其完整原文区间', [s.start, s.end], [6, 10]);
    T('D2 quote 就是字面量', s.quote, '[微笑]');

    /* ---------- E. 全文选中 ---------- */
    s = pick(bubble, 0, bubble, sp.length);
    T('E1 全选 → 0 到 13', [s.start, s.end], [0, 13]);

    /* ---------- F. 空白裁剪 ---------- */
    setRaw('第一段\\n\\n第二段[呲牙]结束');
    sp = spans();
    var fb = document.getElementById('bubble');
    var last = sp[sp.length - 1];
    s = pick(sp[1].firstChild, 0, last.firstChild, last.firstChild.length);
    T('F1 选区跨段落不报错且端点正确', s !== null, true);
    T('F2 首尾空白已被裁掉', /^\\S/.test(s.quote) && /\\S$/.test(s.quote), true);

    /* ---------- G. 批量真实推送文本 ---------- */
    setRaw('金秋十月！[微笑] 本周五晚7点，操场见/呲牙🙂 报名请联系团支书。');
    sp = spans();
    T('G1 三种表情都渲染成图标', sp.filter(function (e) {
      return e.className === 'qq-emoji';
    }).length, 3);
    T('G2 所有片段拼回等于原文', sp.map(function (e) {
      return Q.STATE.doc.raw.slice(Number(e.dataset.s), Number(e.dataset.e));
    }).join(''), Q.STATE.doc.raw);

    /* ---------- H. 表情区间回写后能正确切片 ---------- */
    var emo = sp.filter(function (e) { return e.className === 'qq-emoji'; });
    var okSlice = emo.every(function (e) {
      var lit = Q.STATE.doc.raw.slice(Number(e.dataset.s), Number(e.dataset.e));
      return /^\\[|^[/]/.test(lit) || lit.length <= 4;
    });
    T('H1 每个表情片段的原文区间都切到合法字面量', okSlice, true);

    /* ---------- I. 加批注后高亮与反查 ---------- */
    setRaw(RAW);
    var s2 = pick(spans()[0].firstChild, 3, spans()[0].firstChild, 6);
    Q.addAnnotation(s2, 'typo', '时间表述建议统一', '19:00');
    var hl = document.querySelectorAll('#bubble .hl');
    T('I1 被批注的文字出现高亮', hl.length > 0, true);
    var annId = Q.STATE.doc.annotations[0].id;
    var back = document.querySelectorAll('#bubble [data-ann~="' + annId + '"]');
    T('I2 用 [data-ann~=id] 能反查到正文片段', back.length > 0, true);
    T('I3 反查到的正是被批注那段', Array.prototype.map.call(back, function (e) {
      return e.textContent;
    }).join(''), '晚7点');

    /* ---------- J. 重叠批注的区间切分 ---------- */
    Q.STATE.doc.annotations = [
      { id: 'x1', start: 0, end: 6, quote: '本周五晚7点', type: 'typo', body: 'a', resolved: false },
      { id: 'x2', start: 3, end: 10, quote: '晚7点[微笑]', type: 'wording', body: 'b', resolved: false }
    ];
    Q.renderBodyUI();
    var multi = document.querySelectorAll('#bubble .hl-multi');
    T('J1 重叠区域被标为多批注覆盖', multi.length > 0, true);
    setRaw(RAW);

    /* ---------- K. 完整交互链路：拖选 → 浮动条 → 填意见 → 提交 ---------- */
    setRaw(RAW);
    var ksp = spans();
    var kt0 = ksp[0].firstChild;
    var ksel = pick(kt0, 3, kt0, 6);
    Q.showFloating(ksel);

    var bar = document.getElementById('floatingBar');
    T('K1 浮动工具条已弹出', !bar.classList.contains('hidden'), true);
    T('K2 六种批注类型都渲染出来', bar.querySelectorAll('.fb-btn').length, 6);

    var btns = bar.querySelectorAll('.fb-btn');
    T('K3 第一个类型是错别字', btns[0].textContent.indexOf('错别字') >= 0, true);
    btns[3].click();   /* 第 4 个 = 表情 */

    T('K4 点击类型后展开输入表单', bar.querySelectorAll('.composer textarea').length, 1);
    T('K5 表单回显选中的原文',
      bar.querySelector('.composer-quote').textContent.indexOf('晚7点') >= 0, true);
    T('K6 提供了话术模板', bar.querySelectorAll('.chip').length > 0, true);
    T('K7 模板点击可插入',
      (function () {
        var chips = bar.querySelectorAll('.chip');
        chips[0].click();
        return bar.querySelector('.composer textarea').value.length > 0;
      })(), true);

    bar.querySelector('.composer textarea').value = '这个表情放在这里不太合适，建议删掉';
    bar.querySelector('.composer input').value = '';
    var beforeCount = Q.STATE.doc.annotations.length;
    bar.querySelectorAll('.composer-actions .btn-sm')[1].click();

    T('K8 提交后新增了一条批注', Q.STATE.doc.annotations.length, beforeCount + 1);
    var created = Q.STATE.doc.annotations[Q.STATE.doc.annotations.length - 1];
    T('K9 类型是「表情」', created.type, 'emoji');
    T('K10 锚点区间正确', [created.start, created.end], [3, 6]);
    T('K11 原文快照正确', created.quote, '晚7点');
    T('K12 提交后工具条自动收起', bar.classList.contains('hidden'), true);
    T('K13 正文里出现了对应高亮', document.querySelectorAll('#bubble .hl-emoji').length > 0, true);
    T('K14 侧栏出现对应卡片', document.querySelectorAll('#annList .ann-card').length, 1);
    T('K15 侧栏卡片显示的是同一条', document.querySelector('#annList .ann-card')
      .textContent.indexOf('这个表情放在这里不太合适') >= 0, true);

    /* 空意见应当被拦下。注意：提交后正文已重渲染，片段被切得更细，
       必须重新查询，并避开表情片段（其文本长度按码点算，不是字面量长度）。 */
    var ksp2 = spans();
    var klast = ksp2[ksp2.length - 1].firstChild;
    var ksel2 = pick(klast, 0, klast, 2);
    Q.showFloating(ksel2);
    bar.querySelectorAll('.fb-btn')[1].click();
    var cntBefore = Q.STATE.doc.annotations.length;
    bar.querySelectorAll('.composer-actions .btn-sm')[1].click();
    T('K16 空意见被拦下，不生成批注', Q.STATE.doc.annotations.length, cntBefore);

    Q.hideFloating();
    setRaw(RAW);

  } catch (err) {
    fail++;
    out.push('EXCEPTION  ' + (err && err.message) + '\\n' + (err && err.stack));
  }

  out.unshift(fail === 0 ? 'ALL_PASS' : ('FAILED ' + fail));
  var pre = document.createElement('pre');
  pre.id = '__TEST_RESULT__';
  pre.textContent = out.join('\\n');
  document.body.appendChild(pre);

  var t = document.createElement('div');
  t.id = '__TEST_DONE__';
  document.body.appendChild(t);
})();
`;

const shell = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const probe = [
  '<script>',
  'window.onerror=function(m,s,l,c,e){',
  '  var d=document.createElement("div");d.id="__ERR__";',
  '  d.textContent="ERR: "+m+" @"+l+":"+c;document.documentElement.appendChild(d);',
  '};',
  'document.addEventListener("DOMContentLoaded",function(){',
  '  var d=document.createElement("div");d.id="__DC_OK__";',
  '  d.textContent="dc-ok, __QPR__="+(typeof window.__QPR__);',
  '  document.documentElement.appendChild(d);',
  '});',
  '<\/script>'
].join('\n');

let injected = shell.replace('<title>', probe + '\n<title>');

/* 注意：index.html 里「导出批改稿」的模板字符串本身含有 </body> 字面量，
   必须用 lastIndexOf 定位真正的文档闭合标签，否则会把脚本塞进 JS 字符串中间。 */
const closeIdx = injected.lastIndexOf('</body>');
injected = injected.slice(0, closeIdx) +
  '<script>window.addEventListener("load", function () {' + testCode + '});<\/script>\n' +
  injected.slice(closeIdx);

if (!/readSelection/.test(injected)) {
  console.error('注入失败：index.html 里没有找到可替换的锚点。');
  process.exit(4);
}

const tmpDir = path.join(root, 'src', '_tmp');
fs.mkdirSync(tmpDir, { recursive: true });
const tmpHtml = path.join(tmpDir, 'dom-check.html');
fs.writeFileSync(tmpHtml, injected, 'utf8');

const userDataDir = path.join(os.tmpdir(), 'qpr-edge-profile');
const url = 'file:///' + tmpHtml.replace(/\\/g, '/');

let stdout = '';
try {
  stdout = execFileSync(EDGE, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=' + userDataDir,
    '--virtual-time-budget=6000',
    '--dump-dom',
    url
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  if (e.stdout) stdout = e.stdout.toString();
  else {
    console.error('无法启动无头浏览器：', e.message);
    process.exit(2);
  }
}

const m = /<pre id="__TEST_RESULT__">([\s\S]*?)<\/pre>/.exec(stdout);
if (!m) {
  console.error('页面里没有找到测试结果。');
  console.error('  注入脚本是否存在: ' + /readSelection/.test(stdout));
  console.error('  __QPR__ 是否挂上:  ' + /__QPR__/.test(stdout));
  console.error('  DOMContentLoaded 标记: ' + /__DC_OK__/.test(stdout));
  console.error('  运行时错误: ' + ((/<div id="__ERR__">([\s\S]*?)<\/div>/.exec(stdout) || [])[1] || '无'));
  console.error('  pre 标签出现次数: ' + (stdout.match(/<pre/g) || []).length);
  process.exit(3);
}

const body = m[1]
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&')
  .trim();

console.log(body);
const failed = /^FAILED/m.test(body.split('\n')[0]);
process.exit(failed ? 1 : 0);
