/* ============================================================
 * app.js —— 错题本主应用
 * 路由 / 视图 / 导入流水线 / 文库管理 / 设置 / 帮助
 * ============================================================ */
(function () {
  'use strict';

  /* ================= 工具 ================= */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function debounce(fn, ms = 250) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }
  function fmtDateTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function isThisWeek(ts) {
    const now = new Date();
    const day = (now.getDay() + 6) % 7; // 周一为一周开始
    const monday = new Date(now); monday.setHours(0, 0, 0, 0); monday.setDate(now.getDate() - day);
    return ts >= monday.getTime();
  }
  function todayStr() {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  /* ================= 常量与状态 ================= */
  const SUBJECTS = ['语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理', '计算机', '其他'];
  const STATUS = {
    new: { label: '待学习', cls: 'new' },
    reviewing: { label: '复习中', cls: 'reviewing' },
    mastered: { label: '已掌握', cls: 'mastered' },
  };
  const ROUTE_META = {
    library: { title: '错题文库', sub: '温故而知新，每一道错题都是提分的台阶' },
    import: { title: '导入错题', sub: '拍照 / 选图 → AI 识图整理 → 核对归档' },
    settings: { title: 'API 设置', sub: '配置大模型接口，开启 AI 辅助能力' },
    help: { title: '帮助中心', sub: '使用指引、常见问题与数据安全说明' },
  };

  const state = {
    route: 'library',
    list: [],
    filters: { keyword: '', subject: '全部', difficulty: 0, status: 'all', tag: '', from: '', to: '', sort: 'new' },
    tagsAll: new Set(),
    viewURLs: [],          // 列表视图临时 ObjectURL，重绘前回收
    modalURLs: [],         // 弹窗内临时 ObjectURL，关弹窗时回收
  };

  /* ================= Toast / 确认框 / 灯箱 ================= */
  function toast(msg, type = 'info', timeout = 2600) {
    const wrap = $('#toastWrap');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = `<span>${esc(msg)}</span>`;
    wrap.appendChild(t);
    setTimeout(() => {
      t.classList.add('leaving');
      setTimeout(() => t.remove(), 260);
    }, timeout);
  }

  function confirmDialog({ title = '确认操作', message = '', confirmText = '确认', danger = false }) {
    return new Promise((resolve) => {
      openModal({
        size: 'narrow',
        title,
        bodyHTML: `<p style="font-size:14px;color:var(--ink-2);line-height:1.8">${esc(message)}</p>`,
        onBackdrop: () => resolve(false),
        footer: [
          { text: '取消', onClick: () => { closeModal(); resolve(false); } },
          { text: confirmText, primary: true, danger, onClick: () => { closeModal(); resolve(true); } },
        ],
      });
    });
  }

  function openModal({ title = '', bodyHTML = '', size = '', footer = [], onMounted, onBackdrop }) {
    const root = $('#modalRoot');
    root.innerHTML = '';
    root.hidden = false;
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.addEventListener('click', () => { closeModal(); onBackdrop && onBackdrop(); });

    const modal = document.createElement('div');
    modal.className = `modal ${size}`;
    modal.innerHTML = `
      <div class="modal-head">
        <h2>${esc(title)}</h2>
        <button class="icon-btn" style="margin-left:auto" data-close aria-label="关闭">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="modal-body">${bodyHTML}</div>
      ${footer.length ? `<div class="modal-foot"></div>` : ''}`;
    root.appendChild(backdrop);
    root.appendChild(modal);

    const foot = $('.modal-foot', modal);
    footer.forEach((f) => {
      const b = document.createElement('button');
      b.className = `btn ${f.primary ? 'btn-primary' : ''} ${f.danger ? 'btn-danger' : ''}`;
      b.innerHTML = `${f.spinner ? '<span class="spinner"></span>' : ''}${esc(f.text)}`;
      b.disabled = !!f.disabled;
      b.addEventListener('click', () => f.onClick && f.onClick(b));
      foot.appendChild(b);
    });

    const closeHandler = (e) => {
      if (e.target.closest('[data-close]')) closeModal();
    };
    modal.addEventListener('click', closeHandler);
    if (onMounted) onMounted(modal);
    return modal;
  }
  function closeModal() {
    const root = $('#modalRoot');
    root.innerHTML = '';
    root.hidden = true;
    state.modalURLs.forEach((u) => { try { URL.revokeObjectURL(u); } catch {} });
    state.modalURLs = [];
  }
  // Esc 关闭弹窗：优先触发遮罩点击，确保 confirmDialog/恢复等 Promise 被正常 resolve，
  // 避免直接 closeModal 清空 DOM 后悬挂的 Promise。
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#modalRoot').hidden) {
      const backdrop = $('#modalRoot').querySelector('.modal-backdrop');
      if (backdrop) backdrop.click();
      else closeModal();
    }
  });

  function openLightbox(url) {
    const lb = $('#lightbox');
    lb.hidden = false;
    $('img', lb).src = url;
  }
  $('#lightbox').addEventListener('click', () => { $('#lightbox').hidden = true; });

  function trackURL(url) { state.viewURLs.push(url); return url; }
  function trackModalURL(url) { state.modalURLs.push(url); return url; }
  function revokeViewURLs() {
    state.viewURLs.forEach((u) => { try { URL.revokeObjectURL(u); } catch {} });
    state.viewURLs = [];
  }
  function revokeModalURLs() {
    state.modalURLs.forEach((u) => { try { URL.revokeObjectURL(u); } catch {} });
    state.modalURLs = [];
  }

  /* ================= 轻量 Markdown ================= */
  function md(src) {
    if (!src) return '';
    let s = esc(src);
    const store = [];
    const keep = (html) => { store.push(html); return `\u0000${store.length - 1}\u0000`; };

    s = s.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_, code) =>
      keep('<pre><code>' + code.replace(/\u0000/g, '') + '</code></pre>'));
    s = s.replace(/`([^`\n]+)`/g, (_, c) => keep('<code>' + c + '</code>'));

    const lines = s.split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
      let line = lines[i];
      if (!line.trim()) { i++; continue; }

      if (/^#{1,6}\s*/.test(line)) {
        out.push('<h3>' + line.replace(/^#{1,6}\s*/, '') + '</h3>');
        i++; continue;
      }
      if (/^>\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
        out.push('<blockquote>' + inline(buf.join('<br>')) + '</blockquote>');
        continue;
      }
      if (/^\s*[-*+]\s+/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { buf.push('<li>' + inline(lines[i].replace(/^\s*[-*+]\s+/, '')) + '</li>'); i++; }
        out.push('<ul>' + buf.join('') + '</ul>');
        continue;
      }
      if (/^\s*\d+[.、)]\s+/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*\d+[.、)]\s+/.test(lines[i])) { buf.push('<li>' + inline(lines[i].replace(/^\s*\d+[.、)]\s+/, '')) + '</li>'); i++; }
        out.push('<ol>' + buf.join('') + '</ol>');
        continue;
      }
      const buf = [];
      while (i < lines.length && lines[i].trim() &&
        !/^#{1,6}\s/.test(lines[i]) && !/^>\s?/.test(lines[i]) &&
        !/^\s*[-*+]\s+/.test(lines[i]) && !/^\s*\d+[.、)]\s+/.test(lines[i])) {
        buf.push(lines[i]); i++;
      }
      out.push('<p>' + inline(buf.join('<br>')) + '</p>');
    }

    function inline(t) {
      return t
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    }
    let html = out.join('\n');
    html = html.replace(/\u0000(\d+)\u0000/g, (_, n) => store[+n] || '');
    return html;
  }

  function stars(n) {
    n = Math.max(1, Math.min(5, Number(n) || 3));
    return `<span class="stars" aria-label="难度${n}星">${'★'.repeat(n)}<span class="off">${'★'.repeat(5 - n)}</span></span>`;
  }
  function statusBadge(st) {
    const s = STATUS[st] || STATUS.new;
    return `<span class="badge-status ${s.cls}">${s.label}</span>`;
  }

  /* ================= 标签输入 / 难度星级 / 表单 ================= */
  function bindTagInput(container, arr) {
    function draw() {
      container.querySelectorAll('.chip').forEach((n) => n.remove());
      arr.forEach((t, idx) => {
        const c = document.createElement('span');
        c.className = 'chip';
        c.innerHTML = `${esc(t)}<i class="x" title="移除">✕</i>`;
        c.querySelector('.x').addEventListener('click', () => {
          arr.splice(idx, 1); draw();
        });
        container.insertBefore(c, container.querySelector('input'));
      });
    }
    const input = container.querySelector('input');
    container.addEventListener('click', () => input.focus());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
        e.preventDefault();
        const v = input.value.trim().replace(/^[，,]+|[，,]+$/g, '');
        if (v && !arr.includes(v)) { arr.push(v); input.value = ''; draw(); }
      } else if (e.key === 'Backspace' && !input.value && arr.length) {
        arr.pop(); draw();
      }
    });
    input.addEventListener('blur', () => {
      const v = input.value.trim();
      if (v && !arr.includes(v)) { arr.push(v); input.value = ''; draw(); }
    });
    draw();
  }

  function tagInputHTML(placeholder) {
    return `<div class="tag-input"><input type="text" placeholder="${esc(placeholder)}"></div>`;
  }

  function bindStarPicker(container, get, set) {
    function draw() {
      container.innerHTML = [1, 2, 3, 4, 5].map((n) =>
        `<span data-n="${n}" style="cursor:pointer;font-size:20px;color:${n <= get() ? 'var(--gold)' : 'var(--line-strong)'};padding:2px">★</span>`
      ).join('');
    }
    container.addEventListener('click', (e) => {
      const sp = e.target.closest('[data-n]');
      if (!sp) return;
      set(Number(sp.dataset.n)); draw();
    });
    draw();
  }

  /** 通用错题表单 HTML（import 与编辑共用） */
  function mistakeFormHTML() {
    return `
      <div class="row">
        <div class="field" style="min-width:130px">
          <label class="field-label">学科</label>
          <select class="select" data-f="subject">
            ${SUBJECTS.map((s) => `<option value="${s}">${s}</option>`).join('')}
          </select>
        </div>
        <div class="field" style="min-width:170px">
          <label class="field-label">难度等级</label>
          <div data-f="stars" style="line-height:1;padding-top:6px"></div>
        </div>
        <div class="field" style="min-width:120px">
          <label class="field-label">学习状态</label>
          <select class="select" data-f="status">
            <option value="new">待学习</option>
            <option value="reviewing">复习中</option>
            <option value="mastered">已掌握</option>
          </select>
        </div>
      </div>
      <div class="field">
        <label class="field-label">来源</label>
        <input class="input" data-f="source" placeholder="如：2024 高考全国卷 · 第 12 题 / 第三次月考">
      </div>
      <div class="field">
        <label class="field-label">题目正文<span class="req">*</span></label>
        <textarea class="textarea" data-f="question" rows="4" placeholder="识别结果会自动填入，也可以直接手动录入或修改"></textarea>
      </div>
      <div class="field">
        <label class="field-label">参考答案</label>
        <textarea class="textarea" data-f="answer" rows="3" placeholder="图片中有答案会自动识别；没有可点击「AI 生成答案解析」"></textarea>
      </div>
      <div class="field">
        <label class="field-label">解析</label>
        <textarea class="textarea" data-f="analysis" rows="4" placeholder="解题过程、思路分析……"></textarea>
      </div>
      <div class="field">
        <label class="field-label">知识点</label>
        ${tagInputHTML('输入知识点后回车，如：二次函数')}
      </div>
      <div class="field">
        <label class="field-label">自定义标签</label>
        <div data-f="tags-wrap"></div>
        <div class="field-hint">回车添加，例如：易错题、粗心、期末重点</div>
      </div>
      <div class="field" style="margin-bottom:0">
        <label class="field-label">备注</label>
        <textarea class="textarea" data-f="note" rows="2" placeholder="自己的反思、老师的提醒（可选）"></textarea>
      </div>`;
  }

  /** 把表单绑定到一个 record 对象，kp/tags 用数组 */
  function bindMistakeForm(container, record) {
    const f = (name) => container.querySelector(`[data-f="${name}"]`);
    f('subject').value = record.subject || '数学';
    f('status').value = record.status || 'new';
    f('source').value = record.source || '';
    f('question').value = record.question || '';
    f('answer').value = record.answer || '';
    f('analysis').value = record.analysis || '';
    f('note').value = record.note || '';

    bindStarPicker(f('stars'), () => record.difficulty || 3, (n) => { record.difficulty = n; });
    record.difficulty = record.difficulty || 3;

    // 知识点：第一个 tag-input（mistakeFormHTML 中位于知识点字段）
    const kpContainer = container.querySelectorAll('.tag-input')[0];
    bindTagInput(kpContainer, record.knowledgePoints);
    // 标签：第二个
    const tagsContainer = document.createElement('div');
    tagsContainer.className = 'tag-input';
    tagsContainer.innerHTML = '<input type="text" placeholder="输入标签后回车">';
    f('tags-wrap').appendChild(tagsContainer);
    bindTagInput(tagsContainer, record.tags);

    f('subject').addEventListener('change', (e) => { record.subject = e.target.value; });
    f('status').addEventListener('change', (e) => { record.status = e.target.value; });
    ['source', 'question', 'answer', 'analysis', 'note'].forEach((k) => {
      f(k).addEventListener('input', (e) => { record[k] = e.target.value; });
    });
  }

  /* ================= 路由 ================= */
  function setRoute(name) {
    state.route = name;
    $$('.nav-item').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
    const meta = ROUTE_META[name];
    $('#viewTitle').textContent = meta.title;
    $('#viewSubtitle').textContent = meta.sub;
    closeMobileNav();
    revokeViewURLs();
    const renderers = { library: renderLibrary, import: renderImport, settings: renderSettings, help: renderHelp };
    renderers[name]();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', () => {
    const name = (location.hash || '#/library').replace('#/', '') || 'library';
    setRoute(ROUTE_META[name] ? name : 'library');
  });

  /* ================= 错题文库 ================= */
  async function loadList() {
    state.list = await CTB_DB.all();
    state.tagsAll = new Set(state.list.flatMap((m) => m.tags || []));
  }

  async function renderLibrary() {
    const content = $('#content');
    content.innerHTML = '<div class="view"><div class="empty"><div class="spinner" style="width:28px;height:28px;color:var(--cinnabar)"></div><p style="margin-top:14px">正在打开错题库…</p></div></div>';
    await loadList();

    const counts = {
      total: state.list.length,
      new: state.list.filter((m) => m.status === 'new').length,
      reviewing: state.list.filter((m) => m.status === 'reviewing').length,
      week: state.list.filter((m) => isThisWeek(m.createdAt)).length,
    };

    const usedSubjects = SUBJECTS.filter((s) => state.list.some((m) => m.subject === s));
    const chipSubjects = ['全部', ...usedSubjects];
    const tagOptions = [...state.tagsAll].sort();

    content.innerHTML = `
    <div class="view">
      <div class="stats-row">
        <div class="card stat-card c1"><div class="ico">📚</div><div class="num">${counts.total}</div><div class="lbl">错题总数</div></div>
        <div class="card stat-card c2"><div class="ico">🔖</div><div class="num">${counts.new + counts.reviewing}</div><div class="lbl">待巩固（待学+复习）</div></div>
        <div class="card stat-card c3"><div class="ico">🌿</div><div class="num">${state.list.filter((m) => m.status === 'mastered').length}</div><div class="lbl">已掌握</div></div>
        <div class="card stat-card c4"><div class="ico">✒️</div><div class="num">${counts.week}</div><div class="lbl">本周新增</div></div>
      </div>

      <div class="subject-chips" id="subjectChips">
        ${chipSubjects.map((s) => `<button data-s="${esc(s)}" class="${state.filters.subject === s ? 'on' : ''}">${esc(s)}</button>`).join('')}
      </div>

      <div class="filter-bar">
        <div class="search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input class="input" id="fKeyword" placeholder="搜索题目 / 答案 / 解析关键词" value="${esc(state.filters.keyword)}">
        </div>
        <select class="select" id="fDifficulty">
          <option value="0">全部难度</option>
          ${[5, 4, 3, 2, 1].map((n) => `<option value="${n}" ${state.filters.difficulty === n ? 'selected' : ''}>${'★'.repeat(n)}</option>`).join('')}
        </select>
        <select class="select" id="fStatus">
          <option value="all">全部状态</option>
          <option value="new" ${state.filters.status === 'new' ? 'selected' : ''}>待学习</option>
          <option value="reviewing" ${state.filters.status === 'reviewing' ? 'selected' : ''}>复习中</option>
          <option value="mastered" ${state.filters.status === 'mastered' ? 'selected' : ''}>已掌握</option>
        </select>
        <select class="select" id="fTag">
          <option value="">全部标签</option>
          ${tagOptions.map((t) => `<option value="${esc(t)}" ${state.filters.tag === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
        </select>
        <input class="input" type="date" id="fFrom" value="${state.filters.from}" title="开始日期">
        <span style="color:var(--ink-3);font-size:12px">至</span>
        <input class="input" type="date" id="fTo" value="${state.filters.to}" title="结束日期">
        <select class="select" id="fSort">
          <option value="new" ${state.filters.sort === 'new' ? 'selected' : ''}>最新收录</option>
          <option value="old" ${state.filters.sort === 'old' ? 'selected' : ''}>最早收录</option>
          <option value="hard" ${state.filters.sort === 'hard' ? 'selected' : ''}>难度从高到低</option>
        </select>
      </div>

      <div class="result-count" id="resultCount"></div>
      <div class="mistake-grid" id="grid"></div>
    </div>`;

    // 顶栏操作
    setTopActions([
      { html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg> 手动录入', onClick: () => { location.hash = '#/import'; } },
      { html: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> 导出', primary: true, onClick: () => showExportMenu() },
    ]);

    $('#subjectChips').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      state.filters.subject = b.dataset.s;
      renderLibrary();
    });
    $('#fKeyword').addEventListener('input', debounce((e) => { state.filters.keyword = e.target.value; drawGrid(); }, 200));
    $('#fDifficulty').addEventListener('change', (e) => { state.filters.difficulty = Number(e.target.value); drawGrid(); });
    $('#fStatus').addEventListener('change', (e) => { state.filters.status = e.target.value; drawGrid(); });
    $('#fTag').addEventListener('change', (e) => { state.filters.tag = e.target.value; drawGrid(); });
    $('#fFrom').addEventListener('change', (e) => { state.filters.from = e.target.value; drawGrid(); });
    $('#fTo').addEventListener('change', (e) => { state.filters.to = e.target.value; drawGrid(); });
    $('#fSort').addEventListener('change', (e) => { state.filters.sort = e.target.value; drawGrid(); });

    drawGrid();
  }

  function applyFilters(list) {
    const f = state.filters;
    const kw = f.keyword.trim().toLowerCase();
    let out = list.filter((m) => {
      if (f.subject !== '全部' && m.subject !== f.subject) return false;
      if (f.difficulty && m.difficulty !== f.difficulty) return false;
      if (f.status !== 'all' && m.status !== f.status) return false;
      if (f.tag && !(m.tags || []).includes(f.tag)) return false;
      if (f.from && m.createdAt < new Date(f.from + 'T00:00:00').getTime()) return false;
      if (f.to && m.createdAt > new Date(f.to + 'T23:59:59').getTime()) return false;
      if (kw) {
        const hay = [m.question, m.answer, m.analysis, m.source, m.note,
          (m.knowledgePoints || []).join(' '), (m.tags || []).join(' ')]
          .join('\n').toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
    if (f.sort === 'old') out = out.slice().sort((a, b) => a.createdAt - b.createdAt);
    else if (f.sort === 'hard') out = out.slice().sort((a, b) => b.difficulty - a.difficulty || b.createdAt - a.createdAt);
    return out;
  }

  function drawGrid() {
    const grid = $('#grid');
    if (!grid) return;
    revokeViewURLs(); // 旧卡片即将被替换，先回收其图片 URL
    const items = applyFilters(state.list);
    $('#resultCount').textContent = `共找到 ${items.length} 道错题${state.filters.keyword || state.filters.subject !== '全部' ? '（已应用筛选）' : ''}`;

    if (!items.length) {
      const empty = state.list.length === 0;
      grid.innerHTML = `
        <div class="empty" style="grid-column:1/-1">
          <div class="empty-art">${empty ? '📕' : '🔍'}</div>
          <h3>${empty ? '错题本还是空的' : '没有符合条件的错题'}</h3>
          <p>${empty ? '拍下你的第一张试卷或作业错题，让 AI 帮你识别题目、补全解析。' : '试试调整学科、标签或日期等筛选条件。'}</p>
          ${empty
            ? '<a class="btn btn-primary btn-lg" href="#/import">导入第一张错题</a>'
            : '<button class="btn" id="clearFilters">清除全部筛选</button>'}
        </div>`;
      const cf = $('#clearFilters');
      if (cf) cf.addEventListener('click', () => {
        state.filters = { keyword: '', subject: '全部', difficulty: 0, status: 'all', tag: '', from: '', to: '', sort: 'new' };
        renderLibrary();
      });
      return;
    }

    grid.innerHTML = items.map(cardHTML).join('');
    $$('.mistake-card', grid).forEach((card) => {
      card.addEventListener('click', () => openDetail(card.dataset.id));
    });
  }

  function cardHTML(m) {
    const thumb = m.images && m.images[0] && m.images[0].blob
      ? `<img src="${trackURL(URL.createObjectURL(m.images[0].blob))}" alt="错题图片" loading="lazy">`
      : `<div class="mc-noimg">题</div>`;
    const kpTags = [
      ...(m.knowledgePoints || []).slice(0, 2).map((t) => `<span class="chip chip-kp">${esc(t)}</span>`),
      ...(m.tags || []).slice(0, 2).map((t) => `<span class="chip chip-tag">${esc(t)}</span>`),
    ].join('');
    return `
    <article class="card mistake-card" data-id="${m.id}">
      <div class="mc-thumb">
        <span class="mc-status">${statusBadge(m.status)}</span>
        ${thumb}
        ${m.images && m.images.length > 1 ? `<span class="mc-imgcount">共 ${m.images.length} 图</span>` : ''}
      </div>
      <div class="mc-body">
        <div class="mc-meta">
          <span class="chip chip-subject">${esc(m.subject)}</span>
          ${stars(m.difficulty)}
        </div>
        <div class="mc-q">${esc(m.question || '（图片错题，未填写文字）')}</div>
        <div class="mc-foot">
          <div class="mc-tags">${kpTags}</div>
          <div class="mc-date">${CTB_Export.fmtDate(m.createdAt)}</div>
        </div>
      </div>
    </article>`;
  }

  function setTopActions(actions) {
    const box = $('#topbarActions');
    box.innerHTML = '';
    (actions || []).forEach((a) => {
      const b = document.createElement('button');
      b.className = `btn ${a.primary ? 'btn-primary' : ''} ${a.sm ? 'btn-sm' : ''}`;
      b.innerHTML = a.html;
      b.disabled = !!a.disabled;
      b.addEventListener('click', a.onClick);
      box.appendChild(b);
    });
  }

  /* ---------- 导出菜单 ---------- */
  function showExportMenu() {
    const items = applyFilters(state.list);
    if (!items.length) { toast('当前没有可导出的错题', 'error'); return; }
    const scopeAll = state.list.length !== items.length;
    openModal({
      size: 'narrow',
      title: '导出错题',
      bodyHTML: `
        <p style="font-size:13.5px;color:var(--ink-2);margin-bottom:14px">
          ${scopeAll ? `当前筛选命中 <b>${items.length}</b> 道（文库共 ${state.list.length} 道）。导出将使用筛选后的结果。` : `文库中共有 <b>${items.length}</b> 道错题。`}
        </p>
        <div style="display:flex;flex-direction:column;gap:9px">
          <button class="btn" data-ex="excel" style="justify-content:flex-start;padding:12px 15px">📊 导出为 Excel（.xlsx）<span style="margin-left:auto;color:var(--ink-3);font-size:12px">表格整理</span></button>
          <button class="btn" data-ex="pdf" style="justify-content:flex-start;padding:12px 15px">📄 导出为 PDF<span style="margin-left:auto;color:var(--ink-3);font-size:12px">打印 → 另存为 PDF</span></button>
          <button class="btn" data-ex="backup" style="justify-content:flex-start;padding:12px 15px">💾 导出备份（.json，含原图）<span style="margin-left:auto;color:var(--ink-3);font-size:12px">可恢复</span></button>
        </div>`,
      onMounted: (modal) => {
        modal.querySelector('[data-ex="excel"]').addEventListener('click', async () => {
          try { await CTB_Export.exportExcel(items); toast('Excel 已开始下载', 'success'); closeModal(); }
          catch (e) { toast(e.message, 'error'); }
        });
        modal.querySelector('[data-ex="pdf"]').addEventListener('click', async () => {
          try { await CTB_Export.printPDF(items); closeModal(); }
          catch (e) { toast(e.message, 'error'); }
        });
        modal.querySelector('[data-ex="backup"]').addEventListener('click', async () => {
          try { await CTB_Export.exportBackup(items); toast('备份文件已开始下载', 'success'); closeModal(); }
          catch (e) { toast(e.message, 'error'); }
        });
      },
    });
  }

  /* ================= 错题详情 / 编辑 ================= */
  async function openDetail(id) {
    const m = await CTB_DB.get(id);
    if (!m) return;
    const next = { new: 'reviewing', reviewing: 'mastered', mastered: 'new' };
    renderDetail();

    function renderDetail() {
      const imageURLs = (m.images || []).map((im) => trackModalURL(URL.createObjectURL(im.blob)));
      openModal({
        title: '错题详情',
        size: 'wide',
        bodyHTML: `
        <div class="detail-grid">
          <div class="detail-gallery">
            <div class="dg-main" id="dgMain">
              ${imageURLs[0] ? `<img id="dgImg" src="${imageURLs[0]}" alt="错题图片">` : '<span style="color:var(--ink-3);font-size:13px">本题无图片</span>'}
            </div>
            ${imageURLs.length > 1 ? `<div class="dg-thumbs">
              ${imageURLs.map((u, i) => `<img src="${u}" data-i="${i}" class="${i === 0 ? 'on' : ''}" alt="缩略图">`).join('')}
            </div>` : ''}
            <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn btn-sm" id="btnCycle">↻ 标记为「${STATUS[next[m.status]].label}」</button>
            </div>
          </div>
          <div class="detail-info">
            <div class="detail-meta-row">
              ${statusBadge(m.status)}
              <span class="chip chip-subject">${esc(m.subject)}</span>
              ${stars(m.difficulty)}
              <span style="font-size:12px;color:var(--ink-3);margin-left:auto">${fmtDateTime(m.createdAt)}</span>
            </div>
            ${m.source ? `<div class="detail-meta-row"><span class="chip">📎 ${esc(m.source)}</span></div>` : ''}
            ${(m.knowledgePoints || []).length ? `<div class="detail-meta-row">${m.knowledgePoints.map((t) => `<span class="chip chip-kp">${esc(t)}</span>`).join('')}</div>` : ''}
            ${(m.tags || []).length ? `<div class="detail-meta-row">${m.tags.map((t) => `<span class="chip chip-tag">#${esc(t)}</span>`).join('')}</div>` : ''}

            <div class="detail-section">
              <h4>📝 题目</h4>
              ${m.question ? `<div class="md q">${md(m.question)}</div>` : '<div class="detail-empty">无题目文字，请查看图片</div>'}
            </div>
            <div class="detail-section">
              <h4>✅ 参考答案 ${m.aiModel ? '<span class="tagline">（由 ' + esc(m.aiModel) + ' 生成，请核对）</span>' : ''}</h4>
              ${m.answer ? `<div class="md a">${md(m.answer)}</div>` : '<div class="detail-empty">暂无答案，可在编辑中点 AI 生成</div>'}
            </div>
            <div class="detail-section">
              <h4>💡 解析</h4>
              ${m.analysis ? `<div class="md x">${md(m.analysis)}</div>` : '<div class="detail-empty">暂无解析</div>'}
            </div>
            ${m.note ? `<div class="detail-section"><h4>🗒 我的备注</h4><div class="md">${md(m.note)}</div></div>` : ''}
          </div>
        </div>`,
        footer: [
          { text: '导出本题 PDF', onClick: async () => { try { await CTB_Export.printPDF([m]); } catch (e) { toast(e.message, 'error'); } } },
          {
            text: '删除', danger: true, onClick: async () => {
              if (await confirmDialog({ title: '删除这道错题？', message: '删除后无法恢复（建议先导出备份）。', confirmText: '确认删除', danger: true })) {
                await CTB_DB.delete(m.id); closeModal(); toast('已删除', 'success');
                if (state.route === 'library') renderLibrary();
              }
            },
          },
          { text: '编辑', primary: true, onClick: () => openEditor() },
        ],
        onMounted: (rootEl) => {
          const dgImg = $('#dgImg', rootEl);
          $('#dgMain', rootEl).addEventListener('click', () => { if (dgImg) openLightbox(dgImg.src); });
          $$('.dg-thumbs img', rootEl).forEach((t) => t.addEventListener('click', () => {
            dgImg.src = t.src;
            $$('.dg-thumbs img', rootEl).forEach((x) => x.classList.remove('on'));
            t.classList.add('on');
          }));
          $('#btnCycle', rootEl).addEventListener('click', async () => {
            m.status = next[m.status];
            await CTB_DB.put({ id: m.id, status: m.status });
            toast(`已标记为「${STATUS[m.status].label}」`, 'success');
            closeModal();
            openDetail(m.id);
            if (state.route === 'library') loadList().then(drawGrid);
          });
        },
      });
    }

    function openEditor() {
      // 浅拷贝记录 + 独立数组，取消时不影响原数据
      const editRec = {
        ...m,
        knowledgePoints: [...(m.knowledgePoints || [])],
        tags: [...(m.tags || [])],
        images: [...(m.images || [])],
      };
      renderEdit();

      function renderEdit() {
        openModal({
          title: '编辑错题',
          size: 'wide',
          bodyHTML: `
            <div class="field">
              <label class="field-label">错题图片</label>
              <div class="img-strip" data-f="imgstrip" style="padding-bottom:2px"></div>
              <button class="btn btn-sm" id="addImgBtn">＋ 添加图片（可裁剪旋转）</button>
              <input type="file" id="addImgInput" accept="image/*" multiple hidden>
            </div>
            <div data-f="form">${mistakeFormHTML()}</div>`,
          footer: [
            { text: '取消', onClick: () => { closeModal(); openDetail(editRec.id); } },
            {
              text: '保存修改', primary: true, onClick: async (b) => {
                if (!editRec.question.trim() && !editRec.images.length) { toast('请填写题目正文或至少保留一张图片', 'error'); return; }
                b.disabled = true;
                b.innerHTML = '<span class="spinner"></span>保存中…';
                Object.assign(m, editRec);
                await CTB_DB.put(editRec);
                closeModal(); toast('修改已保存', 'success');
                openDetail(editRec.id);
                if (state.route === 'library') renderLibrary();
              },
            },
          ],
          onMounted: (rootEl) => {
            const stripEl = $('[data-f="imgstrip"]', rootEl);
            function drawStrip() {
              revokeModalURLs();
              stripEl.innerHTML = editRec.images.map((im, i) => `
                <div class="thumb-card" style="width:96px">
                  <div class="tb" style="width:96px;height:76px">
                    <img src="${trackModalURL(URL.createObjectURL(im.blob))}" alt="">
                    <button class="del" data-i="${i}" title="删除">✕</button>
                  </div>
                </div>`).join('');
              $$('.del', stripEl).forEach((d) => d.addEventListener('click', (e) => {
                e.stopPropagation();
                editRec.images.splice(Number(d.dataset.i), 1);
                drawStrip();
              }));
            }
            drawStrip();

            $('#addImgBtn', rootEl).addEventListener('click', () => $('#addImgInput', rootEl).click());
            $('#addImgInput', rootEl).addEventListener('change', async (e) => {
              const files = Array.from(e.target.files || []);
              e.target.value = '';
              // 编辑器会直接替换弹窗节点；逐张编辑，全部结束后整体重绘编辑弹窗
              for (const file of files) {
                const edited = await CTB_Editor.open({ blob: file, name: file.name });
                if (edited) editRec.images.push({ id: CTB_DB.uid(), blob: edited, name: (file.name || 'image').replace(/\.[^.]+$/, '') + '.jpg' });
              }
              if (files.length) renderEdit();
            });

            bindMistakeForm($('[data-f="form"]', rootEl), editRec);
          },
        });
      }
    }
  }

  /* ================= 导入错题 ================= */
  const imp = {
    items: [],         // {id,name,blob,url}
    activeId: null,
    form: blankForm(),
    busy: null,
    aiController: null,
  };

  function blankForm() {
    return {
      subject: '数学', difficulty: 3, status: 'new', source: '',
      question: '', answer: '', analysis: '', note: '',
      knowledgePoints: [], tags: [], aiModel: '',
    };
  }

  function activeItem() { return imp.items.find((i) => i.id === imp.activeId) || null; }

  function renderImport() {
    const content = $('#content');
    content.innerHTML = `
    <div class="view import-layout">
      <!-- 左：图片导入与预览 -->
      <div>
        <div class="card card-pad" style="margin-bottom:16px">
          <div class="section-title">① 导入错题图片 <small>支持 JPG / PNG / WEBP，可多选，也可直接粘贴截图</small></div>
          <div class="dropzone" id="dropzone">
            <div class="dz-ico">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            </div>
            <h3>点击选择，或把图片拖到这里</h3>
            <p>一道题可添加多张图片（题目页 + 答案页），将发送给你配置的 AI 接口识别</p>
          </div>
          <input type="file" id="fileInput" accept="image/png,image/jpeg,image/webp,image/bmp,image/gif" multiple hidden>
          <div class="img-strip" id="imgStrip" style="margin-top:14px"></div>
        </div>

        <div class="card import-preview">
          <div class="ip-bar">
            <button class="btn btn-sm" id="btnEditImg" disabled>✂ 裁剪 / 旋转</button>
            <button class="btn btn-sm btn-danger" id="btnRemoveImg" disabled>移除该图</button>
          </div>
          <div class="ip-stage" id="previewStage">
            <div class="ip-empty">添加图片后在此预览<br>点击上方按钮可裁剪和旋转</div>
          </div>
        </div>
      </div>

      <!-- 右：识别与表单 -->
      <div>
        <div class="card card-pad" style="margin-bottom:16px">
          <div class="section-title">② AI 识别整理</div>
          <div class="pipeline-actions">
            <button class="btn btn-primary" id="btnAiExtract">🪄 AI 识别并整理</button>
            <button class="btn btn-soft" id="btnAiGen">✍️ AI 生成答案解析</button>
          </div>
          <div class="progress" id="pipeProgress" style="margin-top:12px;display:none"><i></i></div>
          <div class="status-line" id="pipeStatus"></div>
          <div class="ai-stream" id="aiStream" hidden></div>
        </div>

        <div class="card card-pad">
          <div class="section-title">③ 核对并归档 <small>识别内容均可手动修改</small></div>
          <div data-f="form">${mistakeFormHTML()}</div>
          <div class="pipeline-actions" style="margin-bottom:0">
            <button class="btn btn-primary btn-lg" id="btnSave">💾 保存到错题库</button>
            <button class="btn btn-lg" id="btnReset">清空，导入下一题</button>
          </div>
        </div>
      </div>
    </div>`;

    setTopActions([]);

    const dz = $('#dropzone');
    const fileInput = $('#fileInput');
    dz.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => { addFiles(e.target.files); fileInput.value = ''; });
    ['dragover', 'dragenter'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
    dz.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));

    $('#imgStrip').addEventListener('click', (e) => {
      const del = e.target.closest('.del');
      const card = e.target.closest('.thumb-card');
      if (del) { removeItem(del.dataset.id); e.stopPropagation(); return; }
      if (card) { imp.activeId = card.dataset.id; drawImportImages(); }
    });
    $('#btnEditImg').addEventListener('click', editActiveImage);
    $('#btnRemoveImg').addEventListener('click', () => { const a = activeItem(); if (a) removeItem(a.id); });
    $('#btnAiExtract').addEventListener('click', runAIExtract);
    $('#btnAiGen').addEventListener('click', runAIGenerate);
    $('#btnSave').addEventListener('click', saveImport);
    $('#btnReset').addEventListener('click', resetImport);

    bindMistakeForm($('[data-f="form"]'), imp.form);
    drawImportImages();
    updatePipelineButtons();
  }

  function addFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    files.forEach((f) => {
      const item = {
        id: CTB_DB.uid(),
        name: f.name || 'pasted-image.jpg',
        blob: f,
        url: URL.createObjectURL(f),
      };
      imp.items.push(item);
      if (!imp.activeId) imp.activeId = item.id;
    });
    drawImportImages();
    updatePipelineButtons();
    toast(`已添加 ${files.length} 张图片`, 'success', 1600);
  }

  function removeItem(id) {
    const idx = imp.items.findIndex((i) => i.id === id);
    if (idx === -1) return;
    try { URL.revokeObjectURL(imp.items[idx].url); } catch {}
    imp.items.splice(idx, 1);
    if (imp.activeId === id) imp.activeId = imp.items[0]?.id || null;
    drawImportImages();
    updatePipelineButtons();
  }

  function drawImportImages() {
    const strip = $('#imgStrip');
    if (!strip) return;
    strip.innerHTML = imp.items.map((it) => `
      <div class="thumb-card ${it.id === imp.activeId ? 'active' : ''}" data-id="${it.id}">
        <div class="tb">
          <img src="${it.url}" alt="">
          <button class="del" data-id="${it.id}" title="移除">✕</button>
        </div>
        <div class="name">${esc(it.name)}</div>
      </div>`).join('');

    const stage = $('#previewStage');
    const a = activeItem();
    if (a) {
      stage.innerHTML = `<img src="${a.url}" alt="预览">`;
    } else {
      stage.innerHTML = '<div class="ip-empty">添加图片后在此预览<br>点击上方按钮可裁剪和旋转</div>';
    }
    $('#btnEditImg').disabled = !a;
    $('#btnRemoveImg').disabled = !a;
  }

  async function editActiveImage() {
    const a = activeItem();
    if (!a) return;
    const blob = await CTB_Editor.open({ blob: a.blob, name: a.name });
    if (!blob) return;
    a.blob = blob;
    try { URL.revokeObjectURL(a.url); } catch {}
    a.url = URL.createObjectURL(blob);
    drawImportImages();
  }

  function setPipe({ statusHTML = '', progress = null, indeterminate = false }) {
    const bar = $('#pipeProgress');
    const line = $('#pipeStatus');
    if (progress == null) { bar.style.display = 'none'; }
    else {
      bar.style.display = 'block';
      bar.classList.toggle('indeterminate', indeterminate);
      $('i', bar).style.width = Math.round(progress * 100) + '%';
    }
    if (line) line.innerHTML = statusHTML;
  }

  function updatePipelineButtons() {
    const hasImg = imp.items.length > 0;
    const configured = CTB_AI.isConfigured();
    const extractBtn = $('#btnAiExtract');
    const genBtn = $('#btnAiGen');
    if (extractBtn) {
      const running = imp.busy === 'ai-extract';
      const busy = !!imp.busy && !running;
      extractBtn.disabled = !hasImg || !configured || busy;
      extractBtn.innerHTML = running
        ? '⏹ 停止识别'
        : (configured ? '🪄 AI 识别并整理' : '🪄 AI 识别并整理（请先配置 API）');
      extractBtn.title = configured ? '' : '请先在「API 设置」中配置接口';
    }
    if (genBtn) {
      const baseDisabled = !configured || !imp.form.question.trim();
      // 正在生成时按钮变为「停止生成」，始终可点
      genBtn.disabled = imp.busy === 'ai-gen' ? false : (baseDisabled || !!imp.busy);
      genBtn.innerHTML = imp.busy === 'ai-gen' ? '⏹ 停止生成' : '✍️ AI 生成答案解析';
      genBtn.title = configured ? '' : '请先在「API 设置」中配置接口';
    }
  }

  /* ---------- AI 图片直传识别整理 ---------- */
  async function runAIExtract() {
    // 正在识别 → 停止
    if (imp.busy === 'ai-extract') { imp.aiController && imp.aiController.abort(); return; }
    if (!imp.items.length) { toast('请先添加错题图片', 'error'); return; }
    if (!CTB_AI.isConfigured()) { toast('请先到「API 设置」配置接口', 'error'); return; }
    imp.busy = 'ai-extract';
    updatePipelineButtons();
    const box = $('#aiStream');
    box.hidden = false;
    box.innerHTML = '<span class="spinner"></span> 正在上传图片并调用 AI 识别…';
    setPipe({ statusHTML: '<span class="spinner"></span> AI 正在读图、提取题目并整理分类…', indeterminate: true, progress: 0.05 });

    const ctrl = new AbortController();
    imp.aiController = ctrl;
    try {
      const images = imp.items.map((it) => it.blob);
      const json = await CTB_AI.extractFromImages(
        images,
        {
          subject: imp.form.subject,
          onDelta: (delta, full) => {
            box.innerHTML = esc(full).replace(/\n/g, '<br>') + '<span class="cursor"></span>';
            box.scrollTop = box.scrollHeight;
            setPipe({ statusHTML: `🪄 正在识别… 已输出 <b>${full.length}</b> 字` });
          },
          signal: ctrl.signal,
        }
      );
      if (!json || !json.question) {
        throw new Error('模型未返回有效的题目内容，可重试或手动录入');
      }
      imp.form.question = String(json.question || '').trim();
      imp.form.answer = String(json.answer || '').trim();
      imp.form.analysis = String(json.analysis || '').trim();
      if (json.subject && SUBJECTS.includes(json.subject)) imp.form.subject = json.subject;
      if (Array.isArray(json.knowledgePoints)) imp.form.knowledgePoints = json.knowledgePoints.map(String).slice(0, 6);
      if (json.difficulty) imp.form.difficulty = Math.max(1, Math.min(5, Number(json.difficulty) || 3));
      rerenderImportForm();
      box.hidden = true;
      const hasAnswer = !!imp.form.answer;
      setPipe({ statusHTML: `✅ 识别完成，已填好题目${hasAnswer ? '、答案' : ''}${imp.form.analysis ? '、解析' : ''}与分类，请核对修改。`, progress: 1 });
      toast('AI 识别完成', 'success');
      if (!hasAnswer) {
        setTimeout(() => toast('图片中未识别到答案，可点击「AI 生成答案解析」补全', 'info', 4000), 400);
      }
    } catch (err) {
      const aborted = /abort|取消|超时/i.test(err.message);
      box.hidden = true;
      setPipe({ statusHTML: `<span style="color:${aborted ? 'var(--gold)' : 'var(--cinnabar)'}">${aborted ? '已停止识别' : '识别失败：' + esc(err.message)}</span>` });
      if (!aborted) toast(err.message, 'error', 3600);
    } finally {
      imp.busy = null;
      imp.aiController = null;
      updatePipelineButtons();
    }
  }

  /* ---------- AI 生成答案解析（流式） ---------- */
  async function runAIGenerate() {
    // 正在生成 → 停止
    if (imp.busy === 'ai-gen') { imp.aiController && imp.aiController.abort(); return; }
    if (!imp.form.question.trim()) { toast('请先识别或填写题目正文', 'error'); return; }

    imp.busy = 'ai-gen';
    updatePipelineButtons();
    const box = $('#aiStream');
    box.hidden = false;
    box.innerHTML = '<span class="spinner"></span> 正在调用大模型生成…';
    setPipe({ statusHTML: '<span class="spinner"></span> AI 正在作答并书写解析，可随时停止', progress: 0.02, indeterminate: true });

    const ctrl = new AbortController();
    imp.aiController = ctrl;
    let acc = '';
    try {
      const result = await CTB_AI.generateAnswer(
        { question: imp.form.question, subject: imp.form.subject, knowledgePoints: imp.form.knowledgePoints },
        (delta, full) => {
          acc = full;
          box.innerHTML = esc(full).replace(/\n/g, '<br>') + '<span class="cursor"></span>';
          box.scrollTop = box.scrollHeight;
          setPipe({ statusHTML: `✍️ 正在生成… 已输出 <b>${full.length}</b> 字` });
        },
        ctrl.signal
      );
      if (result.answer) imp.form.answer = result.answer;
      if (result.analysis) imp.form.analysis = result.analysis;
      imp.form.aiModel = CTB_AI.getSettings().model;
      rerenderImportForm();
      box.hidden = true;
      setPipe({ statusHTML: '✅ 答案与解析已生成并填入表单（AI 内容请务必核对）。', progress: 1 });
      toast('答案解析生成完成', 'success');
    } catch (err) {
      const aborted = /abort|取消|超时/i.test(err.message);
      // 中断时保留已生成内容
      if (aborted && acc) {
        const partial = CTB_AI.splitAnswerAnalysis(acc);
        if (partial.answer) imp.form.answer = partial.answer;
        if (partial.analysis) imp.form.analysis = partial.analysis;
        rerenderImportForm();
      }
      box.hidden = true;
      setPipe({ statusHTML: `<span style="color:${aborted ? 'var(--gold)' : 'var(--cinnabar)'}">${aborted ? '已停止生成' : '生成失败：' + esc(err.message)}</span>${acc && aborted ? '（已保留部分内容）' : ''}` });
    } finally {
      imp.busy = null;
      imp.aiController = null;
      updatePipelineButtons();
    }
  }

  /** 重新渲染导入页表单（AI 填充后同步星级/标签/下拉） */
  function rerenderImportForm() {
    const holder = $('[data-f="form"]');
    holder.innerHTML = mistakeFormHTML();
    bindMistakeForm(holder, imp.form);
    updatePipelineButtons();
  }

  /* ---------- 保存 / 清空 ---------- */
  async function saveImport() {
    const f = imp.form;
    if (!f.question.trim() && !imp.items.length) {
      toast('请先添加图片，或手动填写题目正文', 'error');
      return;
    }
    const btn = $('#btnSave');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> 保存中…';
    try {
      await CTB_DB.put({
        ...f,
        images: imp.items.map((it) => ({ id: it.id, blob: it.blob, name: it.name })),
      });
      toast('错题已收入文库 🎉', 'success');
      resetImport(true);
      // 成功面板
      const content = $('#content');
      content.innerHTML = `
        <div class="view">
          <div class="empty" style="padding-top:90px">
            <div class="empty-art" style="background:var(--sage-soft);border-color:transparent">✅</div>
            <h3>已成功保存到错题文库</h3>
            <p>坚持整理错题是提分最快的路径之一。继续导入下一道，还是去文库看看？</p>
            <div style="display:flex;gap:10px;justify-content:center">
              <a class="btn btn-primary btn-lg" href="#/library">前往错题文库</a>
              <button class="btn btn-lg" id="againBtn">继续导入下一题</button>
            </div>
          </div>
        </div>`;
      $('#againBtn').addEventListener('click', renderImport);
    } catch (err) {
      toast('保存失败：' + err.message, 'error', 3600);
      btn.disabled = false;
      btn.innerHTML = '💾 保存到错题库';
    }
  }

  function resetImport(silent) {
    imp.items.forEach((it) => { try { URL.revokeObjectURL(it.url); } catch {} });
    imp.items = [];
    imp.activeId = null;
    imp.form = blankForm();
    imp.busy = null;
    if (!silent && state.route === 'import') renderImport();
  }

  /* ================= API 设置 ================= */
  function renderSettings() {
    const s = CTB_AI.getSettings();
    const content = $('#content');
    content.innerHTML = `
    <div class="view settings-grid">

      <div class="card card-pad">
        <div class="section-title">模型服务商 <small>选择后自动填充接口地址，可再手动修改</small></div>
        <div class="preset-grid" id="presetGrid">
          ${Object.entries(CTB_AI.PRESETS).map(([key, p]) => `
            <button class="preset-card ${s.preset === key ? 'on' : ''}" data-preset="${key}">
              <strong>${esc(p.name)}</strong>
              <span>${esc(p.baseURL || '自定义接口地址')}</span>
            </button>`).join('')}
        </div>
      </div>

      <div class="card card-pad">
        <div class="section-title">接口参数</div>
        <div class="field">
          <label class="field-label">接口地址 Base URL<span class="req">*</span></label>
          <input class="input" id="setBaseURL" value="${esc(s.baseURL)}" placeholder="https://api.example.com/v1">
          <div class="field-hint">需兼容 OpenAI 的 <code>/chat/completions</code> 协议；自建中转同样适用。</div>
        </div>
        <div class="field">
          <label class="field-label">API 密钥<span class="req">*</span></label>
          <div style="display:flex;gap:8px">
            <input class="input" id="setKey" type="password" value="${esc(s.apiKey)}" placeholder="sk-..." style="flex:1">
            <button class="btn" id="toggleKey" type="button">显示</button>
          </div>
          <div class="field-hint">密钥仅保存在本机浏览器 localStorage 中，只会发往你填写的接口地址。</div>
        </div>
        <div class="field">
          <label class="field-label">模型名称<span class="req">*</span></label>
          <input class="input" id="setModel" list="modelList" value="${esc(s.model)}" placeholder="如 deepseek-chat / glm-4-flash">
          <datalist id="modelList"></datalist>
        </div>
        <div class="row">
          <div class="field">
            <label class="field-label">随机性 Temperature：<span id="tempVal">${s.temperature}</span></label>
            <div class="range-wrap">
              <input type="range" id="setTemp" min="0" max="1.5" step="0.05" value="${s.temperature}">
            </div>
            <div class="field-hint">越低越稳定严谨，越高越发散有创意。错题解析建议 0.3~0.5。</div>
          </div>
          <div class="field" style="max-width:200px">
            <label class="field-label">最大输出 Tokens</label>
            <input class="input" id="setMaxTokens" type="number" min="256" max="32000" step="256" value="${s.maxTokens}">
          </div>
          <div class="field" style="max-width:170px">
            <label class="field-label">超时（秒）</label>
            <input class="input" id="setTimeout" type="number" min="10" max="600" step="10" value="${s.timeout}">
          </div>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn btn-primary" id="btnSaveApi">💾 保存设置</button>
          <button class="btn" id="btnTest"><span id="testLabel">🔌 测试连接</span></button>
          <span id="cfgState"></span>
        </div>
        <div class="test-result" id="testResult"></div>
      </div>

      <div class="card card-pad">
        <div class="section-title">数据管理 <small>错题文字与图片均保存在本机；仅在点击「AI 识别并整理」或「AI 生成答案解析」时，图片/题目会发送给你配置的接口</small></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn" id="btnBackup">💾 备份全部（JSON）</button>
          <button class="btn" id="btnRestore">📥 恢复备份</button>
          <button class="btn" id="btnExcelAll">📊 导出全部 Excel</button>
          <button class="btn" id="btnPdfAll">📄 导出全部 PDF</button>
          <input type="file" id="restoreInput" accept="application/json,.json" hidden>
        </div>
        <div class="field-hint" style="margin-top:10px">备份文件包含错题文字与全部原图，可在本应用或另一台设备上恢复；建议定期导出留存。</div>
        <hr style="border:none;border-top:1px dashed var(--line-strong);margin:18px 0">
        <button class="btn btn-danger" id="btnWipe">🗑 清空全部错题数据</button>
      </div>
    </div>`;

    setTopActions([]);

    const keyInput = $('#setKey');
    $('#toggleKey').addEventListener('click', () => {
      const hide = keyInput.type === 'password';
      keyInput.type = hide ? 'text' : 'password';
      $('#toggleKey').textContent = hide ? '隐藏' : '显示';
    });

    function refreshModelList(presetKey) {
      const models = CTB_AI.PRESETS[presetKey]?.models || [];
      $('#modelList').innerHTML = models.map((m) => `<option value="${esc(m)}">`).join('');
    }
    refreshModelList(s.preset);

    $('#presetGrid').addEventListener('click', (e) => {
      const card = e.target.closest('.preset-card'); if (!card) return;
      const key = card.dataset.preset;
      const p = CTB_AI.PRESETS[key];
      $('#setBaseURL').value = p.baseURL;
      if (p.model) $('#setModel').value = p.model;
      refreshModelList(key);
      $$('.preset-card').forEach((c) => c.classList.remove('on'));
      card.classList.add('on');
    });

    $('#setTemp').addEventListener('input', (e) => { $('#tempVal').textContent = e.target.value; });

    function collect() {
      const presetOn = $('.preset-card.on');
      return {
        preset: presetOn?.dataset.preset || 'custom',
        baseURL: $('#setBaseURL').value.trim(),
        apiKey: $('#setKey').value.trim(),
        model: $('#setModel').value.trim(),
        temperature: Number($('#setTemp').value),
        maxTokens: Number($('#setMaxTokens').value) || 2048,
        timeout: Number($('#setTimeout').value) || 60,
      };
    }
    function markConfigured() {
      const ok = CTB_AI.isConfigured(collect());
      $('#cfgState').innerHTML = ok
        ? '<span class="chip chip-ok">✓ 配置完整</span>'
        : '<span class="chip chip-warn">地址 / 密钥 / 模型 均为必填</span>';
    }
    markConfigured();
    ['#setBaseURL', '#setKey', '#setModel'].forEach((sel) => $(sel).addEventListener('input', markConfigured));

    $('#btnSaveApi').addEventListener('click', () => {
      const v = collect();
      if (!v.baseURL || !v.apiKey || !v.model) { toast('请填写接口地址、密钥与模型名称', 'error'); return; }
      CTB_AI.saveSettings(v);
      toast('API 设置已保存', 'success');
      markConfigured();
    });

    $('#btnTest').addEventListener('click', async () => {
      const v = collect();
      CTB_AI.saveSettings(v);
      const box = $('#testResult');
      const label = $('#testLabel');
      box.className = 'test-result';
      box.innerHTML = '';
      label.innerHTML = '<span class="spinner"></span> 测试中…';
      $('#btnTest').disabled = true;
      try {
        const r = await CTB_AI.testConnection();
        box.className = 'test-result ok show';
        box.innerHTML = `✅ 连接成功！响应耗时 <span class="latency">${r.latencyMs} ms</span>。模型回复：${esc(r.reply.slice(0, 60))}`;
      } catch (err) {
        box.className = 'test-result fail show';
        box.innerHTML = `❌ ${esc(err.message)}<br><span style="font-size:12px;opacity:.85">常见原因：密钥错误 / 欠费、模型名不对、服务商不允许浏览器跨域（需换中转或在帮助中查看说明）。</span>`;
      } finally {
        label.textContent = '🔌 测试连接';
        $('#btnTest').disabled = false;
      }
    });

    $('#btnBackup').addEventListener('click', async () => {
      const all = await CTB_DB.all();
      if (!all.length) return toast('暂无数据可备份', 'error');
      CTB_Export.exportBackup(all).then(() => toast('备份已开始下载', 'success')).catch((e) => toast(e.message, 'error'));
    });
    $('#btnRestore').addEventListener('click', () => $('#restoreInput').click());
    $('#restoreInput').addEventListener('change', async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try {
        const raw = await CTB_Export.readJSONFile(file);
        const records = CTB_Export.hydrateBackup(raw);
        const mode = await new Promise((resolve) => {
          openModal({
            size: 'narrow',
            title: `恢复备份（${records.length} 道）`,
            bodyHTML: `
              <p style="font-size:13.5px;color:var(--ink-2);line-height:1.9">请选择恢复方式：</p>
              <label class="switch" style="display:flex;margin:10px 0"><input type="radio" name="restoreMode" value="merge" checked><span class="track" style="display:none"></span> <b>合并</b>：保留现有错题，追加备份中的内容（相同 ID 会覆盖）</label>
              <label class="switch" style="display:flex"><input type="radio" name="restoreMode" value="replace"><span class="track" style="display:none"></span> <b>替换</b>：先清空当前文库，再导入备份</label>`,
            footer: [
              { text: '取消', onClick: () => { closeModal(); resolve(null); } },
              { text: '开始恢复', primary: true, onClick: () => {
                const v = $('input[name="restoreMode"]:checked')?.value || 'merge';
                closeModal(); resolve(v);
              } },
            ],
            onBackdrop: () => resolve(null),
          });
        });
        if (!mode) return;
        await CTB_DB.bulkPut(records, mode);
        toast(`已恢复 ${records.length} 道错题`, 'success');
        if (state.route === 'library') renderLibrary();
      } catch (err) {
        toast(err.message, 'error', 3600);
      } finally {
        e.target.value = '';
      }
    });

    $('#btnExcelAll').addEventListener('click', async () => {
      const all = await CTB_DB.all();
      if (!all.length) return toast('暂无数据', 'error');
      CTB_Export.exportExcel(all).catch((e) => toast(e.message, 'error'));
    });
    $('#btnPdfAll').addEventListener('click', async () => {
      const all = await CTB_DB.all();
      if (!all.length) return toast('暂无数据', 'error');
      CTB_Export.printPDF(all).catch((e) => toast(e.message, 'error'));
    });
    $('#btnWipe').addEventListener('click', async () => {
      const n = await CTB_DB.count();
      if (!n) return toast('文库已经是空的', 'info');
      const ok = await confirmDialog({
        title: '清空全部错题数据？',
        message: `将永久删除文库中的 ${n} 道错题及图片，且无法恢复。建议先导出备份。`,
        confirmText: '全部删除', danger: true,
      });
      if (!ok) return;
      await CTB_DB.clear();
      toast('已清空全部错题', 'success');
      if (state.route === 'library') renderLibrary();
    });
  }

  /* ================= 帮助中心 ================= */
  function renderHelp() {
    const content = $('#content');
    content.innerHTML = `
    <div class="view" style="max-width:960px">
      <div class="help-grid">
        <div class="card card-pad">
          <div class="section-title">四步上手</div>
          ${[
            ['配置 API', '在「API 设置」选择模型服务商（DeepSeek、智谱、通义、Kimi 等），填入 API 密钥并点「测试连接」。需使用支持图片理解的模型。'],
            ['导入图片', '到「导入错题」点击或拖拽上传试卷/作业照片，支持多选与截图粘贴；可裁剪、旋转摆正题目。'],
            ['AI 识别整理', '点「AI 识别并整理」，图片会发给大模型直接提取题目、答案、解析与学科、难度、知识点。'],
            ['AI 补全与归档', '没有答案的题目点「AI 生成答案解析」，核对学科、难度、知识点后保存，即可在文库中检索复习。'],
          ].map(([t, d], i) => `
            <div class="help-step">
              <div class="n">${i + 1}</div>
              <div><h4>${t}</h4><p>${d}</p></div>
            </div>`).join('')}
        </div>

        <div class="card card-pad">
          <div class="section-title">核心能力一览</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px;color:var(--ink-2)">
            ${[
              ['🖼 多图导入', 'JPG / PNG / WEBP，多选 / 拖拽 / 粘贴'],
              ['✂ 裁剪旋转', '框选题目区域，90° 摆正'],
              ['🪄 识图整理', '图片直发大模型，提取题目/答案/解析'],
              ['� 智能分类', '自动判断学科、难度、知识点'],
              ['✍️ AI 作答', '流式生成参考答案与分步解析'],
              ['🏷 多维整理', '学科 / 难度 / 知识点 / 标签'],
              ['🔎 快速检索', '关键词、标签、日期范围组合筛选'],
              ['📦 安全可控', 'IndexedDB 本地存储 + 备份导出'],
            ].map(([t, d]) => `<div style="padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--paper)"><b style="display:block;color:var(--ink);margin-bottom:2px">${t}</b>${d}</div>`).join('')}
          </div>
        </div>
      </div>

      <div class="card card-pad" style="margin-top:18px">
        <div class="section-title">常见问题</div>
        ${[
          ['API 密钥从哪里获取？', '在对应服务商官网注册并创建 API Key：DeepSeek（platform.deepseek.com）、智谱（open.bigmodel.cn）、阿里云百炼（通义）、Moonshot 开放平台等。密钥相当于账户余额凭证，请勿公开分享。'],
          ['测试连接报跨域 / CORS 错误怎么办？', '浏览器直接调用要求服务商允许跨域。DeepSeek、智谱、通义百炼、Kimi、SiliconFlow 通常支持；OpenAI 官方接口在部分网络环境会受限。解决办法：① 换用支持跨域的服务商；② 使用兼容 OpenAI 协议且允许跨域的中转地址，填入 Base URL；③ 用本应用的桌面壳（Electron / PWA 打包）加载可绕过浏览器限制。'],
          ['AI 识别慢或不准怎么办？', '识别速度与效果取决于所用模型与图片质量。建议先用裁剪功能只保留题目区域、旋转摆正、光线均匀；若模型输出为空或报错，可换用支持图片理解的模型（如 GLM-4V、Qwen-VL、GPT-4o 等），或检查接口是否支持多模态。'],
          ['AI 生成的答案一定对吗？', '不一定。AI 可能出现"一本正经地做错"，所以应用在答案处标注了生成模型名称，请务必自行核对。建议把生成内容当作解题思路参考。'],
          ['我的数据存在哪里？清理浏览器缓存会丢吗？', '错题文字、标签与图片全部保存在当前浏览器的 IndexedDB 中，不经过任何服务器。清理浏览器站点数据可能删除它们，请定期用「备份全部（JSON）」导出文件保存；换电脑时用「恢复备份」即可迁移。'],
          ['手机 / 平板能用吗？', '可以。本应用是响应式网页，手机浏览器同样可拍照上传、识别与管理；在浏览器菜单选择「添加到主屏幕」即可像 App 一样使用。'],
        ].map(([q, a]) => `
          <details class="faq-item">
            <summary>${esc(q)}</summary>
            <div class="faq-a">${esc(a)}</div>
          </details>`).join('')}
      </div>

      <div class="card card-pad" style="margin-top:18px;text-align:center;background:linear-gradient(160deg,var(--card),var(--paper-deep))">
        <div style="font-family:var(--font-serif);font-size:18px;letter-spacing:2px;margin-bottom:6px">学而不思则罔，思而不学则殆</div>
        <p style="font-size:12.5px;color:var(--ink-3)">错题本 · 本地优先的智能错题工具 ｜ 兼容 OpenAI 协议的任意大模型接口</p>
      </div>
    </div>`;
    setTopActions([]);
  }

  /* ================= 移动端导航 / 主题 ================= */
  function closeMobileNav() { $('#app').classList.remove('nav-open'); $('#scrim').hidden = true; }
  $('#menuBtn').addEventListener('click', () => {
    const open = $('#app').classList.toggle('nav-open');
    $('#scrim').hidden = !open;
  });
  $('#scrim').addEventListener('click', closeMobileNav);

  const THEME_KEY = 'ctb_theme_v1';
  const systemDarkMQ = window.matchMedia('(prefers-color-scheme: dark)');
  function currentDefaultTheme() {
    return systemDarkMQ.matches ? 'dark' : 'light';
  }
  /** persist=true 表示用户手动选择，写入 localStorage；否则仅跟随系统 */
  function applyTheme(t, persist) {
    document.documentElement.dataset.theme = t;
    if (persist) localStorage.setItem(THEME_KEY, t);
  }
  applyTheme(localStorage.getItem(THEME_KEY) || currentDefaultTheme());
  $('#themeToggle').addEventListener('click', () => {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark', true);
  });
  // 用户未显式选择时，跟随系统主题变化
  systemDarkMQ.addEventListener?.('change', () => {
    if (!localStorage.getItem(THEME_KEY)) applyTheme(currentDefaultTheme());
  });

  // 导入页全局粘贴截图
  document.addEventListener('paste', (e) => {
    if (state.route !== 'import') return;
    const files = Array.from(e.clipboardData?.files || []).filter((f) => f.type.startsWith('image/'));
    if (files.length) addFiles(files);
  });

  /* ================= 启动 ================= */
  function boot() {
    const name = (location.hash || '#/library').replace('#/', '') || 'library';
    if (!location.hash) location.hash = '#/library'; // 写入会异步触发一次 hashchange，setRoute 幂等，重复渲染无害
    setRoute(ROUTE_META[name] ? name : 'library');
    // 首次访问且未配置 API 时的温和提示
    setTimeout(() => {
      if (!CTB_AI.isConfigured() && location.hash === '#/library') {
        toast('提示：到「API 设置」配置大模型密钥后，可一键生成答案与解析', 'info', 4200);
      }
    }, 800);
  }
  boot();
})();
