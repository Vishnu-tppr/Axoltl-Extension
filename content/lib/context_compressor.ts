/** Axoltl Context Compressor — TF-IDF 3-pass text compression. TS conversion. */

interface Message { role: string; content: string; }

export function compress(messages: Message[], mode: 'inject' | 'relay' = 'inject'): string {
  if (!messages?.length) return 'Continue from transferred context.';
  const charLimit = mode === 'relay' ? 8000 : 2000;
  const recentCount = mode === 'relay' ? 6 : 4;
  const fullText = messages.map(m => `${m.role}: ${m.content}`).join('\n');
  if (fullText.length <= charLimit) return buildPrompt(null, messages, null);
  const first = messages[0];
  const recent = messages.slice(-recentCount);
  const middle = messages.slice(1, -recentCount);
  const topic = extractTopic(first);
  const midSummary = middle.length > 0 ? summarizeMiddle(middle) : null;
  let prompt = buildPrompt(topic, recent, midSummary);
  if (prompt.length > charLimit) {
    const trunc = recent.map(m => ({ role: m.role, content: m.content.slice(0, Math.floor(charLimit / recentCount / 2)) }));
    prompt = buildPrompt(topic, trunc, midSummary);
  }
  return prompt.slice(0, charLimit);
}

function extractTopic(msg: Message): string {
  if (!msg?.content) return 'General conversation';
  const c = msg.content.trim();
  const s = c.match(/^[^.!?\n]+[.!?]?/);
  return ((s && s[0].length > 10 ? s[0] : c) || '').slice(0, 150);
}

function summarizeMiddle(messages: Message[]): string | null {
  const stopWords = new Set(['the','a','an','is','are','was','were','be','have','has','had','do','does','did','will','would','could','should','to','of','in','for','on','with','at','by','from','as','and','but','or','not','no','so','if','then','than','that','this','it','its','i','you','he','she','we','they','me','my','your','what','which','who','when','where','how','all','just','about','very','also','get','got']);
  const counts: Record<string, number> = {};
  messages.forEach(m => {
    (m.content || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(w => w.length > 3 && !stopWords.has(w))
      .forEach(w => { counts[w] = (counts[w] || 0) + 1; });
  });
  const kw = Object.entries(counts).sort(([, a], [, b]) => b - a).slice(0, 10).map(([w]) => w);
  return kw.length ? `[${messages.length} earlier turns discussing: ${kw.join(', ')}]` : null;
}

function buildPrompt(topic: string | null, recent: Message[] | null, mid: string | null): string {
  const p: string[] = []; p.push("I'm continuing a conversation from another AI assistant. Here's the context:\n");
  if (topic) p.push(`Topic: ${topic}\n`);
  if (mid) p.push(`${mid}\n`);
  if (recent?.length) {
    p.push('Recent exchange:');
    recent.forEach(m => p.push(`${m.role === 'user' ? 'User' : 'AI'}: ${m.content}`));
  }
  p.push('\nPlease continue this conversation naturally. You have the context above.');
  return p.join('\n');
}

(window as any).CompressorSW = { compress };