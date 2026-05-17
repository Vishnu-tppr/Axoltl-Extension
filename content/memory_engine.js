/**
 * Axoltl Memory Engine — Hybrid memory using XMem server + IndexedDB fallback.
 *
 * Primary: XMem server (semantic search, LLM retrieval, multi-domain classification).
 * Fallback: Local IndexedDB + BM25-lite (offline-capable, keyword search).
 * Provides: ingest, search, retrieve, stats, export, import, clear, isServerConnected.
 */

(function axoltlMemoryEngine() {
  "use strict";

  const DB_NAME = "axoltl-memory";
  const DB_VERSION = 1;
  const STORE_MEMORIES = "memories";
  const STORE_META = "meta";
  const MAX_MEMORIES = 5000;

  // BM25 parameters
  const BM25_K1 = 1.2;
  const BM25_B = 0.75;

  const STOP_WORDS = new Set([
    "the","a","an","is","are","was","were","be","been","being","have","has","had",
    "do","does","did","will","would","could","should","shall","may","might","can",
    "to","of","in","for","on","with","at","by","from","as","and","but","or","not",
    "no","so","if","then","than","that","this","it","its","i","you","he","she","we",
    "they","me","my","your","his","her","our","their","what","which","who","when",
    "where","how","all","just","about","very","also","get","got","each","every",
    "more","most","other","some","such","only","own","same","too","up","out","now",
    "new","one","two","way","even","back","know","take","make","like","them","him",
    "into","over","after","think","well","here","much","still","any","through",
    "these","those","use","been","many","said","come","could","see","say"
  ]);

  let db = null;

  // ── IndexedDB Setup ─────────────────────────────────────

  function openDB() {
    return new Promise((resolve, reject) => {
      if (db) { resolve(db); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const database = e.target.result;

        if (!database.objectStoreNames.contains(STORE_MEMORIES)) {
          const store = database.createObjectStore(STORE_MEMORIES, {
            keyPath: "id",
            autoIncrement: true,
          });
          store.createIndex("by-hash", "hash", { unique: true });
          store.createIndex("by-timestamp", "timestamp", { unique: false });
          store.createIndex("by-provider", "provider", { unique: false });
          store.createIndex("by-keywords", "keywords", {
            unique: false,
            multiEntry: true,
          });
        }

        if (!database.objectStoreNames.contains(STORE_META)) {
          database.createObjectStore(STORE_META, { keyPath: "key" });
        }
      };

      req.onsuccess = (e) => {
        db = e.target.result;
        resolve(db);
      };

      req.onerror = (e) => {
        console.error("[Axoltl Memory] DB open failed:", e.target.error);
        reject(e.target.error);
      };
    });
  }

  // ── Text Processing ─────────────────────────────────────

  function tokenize(text) {
    return (text || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s'-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  }

  function extractKeywords(text) {
    const tokens = tokenize(text);
    const freq = {};
    tokens.forEach((t) => { freq[t] = (freq[t] || 0) + 1; });
    // Return top 30 keywords by frequency
    return Object.entries(freq)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 30)
      .map(([w]) => w);
  }

  async function contentHash(text) {
    // SHA-256 hash of first 256 chars for deduplication
    const data = new TextEncoder().encode((text || "").slice(0, 256));
    const hashBuf = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 32);
  }

  // ── BM25-Lite Scoring ───────────────────────────────────

  function scoreBM25(queryTokens, docKeywords, docLen, avgDocLen, N, dfMap) {
    let score = 0;
    const docFreq = {};
    docKeywords.forEach((w) => { docFreq[w] = (docFreq[w] || 0) + 1; });

    for (const term of queryTokens) {
      const tf = docFreq[term] || 0;
      if (tf === 0) continue;

      const df = dfMap[term] || 1;
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
      const tfNorm =
        (tf * (BM25_K1 + 1)) /
        (tf + BM25_K1 * (1 - BM25_B + BM25_B * (docLen / avgDocLen)));
      score += idf * tfNorm;
    }
    return score;
  }

  // ── Core API ────────────────────────────────────────────

  // Track server connectivity
  let _serverConnected = false;
  let _lastHealthCheck = 0;
  const HEALTH_CHECK_INTERVAL = 60000; // 1 minute

  let _lastSyncTriggered = false;

  async function checkServerHealth() {
    if (!window.XMemClient) {
      _serverConnected = false;
      return false;
    }
    const now = Date.now();
    if (now - _lastHealthCheck < HEALTH_CHECK_INTERVAL) {
      return _serverConnected;
    }
    try {
      const health = await window.XMemClient.checkHealth();
      const prev = _serverConnected;
      _serverConnected = health.connected;
      _lastHealthCheck = now;

      // Trigger sync if we just connected
      if (_serverConnected && !prev && !_lastSyncTriggered) {
        _lastSyncTriggered = true;
        AxoltlMemory.syncAllLocalMemories().catch(() => {});
      }
    } catch (e) {
      _serverConnected = false;
    }
    return _serverConnected;
  }

  const AxoltlMemory = {
    /**
     * Initialize the memory engine.
     */
    async init() {
      await openDB();
      // Check server connectivity on init (non-blocking)
      checkServerHealth().then((connected) => {
        console.log(`[Axoltl Memory] Initialized — server: ${connected ? "connected" : "local-only"}`);
      });
    },

    /**
     * Returns whether the XMem server is currently reachable.
     * @returns {Promise<boolean>}
     */
    async isServerConnected() {
      return checkServerHealth();
    },

    /**
     * Ingest a conversation turn into local memory.
     * @param {string} userQuery - The user's message
     * @param {string} aiResponse - The AI's response
     * @param {object} metadata - { provider, url, source }
     */
    async ingest(userQuery, aiResponse = "", metadata = {}) {
      const combined = `${userQuery}\n${aiResponse}`.trim();
      if (combined.length < 10) return null;

      // ── Try XMem server first ──────────────────────────────
      if (window.XMemClient && (await checkServerHealth())) {
        try {
          const serverResult = await window.XMemClient.ingestMemory(
            userQuery,
            aiResponse,
            { effortLevel: metadata.effortLevel || "low" }
          );
          if (serverResult) {
            console.log("[Axoltl Memory] Ingested via XMem server:", userQuery.slice(0, 50));
            // Also save locally for offline access, marked as synced
            this._ingestLocal(userQuery, aiResponse, { ...metadata, synced: true }).catch(() => {});
            return serverResult;
          }
        } catch (e) {
          console.warn("[Axoltl Memory] Server ingest failed, falling back to local:", e.message);
        }
      }

      // ── Fallback: Local IndexedDB ──────────────────────────
      return this._ingestLocal(userQuery, aiResponse, metadata);
    },

    /** @private Local IndexedDB ingest (original implementation). */
    async _ingestLocal(userQuery, aiResponse = "", metadata = {}) {
      const database = await openDB();
      const combined = `${userQuery}\n${aiResponse}`.trim();
      if (combined.length < 10) return null;

      const hash = await contentHash(combined);
      const keywords = extractKeywords(combined);
      const provider =
        metadata.provider || detectProvider() || "unknown";

      const record = {
        userQuery: userQuery.slice(0, 2000),
        aiResponse: (aiResponse || "").slice(0, 4000),
        keywords,
        hash,
        provider,
        source: metadata.source || "auto",
        url: metadata.url || window.location.href,
        timestamp: Date.now(),
        synced: !!metadata.synced,
      };

      return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_MEMORIES, "readwrite");
        const store = tx.objectStore(STORE_MEMORIES);

        // Check dedup via hash index
        const hashIdx = store.index("by-hash");
        const check = hashIdx.get(hash);

        check.onsuccess = () => {
          if (check.result) {
            resolve(null);
            return;
          }

          const addReq = store.add(record);
          addReq.onsuccess = () => {
            console.log("[Axoltl Memory] Ingested locally:", record.userQuery.slice(0, 50));
            resolve(record);
            trimOldRecords(database);
          };
          addReq.onerror = (e) => {
            if (e.target.error?.name === "ConstraintError") {
              resolve(null);
            } else {
              reject(e.target.error);
            }
          };
        };

        check.onerror = () => {
          const addReq = store.add(record);
          addReq.onsuccess = () => resolve(record);
          addReq.onerror = () => resolve(null);
        };
      });
    },

    /**
     * Search memories using BM25-lite scoring.
     * @param {string} query - Search query
     * @param {number} topK - Number of results to return
     * @returns {Array<{content, score, provider, timestamp}>}
     */
    async search(query, topK = 5) {
      // ── Try XMem server first ──────────────────────────────
      if (window.XMemClient && (await checkServerHealth())) {
        try {
          const serverResult = await window.XMemClient.searchMemories(query, { topK });
          if (serverResult && serverResult.results && serverResult.results.length > 0) {
            console.log(`[Axoltl Memory] Server search returned ${serverResult.results.length} results`);
            return serverResult.results;
          }
        } catch (e) {
          console.warn("[Axoltl Memory] Server search failed, falling back to local:", e.message);
        }
      }

      // ── Fallback: Local BM25 search ────────────────────────
      return this._searchLocal(query, topK);
    },

    /** @private Local BM25 search (original implementation). */
    async _searchLocal(query, topK = 5) {
      const database = await openDB();
      const queryTokens = tokenize(query);
      if (!queryTokens.length) return [];

      const allMemories = await getAllMemories(database);
      if (!allMemories.length) return [];

      const dfMap = {};
      allMemories.forEach((m) => {
        const seen = new Set(m.keywords || []);
        seen.forEach((w) => { dfMap[w] = (dfMap[w] || 0) + 1; });
      });

      const N = allMemories.length;
      const totalKeywords = allMemories.reduce(
        (sum, m) => sum + (m.keywords?.length || 0),
        0
      );
      const avgDocLen = totalKeywords / N;

      const scored = allMemories.map((m) => ({
        memory: m,
        score: scoreBM25(
          queryTokens,
          m.keywords || [],
          (m.keywords || []).length,
          avgDocLen,
          N,
          dfMap
        ),
      }));

      return scored
        .filter((s) => s.score > 0.3)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
        .map((s) => ({
          content: s.memory.userQuery +
            (s.memory.aiResponse ? "\n" + s.memory.aiResponse : ""),
          userQuery: s.memory.userQuery,
          aiResponse: s.memory.aiResponse,
          score: Math.round(s.score * 100) / 100,
          provider: s.memory.provider,
          timestamp: s.memory.timestamp,
          source: s.memory.source,
        }));
    },

    /**
     * Retrieve a synthesized summary from top memory matches.
     * @param {string} query - Query to answer
     * @returns {{ answer: string, sources: Array }}
     */
    async retrieve(query) {
      // ── Try XMem server first (LLM-synthesized answer) ─────
      if (window.XMemClient && (await checkServerHealth())) {
        try {
          const serverResult = await window.XMemClient.retrieveAnswer(query, { topK: 5 });
          if (serverResult && serverResult.answer) {
            console.log(`[Axoltl Memory] Server retrieve: confidence=${serverResult.confidence}`);
            return {
              answer: serverResult.answer,
              sources: serverResult.sources || [],
              confidence: serverResult.confidence || 0,
              model: serverResult.model || "",
              fromServer: true,
            };
          }
        } catch (e) {
          console.warn("[Axoltl Memory] Server retrieve failed, falling back to local:", e.message);
        }
      }

      // ── Fallback: Local concatenation-based answer ─────────
      const results = await this._searchLocal(query, 3);
      if (!results.length) {
        return { answer: "", sources: [], fromServer: false };
      }

      const parts = results.map((r) => {
        if (r.aiResponse && r.aiResponse.length > 20) {
          return r.aiResponse.slice(0, 200);
        }
        return r.userQuery.slice(0, 150);
      });

      const answer = parts.join(" ... ");

      return {
        answer: answer.slice(0, 300),
        sources: results,
        fromServer: false,
      };
    },

    /**
     * Get memory statistics.
     */
    async getStats() {
      const database = await openDB();
      const all = await getAllMemories(database);
      if (!all.length) {
        return { totalMemories: 0, oldestDate: null, newestDate: null, byProvider: {} };
      }

      const byProvider = {};
      let oldest = Infinity;
      let newest = 0;

      all.forEach((m) => {
        byProvider[m.provider] = (byProvider[m.provider] || 0) + 1;
        if (m.timestamp < oldest) oldest = m.timestamp;
        if (m.timestamp > newest) newest = m.timestamp;
      });

      return {
        totalMemories: all.length,
        oldestDate: new Date(oldest).toLocaleDateString(),
        newestDate: new Date(newest).toLocaleDateString(),
        byProvider,
      };
    },

    /**
     * Export all memories as JSON.
     */
    async export() {
      const database = await openDB();
      const all = await getAllMemories(database);
      return {
        version: 1,
        exportedAt: new Date().toISOString(),
        count: all.length,
        memories: all,
      };
    },

    /**
     * Import memories from a JSON export.
     */
    async import(data) {
      if (!data?.memories?.length) throw new Error("Invalid import data");
      const database = await openDB();
      let imported = 0;

      for (const m of data.memories) {
        try {
          await this.ingest(m.userQuery || m.content || "", m.aiResponse || "", {
            provider: m.provider,
            source: m.source || "import",
          });
          imported++;
        } catch (e) {
          // Skip duplicates
        }
      }
      return { imported, total: data.memories.length };
    },

    /**
     * Clear all memories.
     */
    async clear() {
      const database = await openDB();
      return new Promise((resolve, reject) => {
        const tx = database.transaction(STORE_MEMORIES, "readwrite");
        const store = tx.objectStore(STORE_MEMORIES);
        const req = store.clear();
        req.onsuccess = () => {
          console.log("[Axoltl Memory] All memories cleared");
          resolve();
        };
        req.onerror = (e) => reject(e.target.error);
      });
    },

    /**
     * Sync all local unsynced memories to the XMem server.
     */
    async syncAllLocalMemories() {
      if (!window.XMemClient || !(await checkServerHealth())) return 0;
      
      console.log("[Axoltl Memory] Starting memory sync...");
      const database = await openDB();
      const memories = await getAllMemories(database);

      let syncCount = 0;
      for (const m of memories) {
        if (m.synced) continue;
        
        try {
          await window.XMemClient.ingestMemory(m.userQuery, m.aiResponse, {
            effortLevel: "medium"
          });
          
          // Mark as synced in DB
          const tx = database.transaction(STORE_MEMORIES, "readwrite");
          const store = tx.objectStore(STORE_MEMORIES);
          await new Promise((res) => {
            const req = store.put({ ...m, synced: true });
            req.onsuccess = res;
          });
          syncCount++;
        } catch (e) {
          console.warn("[Axoltl Memory] Sync failed for item:", m.id, e);
          break; // Stop if server goes away
        }
      }
      
      if (syncCount > 0) {
        console.log(`[Axoltl Memory] Sync complete. Pushed ${syncCount} items.`);
      }
      return syncCount;
    },
  };

  // ── Helpers ─────────────────────────────────────────────

  function getAllMemories(database) {
    return new Promise((resolve, reject) => {
      const tx = database.transaction(STORE_MEMORIES, "readonly");
      const store = tx.objectStore(STORE_MEMORIES);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  function trimOldRecords(database) {
    const tx = database.transaction(STORE_MEMORIES, "readwrite");
    const store = tx.objectStore(STORE_MEMORIES);
    const countReq = store.count();

    countReq.onsuccess = () => {
      if (countReq.result <= MAX_MEMORIES) return;

      const toDelete = countReq.result - MAX_MEMORIES;
      const idx = store.index("by-timestamp");
      const cursor = idx.openCursor();
      let deleted = 0;

      cursor.onsuccess = (e) => {
        const c = e.target.result;
        if (c && deleted < toDelete) {
          c.delete();
          deleted++;
          c.continue();
        }
      };
    };
  }

  function detectProvider() {
    const h = window.location.hostname;
    if (h.includes("claude.ai")) return "claude";
    if (h.includes("chatgpt.com") || h.includes("openai.com")) return "chatgpt";
    if (h.includes("gemini.google.com")) return "gemini";
    if (h.includes("perplexity.ai")) return "perplexity";
    return "unknown";
  }

  // ── Expose globally ─────────────────────────────────────

  window.AxoltlMemory = AxoltlMemory;

  // Auto-initialize
  AxoltlMemory.init().catch((e) => {
    console.error("[Axoltl Memory] Init failed:", e);
  });

  // Load enabled state from storage
  window.axoltlMemoryEnabled = true;
  chrome.storage.local.get(["axoltlMemoryEnabled"], (res) => {
    if (res.axoltlMemoryEnabled !== undefined) {
      window.axoltlMemoryEnabled = res.axoltlMemoryEnabled !== false;
    }
  });
  chrome.storage.onChanged.addListener((changes, ns) => {
    if (ns === "local" && changes.axoltlMemoryEnabled) {
      window.axoltlMemoryEnabled = changes.axoltlMemoryEnabled.newValue !== false;
    }
  });
})();
