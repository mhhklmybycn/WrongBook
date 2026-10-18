/* ============================================================
 * exporter.js —— 数据备份 / 恢复 / 导出
 *  · 备份：JSON（图片以 base64 内嵌），可原样恢复
 *  · Excel：.xlsx（SheetJS）
 *  · PDF：调起浏览器打印（中文渲染最佳，选择"另存为 PDF"）
 * ============================================================ */
(function (global) {
  'use strict';

  const STATUS_LABEL = { new: '待学习', reviewing: '复习中', mastered: '已掌握' };

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  function dataURLToBlob(dataURL) {
    const [head, body] = dataURL.split(',');
    const mime = /data:(.*?);/.exec(head)?.[1] || 'image/jpeg';
    const bin = atob(body || '');
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  function download(blobOrURL, filename) {
    const url = blobOrURL instanceof Blob ? URL.createObjectURL(blobOrURL) : blobOrURL;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (blobOrURL instanceof Blob) setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }

  function fmtDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  /* ---------------- 备份 / 恢复 ---------------- */

  async function exportBackup(mistakes) {
    const payload = {
      app: 'cuotiben',
      version: 1,
      exportedAt: new Date().toISOString(),
      count: mistakes.length,
      mistakes: [],
    };
    for (const m of mistakes) {
      const images = [];
      for (const im of (m.images || [])) {
        images.push({
          id: im.id,
          name: im.name || '',
          dataURL: im.blob ? await blobToDataURL(im.blob) : im.dataURL || '',
        });
      }
      payload.mistakes.push({ ...m, images });
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    download(blob, `错题本备份-${stamp()}.json`);
  }

  function readJSONFile(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        try { resolve(JSON.parse(fr.result)); } catch (e) { reject(new Error('文件不是有效的备份 JSON')); }
      };
      fr.onerror = () => reject(fr.error);
      fr.readAsText(file);
    });
  }

  /** 校验并转换备份内容，返回可入库的记录 */
  function hydrateBackup(data) {
    if (!data || data.app !== 'cuotiben' || !Array.isArray(data.mistakes)) {
      throw new Error('备份文件格式不正确（缺少错题本标识）');
    }
    return data.mistakes.map((m) => ({
      ...m,
      images: (m.images || []).map((im) => ({
        id: im.id || 'img_' + Math.random().toString(36).slice(2, 9),
        name: im.name || '',
        blob: im.blob instanceof Blob ? im.blob : (im.dataURL ? dataURLToBlob(im.dataURL) : null),
      })).filter((im) => im.blob),
    }));
  }

  /* ---------------- Excel ---------------- */

  async function ensureXLSX() {
    if (typeof XLSX === 'undefined') {
      await global.CTB_loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
    }
    if (typeof XLSX === 'undefined') throw new Error('Excel 组件加载失败，请检查网络后重试');
  }

  async function exportExcel(mistakes) {
    await ensureXLSX();
    const rows = [['编号', '学科', '难度(1-5)', '题目', '参考答案', '解析', '知识点', '标签', '来源', '状态', '创建日期']];
    mistakes.forEach((m, i) => {
      rows.push([
        i + 1,
        m.subject,
        m.difficulty,
        m.question,
        mdToPlain(m.answer),
        mdToPlain(m.analysis),
        (m.knowledgePoints || []).join('、'),
        (m.tags || []).join('、'),
        m.source || '',
        STATUS_LABEL[m.status] || m.status,
        fmtDate(m.createdAt),
      ]);
    });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws['!cols'] = [{ wch: 6 }, { wch: 9 }, { wch: 9 }, { wch: 50 }, { wch: 36 }, { wch: 60 }, { wch: 20 }, { wch: 16 }, { wch: 14 }, { wch: 9 }, { wch: 12 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '错题');
    XLSX.writeFile(wb, `错题本导出-${stamp()}.xlsx`);
  }

  function mdToPlain(s) {
    return String(s || '')
      .replace(/^#{1,6}\s*/gm, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .trim();
  }

  /* ---------------- PDF（打印） ---------------- */

  async function printPDF(mistakes) {
    const win = window.open('', '_blank');
    if (!win) throw new Error('浏览器拦截了打印窗口，请允许弹窗后重试');

    const blocks = [];
    for (let i = 0; i < mistakes.length; i++) {
      const m = mistakes[i];
      const imgs = [];
      for (const im of (m.images || [])) {
        if (im.blob) imgs.push(await blobToDataURL(im.blob));
      }
      blocks.push(buildBlockHTML(i + 1, m, imgs));
    }

    win.document.write(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>错题本</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Noto Sans SC","PingFang SC","Microsoft YaHei",sans-serif; color:#222; margin:0; padding:36px 40px; font-size:13px; line-height:1.75; }
  header { text-align:center; border-bottom:2px solid #bf3b2e; padding-bottom:14px; margin-bottom:22px; }
  header h1 { font-family:"Noto Serif SC",serif; margin:0 0 4px; font-size:24px; letter-spacing:6px; }
  header p { margin:0; color:#777; font-size:12px; }
  .item { break-inside: avoid-page; margin-bottom:26px; padding-bottom:18px; border-bottom:1px dashed #ccc; }
  .meta { font-size:12px; color:#666; margin:4px 0 8px; }
  .meta b { color:#bf3b2e; font-weight:600; }
  h3.sec { font-size:13.5px; margin:12px 0 4px; color:#3f5e86; }
  h3.sec.a { color:#57765a; } h3.sec.x { color:#bf3b2e; }
  .qbox { white-space:pre-wrap; }
  .imgs { display:flex; flex-wrap:wrap; gap:8px; margin:8px 0; }
  .imgs img { max-width:240px; max-height:220px; border:1px solid #ddd; border-radius:6px; }
  .content { white-space:pre-wrap; }
  .empty { color:#999; font-style:italic; }
  footer { text-align:center; color:#999; font-size:11px; margin-top:10px; }
  @media print { body { padding: 12mm 14mm; } }
</style></head><body>
<header><h1>错 题 本</h1><p>导出时间：${new Date().toLocaleString('zh-CN')} ｜ 共 ${mistakes.length} 题</p></header>
${blocks.join('\n')}
<footer>由「错题本」应用导出 · 数据本地存储，安心使用</footer>
</body></html>`);
    win.document.close();

    const trigger = () => {
      try { win.focus(); win.print(); } catch {}
    };
    if (win.document.readyState === 'complete') setTimeout(trigger, 400);
    else win.onload = () => setTimeout(trigger, 400);
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function buildBlockHTML(no, m, imgURLs) {
    const kp = (m.knowledgePoints || []).map(esc).join('、');
    const tags = (m.tags || []).map(esc).join('、');
    const stars = '★'.repeat(m.difficulty || 3) + '☆'.repeat(5 - (m.difficulty || 3));
    return `
<div class="item">
  <div class="meta"><b>第 ${no} 题</b> ｜ ${esc(m.subject)} ｜ 难度：${stars} ｜ ${esc(STATUS_LABEL[m.status] || '')} ｜ ${fmtDate(m.createdAt)}${m.source ? ' ｜ 来源：' + esc(m.source) : ''}</div>
  ${kp || tags ? `<div class="meta">${kp ? '知识点：' + kp : ''}${tags ? '　标签：' + tags : ''}</div>` : ''}
  ${imgURLs.length ? `<div class="imgs">${imgURLs.map((u) => `<img src="${u}">`).join('')}</div>` : ''}
  <h3 class="sec">题目</h3>
  <div class="qbox">${esc(m.question) || '<span class="empty">（无文字内容，见图片）</span>'}</div>
  <h3 class="sec a">参考答案</h3>
  <div class="content">${esc(m.answer) || '<span class="empty">（暂无答案）</span>'}</div>
  <h3 class="sec x">解析</h3>
  <div class="content">${esc(m.analysis) || '<span class="empty">（暂无解析）</span>'}</div>
</div>`;
  }

  global.CTB_Export = {
    exportBackup, readJSONFile, hydrateBackup, exportExcel, printPDF,
    blobToDataURL, dataURLToBlob, download, fmtDate,
  };
})(window);
