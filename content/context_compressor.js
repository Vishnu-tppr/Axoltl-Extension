/**
 * Axoltl — Context Compressor
 *
 * Replaces the naive .slice(0, 300) truncation with intelligent
 * context compression that preserves conversation meaning.
 *
 * Strategy:
 *   1. Keep the first message (topic/intent)
 *   2. Keep the last 4-6 messages (recent context)
 *   3. Summarize the middle with keyword extraction
 *   4. Format as a structured handoff prompt
 *
 * Output targets:
 *   - "inject" mode: ~2000 chars for DOM injection
 *   - "relay"  mode: ~8000 chars for encrypted relay bundles
 */

const AxoltlCompressor = {
  /**
   * Compress a session's messages into a handoff-ready context string.
   * @param {Array<{role:string, content:string}>} messages
   * @param {"inject"|"relay"} mode
   * @returns {string} Compressed context prompt
   */
  compress(messages, mode = "inject") {
    if (!Array.isArray(messages) || !messages.length) {
      return "Continue from transferred context.";
    }

    const charLimit = mode === "relay" ? 8000 : 2000;
    const recentCount = mode === "relay" ? 6 : 4;

    // If conversation is short enough, include everything
    const fullText = this._formatMessages(messages);
    if (fullText.length <= charLimit) {
      return this._buildPrompt(null, messages, null);
    }

    // Split into first / middle / recent
    const first = messages[0];
    const recent = messages.slice(-recentCount);
    const middle = messages.slice(1, -recentCount);

    // Extract topic from first message
    const topic = this._extractTopic(first);

    // Summarize middle section
    const middleSummary = middle.length > 0 ? this._summarizeMiddle(middle) : null;

    // Build the compressed prompt
    let prompt = this._buildPrompt(topic, recent, middleSummary);

    // If still too long, truncate individual messages
    if (prompt.length > charLimit) {
      const truncatedRecent = recent.map((m) => ({
        role: m.role,
        content: m.content.slice(0, Math.floor(charLimit / recentCount / 2)),
      }));
      prompt = this._buildPrompt(topic, truncatedRecent, middleSummary);
    }

    return prompt.slice(0, charLimit);
  },

  /**
   * Build a structured bundle object for relay/storage.
   * @param {Array<{role:string, content:string}>} messages
   * @param {string} provider
   * @returns {Object} Bundle with summary, recent messages, and metadata
   */
  buildBundle(messages, provider) {
    if (!Array.isArray(messages) || !messages.length) {
      return { summary: "", messages: [], provider, messageCount: 0 };
    }

    return {
      summary: this.compress(messages, "relay"),
      messages: messages.slice(-10), // Keep last 10 full messages for relay
      provider: provider || "unknown",
      messageCount: messages.length,
      compressedAt: Date.now(),
    };
  },

  // ── Internal helpers ───────────────────────────────────

  _extractTopic(message) {
    if (!message?.content) return "General conversation";
    const content = message.content.trim();

    // Take first sentence or first 150 chars
    const firstSentence = content.match(/^[^.!?\n]+[.!?]?/);
    if (firstSentence && firstSentence[0].length > 10) {
      return firstSentence[0].slice(0, 150);
    }
    return content.slice(0, 150);
  },

  _summarizeMiddle(messages) {
    if (!messages.length) return null;

    // Extract key terms using frequency analysis
    const wordCounts = {};
    const stopWords = new Set([
      "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
      "have", "has", "had", "do", "does", "did", "will", "would", "could",
      "should", "may", "might", "shall", "can", "to", "of", "in", "for",
      "on", "with", "at", "by", "from", "as", "into", "through", "during",
      "before", "after", "above", "below", "between", "and", "but", "or",
      "not", "no", "so", "if", "then", "than", "that", "this", "it", "its",
      "i", "you", "he", "she", "we", "they", "me", "my", "your", "his",
      "her", "our", "their", "what", "which", "who", "when", "where", "how",
      "all", "each", "every", "both", "few", "more", "most", "other", "some",
      "such", "only", "own", "same", "also", "just", "about", "up", "out",
      "very", "much", "still", "well", "here", "there", "now", "get", "got",
    ]);

    messages.forEach((m) => {
      const words = (m.content || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3 && !stopWords.has(w));

      words.forEach((w) => {
        wordCounts[w] = (wordCounts[w] || 0) + 1;
      });
    });

    // Get top 10 keywords
    const keywords = Object.entries(wordCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([word]) => word);

    if (!keywords.length) return null;

    const turnCount = messages.length;
    return `[${turnCount} earlier turns discussing: ${keywords.join(", ")}]`;
  },

  _formatMessages(messages) {
    return messages
      .map((m) => `${m.role === "user" ? "User" : "AI"}: ${m.content}`)
      .join("\n\n");
  },

  _buildPrompt(topic, recentMessages, middleSummary) {
    const parts = [];

    parts.push("I'm continuing a conversation from another AI assistant. Here's the context:\n");

    if (topic) {
      parts.push(`Topic: ${topic}\n`);
    }

    if (middleSummary) {
      parts.push(`${middleSummary}\n`);
    }

    if (recentMessages?.length) {
      parts.push("Recent exchange:");
      recentMessages.forEach((m) => {
        const label = m.role === "user" ? "User" : "AI";
        parts.push(`${label}: ${m.content}`);
      });
    }

    parts.push("\nPlease continue this conversation naturally. You have the context above.");

    return parts.join("\n");
  },
};

// Export for use by service_worker and content scripts
if (typeof window !== "undefined") {
  window.AxoltlCompressor = AxoltlCompressor;
}
