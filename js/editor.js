/* ============================================================
 * editor.js —— 图片裁剪与旋转编辑器
 * CTB_Editor.open({ blob, name }) -> Promise<Blob|null>
 * 旋转为物理旋转（输出即所得），裁剪框支持鼠标 / 触摸拖拽。
 * ============================================================ */
(function (global) {
  'use strict';

  function loadImageFromURL(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('图片加载失败'));
      img.src = url;
    });
  }

  function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.92) {
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
  }

  /** 物理旋转 90° 的倍数，返回新的 HTMLImageElement */
  async function rotateImage(img, deg) {
    const turns = ((Math.round(deg / 90) % 4) + 4) % 4;
    if (turns === 0) return img;
    const swap = turns % 2 === 1;
    const canvas = document.createElement('canvas');
    canvas.width = swap ? img.naturalHeight : img.naturalWidth;
    canvas.height = swap ? img.naturalWidth : img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((turns * Math.PI) / 2);
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
    const blob = await canvasToBlob(canvas);
    return loadImageFromURL(URL.createObjectURL(blob));
  }

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  /**
   * 打开编辑器
   * @returns Promise，确认时 resolve(JPEG Blob)，取消时 resolve(null)
   */
  function open({ blob, name = '' }) {
    return new Promise(async (resolve) => {
      const root = document.getElementById('modalRoot');
      root.hidden = false;

      const backdrop = el('div', 'modal-backdrop');
      const modal = el('div', 'modal wide');
      modal.innerHTML = `
        <div class="modal-head">
          <h2>编辑图片</h2>
          <span class="chip" id="edName" style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span>
        </div>
        <div class="modal-body">
          <div class="crop-stage" id="edStage">
            <img id="edImg" alt="待编辑图片">
            <div class="crop-box" id="edBox">
              <div class="crop-handle nw" data-h="nw"></div>
              <div class="crop-handle ne" data-h="ne"></div>
              <div class="crop-handle sw" data-h="sw"></div>
              <div class="crop-handle se" data-h="se"></div>
            </div>
          </div>
          <div class="crop-toolbar">
            <button class="btn" id="edRotL" title="逆时针旋转 90°">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
              左转 90°
            </button>
            <button class="btn" id="edRotR" title="顺时针旋转 90°">
              右转 90°
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            </button>
            <button class="btn" id="edFull">全图选区</button>
          </div>
          <p class="crop-hint">拖动框内移动选区，拖动四角调整范围；点击「全图选区」可恢复整张图片。</p>
        </div>
        <div class="modal-foot">
          <button class="btn" id="edCancel">取消</button>
          <button class="btn btn-primary" id="edApply">应用并保存</button>
        </div>`;
      root.appendChild(backdrop);
      root.appendChild(modal);

      const stage = modal.querySelector('#edStage');
      const imgEl = modal.querySelector('#edImg');
      const box = modal.querySelector('#edBox');
      modal.querySelector('#edName').textContent = name;

      let img;
      try {
        img = await loadImageFromURL(URL.createObjectURL(blob));
      } catch (err) {
        close(null);
        throw err;
      }
      imgEl.src = img.src;

      // 裁剪框数据（相对于图片显示区域的像素）
      let crop = { x: 0, y: 0, w: 0, h: 0 };

      function imgRect() {
        const sr = stage.getBoundingClientRect();
        const ir = imgEl.getBoundingClientRect();
        return { left: ir.left - sr.left, top: ir.top - sr.top, w: ir.width, h: ir.height };
      }

      function placeBox() {
        const r = imgRect();
        box.style.left = r.left + crop.x + 'px';
        box.style.top = r.top + crop.y + 'px';
        box.style.width = crop.w + 'px';
        box.style.height = crop.h + 'px';
      }

      function resetBox(inset = 0.08) {
        const r = imgRect();
        crop = {
          x: r.w * inset, y: r.h * inset,
          w: r.w * (1 - inset * 2), h: r.h * (1 - inset * 2),
        };
        placeBox();
      }

      function close(result) {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('resize', onResize);
        if (img && img.src && img.src.startsWith('blob:')) URL.revokeObjectURL(img.src);
        root.innerHTML = '';
        root.hidden = true;
        resolve(result);
      }

      /* ---------- 指针交互 ---------- */
      let drag = null;
      function point(e) {
        const r = stage.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
      }
      function onDown(e) {
        const handle = e.target.closest('.crop-handle');
        const r = imgRect();
        drag = {
          mode: handle ? handle.dataset.h : 'move',
          start: point(e),
          origin: { ...crop },
          bounds: r,
        };
        box.setPointerCapture && box.setPointerCapture(e.pointerId);
        e.preventDefault();
      }
      function onMove(e) {
        if (!drag) return;
        const p = point(e);
        const dx = p.x - drag.start.x;
        const dy = p.y - drag.start.y;
        const b = drag.bounds;
        const MIN = 36;
        let { x, y, w, h } = drag.origin;

        if (drag.mode === 'move') {
          x = Math.max(0, Math.min(b.w - w, drag.origin.x + dx));
          y = Math.max(0, Math.min(b.h - h, drag.origin.y + dy));
        } else {
          // 四角缩放（以对角为锚点）
          let left = drag.origin.x, top = drag.origin.y;
          let right = drag.origin.x + drag.origin.w, bottom = drag.origin.y + drag.origin.h;
          if (drag.mode.includes('w')) left = drag.origin.x + dx;
          if (drag.mode.includes('e')) right = drag.origin.x + drag.origin.w + dx;
          if (drag.mode.includes('n')) top = drag.origin.y + dy;
          if (drag.mode.includes('s')) bottom = drag.origin.y + drag.origin.h + dy;
          left = Math.max(0, Math.min(left, b.w));
          right = Math.max(0, Math.min(right, b.w));
          top = Math.max(0, Math.min(top, b.h));
          bottom = Math.max(0, Math.min(bottom, b.h));
          if (right - left < MIN) { if (drag.mode.includes('w')) left = right - MIN; else right = left + MIN; }
          if (bottom - top < MIN) { if (drag.mode.includes('n')) top = bottom - MIN; else bottom = top + MIN; }
          x = Math.min(left, right); w = Math.abs(right - left);
          y = Math.min(top, bottom); h = Math.abs(bottom - top);
          // 再次夹取
          x = Math.max(0, x); y = Math.max(0, y);
          if (x + w > b.w) w = b.w - x;
          if (y + h > b.h) h = b.h - y;
        }
        crop = { x, y, w, h };
        placeBox();
      }
      function onUp() { drag = null; };

      box.addEventListener('pointerdown', onDown);
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('resize', onResize);
      function onResize() { placeBox(); }

      modal.querySelector('#edRotL').addEventListener('click', async () => {
        const oldUrl = img.src;
        img = await rotateImage(img, -90);
        imgEl.src = img.src;
        if (oldUrl.startsWith('blob:')) URL.revokeObjectURL(oldUrl);
        requestAnimationFrame(() => requestAnimationFrame(resetBox));
      });
      modal.querySelector('#edRotR').addEventListener('click', async () => {
        const oldUrl = img.src;
        img = await rotateImage(img, 90);
        imgEl.src = img.src;
        if (oldUrl.startsWith('blob:')) URL.revokeObjectURL(oldUrl);
        requestAnimationFrame(() => requestAnimationFrame(resetBox));
      });
      modal.querySelector('#edFull').addEventListener('click', () => resetBox(0));
      modal.querySelector('#edCancel').addEventListener('click', () => close(null));
      backdrop.addEventListener('click', () => close(null));

      modal.querySelector('#edApply').addEventListener('click', async () => {
        const r = imgRect();
        const sx = img.naturalWidth / r.w;
        const sy = img.naturalHeight / r.h;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(crop.w * sx));
        canvas.height = Math.max(1, Math.round(crop.h * sy));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(
          img,
          crop.x * sx, crop.y * sy, crop.w * sx, crop.h * sy,
          0, 0, canvas.width, canvas.height
        );
        const out = await canvasToBlob(canvas);
        close(out);
      });

      // 等图片完成布局后放置选区
      requestAnimationFrame(() => requestAnimationFrame(resetBox));
      if (document.fonts) document.fonts.ready.then(() => placeBox());
    });
  }

  global.CTB_Editor = { open, rotateImage, canvasToBlob, loadImageFromURL };
})(window);
