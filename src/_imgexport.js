/**
 * 图片批改的导出成品校验：在真浏览器里跑 buildDocCanvas，把结果 PNG 落盘，
 * 用来肉眼确认「标注层 + 图下意见清单」真的画对了、排版没崩。
 * 顺带验两件事：仅标注图尺寸等于原图；带清单时高度必须增加。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const OUT = path.join(root, 'src', '_tmp', 'out');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const genCode = `
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

  var c = document.createElement('canvas');
  c.width = W; c.height = H;
  var x = c.getContext('2d');
  x.fillStyle = '#EDEDED'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, W, 72);
  x.fillStyle = '#1F2329'; x.font = '600 24px sans-serif';
  x.fillText('智慧农业学院团委', 24, 46);
  x.fillStyle = '#12B7F5'; x.fillRect(0, 70, W, 2);
  x.fillStyle = '#FFFFFF'; rr(x, 22, 92, W - 44, 800, 14); x.fill();
  x.fillStyle = '#1F2329'; x.font = '700 27px sans-serif';
  x.fillText('【活动预告】智慧农业学院', 46, 190);
  x.fillText('秋季趣味运动会', 46, 226);
  x.fillStyle = '#9198A3'; x.font = '19px sans-serif';
  x.fillText('团委组织部 · 10 月 9 日', 46, 258);
  x.fillStyle = '#1F2329'; x.font = '23px sans-serif';
  [[310,'各位同学：'],
   [374,'金秋十月，正是运动好时节！学院将于'],
   [418,'本周五晚7点，在学校西区操场举办秋季'],
   [462,'趣味运动会，现面向全院同学开放报名。'],
   [526,'本次运动会设置了拔河、两人三足、趣味接力'],
   [570,'等六个项目，既有团队协作，也有个人挑战。'],
   [634,'报名方式：请各班同学于周四中午12点前，'],
   [678,'在本班团支书处登记报名，并注明参加项目。'],
   [742,'期待在操场上见到你的身影，'],
   [786,'让我们一起奔跑、一起欢笑！']
  ].forEach(function (l) { x.fillText(l[1], 46, l[0]); });
  x.fillStyle = '#B9BFC8'; x.font = '18px sans-serif';
  x.fillText('19:04', W - 76, 866);

  var durl = c.toDataURL('image/png');
  var bin = atob(durl.split(',')[1]);
  var u8 = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  /* 先切到一个干净的文字稿，再导入截图。
     否则上一次运行留在 localStorage 里的图片文档会被 boot() 读回来，
     轮询条件立刻为真，测试会在 importImage 还没跑完时就往下走。 */
  Q.STATE.doc = Q.normalizeDoc({ id: 'seed_text', title: '文字稿', raw: '', annotations: [] });
  Q.STATE.mode = 'edit';
  Q.setAnnotator('李小明');
  Q.importImage(new File([u8], 'QQ推送截图.png', { type: 'image/png' }));

  var waited = 0;
  (function tick() {
    if (Q.STATE.doc && Q.STATE.doc.kind === 'image' && Q.STATE.doc.image) { paint(); return; }
    waited += 50;
    if (waited > 12000) { emit('', '', 0, 0, 0, 0, 0, 0, 'poll timeout'); return; }
    setTimeout(tick, 50);
  })();

  function ny(py) { return Math.round(py / H * 10000) / 10000; }
  function nx(px) { return Math.round(px / W * 10000) / 10000; }

  /* 纯函数级的补充校验：分栏均衡、圆角同心、JSON 导入容错。
     这几条不依赖画布，直接在页内算出来塞进 meta，node 侧再断言。 */
  function unitTests() {
    var nf = 15;
    var rows = [];
    for (var i = 0; i < 7; i++) {
      rows.push({
        relX: i === 6 ? 0.82 : 0.08 + i * 0.005,   /* 6 张挤在图左半边 + 1 张在右下 */
        relY: 0.08 + i * 0.12,
        h: 60
      });
    }
    var s = Q.splitIndexSides(rows, 22);
    var oneLeft = Q.splitIndexSides([{ relX: 0.1, relY: 0.2, h: 60 }], 22);

    var R = Q.cardRadius(nf);
    return {
      sideL: s.left.length, sideR: s.right.length,
      singleL: oneLeft.left.length, singleR: oneLeft.right.length,
      cardR: R, innerR: Q.innerRadius(R), oldCardR: Math.round(nf * 0.75),
      impWrapped: (function () {
        var a = Q.importDocsFrom({ type: 'qq-push-reviewer', schemaVersion: 1,
          exportedAt: 1, doc: { kind: 'image', title: '存档A', image: null, marks: [{ id: 'x' }] } });
        return (a.length === 1 && a[0].kind === 'image' && a[0].title === '存档A' &&
                !!a[0].id && a[0].schemaVersion === 1 && !a[0].exportedAt) ? 1 : 0;
      })(),
      impBare: (function () {
        var a = Q.importDocsFrom({ kind: 'text', raw: 'hi', annotations: [] });
        return (a.length === 1 && a[0].kind === 'text' && !!a[0].id && a[0].title) ? 1 : 0;
      })(),
      impBogus: Q.importDocsFrom({ hello: 'world' }).length,
      impWrongType: Q.importDocsFrom({ kind: 'text', raw: 'x', type: 'something-else' }).length,
      impJunkArray: Q.importDocsFrom([null, 42, 'x', { kind: 'text', raw: 'y' }]).length
    };
  }

  function paint() {
    var d = Q.STATE.doc;
    d.title = '【活动预告】秋季趣味运动会';
    d.marks = [
      { id: 'm1', tool: 'rect', color: '#E23B3B', width: 'mid',
        geo: { x0: nx(38), y0: ny(156), x1: nx(604), y1: ny(266) },
        type: 'typo',
        body: '学院名称请使用全称「智慧农业学院（人工智能学院）」，通知里出现简称容易被误认成别家学院',
        suggestion: '【活动预告】智慧农业学院（人工智能学院）秋季趣味运动会' },

      { id: 'm2', tool: 'ellipse', color: '#E8890C', width: 'mid',
        geo: { x0: nx(40), y0: ny(396), x1: nx(210), y1: ny(432) },
        type: 'wording',
        body: '时间表述建议统一为 24 小时制，与学院通知口径保持一致',
        suggestion: '本周五 19:00' },

      { id: 'm3', tool: 'arrow', color: '#E23B3B', width: 'mid',
        geo: { x0: nx(560), y0: ny(716), x1: nx(430), y1: ny(646) },
        type: 'format',
        body: '报名信息较长，建议分点列出，同学一眼能看清' },

      { id: 'm4', tool: 'highlight', color: '#E8890C', width: 'mid',
        geo: { x0: nx(40), y0: ny(506), x1: nx(608), y1: ny(548) },
        type: 'format', body: '项目名称建议加顿号分隔，读起来更顺' },

      { id: 'm5', tool: 'pen', color: '#17A673', width: 'mid',
        pts: [[nx(44), ny(800)], [nx(180), ny(802)], [nx(320), ny(802)], [nx(470), ny(800)]],
        type: 'praise', body: '结尾用词有画面感，保留' },

      { id: 'm6', tool: 'pin', color: '#2E7CF6', width: 'mid',
        geo: { x0: nx(566), y0: ny(330), x1: nx(566), y1: ny(330) },
        type: 'general', body: '整体节奏不错，开头可以加一句更有画面感的引入' }
    ];
    d.marks.forEach(function (m, i) {
      m.seq = i + 1; m.start = i + 1; m.end = i + 1;
      m.resolved = false; m.lost = false; m.createdAt = Date.now();
      m.quote = Q.quoteOf(m);
    });
    Q.paintMarks();
    Q.renderSidebar();

    var Wn = d.image.w, Hn = d.image.h;
    var pre = { mk: d.marks.length, note: Q.imageNoteMarks().length };
    Q.buildDocCanvas(false).then(function (c1) {
      var plain = c1.toDataURL('image/png');
      var mid = { mk: d.marks.length, note: Q.imageNoteMarks().length };
      return Q.buildDocCanvas(true).then(function (c2) {
        return Q.buildIndexCanvas('side').then(function (c3) {
          return Q.buildIndexCanvas('near').then(function (c4) {
            emit(plain, c2.toDataURL('image/png'), Wn, Hn,
              c1.width, c1.height, c2.width, c2.height, '',
              { pre: pre, mid: mid }, c3, c4);
          });
        });
      });
    }).catch(function (e) {
      emit('', '', 0, 0, 0, 0, 0, 0, e && e.message, null, null, null);
    });
  }

  function emit(plain, full, Wn, Hn, p1, p2, f1, f2, err, dbg, c3, c4) {
    var pre = document.createElement('pre');
    pre.id = '__EXPORT_META__';
    pre.textContent = JSON.stringify({
      w: Wn, h: Hn, plainW: p1, plainH: p2, fullW: f1, fullH: f2,
      sideW: c3 ? c3.width : 0, sideH: c3 ? c3.height : 0,
      nearW: c4 ? c4.width : 0, nearH: c4 ? c4.height : 0,
      err: err || '', dbg: dbg || null, unit: unitTests()
    });
    document.body.appendChild(pre);
    var a = document.createElement('pre');
    a.id = '__PLAIN__'; a.textContent = plain || 'EMPTY';
    var b = document.createElement('pre');
    b.id = '__FULL__'; b.textContent = full || 'EMPTY';
    var s = document.createElement('pre');
    s.id = '__SIDE__'; s.textContent = c3 ? c3.toDataURL('image/png') : 'EMPTY';
    var n = document.createElement('pre');
    n.id = '__NEAR__'; n.textContent = c4 ? c4.toDataURL('image/png') : 'EMPTY';
    document.body.appendChild(a);
    document.body.appendChild(b);
    document.body.appendChild(s);
    document.body.appendChild(n);
    var t = document.createElement('div');
    t.id = '__DONE__';
    document.body.appendChild(t);
  }
})();
`;

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const idx = html.lastIndexOf('</body>');
const injected = html.slice(0, idx) +
  '<script>window.__ERRLOG__="";window.onerror=function(m,s,l,c,e){' +
  'window.__ERRLOG__+=m+" @"+l+":"+c+" | "+String(e&&e.stack).split("\\n").slice(0,3).join(" ^ ")+" ;; ";' +
  '};<\/script>\n' +
  '<script>window.addEventListener("load",function(){' + genCode + '});<\/script>\n' +
  html.slice(idx);

const tmpDir = path.join(root, 'src', '_tmp');
fs.mkdirSync(tmpDir, { recursive: true });
const tmp = path.join(tmpDir, 'img-export-gen.html');
fs.writeFileSync(tmp, injected, 'utf8');

let stdout = '';
try {
  stdout = execFileSync(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--window-size=1680,1220',
    '--user-data-dir=' + path.join(os.tmpdir(), 'qpr-imgexport-profile'),
    '--virtual-time-budget=30000', '--dump-dom',
    'file:///' + tmp.replace(/\\/g, '/')
  ], { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  stdout = e.stdout ? e.stdout.toString() : '';
}

function grabText(id) {
  const re = new RegExp('<pre id="' + id + '">([\\s\\S]*?)<\\/pre>');
  const m = re.exec(stdout);
  return m ? m[1].trim() : null;
}

const metaRaw = grabText('__EXPORT_META__');
if (!metaRaw) {
  console.error('没能取到导出元信息。');
  console.error('  DOM 片段：' + stdout.slice(0, 800));
  process.exit(2);
}

const meta = JSON.parse(metaRaw.replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
if (meta.err) {
  console.error('页面里报错：' + meta.err);
  process.exit(2);
}

function savePng(id, file) {
  const b64 = grabText(id);
  if (!b64 || b64 === 'EMPTY') return null;
  const buf = Buffer.from(b64.split(',')[1], 'base64');
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, file), buf);
  return buf.length;
}

const aBytes = savePng('__PLAIN__', 'imgdoc-仅标注图.png');
const bBytes = savePng('__FULL__', 'imgdoc-含意见清单.png');
const sBytes = savePng('__SIDE__', 'imgdoc-两侧索引图.png');
const nBytes = savePng('__NEAR__', 'imgdoc-就近索引图.png');

let bad = 0;
function check(label, ok) {
  if (!ok) bad++;
  console.log('  ' + (ok ? 'PASS  ' : 'FAIL  ') + label);
}
check('仅标注图尺寸等于原图 (' + meta.plainW + '×' + meta.plainH + ' vs ' + meta.w + '×' + meta.h + ')',
  meta.plainW === meta.w && meta.plainH === meta.h);
check('带清单时宽度不变', meta.fullW === meta.w);
check('带清单时高度增加 (' + meta.fullH + ' > ' + meta.h + ')', meta.fullH > meta.h);
check('导出过程不会顺手清空标注（' + JSON.stringify(meta.dbg) + '）',
  !!meta.dbg && meta.dbg.mid.mk === meta.dbg.pre.mk && meta.dbg.mid.note === meta.dbg.pre.note);
check('仅标注图已落盘', !!aBytes);
check('含意见清单的图已落盘', !!bBytes);
check('两侧索引图比原图宽（留出了左右栏）(' + meta.sideW + ' > ' + meta.w + ')', meta.sideW > meta.w);
check('两侧索引图已落盘', !!sBytes);
check('就近索引图已落盘，且宽度略大于原图 (' + meta.nearW + ' >= ' + meta.w + ')',
  !!nBytes && meta.nearW >= meta.w);

const u = meta.unit || {};
check('两侧分栏不再一头沉（6 左 1 右 → ' + u.sideL + ' : ' + u.sideR + '）',
  Math.abs((u.sideL || 0) - (u.sideR || 0)) <= 1 && (u.sideL || 0) + (u.sideR || 0) === 7);
check('只有一张卡时不会硬凑到两边（' + u.singleL + ' : ' + u.singleR + '）',
  u.singleL === 1 && u.singleR === 0);
check('卡片圆角比原来小 (' + u.cardR + ' < ' + u.oldCardR + ')',
  typeof u.cardR === 'number' && u.cardR < u.oldCardR);
check('内层圆角小于外层、成体系 (' + u.innerR + ' < ' + u.cardR + ')',
  typeof u.innerR === 'number' && u.innerR > 0 && u.innerR < u.cardR);
check('JSON 导入：认包装存档、剥掉包装字段', u.impWrapped === 1);
check('JSON 导入：也认裸 doc 对象', u.impBare === 1);
check('JSON 导入：不像文档的 payload 被拒（' + u.impBogus + '）', u.impBogus === 0);
check('JSON 导入：type 不匹配的存档被拒（' + u.impWrongType + '）', u.impWrongType === 0);
check('JSON 导入：数组里的杂质被跳过，只留合法的一份（' + u.impJunkArray + '）', u.impJunkArray === 1);

console.log('');
console.log('仅标注图      ' + (aBytes / 1024).toFixed(0) + ' KB  → src/_tmp/out/imgdoc-仅标注图.png');
console.log('含意见清单    ' + (bBytes / 1024).toFixed(0) + ' KB  → src/_tmp/out/imgdoc-含意见清单.png');
console.log('两侧索引图    ' + (sBytes / 1024).toFixed(0) + ' KB  → src/_tmp/out/imgdoc-两侧索引图.png  (' + meta.sideW + '×' + meta.sideH + ')');
console.log('就近索引图    ' + (nBytes / 1024).toFixed(0) + ' KB  → src/_tmp/out/imgdoc-就近索引图.png  (' + meta.nearW + '×' + meta.nearH + ')');

process.exit(bad ? 1 : 0);
