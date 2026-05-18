/** Axoltl Memory Injector — Injects retrieved AMC context into provider prompt fields. TS conversion. */
import { searchMemory } from './memory_engine';
declare const chrome: any;

export async function injectMemoryContext(context: string, provider: string) {
  const inject = (window as any).AxoltlInjector?.injectContext;
  if (inject) return inject(context, provider);
  // Fallback inline injection
  const { injectContext } = await import('../lib/provider_injector');
  return injectContext(context, provider);
}

export async function wrapAndSend(editor: HTMLElement, originalText: string) {
  const memories = await searchMemory(originalText, 3);
  if (!memories.length) return false;
  const ctxTag = memories.map(m => `<xmem domain="${m.domain}" score="${m.score.toFixed(2)}">${m.content}</xmem>`).join('\n');
  const wrapped = `${originalText}\n\n<!-- Context from XMem -->\n${ctxTag}`;
  if (editor instanceof HTMLTextAreaElement) {
    editor.value = wrapped;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    editor.focus();
    editor.textContent = wrapped;
  }
  // Async scrub the tags from visible transcript after send
  setTimeout(() => scrubInjectedTags(), 5000);
  return true;
}

function scrubInjectedTags() {
  document.querySelectorAll('.xmem-tag, [data-xmem-injected]').forEach(el => el.remove());
  // Also remove any raw xmem tags in visible text
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    if (node.textContent?.includes('<xmem ')) nodes.push(node);
  }
  nodes.forEach(n => {
    n.textContent = n.textContent?.replace(/<xmem[^>]*>[\s\S]*?<\/xmem>/gi, '') || n.textContent;
  });
}

(window as any).AxoltlMemoryInjector = { injectMemoryContext, wrapAndSend };