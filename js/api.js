/* ============================================================
 * api.js —— 大模型 API 配置与调用
 * 兼容 OpenAI Chat Completions 协议（/chat/completions）：
 * OpenAI / DeepSeek / 智谱 GLM / 通义千问 / Kimi / 豆包 /
 * SiliconFlow 及任意自建中转。支持 SSE 流式输出与中断。
 * ============================================================ */
(function (global) {
  'use strict';

  const SETTINGS_KEY = 'ctb_api_settings_v1';

  /** 供应商预设（baseURL 均为 OpenAI 兼容入口） */
  const PRESETS = {
    deepseek: {
      name: 'DeepSeek 深度求索',
      baseURL: 'https://api.deepseek.com',
      models: ['deepseek-chat', 'deepseek-reasoner'],
      model: 'deepseek-chat',
    },
    zhipu: {
      name: '智谱 GLM',
      baseURL: 'https://open.bigmodel.cn/api/paas/v4',
      models: ['glm-4-flash', 'glm-4-plus', 'glm-4.5-flash', 'glm-4-air'],
      model: 'glm-4-flash',
    },

    qwen: {
      name: '通义千问（百炼）',
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      models: ['qwen-plus', 'qwen-turbo', 'qwen-max', 'qwen2.5-72b-instruct'],
      model: 'qwen-plus',
    },
    moonshot: {
      name: 'Kimi 月之暗面',
      baseURL: 'https://api.moonshot.cn/v1',
      models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k', 'kimi-k2-0905-preview'],
      model: 'moonshot-v1-8k',
    },
    doubao: {
      name: '豆包（火山方舟）',
      baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
      models: [], // 方舟使用接入点 ID（ep-xxxx），由用户填写
      model: '',
    },
    openai: {
      name: 'OpenAI',
      baseURL: 'https://api.openai.com/v1',
      models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'o4-mini'],
      model: 'gpt-4o-mini',
    },
    siliconflow: {
      name: 'SiliconFlow 硅基流动',
      baseURL: 'https://api.siliconflow.cn/v1',
      models: ['Qwen/Qwen2.5-72B-Instruct', 'deepseek-ai/DeepSeek-V3', 'THUDM/glm-4-9b-chat'],
      model: 'Qwen/Qwen2.5-72B-Instruct',
    },
    custom: {
      name: '自定义（OpenAI 兼容）',
      baseURL: '',
      models: [],
      model: '',
    },
  };

  const DEFAULTS = {
    preset: 'deepseek',
    baseURL: PRESETS.deepseek.baseURL,
    apiKey: '',
    model: PRESETS.deepseek.model,
    temperature: 0.4,
    maxTokens: 2048,
    timeout: 60,
  };

  function getSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function saveSettings(s) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  }

  function isConfigured(s = getSettings()) {
    return !!(s.apiKey && s.baseURL && s.model);
  }

  /* ---------------- 核心请求 ---------------- */

  function normalizeURL(base) {
    return base.replace(/\/+$/, '');
  }

  /**
   * 发起一次 chat completion。
   * @param {Array} messages  OpenAI 消息数组
   * @param {Object} opts     { stream, onDelta, signal, jsonMode, temperature, maxTokens }
   * @returns {Promise<{content:string}>}
   */
  async function chat(messages, opts = {}) {
    const s = getSettings();
    if (!isConfigured(s)) {
      throw new Error('尚未配置 API：请先到「API 设置」填写密钥与模型');
    }
    const ctrl = new AbortController();
    const timeoutSec = opts.timeout ?? s.timeout ?? 60;
    const timer = setTimeout(() => ctrl.abort(), timeoutSec * 1000);
    if (opts.signal) {
      opts.signal.addEventListener('abort', () => ctrl.abort(), { once: true });
    }

    const body = {
      model: s.model,
      messages,
      temperature: opts.temperature ?? s.temperature ?? 0.4,
      max_tokens: opts.maxTokens ?? s.maxTokens ?? 2048,
      stream: !!opts.stream,
    };
    // 不强制下发 response_format：部分 OpenAI 兼容服务不支持会直接报错；
    // JSON 结构化通过系统提示词约束 + extractJSON 容错提取实现。

    let resp;
    try {
      resp = await fetch(normalizeURL(s.baseURL) + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + s.apiKey,
        },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') throw new Error('请求超时或已被取消（可在设置中调大超时时间）');
      throw new Error('网络请求失败：' + err.message + '（可能是跨域限制或网络不可达）');
    }

    if (!resp.ok) {
      clearTimeout(timer);
      let detail = '';
      try { detail = (await resp.text()).slice(0, 500); } catch {}
      throw new Error(`接口返回 ${resp.status}：${detail || resp.statusText}`);
    }

    if (!opts.stream) {
      clearTimeout(timer);
      const data = await resp.json();
      const content = data?.choices?.[0]?.message?.content ?? '';
      return { content: String(content), raw: data };
    }

    // ---- SSE 流式解析 ----
    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let full = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload);
            const delta = json?.choices?.[0]?.delta?.content;
            if (delta) {
              full += delta;
              opts.onDelta && opts.onDelta(delta, full);
            }
          } catch { /* 心跳/不完整分片，忽略 */ }
        }
      }
    } finally {
      clearTimeout(timer);
      try { reader.releaseLock(); } catch {}
    }
    return { content: full };
  }

  /* ---------------- 业务能力 ---------------- */

  /** 连接测试：发送极小请求，返回耗时与模型回显 */
  async function testConnection() {
    const started = performance.now();
    const { content } = await chat(
      [
        { role: 'system', content: '你是接口连通性检测助手，只需要简短回答。' },
        { role: 'user', content: '请回复：连接正常' },
      ],
      { temperature: 0, maxTokens: 20, timeout: 20 }
    );
    return { latencyMs: Math.round(performance.now() - started), reply: content.trim() };
  }

  /**
   * AI 生成参考答案与解析（流式）。
   * @returns {Promise<{content:string, answer:string, analysis:string}>}
   */
  async function generateAnswer(params, onDelta, signal) {
    const { question, subject = '', knowledgePoints = [] } = params;
    const sys = `你是一名经验丰富的${subject || '全科'}教师，正在为学生讲解一道错题。要求：
1. 答案准确，若题目信息不足以唯一确定答案，要明确指出并给出最可能的解法；
2. 解析条理清晰、步骤完整，讲清"为什么"，必要时给出易错提醒；
3. 使用中文，公式可用文字或 LaTeX；
4. 严格按以下格式输出（Markdown）：
### 参考答案
（最终答案）
### 解析
（分步解析）
### 易错提醒
（一条本题最容易出错的地方）`;
    const user = `学科：${subject || '未指定'}
${knowledgePoints.length ? '知识点：' + knowledgePoints.join('、') + '\n' : ''}
题目：
${question}`;
    const { content } = await chat(
      [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
      { stream: true, onDelta, signal, temperature: 0.35, maxTokens: 2600 }
    );
    return splitAnswerAnalysis(content);
  }

  /* ---------------- 多模态：图片直接提取 ---------------- */

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  /**
   * 直接将错题图片传给多模态 AI，提取结构化信息。
   * @param {Blob[]} images  图片 Blob 数组
   * @param {Object} opts    { subject, onDelta, signal }
   * @returns {Promise<Object>} { question, answer, analysis, subject, knowledgePoints, difficulty }
   */
  async function extractFromImages(images, opts = {}) {
    const { subject = '', onDelta, signal } = opts;
    const imageParts = [];
    for (const blob of images) {
      const dataUrl = await blobToDataURL(blob);
      imageParts.push({ type: 'image_url', image_url: { url: dataUrl } });
    }
    const sys = `你是一名严谨的学科教研老师，正在帮学生整理错题。用户会上传错题照片（可能含题目、答案、解析，也可能只有题目）。
请仔细识别图片中的全部文字与公式，输出 JSON（不要输出 JSON 以外的任何内容），字段如下：
{
  "question": "完整、通顺的题目正文（保留公式、编号、选项；修正明显的识别错误）",
  "answer": "参考答案；若图片中没有答案则为空字符串",
  "analysis": "解析/解答过程；若没有则为空字符串",
  "subject": "学科，只能从：语文/数学/英语/物理/化学/生物/政治/历史/地理/计算机/其他",
  "knowledgePoints": ["涉及的知识点，1-4个，没有把握时给空数组"],
  "difficulty": 1到5的整数（1最易，5最难，依据题目复杂度保守估计）
}
要求：只基于图片内容整理，不编造图片中没有的答案与解析。`;
    const userContent = [
      { type: 'text', text: subject ? `学科提示：${subject}（若图片明显属于其他学科以图片为准）` : '请识别并整理图片中的错题。' },
      ...imageParts,
    ];
    const { content } = await chat(
      [
        { role: 'system', content: sys },
        { role: 'user', content: userContent },
      ],
      { stream: true, onDelta, signal, temperature: 0.1, maxTokens: 2600 }
    );
    return extractJSON(content);
  }

  /* ---------------- 文本工具 ---------------- */

  function extractJSON(text) {
    if (!text) return null;
    // 去掉代码围栏
    let t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    // 直接解析
    try { return JSON.parse(t); } catch {}
    // 截取首个 { 到末个 }
    const m = t.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch {}
    }
    return null;
  }

  /** 把「### 参考答案 / ### 解析」格式拆成两段 Markdown */
  function splitAnswerAnalysis(text) {
    const result = { answer: '', analysis: '', raw: text };
    if (!text) return result;
    // 统一标题
    const normalized = text
      .replace(/[#\s]*参考答案?\s*[:：]?/g, '\n@@ANSWER@@')
      .replace(/[#\s]*解\s*析\s*[:：]?/g, '\n@@ANALYSIS@@')
      .replace(/[#\s]*易错提醒\s*[:：]?/g, '\n@@TIP@@');
    const aIdx = normalized.indexOf('@@ANSWER@@');
    const xIdx = normalized.indexOf('@@ANALYSIS@@');
    const tIdx = normalized.indexOf('@@TIP@@');
    if (aIdx === -1 && xIdx === -1) {
      result.answer = text.trim();
      return result;
    }
    const answerStart = aIdx + '@@ANSWER@@'.length;
    const answerEnd = xIdx > aIdx ? xIdx : (tIdx > aIdx ? tIdx : text.length);
    if (aIdx !== -1) result.answer = normalized.slice(answerStart, answerEnd).trim();

    const analysisParts = [];
    if (xIdx !== -1) {
      const xStart = xIdx + '@@ANALYSIS@@'.length;
      const xEnd = tIdx > xIdx ? tIdx : normalized.length;
      analysisParts.push(normalized.slice(xStart, xEnd).trim());
    }
    if (tIdx !== -1) {
      analysisParts.push('**易错提醒：** ' + normalized.slice(tIdx + '@@TIP@@'.length).trim());
    }
    result.analysis = analysisParts.filter(Boolean).join('\n\n');
    return result;
  }

  global.CTB_AI = {
    PRESETS,
    getSettings,
    saveSettings,
    isConfigured,
    chat,
    testConnection,
    generateAnswer,
    extractFromImages,
    extractJSON,
    splitAnswerAnalysis,
  };
})(window);
