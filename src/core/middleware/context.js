import { llmChat } from '../providers/index.js';

export class ContextManager {
  constructor(maxTokens = 8000) {
    this.maxTokens = maxTokens;
    this.messages = [];
    this.summary = '';
    this.summaryThreshold = 0.7;
    this.codeSnippetRegex = /```[\s\S]*?```/g;
  }

  countTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  countTotalTokens() {
    const msgTokens = this.messages.reduce((sum, m) => {
      return sum + this.countTokens(m.content) + 4;
    }, 0);
    return msgTokens + this.countTokens(this.summary);
  }

  addMessage(role, content) {
    this.messages.push({ role, content, timestamp: Date.now() });
  }

  extractKeyInfo(messages) {
    const keyItems = [];
    for (const msg of messages) {
      const snippets = msg.content.match(this.codeSnippetRegex);
      if (snippets) {
        for (const snippet of snippets) {
          keyItems.push(snippet);
        }
      }
      const decisionMatch = msg.content.match(/(?:decision|decided|chose|using|approach|strategy|plan):\s*([^\n]+)/gi);
      if (decisionMatch) {
        keyItems.push(...decisionMatch);
      }
    }
    return keyItems;
  }

  async summarize(messages) {
    if (!messages || messages.length === 0) return '';
    const text = messages.map(m => `[${m.role}]: ${m.content}`).join('\n\n');
    const keyItems = this.extractKeyInfo(messages);
    const keyContext = keyItems.length > 0
      ? `\n\nKey items to preserve:\n${keyItems.join('\n')}`
      : '';

    try {
      const result = await llmChat([
        {
          role: 'system',
          content: 'You are a conversation summarizer. Create a concise summary preserving: key decisions, code snippets, architecture choices, and important context. Be brief but complete. Return only the summary text.'
        },
        {
          role: 'user',
          content: `Summarize this conversation history, preserving critical information:${keyContext}\n\nConversation:\n${text.slice(0, 6000)}`
        }
      ], { provider: process.env.CONTEXT_PROVIDER || 'ollama' });

      const newSummary = result.content.trim();
      if (this.summary) {
        this.summary = this.summary + '\n\n' + newSummary;
      } else {
        this.summary = newSummary;
      }
      return this.summary;
    } catch (err) {
      const fallbackSummary = messages
        .map(m => `[${m.role}] ${m.content.slice(0, 100)}`)
        .join('\n');
      if (this.summary) {
        this.summary += '\n\n' + fallbackSummary;
      } else {
        this.summary = fallbackSummary;
      }
      return this.summary;
    }
  }

  getSummary() {
    return this.summary;
  }

  async getHistory() {
    const totalTokens = this.countTotalTokens();
    const threshold = this.maxTokens * this.summaryThreshold;

    if (totalTokens > threshold) {
      const excessTokens = totalTokens - (this.maxTokens * 0.5);
      let tokensToRemove = 0;
      let compressFrom = 0;

      for (let i = 0; i < this.messages.length; i++) {
        const msgTokens = this.countTokens(this.messages[i].content) + 4;
        tokensToRemove += msgTokens;
        if (tokensToRemove >= excessTokens) {
          compressFrom = i + 1;
          break;
        }
      }

      if (compressFrom > 0) {
        const oldMessages = this.messages.slice(0, compressFrom);
        await this.summarize(oldMessages);
        this.messages = this.messages.slice(compressFrom);
      }
    }

    return this.messages;
  }

  compress() {
    const totalTokens = this.countTotalTokens();
    if (totalTokens <= this.maxTokens) return this.messages;

    const targetTokens = this.maxTokens * 0.6;
    let kept = [];
    let currentTokens = 0;

    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];
      const msgTokens = this.countTokens(msg.content) + 4;
      if (currentTokens + msgTokens <= targetTokens) {
        kept.unshift(msg);
        currentTokens += msgTokens;
      } else {
        break;
      }
    }

    return kept;
  }

  toJSON() {
    return {
      messages: this.messages,
      summary: this.summary,
      totalTokens: this.countTotalTokens()
    };
  }

  static fromJSON(data) {
    const manager = new ContextManager(data.maxTokens || 8000);
    manager.messages = data.messages || [];
    manager.summary = data.summary || '';
    return manager;
  }

  clear() {
    this.messages = [];
    this.summary = '';
  }
}

export default { ContextManager };
