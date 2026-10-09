/**
 * 图片批改的浏览器端自测。
 *
 * 这里要验的是 Node 侧完全测不到的两条链路：
 *   1. 「屏幕坐标 → 归一化坐标」的换算（等价于文字版的选区偏移，错一点标注就整体跑偏）
 *   2. 绘制 → 落库 → 编号 → 导出 canvas 的完整链路
 * 所以必须在真浏览器里派发 PointerEvent 来做。
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
  function near(name, actual, expected, tol) {
    var ok = Math.abs(actual - expected) <= tol;
    if (!ok) fail++;
    out.push((ok ? 'PASS  ' : 'FAIL  ') + name +
      (ok ? '' : '\\n        期望 ≈' + expected + ' ±' + tol + '  实际 ' + actual));
  }

  /* 造一张测试截图：纯色底 + 一点文字，模拟 QQ 聊天截图 */
  function makeFile(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var x = c.getContext('2d');
    x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#0B7FA8';
    x.fillRect(40, 40, 4, h - 80);
    x.fillStyle = '#1F2329';
    x.font = '30px sans-serif';
    x.fillText('【活动预告】智慧农业学院', 70, 110);
    x.fillText('秋季趣味运动会', 70, 170);
    x.fillStyle = '#9198A3';
    x.font = '22px sans-serif';
    x.fillText('金秋十月，正是运动好时节', 70, 260);
    x.fillText('本周五晚 19:00 西区操场', 70, 310);

    var durl = c.toDataURL('image/png');
    var bin = atob(durl.split(',')[1]);
    var u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new File([u8], 'QQ推送截图.png', { type: 'image/png' });
  }

  function press(el, type, cx, cy) {
    var ev = new PointerEvent(type, {
      bubbles: true, cancelable: true,
      clientX: cx, clientY: cy, pointerId: 1, pointerType: 'mouse', isPrimary: true
    });
    el.dispatchEvent(ev);
  }

  /* 在画布上按「归一化比例」拖动，坐标由当前 SVG 的实际位置换算出来 */
  function dragNorm(nx0, ny0, nx1, ny1, midSteps) {
    var svg = document.getElementById('stageSvg');
    var r = svg.getBoundingClientRect();
    var at = function (nx, ny) {
      return [r.left + r.width * nx, r.top + r.height * ny];
    };
    var p = at(nx0, ny0);
    press(svg, 'pointerdown', p[0], p[1]);
    var steps = midSteps || 1;
    for (var i = 1; i <= steps; i++) {
      var nx = nx0 + (nx1 - nx0) * i / steps;
      var ny = ny0 + (ny1 - ny0) * i / steps;
      var q = at(nx, ny);
      press(svg, 'pointermove', q[0], q[1]);
    }
    var e = at(nx1, ny1);
    press(svg, 'pointerup', e[0], e[1]);
  }

  var done = false;
  function finish() {
    if (done) return;
    done = true;
    out.unshift(fail === 0 ? 'ALL_PASS' : ('FAILED ' + fail));
    var pre = document.createElement('pre');
    pre.id = '__TEST_RESULT__';
    pre.textContent = out.join('\\n');
    document.body.appendChild(pre);
    var t = document.createElement('div');
    t.id = '__TEST_DONE__';
    document.body.appendChild(t);
  }

  function waitFor(cond, cb, budget) {
    var waited = 0;
    (function tick() {
      if (cond()) { cb(); return; }
      waited += 50;
      if (waited > (budget || 8000)) { cb(); return; }
      setTimeout(tick, 50);
    })();
  }

  try {
    /* ---------- A. 文字文档的导出菜单：PDF / 长图可选批注样式 ---------- */
    Q.STATE.doc.kind = 'text';
    Q.renderExportMenu();
    var menu = document.getElementById('exportMenu').innerHTML;
    T('A1 文字文档：PDF 提供整体批注式', menu.indexOf('data-act="pdf-list"') >= 0, true);
    T('A2 文字文档：PDF 提供段后批注式', menu.indexOf('data-act="pdf-inline"') >= 0, true);
    T('A3 文字文档：长图提供整体批注式', menu.indexOf('data-act="img-list"') >= 0, true);
    T('A4 文字文档：长图提供段后批注式', menu.indexOf('data-act="img-inline"') >= 0, true);
    T('A5 文字文档不再出现写死的老按钮', menu.indexOf('data-act="pdf"') < 0, true);

    /* ---------- B. 导入截图 ---------- */
    /* 先落到一个干净的文字稿，避免上一轮留在 localStorage 里的图片文档
       被 boot() 读回来，让下面的轮询条件提前为真。 */
    Q.STATE.doc = Q.normalizeDoc({ id: 'seed_text', title: '文字稿', raw: '', annotations: [] });
    Q.STATE.mode = 'edit';
    Q.importImage(makeFile(600, 400));

    waitFor(function () {
      return Q.STATE.doc.kind === 'image' && Q.STATE.doc.image;
    }, function () {
      try { runRest(); } catch (e) {
        fail++; out.push('EXCEPTION ' + e.message + '\\n' + e.stack); finish();
      }
    });
  } catch (e) {
    fail++; out.push('EXCEPTION ' + e.message + '\\n' + e.stack); finish();
  }

  function runRest() {
    var doc = Q.STATE.doc;

    T('B1 文档类型已切换为图片', doc.kind, 'image');
    T('B2 图片长边被压到 1500 以内', Math.max(doc.image.w, doc.image.h) <= 1500, true);
    T('B3 尺寸按原比例保留（600×400 → 3:2）',
      Math.round(doc.image.w / doc.image.h * 100), 150);
    T('B4 标题取自文件名', doc.title, 'QQ推送截图');
    T('B5 导入后自动进入批注模式', Q.STATE.mode, 'annotate');
    T('B6 画布已显示', !document.getElementById('imgHolder').classList.contains('hidden'), true);
    T('B7 工具栏已显示', !document.getElementById('imgTools').classList.contains('hidden'), true);
    T('B8 上传区已隐藏', document.getElementById('imgDrop').classList.contains('hidden'), true);
    T('B9 SVG viewBox 与图片原始尺寸一致',
      document.getElementById('stageSvg').getAttribute('viewBox'),
      '0 0 ' + doc.image.w + ' ' + doc.image.h);

    /* ---------- Z. 缩放 ----------
       这一节要盯两件事：
       一是「传入图被压缩」这个真 bug —— 它压根不在缩放逻辑里，
         而是卡片作为纵向 flex 子项被 flex-shrink 压扁把图挤变形，
         所以断言一律打在 getBoundingClientRect（渲染尺寸）上，只看 style.height 是瞎的。
       二是缩放不能改写「屏幕坐标 → 归一化坐标」的换算，否则症状是标注整体跑偏。 */
    var holder = document.getElementById('imgHolder');
    var board = document.getElementById('imgBoard');
    var imgW = doc.image.w, imgH = doc.image.h;

    T('Z1 桌面默认 1:1 原尺寸打开（不压缩）', Q.DRAW.zoomFit, false);
    T('Z2 默认倍率就是 100%', Q.viewScale(), 1);
    var box0 = holder.getBoundingClientRect();
    T('Z3 画布渲染尺寸等于图片原始像素',
      [Math.round(box0.width), Math.round(box0.height)], [imgW, imgH]);
    T('Z4 宽高比与原图一致',
      Math.round(box0.width / box0.height * 100), Math.round(imgW / imgH * 100));

    /* 复现用户报的那张图：长图（远高于画布）打开时的比例失真 */
    var keepImgH = Q.STATE.doc.image.h;
    Q.STATE.doc.image.h = keepImgH * 4;
    Q.applyView();
    var tallBox = holder.getBoundingClientRect();
    T('Z5 长图不被压扁：渲染高度跟得上设定高度',
      Math.round(tallBox.height), Math.round(keepImgH * 4 * Q.viewScale()));
    near('Z6 长图渲染后的宽高比仍是原比例',
      tallBox.width / tallBox.height, Q.STATE.doc.image.w / Q.STATE.doc.image.h, 0.02);
    T('Z7 长图高过画布时画布可纵向滚动',
      board.scrollHeight > board.clientHeight, true);
    Q.STATE.doc.image.h = keepImgH;
    Q.applyView();

    /* 「适应」只缩不放：小图不会被拉大发虚 */
    T('Z8 适应倍率封顶 100%', Q.fitScale() <= 1, true);
    var keepImgW = Q.STATE.doc.image.w;
    Q.STATE.doc.image.w = 6000;          /* 假装来了一张远宽于画布的图 */
    var wideFit = Q.fitScale();
    Q.STATE.doc.image.w = keepImgW;
    T('Z9 超宽图的适应倍率小于 100%', wideFit > 0 && wideFit < 1, true);

    /* 倍率上下限：再乱按也不会缩到看不见、也不会放大到只剩马赛克 */
    Q.setScale(0.01);
    T('Z10 缩小有下限', Q.viewScale(), 0.15);
    Q.setScale(99);
    T('Z11 放大到上限被夹住', Q.viewScale(), 8);
    Q.setScale(2);
    T('Z12 放大后画布按倍率变大',
      Math.round(holder.getBoundingClientRect().width), Math.round(imgW * 2));
    var z12 = holder.getBoundingClientRect();
    T('Z13 放大后仍保持原比例',
      Math.round(z12.width / z12.height * 100), Math.round(imgW / imgH * 100));

    /* 关键回归：缩放只改显示，不改坐标换算。
       哪天有人图省事拿 clientX 直接除以图片原始宽度，这里立刻红。 */
    var marksBefore = Q.STATE.doc.marks.length;
    Q.DRAW.tool = 'rect';
    dragNorm(0.25, 0.30, 0.60, 0.55);
    var zoomMark = Q.STATE.doc.marks[Q.STATE.doc.marks.length - 1];
    T('Z14 2 倍缩放下照样能画', Q.STATE.doc.marks.length, marksBefore + 1);
    near('Z15 2 倍缩放下 x0 换算依然准确', zoomMark.geo.x0, 0.25, 0.02);
    near('Z16 2 倍缩放下 y1 换算依然准确', zoomMark.geo.y1, 0.55, 0.02);
    Q.undoMark();

    /* 平移：只挪画面，不落笔。放大后没有它就没法把切到画外的手指挪回来 */
    Q.setScale(3);
    board.scrollLeft = 0; board.scrollTop = 0;
    Q.DRAW.tool = 'pan';
    var nBeforePan = Q.STATE.doc.marks.length;
    dragNorm(0.70, 0.70, 0.25, 0.25, 4);
    T('Z17 平移工具不产生标注', Q.STATE.doc.marks.length, nBeforePan);
    T('Z18 平移真的把画面挪动了', board.scrollTop > 0 && board.scrollLeft > 0, true);
    T('Z19 图比画布大时贴左上（溢出可滚到）', parseFloat(holder.style.marginLeft), 0);
    T('Z20 溢出时不再插入空白居中', parseFloat(holder.style.marginTop), 0);

    /* 工具栏读数 + 按钮 */
    T('Z21 工具条里有平移工具',
      !!document.querySelector('#imgTools [data-tool="pan"]'), true);
    /* 图标从 ICONS 取不到时会拼成字面量 "undefined"（不报错，只是难看），
       实证抓一次：工具条里出现 undefined 就是漏配了图标。 */
    T('Z22 工具条里没有 undefined（图标没漏配）',
      document.getElementById('imgTools').textContent.indexOf('undefined'), -1);
    T('Z23 每个工具按钮都带图标',
      Array.prototype.every.call(document.querySelectorAll('#imgTools [data-tool]'), function (b) {
        return !!b.querySelector('svg');
      }), true);
    T('Z24 工具有缩放读数', !!document.getElementById('imgZoomPct'), true);
    T('Z25 工具条里有「适应」按钮', !!document.getElementById('imgZoomFit'), true);
    Q.setScale(2.5);
    T('Z26 读数跟随倍率', document.getElementById('imgZoomPct').textContent, '250%');
    Q.zoomToFit();
    T('Z27「适应」按钮在适应态高亮',
      document.getElementById('imgZoomFit').classList.contains('is-on'), true);
    T('Z28「适应」把整图收进画布宽度',
      holder.getBoundingClientRect().width <= board.clientWidth, true);
    Q.zoomToActual();
    T('Z29 100% 按钮回到原尺寸', Q.viewScale(), 1);
    T('Z30 回到 100% 后按钮不再高亮',
      document.getElementById('imgZoomFit').classList.contains('is-on'), false);

    /* 捏合：手机上最顺手的放大方式，必须真的能改倍率。
       注意 pointerup 要派发到 window —— 手指在画布外抬起时 board 收不到。 */
    function pinchEv(id, x, y, type) {
      return new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch',
        isPrimary: id === 1, clientX: x, clientY: y
      });
    }
    Q.setScale(1);
    var br = board.getBoundingClientRect();
    var px = br.left + 140, py = br.top + 160;
    board.dispatchEvent(pinchEv(1, px - 40, py, 'pointerdown'));
    board.dispatchEvent(pinchEv(2, px + 40, py, 'pointerdown'));
    var s0 = Q.viewScale();
    board.dispatchEvent(pinchEv(1, px - 80, py, 'pointermove'));
    board.dispatchEvent(pinchEv(2, px + 80, py, 'pointermove'));
    T('Z32 双指拉开就放大', Q.viewScale() > s0, true);
    board.dispatchEvent(pinchEv(1, px - 160, py, 'pointermove'));
    board.dispatchEvent(pinchEv(2, px + 160, py, 'pointermove'));
    T('Z33 拉开越多放得越大', Q.viewScale() > s0 * 2, true);
    window.dispatchEvent(pinchEv(2, px + 160, py, 'pointerup'));
    var sAfter = Q.viewScale();
    window.dispatchEvent(pinchEv(1, px - 400, py, 'pointermove'));
    T('Z34 收掉一指后捏合立刻结束（不会单指乱缩放）', Q.viewScale(), sAfter);
    window.dispatchEvent(pinchEv(1, px - 400, py, 'pointerup'));
    T('Z35 捏合收尾后状态复位', Q.DRAW.pinching, false);

    /* 收尾：回到默认倍率，后面的绘制用例从干净状态起步 */
    Q.resetZoomDefault();
    Q.applyView();
    board.scrollLeft = 0; board.scrollTop = 0;
    T('Z31 收起缩放后回到该设备的默认倍率', Q.viewScale(), 1);
    Q.DRAW.tool = 'rect';

    /* ---------- C. 屏幕坐标 → 归一化坐标（最关键的一条） ---------- */
    Q.DRAW.tool = 'rect';
    Q.DRAW.color = '#E23B3B';
    dragNorm(0.25, 0.30, 0.60, 0.55);

    T('C1 画出一个标注', Q.STATE.doc.marks.length, 1);
    var m0 = Q.STATE.doc.marks[0];
    T('C2 工具记录正确', m0.tool, 'rect');
    T('C3 颜色记录正确', m0.color, '#E23B3B');
    near('C4 x0 换算准确', m0.geo.x0, 0.25, 0.02);
    near('C5 y0 换算准确', m0.geo.y0, 0.30, 0.02);
    near('C6 x1 换算准确', m0.geo.x1, 0.60, 0.02);
    near('C7 y1 换算准确', m0.geo.y1, 0.55, 0.02);
    T('C8 左上角被规范化为较小值', m0.geo.x0 < m0.geo.x1 && m0.geo.y0 < m0.geo.y1, true);
    T('C9 位置描述落在左上', Q.locOf(m0), '图左上');
    T('C10 意见框自动弹出（画完就能写）',
      !document.getElementById('imgComposer').classList.contains('hidden'), true);
    T('C11 画完还没写意见，所以不进清单', Q.imageNoteMarks().length, 0);

    /* ---------- D. 填写意见并保存 ---------- */
    var box = document.getElementById('imgComposer');
    box.dataset.pickedType = 'wording';
    box.querySelector('textarea').value = '时间建议写成 24 小时制，前后统一';
    box.querySelector('input[type="text"]').value = '本周五 19:00';
    box.querySelector('.composer-actions .btn-sm.primary').click();

    T('D1 意见已写入标注', m0.body, '时间建议写成 24 小时制，前后统一');
    T('D2 建议改法已写入', m0.suggestion, '本周五 19:00');
    T('D3 类型已写入', m0.type, 'wording');
    T('D4 保存后意见框收起', box.classList.contains('hidden'), true);
    T('D5 这条标注进入清单', Q.imageNoteMarks().length, 1);
    T('D6 侧栏出现卡片', document.querySelectorAll('#annList .ann-card').length, 1);
    T('D7 卡片显示位置提示',
      document.querySelector('#annList .ann-quote').textContent.indexOf('图左上') >= 0, true);
    T('D8 卡片显示意见内容',
      document.querySelector('#annList .ann-body').textContent.indexOf('24 小时制') >= 0, true);
    var badges = document.querySelectorAll('#svMarks text');
    T('D9 图上出现编号徽标', badges.length, 1);
    T('D10 徽标编号为 1', badges[0].textContent, '1');

    /* 现在改成了「点保存才保存」：画完标注只标脏，
       文档列表的统计要等保存之后才更新。
       这里顺便验证「保存真的写进了本地存储」，而不只是改了内存里的对象。 */
    var myId = Q.STATE.doc.id;
    function entryOf(id) {
      var ix = Q.store.index();
      for (var i = 0; i < ix.length; i++) if (ix[i].id === id) return ix[i];
      return null;
    }
    var e0 = entryOf(myId) || {};
    T('D11 导入图片本身已立即落盘', !!Q.store.doc(myId), true);
    T('D12 刚导入时文档列表统计为 0 条', e0.annCount, 0);
    T('D13 画完标注后处于「未保存」', Q.STATE.dirty, true);
    T('D14 未保存时统计仍未更新', (entryOf(myId) || {}).annCount, 0);
    Q.saveNow(true);
    var e1 = entryOf(myId) || {};
    T('D15 保存后统计为 1 条批注', e1.annCount, 1);
    T('D16 文档列表标记为图片类型', e1.kind, 'image');
    T('D17 保存后回到「已保存」', Q.STATE.dirty, false);
    try { phaseE(); } catch (e) {
      fail++; out.push('EXCEPTION ' + e.message + '\\n' + e.stack); finish();
    }
  }

  function phaseE() {
    var doc = Q.STATE.doc;
    var m0 = Q.STATE.doc.marks[0];
    var box = document.getElementById('imgComposer');

    /* ---------- E. 画笔：画完同样自动弹意见框 ---------- */
    Q.DRAW.tool = 'pen';
    dragNorm(0.10, 0.70, 0.70, 0.80, 8);
    T('E1 画笔生成了标注', Q.STATE.doc.marks.length, 2);
    var m1 = Q.STATE.doc.marks[1];
    T('E2 记录为画笔', m1.tool, 'pen');
    T('E3 采到了多个路径点', m1.pts.length > 3, true);
    T('E4 路径点也是归一化坐标',
      m1.pts.every(function (p) { return p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1; }), true);
    /* 曾经画笔/高亮被排除在「画完弹框」之外，用户必须切到「选择」再点一下
       才能写意见 —— 圈点勾画本来就是为了配意见，这一步纯属多余。 */
    T('E5 画笔划线也自动弹意见框',
      document.getElementById('imgComposer').classList.contains('hidden'), false);
    T('E6 意见框挂在刚画的那条线上', Q.DRAW.dur, m1.id);
    T('E7 还没写意见，所以不进清单', Q.imageNoteMarks().length, 1);

    /* E7~E9 回归：拖拽途中预览层就该有折线。
       曾经的 bug 是 DRAW.pts 里是 {x,y} 对象，而 ptsAttr 按数组取 p[0]/p[1]，
       算出来全是 NaN，预览线在松手前根本看不见（松手落库转成数组后才显示）。 */
    var svgE = document.getElementById('stageSvg');
    var rE = svgE.getBoundingClientRect();
    var atE = function (nx, ny) { return [rE.left + rE.width * nx, rE.top + rE.height * ny]; };
    var beforeE = Q.STATE.doc.marks.length;
    var e0 = atE(0.2, 0.2);
    press(svgE, 'pointerdown', e0[0], e0[1]);
    var e1 = atE(0.35, 0.30);
    press(svgE, 'pointermove', e1[0], e1[1]);
    var e2 = atE(0.5, 0.24);
    press(svgE, 'pointermove', e2[0], e2[1]);
    var pv = document.getElementById('svPreview');
    var pvLine = pv ? pv.querySelector('polyline') : null;
    T('E8 拖拽途中预览层已出现折线', !!pvLine, true);
    T('E9 预览折线坐标不含 NaN',
      pvLine ? String(pvLine.getAttribute('points')).indexOf('NaN') < 0 : false, true);
    press(svgE, 'pointerup', e2[0], e2[1]);
    Q.undoMark();
    T('E10 收尾撤销后标注数复原', Q.STATE.doc.marks.length, beforeE);

    /* ---------- F. 高亮框：框选一块区域铺半透明底，不是描边 ---------- */
    Q.DRAW.tool = 'highlight';
    Q.DRAW.width = 'mid';
    dragNorm(0.10, 0.86, 0.60, 0.90, 5);
    var m2 = Q.STATE.doc.marks[2];
    T('F1 记录为高亮', m2.tool, 'highlight');
    T('F2 高亮存方框对角（不是路径点）', !!(m2.geo && !m2.pts), true);
    var svg = document.getElementById('stageSvg');
    var hRect = null;
    Array.prototype.forEach.call(svg.querySelectorAll('rect'), function (r) {
      var fa = r.getAttribute('fill-opacity');
      if (fa != null && Number(fa) < 1) hRect = r;
    });
    T('F3 高亮渲染为半透明矩形', !!hRect, true);
    T('F4 高亮不再渲染成折线',
      Array.prototype.some.call(svg.querySelectorAll('polyline'), function (p) {
        return Number(p.getAttribute('opacity')) < 1;
      }), false);
    T('F5 高亮框画完也自动弹意见框',
      document.getElementById('imgComposer').classList.contains('hidden'), false);
    T('F6 意见框挂在刚画的高亮框上', Q.DRAW.dur, m2.id);

    /* ---------- G. 选择工具点选已有标注 → 打开意见框 ---------- */
    Q.DRAW.tool = 'select';
    var mkEl = svg.querySelector('[data-mk="' + m0.id + '"]');
    T('G1 能在图上找到该标注的图形', !!mkEl, true);
    var r = svg.getBoundingClientRect();
    press(mkEl, 'pointerdown', r.left + r.width * 0.4, r.top + r.height * 0.4);
    T('G2 点选后意见框打开', box.classList.contains('hidden'), false);
    T('G3 意见框回显已有意见',
      box.querySelector('textarea').value, '时间建议写成 24 小时制，前后统一');
    T('G4 点击卡片也能选中图形（侧栏联动）', (function () {
      Q.STATE.focusAnnId = null;
      document.querySelector('#annList .ann-card').click();
      return Q.STATE.focusAnnId === m0.id;
    })(), true);
    Q.hideImgComposer();

    /* ---------- H. 撤销 / 清空 ---------- */
    Q.undoMark();
    T('H1 撤销后只剩两条', Q.STATE.doc.marks.length, 2);
    Q.undoMark();
    Q.undoMark();
    T('H2 连续撤销到空', Q.STATE.doc.marks.length, 0);
    Q.undoMark();   /* 空的时候不该炸 */
    T('H3 空撤销不报错', Q.STATE.doc.marks.length, 0);

    /* ---------- I. 导出 canvas ---------- */
    var W = doc.image.w, H = doc.image.h;

    /* 重新造两条标注用于导出 */
    Q.DRAW.tool = 'rect';
    dragNorm(0.20, 0.15, 0.75, 0.35);
    var ex = Q.STATE.doc.marks[0];
    ex.body = '活动名称建议加书名号以外的统一写法';
    ex.suggestion = '【活动预告】智慧农业学院…';
    ex.type = 'format';
    ex.quote = Q.quoteOf(ex);
    Q.paintMarks();
    Q.renderSidebar();

    Q.buildDocCanvas(false).then(function (c) {
      T('I1 仅标注图尺寸等于原图', [c.width, c.height], [W, H]);
      return Q.buildDocCanvas(true).then(function (c2) {
        T('I2 带意见清单时高度增加', c2.height > H, true);
        T('I3 宽度保持不变', c2.width, W);
        var ctx = c2.getContext('2d');
        /* 意见区应该不是纯白——说明真的画了东西 */
        var area = ctx.getImageData(0, H + 4, W, Math.min(30, c2.height - H - 4)).data;
        var colored = 0;
        for (var i = 0; i < area.length; i += 4) {
          if (area[i] < 250 || area[i + 1] < 250 || area[i + 2] < 250) colored++;
        }
        T('I4 图下意见清单确实画上了', colored > 50, true);

        /* ---------- J. 导出菜单切换为图片版 ---------- */
        Q.renderExportMenu();
        var im = document.getElementById('exportMenu').innerHTML;
        T('J1 图片文档导出菜单含「标注 + 意见清单」', im.indexOf('data-act="imgdoc-list"') >= 0, true);
        T('J2 图片文档导出菜单含「仅标注图形」', im.indexOf('data-act="imgdoc-only"') >= 0, true);
        T('J3 图片文档导出菜单含打印 PDF', im.indexOf('data-act="imgdoc-pdf"') >= 0, true);
        T('J4 图片文档不再出现文字批注稿选项', im.indexOf('data-act="html-list"') < 0, true);
        T('J5 图片文档含「两侧索引线」', im.indexOf('data-act="imgdoc-side"') >= 0, true);
        T('J6 图片文档含「就近索引」', im.indexOf('data-act="imgdoc-near"') >= 0, true);

        /* ---------- K. 回到文字文档，确认没被图片逻辑污染 ---------- */
        var td = Q.normalizeDoc({
          id: 't_doc', title: '文字稿', raw: '本周五晚7点[微笑]学院见', annotations: []
        });
        Q.STATE.doc = td;
        Q.STATE.mode = 'annotate';
        Q.renderBodyUI();
        T('K1 文字文档仍能正常渲染正文片段',
          document.querySelectorAll('#bubble [data-s]').length, 3);
        T('K2 图片画布已隐藏',
          document.getElementById('imgStage').classList.contains('hidden'), true);
        Q.renderExportMenu();
        T('K3 导出菜单切回文字版',
          document.getElementById('exportMenu').innerHTML.indexOf('data-act="html-inline"') >= 0, true);

        finish();
      });
    }).catch(function (e) {
      fail++; out.push('EXCEPTION 导出阶段 ' + e.message); finish();
    });
  }
})();
`;

const shell = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const probe = [
  '<script>',
  'window.onerror=function(m,s,l,c,e){',
  '  var d=document.createElement("div");d.id="__ERR__";',
  '  d.textContent="ERR: "+m+" @"+l+":"+c;document.documentElement.appendChild(d);',
  '};',
  '<\/script>'
].join('\n');

let injected = shell.replace('<title>', probe + '\n<title>');
const closeIdx = injected.lastIndexOf('</body>');
injected = injected.slice(0, closeIdx) +
  '<script>window.addEventListener("load", function () {' + testCode + '});<\/script>\n' +
  injected.slice(closeIdx);

const tmpDir = path.join(root, 'src', '_tmp');
fs.mkdirSync(tmpDir, { recursive: true });
const tmpHtml = path.join(tmpDir, 'img-check.html');
fs.writeFileSync(tmpHtml, injected, 'utf8');

const userDataDir = path.join(os.tmpdir(), 'qpr-img-profile');
const url = 'file:///' + tmpHtml.replace(/\\/g, '/');

let stdout = '';
try {
  stdout = execFileSync(EDGE, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1680,1000',
    '--user-data-dir=' + userDataDir,
    '--virtual-time-budget=30000',
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
  console.error('  __QPR__ 是否挂上:  ' + /__QPR__/.test(stdout));
  console.error('  运行时错误: ' + ((/<div id="__ERR__">([\s\S]*?)<\/div>/.exec(stdout) || [])[1] || '无'));
  console.error('  DOM 片段：' + stdout.slice(0, 900));
  process.exit(3);
}

const body = m[1]
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&')
  .trim();

console.log(body);
const failed = /^FAILED/m.test(body.split('\n')[0]);
process.exit(failed ? 1 : 0);
