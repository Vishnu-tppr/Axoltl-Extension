/** Axoltl Memory Engine — Search orchestrator. TS conversion. */
import { XMemClient } from '../lib/xmem_client';
declare const chrome: any;

export interface SourceRecord {
  content: string;
  domain: string;
  score: number;
  metadata?: Record<string, any>;
}

export async function searchMemory(query: string, topK = 5): Promise<SourceRecord[]> {
  try {
    const resp = await XMemClient.searchMemories(query, { topK });
    if (!resp?.results) return [];
    return resp.results.map((r: any) => ({ content: r.content || '', domain: r.domain || 'general', score: r.score || 0, metadata: r.metadata || {} }));
  } catch { return []; }
}

export async function ingestMemory(userQuery: string, agentResponse: string, effortLevel = 'low'): Promise<boolean> {
  try {
    await XMemClient.ingestMemory(userQuery, agentResponse, { effortLevel });
    return true;
  } catch { return false; }
}

export async function getHealthStatus(): Promise<{ connected: boolean; status: string }> {
  return XMemClient.checkHealth();
}

(window as any).AxoltlMemoryEngine = { searchMemory, ingestMemory, getHealthStatus };