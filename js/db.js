/* ============================================================
 * db.js —— 本地数据层（IndexedDB）
 * 错题记录（含图片 Blob）全部保存在本机浏览器，不上传服务器。
 * ============================================================ */
(function (global) {
  'use strict';

  const DB_NAME = 'cuotiben_db';
  const DB_VERSION = 1;
  const STORE = 'mistakes';

  let _dbPromise = null;

  function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: 'id' });
          os.createIndex('createdAt', 'createdAt');
          os.createIndex('subject', 'subject');
          os.createIndex('status', 'status');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return _dbPromise;
  }

  function tx(mode) {
    return openDB().then((db) => {
      const t = db.transaction(STORE, mode);
      return { t, store: t.objectStore(STORE) };
    });
  }

  function reqAsPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function uid() {
    return 'm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
  }

  /** 规范一条错题记录 */
  function normalize(input) {
    const now = Date.now();
    return {
      id: input.id || uid(),
      createdAt: input.createdAt || now,
      updatedAt: now,
      subject: input.subject || '其他',
      question: (input.question || '').trim(),
      answer: (input.answer || '').trim(),
      analysis: (input.analysis || '').trim(),
      knowledgePoints: Array.isArray(input.knowledgePoints) ? input.knowledgePoints : [],
      tags: Array.isArray(input.tags) ? input.tags : [],
      difficulty: Number(input.difficulty) || 3,
      source: input.source || '',
      status: input.status || 'new',           // new | reviewing | mastered
      reviewCount: Number(input.reviewCount) || 0,
      note: input.note || '',
      aiModel: input.aiModel || '',
      images: Array.isArray(input.images) ? input.images : [],
      // images: [{ id, blob(Blob), name }]
    };
  }

  const DB = {
    uid,

    /** 读取全部错题（按创建时间倒序） */
    async all() {
      const { store } = await tx('readonly');
      const list = await reqAsPromise(store.getAll());
      return list.sort((a, b) => b.createdAt - a.createdAt);
    },

    async get(id) {
      const { store } = await tx('readonly');
      return reqAsPromise(store.get(id));
    },

    async count() {
      const { store } = await tx('readonly');
      return reqAsPromise(store.count());
    },

    /** 新增或更新 */
    async put(input) {
      const existing = input.id ? await this.get(input.id).catch(() => null) : null;
      const record = normalize({ ...(existing || {}), ...input, id: input.id || existing?.id });
      if (existing) record.createdAt = existing.createdAt;
      const { t, store } = await tx('readwrite');
      await reqAsPromise(store.put(record));
      return new Promise((resolve, reject) => {
        t.oncomplete = () => resolve(record);
        t.onerror = () => reject(t.error);
      });
    },

    async delete(id) {
      const { t, store } = await tx('readwrite');
      await reqAsPromise(store.delete(id));
      return new Promise((resolve, reject) => {
        t.oncomplete = () => resolve(true);
        t.onerror = () => reject(t.error);
      });
    },

    async clear() {
      const { t, store } = await tx('readwrite');
      await reqAsPromise(store.clear());
      return new Promise((resolve, reject) => {
        t.oncomplete = () => resolve(true);
        t.onerror = () => reject(t.error);
      });
    },

    /** 批量写入（恢复备份用），返回写入条数 */
    async bulkPut(records, mode = 'merge') {
      const { t, store } = await tx('readwrite');
      if (mode === 'replace') {
        await reqAsPromise(store.clear());
      }
      let n = 0;
      for (const r of records) {
        const rec = normalize(r);
        // 恢复时保留备份中的时间
        await reqAsPromise(store.put(rec));
        n++;
      }
      return new Promise((resolve, reject) => {
        t.oncomplete = () => resolve(n);
        t.onerror = () => reject(t.error);
      });
    },
  };

  /* ---------------- 第三方库按需加载 ---------------- */
  const _loading = {};
  /** 动态注入脚本（幂等）；加载过则复用同一个 Promise */
  function loadScript(src) {
    if (_loading[src]) return _loading[src];
    _loading[src] = new Promise((resolve, reject) => {
      if (document.querySelector(`script[data-src="${CSS.escape(src)}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.dataset.src = src;
      s.onload = () => resolve();
      s.onerror = () => {
        _loading[src] = null;
        reject(new Error('网络组件加载失败，请检查网络连接后重试'));
      };
      document.head.appendChild(s);
    });
    return _loading[src];
  }

  global.CTB_DB = DB;
  global.CTB_loadScript = loadScript;
})(window);
