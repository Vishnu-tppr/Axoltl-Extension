/** Axoltl XMem Client — HTTP/Message-Passing client for AMC API. TypeScript conversion. */

interface XMemConfig {
  apiUrl: string;
  apiKey: string;
  userId: string;
}

interface FetchOptions {
  method?: string;
  body?: any;
  timeoutMs?: number;
  tag?: string | null;
}

interface QueueItem {
  fn: () => Promise<any>;
  tag: string | null;
  resolve: (v: any) => void;
  reject: (e: any) => void;
}

interface IngestOpts { effortLevel?: string; }
interface SearchOpts { domains?: string[]; topK?: number; }
interface RetrieveOpts { topK?: number; }

declare const chrome: any;

const DEFAULTS: XMemConfig = { apiUrl: 'http://localhost:8899', apiKey: '', userId: 'demo_user' };
const CONFIG_KEYS = { apiUrl: 'axoltlXMemApiUrl', apiKey: 'axoltlXMemApiKey', userId: 'axoltlXMemUserId' };

class RequestQueue {
  private _queue: QueueItem[] = [];
  private _processing = false;

  enqueue(fn: () => Promise<any>, tag: string | null = null): Promise<any> {
    if (tag === 'search') this._queue = this._queue.filter(item => item.tag !== 'search');
    return new Promise((resolve, reject) => {
      this._queue.push({ fn, tag, resolve, reject });
      if (!this._processing) this._processNext();
    });
  }

  private async _processNext() {
    if (this._queue.length === 0) { this._processing = false; return; }
    this._processing = true;
    const { fn, resolve, reject } = this._queue.shift()!;
    try { resolve(await fn()); } catch (err) { reject(err); }
    setTimeout(() => this._processNext(), 10);
  }
}

const requestQueue = new RequestQueue();

async function getConfig(): Promise<XMemConfig> {
  return new Promise(resolve => {
    chrome.storage.sync.get([CONFIG_KEYS.apiUrl, CONFIG_KEYS.apiKey, CONFIG_KEYS.userId], (res: any) => {
      resolve({
        apiUrl: res[CONFIG_KEYS.apiUrl] || DEFAULTS.apiUrl,
        apiKey: res[CONFIG_KEYS.apiKey] || DEFAULTS.apiKey,
        userId: res[CONFIG_KEYS.userId] || DEFAULTS.userId,
      });
    });
  });
}

async function saveConfig(config: Partial<XMemConfig>) {
  const data: Record<string, string> = {};
  if (config.apiUrl !== undefined) data[CONFIG_KEYS.apiUrl] = config.apiUrl;
  if (config.apiKey !== undefined) data[CONFIG_KEYS.apiKey] = config.apiKey;
  if (config.userId !== undefined) data[CONFIG_KEYS.userId] = config.userId;
  return chrome.storage.sync.set(data);
}

async function apiFetch(path: string, options: FetchOptions = {}): Promise<any> {
  const config = await getConfig();
  const { method = 'POST', body = null } = options;
  const url = `${config.apiUrl.replace(/\/+$/, '')}${path}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;
  return requestQueue.enqueue(async () => {
    const response = await chrome.runtime.sendMessage({
      action: 'XMEM_PROXY_FETCH',
      payload: { url, options: { method, headers, body } },
    });
    if (!response?.ok) throw new Error(response?.error || `XMem API Error: ${response?.status}`);
    return response.data;
  }, options.tag ?? null);
}

export const XMemClient = {
  async checkHealth() {
    const result = await apiFetch('/health', { method: 'GET' });
    if (!result) return { connected: false, status: 'offline' };
    const isReady = result.pipelines_ready === true || (result.data?.pipelines_ready === true);
    return { connected: isReady, status: result.status || result.data?.status || 'online', uptime: result.uptime_seconds || result.data?.uptime_seconds || 0 };
  },
  async ingestMemory(userQuery: string, agentResponse: string, opts: IngestOpts = {}) {
    const config = await getConfig();
    return apiFetch('/v1/memory/ingest', { body: { user_query: userQuery, agent_response: agentResponse || 'Acknowledged.', user_id: config.userId, effort_level: opts.effortLevel || 'low', session_datetime: new Date().toISOString() } });
  },
  async searchMemories(query: string, opts: SearchOpts = {}) {
    const config = await getConfig();
    const result = await apiFetch('/v1/memory/search', { tag: 'search', body: { query, user_id: config.userId, domains: opts.domains || ['profile','temporal','summary'], top_k: opts.topK || 5 } });
    if (!result || (result.status !== 'success' && result.status !== 'ok')) return null;
    return { results: (result.results || []).map((r: any) => ({ content: r.content || '', domain: r.domain || 'general', score: r.score || 0, metadata: r.metadata || {}, userQuery: r.user_query || '', aiResponse: r.agent_response || '', provider: r.domain, timestamp: r.timestamp || Date.now(), source: 'axoltl-amc' })), total: result.total || result.results?.length };
  },
  async retrieveAnswer(query: string, opts: RetrieveOpts = {}) {
    const config = await getConfig();
    const result = await apiFetch('/v1/memory/retrieve', { tag: 'search', body: { query, user_id: config.userId, top_k: opts.topK || 5 } });
    if (!result || (result.status !== 'success' && result.status !== 'ok') || !result.data) return null;
    return { answer: result.data.answer || '', sources: (result.data.sources || []).map((s: any) => ({ domain: s.domain, content: s.content, score: s.score, metadata: s.metadata || {} })), confidence: result.data.confidence || 0, model: result.data.model || 'AMC-MODEL', steps: result.data.steps || [] };
  },
  async codeQuery(repo: string, query: string, opts: { topK?: number } = {}) {
    const config = await getConfig();
    return apiFetch('/v1/code/query', { body: { org_id: 'default', repo, query, user_id: config.userId, top_k: opts.topK || 5 } });
  },
  async codeQueryStream(repo: string, query: string, opts: { topK?: number } = {}) {
    const config = await getConfig();
    const url = `${config.apiUrl.replace(/\/+$/, '')}/v1/code/query_stream`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey}`;
    return fetch(url, { method: 'POST', headers, body: JSON.stringify({ org_id: 'default', repo, query, user_id: config.userId, top_k: opts.topK || 5 }) });
  },
  async getDirectoryTree(repo: string, orgId = 'default') {
    return apiFetch(`/v1/code/directory-tree?org_id=${encodeURIComponent(orgId)}&repo=${encodeURIComponent(repo)}`, { method: 'GET' });
  },
  async listRepos(orgId = 'default') {
    return apiFetch(`/v1/code/repos?org_id=${encodeURIComponent(orgId)}`, { method: 'GET' });
  },
  async verifyApiKey() { return apiFetch('/auth/verify-key', { method: 'GET' }); },
  getConfig, saveConfig,
};

(window as any).XMemClient = XMemClient;