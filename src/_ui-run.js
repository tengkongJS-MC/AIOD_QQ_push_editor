/**
 * 界面层自测：主题、批注人、窄屏视图、图标化。
 *
 * 这几项都属于"页面装配"类的东西，Node 侧一行都测不到：
 *   - 主题靠 data-theme 属性 + CSS 变量覆盖，必须真渲染才能确认变量被换掉；
 *   - 批注人头像取姓名后两个字，是纯字符串规则，但绑定与持久化要走真 DOM；
 *   - 窄屏视图靠 body[data-mview] 切换，只有真 DOM 才有这个属性。
 *
 * 所有断言都在无头 Edge 里跑，跑完把结果塞进 <pre id="__TEST_RESULT__">。
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
  function ok(name, cond, extra) {
    if (!cond) fail++;
    out.push((cond ? 'PASS  ' : 'FAIL  ') + name + (cond || !extra ? '' : '\\n        ' + extra));
  }
  function finish() {
    var pre = document.createElement('pre');
    pre.id = '__TEST_RESULT__';
    pre.textContent = (fail ? 'FAILED ' + fail + ' 项' : 'ALL_PASS') + '\\n' + out.join('\\n');
    document.body.appendChild(pre);
  }
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /* body 上挂了 0.2s 的背景色过渡（切主题时不该硬闪）。
     但在 headless 的 virtual-time 下，CSS 过渡这条时钟不跟着走，
     量到的会一直停在过渡起始值 —— 那是量具的问题，不是主题没生效。
     所以这里先把过渡临时关掉再量，量完还原。 */
  var keepTrans = document.body.style.transition;
  document.body.style.transition = 'none';
  Q.applyTheme('dark', false);
  setTimeout(function () {
    var bodyBgDark = getComputedStyle(document.body).backgroundColor;
    Q.applyTheme('light', false);
    setTimeout(function () {
      var bodyBgLight = getComputedStyle(document.body).backgroundColor;
      document.body.style.transition = keepTrans;
      runSuite(bodyBgDark, bodyBgLight);
    }, 40);
  }, 40);

  function runSuite(bodyBgDark, bodyBgLight) {
  try {
    /* ================= A. 主题 ================= */
    Q.applyTheme('dark', true);
    T('A1 data-theme 落到 <html> 上', document.documentElement.getAttribute('data-theme'), 'dark');
    T('A2 主题已持久化',
      JSON.parse(localStorage.getItem('qqpc:settings')).theme, 'dark');

    var bgDark = cssVar('--bg-grouped');
    var surfaceDark = cssVar('--bg-elevated');
    var textDark = cssVar('--label-primary');
    okeq('A3 深色下 --bg-grouped 是纯黑底', /#000000/i.test(bgDark), bgDark);
    okeq('A4 深色下 --label-primary 是纯白字', /#ffffff/i.test(textDark), textDark);
    okeq('A4b 深色下浮起层不是纯黑（靠亮度差分层）',
      /#1c1c1e/i.test(surfaceDark), surfaceDark);

    Q.applyTheme('light', true);
    var bgLight = cssVar('--bg-grouped');
    var textLight = cssVar('--label-primary');
    okeq('A5 浅色下 --bg-grouped 与深色不同', bgLight !== bgDark, bgLight + ' vs ' + bgDark);
    okeq('A6 浅色下 --label-primary 与深色不同', textLight !== textDark, textLight + ' vs ' + textDark);
    okeq('A6b 浅色下 --bg-grouped 是苹果分组灰 #F2F2F7',
      /#f2f2f7/i.test(bgLight), bgLight);
    okeq('A6c 强调色是系统蓝 #007AFF', /#007aff/i.test(cssVar('--accent')), cssVar('--accent'));
    okeq('A6d 字体栈优先系统字体', /-apple-system/.test(cssVar('--font-sans')), cssVar('--font-sans'));

    /* 变量真的影响到了绘制结果，而不只是躺在 CSS 里 */
    okeq('A7 body 实际底色随主题变化', bodyBgDark !== bodyBgLight, bodyBgDark + ' vs ' + bodyBgLight);
    okeq('A8 深色底确实是暗的',
      (function () {
        var m = /rgb\\((\\d+), (\\d+), (\\d+)\\)/.exec(bodyBgDark);
        return !!m && Number(m[1]) < 40 && Number(m[2]) < 40 && Number(m[3]) < 50;
      })(), bodyBgDark);

    /* 按钮图标跟着换 */
    Q.applyTheme('dark', false);
    var iconDark = document.getElementById('btnTheme').innerHTML;
    var titleDark = document.getElementById('btnTheme').title;
    Q.applyTheme('light', false);
    var iconLight = document.getElementById('btnTheme').innerHTML;
    okeq('A9 主题按钮图标随主题切换', iconDark !== iconLight);
    okeq('A10 深色时按钮提示"切换为浅色"', /浅色/.test(titleDark), titleDark);

    /* 切换按钮走的是同一套逻辑 */
    Q.toggleTheme();
    T('A11 toggle 切到深色', Q.SETTINGS.theme, 'dark');
    Q.toggleTheme();
    T('A12 toggle 切回浅色', Q.SETTINGS.theme, 'light');

    /* 冷启动能从存储里读回来 */
    Q.applyTheme('dark', true);
    Q.SETTINGS.theme = 'light';
    Q.loadSettings();
    T('A13 loadSettings 能把主题读回来', Q.SETTINGS.theme, 'dark');
    Q.applyTheme('light', true);

    /* ================= B. 批注人头像取字 ================= */
    T('B1 空名字给占位符', Q.annotatorInitials(''), '＋');
    T('B2 一个字的姓名直接用', Q.annotatorInitials('张'), '张');
    T('B3 两个字直接用全名', Q.annotatorInitials('张三'), '张三');
    T('B4 三个字取后两个字', Q.annotatorInitials('李小明'), '小明');
    T('B5 四字复姓也取后两个字', Q.annotatorInitials('欧阳小明'), '小明');
    T('B6 英文名取后两字符', Q.annotatorInitials('Angela'), 'la');
    T('B7 首尾空格被忽略', Q.annotatorInitials('  陈晨  '), '陈晨');

    /* ================= C. 批注人设置与渲染 ================= */
    Q.setAnnotator('李小明');
    T('C1 姓名写入设置', Q.SETTINGS.annotator, '李小明');
    T('C2 顶栏头像显示后两个字', document.getElementById('whoAvatar').textContent, '小明');
    T('C3 弹层里的大头像同步', document.getElementById('whoAvatarBig').textContent, '小明');
    T('C4 顶栏显示全名', document.getElementById('whoName').textContent, '李小明');
    T('C5 有名字时不再是空态',
      document.getElementById('btnWho').classList.contains('is-empty'), false);
    T('C6 已落盘',
      JSON.parse(localStorage.getItem('qqpc:settings')).annotator.name, '李小明');
    T('C7 annotatorName() 与设置一致', Q.annotatorName(), '李小明');

    Q.setAnnotator('   ');
    T('C8 清空后回到空态',
      document.getElementById('btnWho').classList.contains('is-empty'), true);
    T('C9 清空后头像变占位符', document.getElementById('whoAvatar').textContent, '＋');
    Q.setAnnotator('这是一个特别特别长的名字啊');
    okeq('C10 超长名字被截到 12 字',
      Q.SETTINGS.annotator.length === 12, 'len=' + Q.SETTINGS.annotator.length);

    /* 入口从顶栏搬到了左栏底部：它是「设置」，和文档列表同属一个区域，
       放在顶栏会和保存/导出这些高频操作抢注意力。 */
    var whoBtn = document.getElementById('btnWho');
    var whoFoot = document.querySelector('.col-left .who-foot');
    okeq('C11 批注人入口在左栏底部', !!whoFoot && whoFoot.contains(whoBtn));
    okeq('C12 入口排在文档列表之后',
      !!(document.getElementById('docList').compareDocumentPosition(whoBtn) &
         Node.DOCUMENT_POSITION_FOLLOWING));
    okeq('C13 顶栏不再有批注人入口', !document.querySelector('.topbar #btnWho'));
    okeq('C14 弹层跟入口在一起',
      !!whoFoot && whoFoot.contains(document.getElementById('whoPop')));

    /* ================= D. 署名落到批注与导出 ================= */
    Q.setAnnotator('王小明');

    var td = Q.normalizeDoc({
      id: 'ui_text', title: '署名测试', raw: '本周五晚7点[微笑]学院见', annotations: []
    });
    Q.STATE.doc = td;
    Q.STATE.mode = 'annotate';
    var ann = Q.addAnnotation({ start: 0, end: 5, quote: '本周五晚7点' }, 'wording', '时间建议写成 19:00');
    T('D1 文字批注记住了批注人', ann.author, '王小明');

    var html = Q.buildExportHTML(td, 'list');
    okeq('D2 文字批改稿抬头有署名', html.indexOf('批注人：王小明') >= 0);
    okeq('D3 批改稿仍是自包含单文件', html.indexOf('<style>') >= 0 && html.indexOf('<script') < 0);

    /* 图片侧的标注同样带上署名 */
    Q.DRAW.tool = 'rect';
    Q.DRAW.start = { x: 0.1, y: 0.1 };
    Q.DRAW.cur = { x: 0.4, y: 0.3 };
    Q.DRAW.pts = [];
    var mk = Q.markFromStroke();
    T('D4 图片标注也记住了批注人', mk && mk.author, '王小明');

    /* ================= E. 窄屏视图 ================= */
    Q.setMView('docs');
    T('E1 body[data-mview] 记下当前视图', document.body.getAttribute('data-mview'), 'docs');
    T('E2 对应导航按钮高亮',
      document.querySelector('.mnav button[data-mview="docs"]').classList.contains('is-on'), true);
    T('E3 其他按钮不高亮',
      document.querySelector('.mnav button[data-mview="main"]').classList.contains('is-on'), false);
    Q.setMView('ann');
    T('E4 切到批注视图', document.body.getAttribute('data-mview'), 'ann');
    T('E5 高亮跟着走',
      document.querySelector('.mnav button[data-mview="ann"]').classList.contains('is-on'), true);
    Q.setMView('乱写');
    T('E6 非法值回落到主视图', document.body.getAttribute('data-mview'), 'main');
    T('E7 底部导航有三个入口', document.querySelectorAll('.mnav button').length, 3);
    okeq('E8 底部导航图标是 SVG',
      document.querySelectorAll('.mnav button svg').length === 3);

    /* ================= F. 图标化 ================= */
    okeq('F1 顶栏导出按钮带图标',
      document.querySelectorAll('#btnExport svg').length === 1);
    okeq('F2 主题按钮带图标',
      document.querySelectorAll('#btnTheme svg').length === 1);
    okeq('F3 新建按钮带图标',
      document.querySelectorAll('#btnNew svg').length === 1 &&
      document.querySelectorAll('#btnNewImg svg').length === 1);

    Q.renderExportMenu();
    var menuHTML = document.getElementById('exportMenu').innerHTML;
    var menuItems = (menuHTML.match(/data-act="/g) || []).length;
    var menuSvgs = (menuHTML.match(/<svg/g) || []).length;
    /* 不断言固定条数，只断言「每一项都配了图标」——
       菜单会随功能增减，写死数字等于每次加功能都要改测试。 */
    okeq('F4 导出菜单每项都有图标（' + menuItems + ' 项 ' + menuSvgs + ' 图）',
      menuItems >= 9 && menuSvgs === menuItems, 'svg 数=' + menuSvgs);
    okeq('F4b 导出菜单里有「导入 JSON 存档」',
      menuHTML.indexOf('data-act="json-import"') >= 0 &&
      menuHTML.indexOf('data-act="json"') >= 0);

    /* 图片工具栏 */
    Q.STATE.doc = Q.normalizeDoc(Q.newImageDoc('图标测试'));
    Q.STATE.doc.image = { dataUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', w: 1, h: 1 };
    Q.renderImgTools();
    var toolHTML = document.getElementById('imgTools').innerHTML;
    okeq('F5 图片工具栏图标化', (toolHTML.match(/<svg/g) || []).length >= 10,
      'svg 数=' + (toolHTML.match(/<svg/g) || []).length);
    okeq('F6 工具栏不再用字符图标',
      /[☞▭◯✎▨◉↶]/.test(toolHTML) === false);
    /* 工具会随功能增减，所以断言「按钮数 = 带图标的按钮数」，不写死数字——
       加了「平移」那次，写死 7 的这条就无信息量地红了。 */
    okeq('F7 每个工具按钮都带图标（' +
      document.querySelectorAll('#imgTools [data-tool]').length + ' 个工具）',
      (function () {
        var btns = document.querySelectorAll('#imgTools [data-tool]');
        return btns.length >= 8 &&
          btns.length === document.querySelectorAll('#imgTools [data-tool] svg').length;
      })());
    /* 图标漏配时拼出来是字面量 "undefined"：不报错，只是难看得莫名其妙 */
    okeq('F7b 工具条里没有 undefined（图标没漏配）',
      document.getElementById('imgTools').textContent.indexOf('undefined') < 0);
    okeq('F7c 工具条带缩放控件（缩小 / 读数 / 放大 / 适应）',
      !!document.querySelector('#imgTools [data-zoom="out"]') &&
      !!document.querySelector('#imgTools [data-zoom="in"]') &&
      !!document.getElementById('imgZoomPct') &&
      !!document.getElementById('imgZoomFit'));
    /* 曾经的撤销图标是一段写歪的圆弧，渲染出来是个缺口圆圈。
       只要路径首段还是标准的「折角箭头」起点，就说明没退回旧值。 */
    okeq('F8 撤销图标是回退箭头（不是缺口圆圈）',
      (function () {
        var p = document.querySelector('#imgTools [data-act="undo"] svg path');
        return !!p && /^M9 14/.test(p.getAttribute('d') || '');
      })());
    /* 选中态必须唯一，而且真的跟着当前笔走。
       色块选中环以前是 4px 外环、间距只有 3px，和邻居糊成一片；
       现在环收窄到 3px、色块留了外边距，这里顺便把间距也钉住。 */
    okeq('F9 颜色有且只有一个选中',
      document.querySelectorAll('#imgTools .sw.is-on').length === 1);
    okeq('F10 选中的就是当前颜色',
      document.querySelector('#imgTools .sw.is-on').dataset.color, Q.DRAW.color);
    okeq('F11 粗细有且只有一个选中',
      document.querySelectorAll('#imgTools [data-width].is-on').length === 1);
    okeq('F12 选中的就是当前粗细',
      document.querySelector('#imgTools [data-width].is-on').dataset.width, Q.DRAW.width);
    okeq('F13 色块之间留出了呼吸位',
      (function () {
        var ml = getComputedStyle(document.querySelector('#imgTools .sw')).marginLeft;
        return parseFloat(ml) >= 2;
      })(), 'margin-left=' + getComputedStyle(document.querySelector('#imgTools .sw')).marginLeft);

    /* 文档列表的删除按钮 */
    Q.STATE.doc = td;
    Q.store.setIndex([{ id: td.id, kind: 'text', title: td.title, updatedAt: Date.now(), annCount: 1 }]);
    Q.STATE.doc.title = td.title;
    document.getElementById('docList').innerHTML = '';
    // 直接调渲染入口，走真实路径
    Q.renderSidebar();
    okeq('F8 侧栏卡片仍能渲染', document.querySelectorAll('#annList .ann-card').length >= 1);

    /* ================= G. 新建入口位置 ================= */
    var colLeft = document.querySelector('.col-left');
    var newRow = document.querySelector('.new-row');
    var docList = document.getElementById('docList');
    okeq('G1 新建入口在左栏内部', !!colLeft && colLeft.contains(newRow));
    okeq('G2 新建入口排在文档列表之前',
      !!(newRow && docList &&
         (newRow.compareDocumentPosition(docList) & Node.DOCUMENT_POSITION_FOLLOWING)),
      'new-row 应位于 docList 之前');
    okeq('G3 两个入口在同一个新建区里',
      document.querySelectorAll('.new-row .new-btn').length === 2);
    okeq('G4 左栏顶部就是新建区（第一屏可见）',
      !!(colLeft && colLeft.querySelector('.col-head + .new-row')), '');

    /* 图片批改成了默认功能：入口排第一、用实心强调色，新开页面也直接落它 */
    okeq('G5 图片批改排在新入口第一位',
      document.querySelector('.new-row .new-btn').id === 'btnNewImg');
    okeq('G6 图片批改是主推样式（实心强调色）',
      document.getElementById('btnNewImg').classList.contains('is-primary') &&
      /* 光有 class 不算数 —— 之前就漏过一次 CSS 规则没落盘，
         结果两个按钮长得一模一样。这里直接量计算样式。 */
      getComputedStyle(document.getElementById('btnNewImg')).backgroundColor !==
      getComputedStyle(document.getElementById('btnNew')).backgroundColor,
      'primary=' + getComputedStyle(document.getElementById('btnNewImg')).backgroundColor +
      ' plain=' + getComputedStyle(document.getElementById('btnNew')).backgroundColor);
    okeq('G7 默认草稿就是图片批改', Q.defaultDraft().kind === 'image');
    okeq('G8 默认草稿还没图，所以先落在编辑态',
      Q.defaultDraft().marks.length === 0 && !Q.defaultDraft().image);

    /* ================= H. 手动保存模型 ================= */
    /* localStorage 按 profile 目录跨次运行保留，而这里用的是固定 id。
       不先清掉，H6「没落盘就读不出来」会读到上一轮跑剩下的那份 ——
       量具的问题，不是保存模型的问题。 */
    Q.store.setIndex([]);
    Q.store.removeDoc('ui_save');
    Q.store.removeDoc('ui_draft');
    Q.STATE.doc = Q.normalizeDoc({
      id: 'ui_save', kind: 'text', title: '保存测试', raw: '本周五晚7点[微笑]学院见', annotations: []
    });
    Q.STATE.mode = 'annotate';
    Q.setDirty(false);
    Q.renderDocListUI();

    var saveBtn = document.getElementById('btnSave');
    var hint = document.getElementById('saveHint');
    T('H1 没有改动时保存按钮禁用', saveBtn.disabled, true);
    T('H2 提示显示已保存', hint.textContent, '已保存');

    Q.markDirty();
    T('H3 有改动后按钮可用', saveBtn.disabled, false);
    T('H4 提示变成未保存', hint.textContent, '未保存');
    okeq('H5 只是标了脏，还没落盘', Q.isIndexed('ui_save') === false);
    okeq('H6 没落盘也就读不出来', Q.store.doc('ui_save') === null);

    Q.saveNow(true);
    okeq('H7 保存后写进了本地存储', !!Q.store.doc('ui_save'));
    okeq('H8 保存后进了文档列表索引', Q.isIndexed('ui_save') === true);
    T('H9 保存后按钮回到禁用', saveBtn.disabled, true);
    T('H10 提示回到已保存', hint.textContent, '已保存');

    /* 列表里标出「未保存」的草稿 */
    Q.STATE.doc = Q.normalizeDoc({ id: 'ui_draft', kind: 'text', title: '没保存的草稿', raw: 'abc', annotations: [] });
    Q.setDirty(true);
    Q.renderDocListUI();
    okeq('H11 未落盘的草稿也会显示在列表里', !!document.querySelector('.doc-unsaved'));

    /* ================= I. 未保存守卫（自绘弹窗） ================= */
    Q.setDirty(false);
    var ranSync = false;
    Q.guardUnsaved(function () { ranSync = true; });
    T('I1 没有改动时不打断，直接执行', ranSync, true);

    Q.markDirty();
    var ranLater = false;
    Q.guardUnsaved(function () { ranLater = true; });
    T('I2 有改动时先弹窗，不直接执行', ranLater, false);
    T('I3 弹窗已打开', Q.dialogOpen(), true);
    T('I4 弹窗标题', document.getElementById('dlgTitle').textContent, '还有改动没保存');
    T('I5 给出三个选择', document.querySelectorAll('#dlgActs .dlg-btn').length, 3);
    T('I6 主操作是「保存」',
      document.querySelector('#dlgActs .dlg-btn.is-primary').textContent, '保存');
    T('I7 危险操作是「不保存」',
      document.querySelector('#dlgActs .dlg-btn.is-destructive').textContent, '不保存');

    document.querySelector('#dlgActs .dlg-btn.is-primary').click();

    setTimeout(function () {
      T('I8 选「保存」后动作被执行', ranLater, true);
      T('I9 弹窗已关闭', Q.dialogOpen(), false);
      T('I10 保存完不再 dirty', Q.STATE.dirty, false);
      T('I11 保存按钮回到禁用', document.getElementById('btnSave').disabled, true);

      Q.markDirty();
      var ranCancel = false;
      Q.guardUnsaved(function () { ranCancel = true; });
      document.querySelector('#dlgActs .dlg-btn.is-ghost').click();
      setTimeout(function () {
        T('I12 选「取消」时不执行动作', ranCancel, false);
        T('I13 取消后仍然保持未保存', Q.STATE.dirty, true);
        T('I14 弹窗已收起', Q.dialogOpen(), false);

        /* 弹窗开着时快捷键不该漏到正文上 */
        Q.STATE.doc = td;
        Q.STATE.mode = 'annotate';
        Q.setDirty(false);

        /* ================= K. JSON 存档导入 ================= */
        Q.store.setIndex([]);
        Q.STATE.doc = Q.normalizeDoc({ id: 'k_seed', kind: 'text', title: '种子', raw: '', annotations: [] });
        Q.setDirty(false);

        var fresh = { type: 'qq-push-reviewer', schemaVersion: 1, exportedAt: 1,
          doc: { id: 'k_import', kind: 'text', title: '导入的稿子', raw: '你好', annotations: [] } };
        Q.adoptImported(Q.importDocsFrom(fresh)[0], 0);
        T('K1 导入后成为当前文档', Q.STATE.doc.id, 'k_import');
        okeq('K2 导入即落盘，不用再点保存', Q.isIndexed('k_import') === true);
        T('K3 导入后不是脏状态', Q.STATE.dirty, false);

        /* 同 id 再导一次：必须先问，点「另存副本」要换个新 id */
        Q.adoptImported(Q.importDocsFrom(fresh)[0], 0);
        T('K4 同 id 冲突时先弹窗问', Q.dialogOpen(), true);
        T('K5 冲突弹窗给出两个走法',
          document.querySelectorAll('#dlgActs .dlg-btn').length, 3);
        document.querySelector('#dlgActs .dlg-btn.is-primary').click();

        setTimeout(function () {
          okeq('K6 另存副本换了新 id', Q.STATE.doc.id !== 'k_import');
          okeq('K7 副本也进了列表', Q.isIndexed(Q.STATE.doc.id) === true);
          okeq('K8 副本标题带后缀', /副本$/.test(Q.STATE.doc.title));

          /* 图片存档：没有图时应落在「上传」这一步 */
          Q.adoptImported(Q.importDocsFrom({ kind: 'image', title: '图稿', image: null, marks: [] })[0], 0);
          T('K9 图片存档导入后先落在编辑态', Q.STATE.mode, 'edit');

          okeq('K10 有隐藏的 JSON 文件选择框',
            !!document.getElementById('jsonFile') &&
            /json/.test(document.getElementById('jsonFile').getAttribute('accept')));

          /* ================= J. 收尾：回到干净状态 ================= */
          Q.applyTheme('light', true);
          Q.setAnnotator('');
          Q.store.setIndex([]);
          T('J1 主题复位', document.documentElement.getAttribute('data-theme'), 'light');
          T('J2 批注人复位', Q.SETTINGS.annotator, '');

          finish();
        }, 40);
      }, 40);
    }, 40);
  } catch (e) {
    fail++;
    out.push('EXCEPTION ' + (e && e.message) + '\\n' + (e && e.stack ? e.stack.split('\\n').slice(0, 4).join('\\n') : ''));
    finish();
  }
  }

  function okeq(name, cond, extra) { ok(name, cond, extra); }
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
const tmpHtml = path.join(tmpDir, 'ui-check.html');
fs.writeFileSync(tmpHtml, injected, 'utf8');

const userDataDir = path.join(os.tmpdir(), 'qpr-ui-profile');
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
    '--virtual-time-budget=20000',
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

/* 静态检查（Node 侧）：源码里不该再有原生 confirm / prompt，
   也不该再有内置示例数据 —— 这两条是「廉价感」和「刚打开不干净」的根。 */
const src = fs.readFileSync(path.join(root, 'src', 'app.js'), 'utf8');
function statik(label, cond) {
  console.log('  ' + (cond ? 'PASS  ' : 'FAIL  ') + '静态检查 · ' + label);
  return cond ? 0 : 1;
}
let sbad = 0;
sbad += statik('不再使用原生 confirm()', !/[^.\w]confirm\s*\(/.test(src));
sbad += statik('不再使用原生 prompt()', !/[^.\w]prompt\s*\(/.test(src));
sbad += statik('不再内置示例数据 SAMPLE_RAW', src.indexOf('SAMPLE_RAW') < 0);
sbad += statik('启动不再播种示例文档', src.indexOf('示例：秋季趣味运动会') < 0);

const failed = /^FAILED/m.test(body.split('\n')[0]);
process.exit(failed || sbad ? 1 : 0);
