import { llmChat } from '../providers/index.js';

const CHARS_PER_TOKEN = 4;
const COMPRESS_THRESHOLD = 0.7;

export class ContextCompressor {
  constructor(maxTokens = 8000) {
    this.maxTokens = maxTokens;
    this.messages = [];
    this.compressed = [];
  }

  addMessage(role, content) {
    this.messages.push({ role, content, timestamp: Date.now() });
    return this;
  }

  getHistory() {
    if (this.needsCompression()) {
      this.compress();
    }
    return this.compressed.length > 0 ? this.compressed : this.messages;
  }

  needsCompression() {
    return this.getTokenCount() > this.maxTokens * COMPRESS_THRESHOLD;
  }

  getTokenCount() {
    const total = this.messages.reduce((sum, m) => sum + this.countTokens(m.content), 0);
    return total;
  }

  countTokens(text) {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }

  compress() {
    this._microCompress();
    if (this.getTokenCount() > this.maxTokens * COMPRESS_THRESHOLD) {
      this._trimmedCompress();
    }
    if (this.getTokenCount() > this.maxTokens * COMPRESS_THRESHOLD) {
      this._reactiveCompress();
    }
    if (this.getTokenCount() > this.maxTokens) {
      this._hardTrim();
    }
    return this.compressed;
  }

  _microCompress() {
    this.compressed = this.messages.map(m => ({
      ...m,
      content: m.content
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]+$/gm, '')
        .replace(/^\s+/, '')
        .trim()
    }));
  }

  _trimmedCompress() {
    const totalTokens = this.getTokenCount();
    const targetTokens = this.maxTokens * 0.6;
    const excessTokens = totalTokens - targetTokens;

    if (excessTokens <= 0) {
      this.compressed = [...this.compressed];
      return;
    }

    const keepRecent = Math.max(2, Math.ceil(this.compressed.length * 0.2));
    const recent = this.compressed.slice(-keepRecent);
    const older = this.compressed.slice(0, -keepRecent);

    let removedTokens = 0;
    const filtered = older.filter(m => {
      if (m.role === 'system') return true;
      if (this._hasCodeBlock(m.content)) return true;
      if (removedTokens >= excessTokens) return true;

      const isFiller = this._isConversationalFiller(m.content);
      if (isFiller) {
        removedTokens += this.countTokens(m.content);
        return false;
      }
      return true;
    });

    this.compressed = [...filtered, ...recent];
  }

  async _reactiveCompress() {
    const keepRecent = Math.max(2, Math.ceil(this.compressed.length * 0.15));
    const recent = this.compressed.slice(-keepRecent);
    const systemMsgs = this.compressed.filter(m => m.role === 'system');
    const older = this.compressed.slice(0, -keepRecent).filter(m => m.role !== 'system');

    const codeBlocks = older.filter(m => this._hasCodeBlock(m.content));
    const nonCode = older.filter(m => !this._hasCodeBlock(m.content));

    if (nonCode.length > 3) {
      try {
        const summary = await this._summarizeWithAI(nonCode);
        const summaryMsg = {
          role: 'system',
          content: `[Compressed conversation history]\n${summary}`,
          compressed: true
        };
        this.compressed = [...systemMsgs, summaryMsg, ...codeBlocks, ...recent];
      } catch (err) {
        console.warn(`[ContextCompressor] AI summarization failed: ${err.message}`);
        this.compressed = [...systemMsgs, ...codeBlocks, ...recent];
      }
    } else {
      this.compressed = [...systemMsgs, ...codeBlocks, ...recent];
    }
  }

  async _summarizeWithAI(messages) {
    const text = messages
      .map(m => `${m.role}: ${m.content.slice(0, 500)}`)
      .join('\n\n');

    const response = await llmChat([
      {
        role: 'system',
        content: 'Summarize this conversation history concisely. Preserve key decisions, code patterns, and facts. Drop conversational filler. Keep it under 500 words.'
      },
      {
        role: 'user',
        content: `Summarize this conversation:\n\n${text}`
      }
    ], { maxTokens: 1024 });

    return response.content;
  }

  _hardTrim() {
    const keepRecent = 3;
    const systemMsgs = this.compressed.filter(m => m.role === 'system');
    const recent = this.compressed.filter(m => m.role !== 'system').slice(-keepRecent);
    this.compressed = [...systemMsgs, ...recent];
  }

  _hasCodeBlock(content) {
    return /```/.test(content);
  }

  _isConversationalFiller(content) {
    const trimmed = content.trim().toLowerCase();
    const fillerPatterns = [
      /^sure,?\s/i,
      /^okay,?\s/i,
      /^thanks?\s/i,
      /^great!\s?$/i,
      /^let me\s/i,
      /^i'll\s/i,
      /^here (is|are|we go)/i,
      /^sounds?\s/i,
      /^no problem/i,
      /^of course/i,
      /^absolutely/i,
      /^definitely/i,
      /^i understand/i,
      /^i can help/i,
      /^i'd be happy/i,
      /^i'm sorry/i,
      /^that'?s (a |an |great |good |interesting )/i,
      /^that makes sense/i,
      /^you'?re (right|welcome)/i,
      /^feel free/i,
      /^happy to help/i,
      /^let'?s (get started|dive in|begin)/i,
    ];

    return fillerPatterns.some(pattern => pattern.test(trimmed));
  }

  clear() {
    this.messages = [];
    this.compressed = [];
  }

  getMessageCount() {
    return this.messages.length;
  }
}

export default ContextCompressor;
