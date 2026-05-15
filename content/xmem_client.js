/**
 * Axoltl XMem Client — HTTP client for the Axoltl Memory Core (AMC).
 *
 * Provides: ingest, search, retrieve, healthCheck, getConfig, saveConfig.
 * Serializes requests via RequestQueue to ensure engine stability.
 *
 * Exposes: window.XMemClient
 */

(function axoltlXMemClient() {
  "use strict";

  // ── Config Defaults ─────────────────────────────────────────
  const DEFAULTS = {
    apiUrl: "http://localhost:8000",
    apiKey: "",
    userId: "axoltl-user",
  };

  const CONFIG_KEYS = {
    apiUrl: "axoltlXMemApiUrl",
    apiKey: "axoltlXMemApiKey",
    userId: "axoltlXMemUserId",
  };

  // ── Request Queue ───────────────────────────────────────────
  // Serializes all XMem API requests.

  class RequestQueue {
    constructor() {
      this._queue = [];
      this._processing = false;
    }

    enqueue(fn) {
      return new Promise((resolve, reject) => {
        this._queue.push({ fn, resolve, reject });
        if (!this._processing) {
          this._processNext();
        }
      });
    }

    async _processNext() {
      if (this._queue.length === 0) {
        this._processing = false;
        return;
      }
      this._processing = true;
      const { fn, resolve, reject } = this._queue.shift();
      try {
        const result = await fn();
        resolve(result);
      } catch (err) {
        reject(err);
      }
      setTimeout(() => this._processNext(), 50);
    }
  }

  const requestQueue = new RequestQueue();

  // ── Config Management ───────────────────────────────────────

  async function getConfig() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(
        [CONFIG_KEYS.apiUrl, CONFIG_KEYS.apiKey, CONFIG_KEYS.userId],
        (res) => {
          resolve({
            apiUrl: res[CONFIG_KEYS.apiUrl] || DEFAULTS.apiUrl,
            apiKey: res[CONFIG_KEYS.apiKey] || DEFAULTS.apiKey,
            userId: res[CONFIG_KEYS.userId] || DEFAULTS.userId,
          });
        }
      );
    });
  }

  async function saveConfig(config) {
    const data = {};
    if (config.apiUrl !== undefined) data[CONFIG_KEYS.apiUrl] = config.apiUrl;
    if (config.apiKey !== undefined) data[CONFIG_KEYS.apiKey] = config.apiKey;
    if (config.userId !== undefined) data[CONFIG_KEYS.userId] = config.userId;
    return chrome.storage.sync.set(data);
  }

  // ── HTTP Helpers ────────────────────────────────────────────

  async function apiFetch(path, options = {}) {
    const config = await getConfig();
    const { method = "POST", body = null, timeoutMs = 30000 } = options;
    const url = `${config.apiUrl.replace(/\/+$/, "")}${path}`;

    const headers = { "Content-Type": "application/json" };
    if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;

    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            action: "XMEM_PROXY_FETCH",
            payload: { url, options: { method, headers, body } },
          },
          (res) => resolve(res)
        );
      });

      if (!response || !response.ok) {
        console.warn(`[Axoltl Client] ${method} ${path} failed:`, response?.error || response?.status);
        return null;
      }

      return response.data;
    } catch (err) {
      console.debug(`[Axoltl Client] ${method} ${path} offline:`, err.message);
      return null;
    }
  }

  // ── Public API ──────────────────────────────────────────────

  const XMemClient = {
    async checkHealth() {
      const result = await apiFetch("/health", { method: "GET", timeoutMs: 5000 });
      if (!result) return { connected: false, status: "offline" };
      
      return {
        connected: result.pipelines_ready === true,
        status: result.status || "online",
        uptime: result.uptime_seconds || 0,
      };
    },

    async ingestMemory(userQuery, agentResponse = "", opts = {}) {
      const config = await getConfig();
      return requestQueue.enqueue(() =>
        apiFetch("/v1/memory/ingest", {
          body: {
            user_query: userQuery,
            agent_response: agentResponse || "Acknowledged.",
            user_id: config.userId,
            effort_level: opts.effortLevel || "low",
            session_datetime: new Date().toISOString(),
          },
        })
      );
    },

    async searchMemories(query, opts = {}) {
      const config = await getConfig();
      const result = await requestQueue.enqueue(() =>
        apiFetch("/v1/memory/search", {
          body: {
            query,
            user_id: config.userId,
            domains: opts.domains || ["profile", "temporal", "tech", "general"],
            top_k: opts.topK || 5,
          },
        })
      );

      if (!result || result.status !== "success") return null;

      const results = result.results || [];
      return {
        results: results.map((r) => ({
          content: r.content || "",
          domain: r.domain || "general",
          score: r.score || 0,
          metadata: r.metadata || {},
          userQuery: r.user_query || "",
          aiResponse: r.agent_response || "",
          provider: r.domain,
          timestamp: r.timestamp || Date.now(),
          source: "axoltl-amc",
        })),
        total: result.total || results.length,
      };
    },

    async retrieveAnswer(query, opts = {}) {
      const config = await getConfig();
      const result = await requestQueue.enqueue(() =>
        apiFetch("/v1/memory/retrieve", {
          body: {
            query,
            user_id: config.userId,
            top_k: opts.topK || 5,
          },
        })
      );

      if (!result || result.status !== "success" || !result.data) return null;

      const data = result.data;
      return {
        answer: data.answer || "",
        sources: (data.sources || []).map((s) => ({
          domain: s.domain,
          content: s.content,
          score: s.score,
          metadata: s.metadata || {},
        })),
        confidence: data.confidence || 0,
        model: data.model || "Axoltl-AMC",
      };
    },

    getConfig,
    saveConfig,
  };

  window.XMemClient = XMemClient;
  console.log("[Axoltl Client] Initialized — talking to Axoltl Memory Core (AMC)");
})();
