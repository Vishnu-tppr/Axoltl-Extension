/**
 * Axoltl XMem Client — HTTP client for the XMem memory server.
 *
 * Provides: ingest, search, retrieve, healthCheck, getConfig, saveConfig.
 * Uses a serial RequestQueue to prevent INVALID_CONCURRENT_GRAPH_UPDATE errors.
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
  // Serializes all XMem API requests to prevent LangGraph concurrency errors.
  // Pattern from: /backend-patterns — RequestQueue (serial processing).

  class RequestQueue {
    constructor() {
      this._queue = [];
      this._processing = false;
    }

    /**
     * Enqueue a request function. Returns a promise that resolves with the result.
     * @param {() => Promise<any>} fn - Async function to execute.
     * @returns {Promise<any>}
     */
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

      // Process next item after a small delay to avoid hammering the server
      setTimeout(() => this._processNext(), 50);
    }
  }

  const requestQueue = new RequestQueue();

  // ── Config Management ───────────────────────────────────────

  /**
   * Load XMem config from chrome.storage.sync.
   * @returns {Promise<{apiUrl: string, apiKey: string, userId: string}>}
   */
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

  /**
   * Save XMem config to chrome.storage.sync.
   * @param {{apiUrl?: string, apiKey?: string, userId?: string}} config
   * @returns {Promise<void>}
   */
  async function saveConfig(config) {
    const data = {};
    if (config.apiUrl !== undefined) data[CONFIG_KEYS.apiUrl] = config.apiUrl;
    if (config.apiKey !== undefined) data[CONFIG_KEYS.apiKey] = config.apiKey;
    if (config.userId !== undefined) data[CONFIG_KEYS.userId] = config.userId;
    return chrome.storage.sync.set(data);
  }

  // ── HTTP Helpers ────────────────────────────────────────────

  /**
   * Make an authenticated fetch request to the XMem server.
   * Returns parsed JSON on success, null on network failure (enables fallback).
   *
   * @param {string} path - API path (e.g. "/v1/memory/ingest")
   * @param {object} options - { method, body, timeoutMs }
   * @returns {Promise<object|null>}
   */
  async function apiFetch(path, options = {}) {
    const config = await getConfig();
    const { method = "POST", body = null, timeoutMs = 30000 } = options;

    const url = `${config.apiUrl.replace(/\/+$/, "")}${path}`;

    const headers = {
      "Content-Type": "application/json",
    };
    if (config.apiKey) {
      headers["Authorization"] = `Bearer ${config.apiKey}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const resp = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!resp.ok) {
        const errBody = await resp.json().catch(() => ({}));
        console.warn(
          `[XMem Client] ${method} ${path} → ${resp.status}:`,
          errBody.error || resp.statusText
        );
        return null;
      }

      return await resp.json();
    } catch (err) {
      clearTimeout(timeoutId);

      if (err.name === "AbortError") {
        console.warn(`[XMem Client] ${method} ${path} → timeout (${timeoutMs}ms)`);
      } else {
        // Network error — server unreachable. This is expected when offline.
        // Don't spam the console — log at debug level.
        console.debug(`[XMem Client] ${method} ${path} → offline:`, err.message);
      }
      return null;
    }
  }

  // ── Public API ──────────────────────────────────────────────

  const XMemClient = {
    /**
     * Check if the XMem server is reachable and ready.
     * @returns {Promise<{connected: boolean, status: string, uptime: number|null}>}
     */
    async checkHealth() {
      const result = await apiFetch("/health", { method: "GET", timeoutMs: 5000 });
      if (!result) {
        return { connected: false, status: "offline", uptime: null };
      }
      const data = result.data || {};
      return {
        connected: data.pipelines_ready === true,
        status: data.status || "unknown",
        uptime: data.uptime_seconds || null,
      };
    },

    /**
     * Ingest a conversation turn into XMem long-term memory.
     * Queued to prevent concurrent graph updates.
     *
     * @param {string} userQuery - The user's message.
     * @param {string} agentResponse - The AI's reply.
     * @param {object} opts - { effortLevel: "low"|"high" }
     * @returns {Promise<object|null>} - XMem IngestResponse or null on failure.
     */
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

    /**
     * Search memories using raw semantic search (no LLM answer).
     *
     * @param {string} query - Search query.
     * @param {object} opts - { topK, domains }
     * @returns {Promise<{results: Array, total: number}|null>}
     */
    async searchMemories(query, opts = {}) {
      const config = await getConfig();
      const result = await requestQueue.enqueue(() =>
        apiFetch("/v1/memory/search", {
          body: {
            query,
            user_id: config.userId,
            domains: opts.domains || ["profile", "temporal", "summary"],
            top_k: opts.topK || 10,
          },
        })
      );

      if (!result || result.status === "error") return null;

      // Normalize response to match the shape ghost text / commands expect
      const data = result.data || {};
      return {
        results: (data.results || []).map((r) => ({
          content: r.content || "",
          domain: r.domain || "unknown",
          score: r.score || 0,
          metadata: r.metadata || {},
          // Map to the shape AxoltlMemory.search() returns
          userQuery: r.content,
          aiResponse: "",
          provider: r.domain,
          timestamp: Date.now(),
          source: "xmem-server",
        })),
        total: data.total || 0,
      };
    },

    /**
     * Retrieve an LLM-synthesized answer backed by stored memories.
     *
     * @param {string} query - The question to answer.
     * @param {object} opts - { topK }
     * @returns {Promise<{answer: string, sources: Array, confidence: number}|null>}
     */
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

      if (!result || result.status === "error") return null;

      const data = result.data || {};
      return {
        answer: data.answer || "",
        sources: (data.sources || []).map((s) => ({
          domain: s.domain,
          content: s.content,
          score: s.score,
          metadata: s.metadata || {},
        })),
        confidence: data.confidence || 0,
        model: data.model || "",
      };
    },

    /**
     * Get the current config (for UI display).
     * @returns {Promise<{apiUrl: string, apiKey: string, userId: string}>}
     */
    getConfig,

    /**
     * Save config (from popup settings).
     * @param {{apiUrl?: string, apiKey?: string, userId?: string}} config
     * @returns {Promise<void>}
     */
    saveConfig,
  };

  // ── Expose globally ─────────────────────────────────────────
  window.XMemClient = XMemClient;

  console.log("[XMem Client] Loaded — use window.XMemClient to access the API");
})();
