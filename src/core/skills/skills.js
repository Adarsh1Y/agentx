import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';

const BUILT_IN_SKILLS = [
  {
    name: 'commit',
    description: 'Review changes and create git commit',
    trigger: ['commit', 'git commit', 'save changes', 'commit changes'],
    prompt: `You are a git commit assistant. Review the following changes and create a well-structured commit message.

Rules:
- Use conventional commit format (feat, fix, docs, style, refactor, test, chore)
- Write a clear, concise subject line (max 72 chars)
- Include a body if the changes are complex
- Review the diff for any issues before committing

User input: {input}

First, review the current git status and diff. Then propose a commit message and execute the commit.`
  },
  {
    name: 'review',
    description: 'Code review with suggestions',
    trigger: ['review', 'code review', 'review code', 'check my code', 'look over'],
    prompt: `You are a thorough code reviewer. Analyze the code provided and give constructive feedback.

Review checklist:
1. Bugs and logic errors
2. Security vulnerabilities
3. Performance issues
4. Code style and readability
5. Error handling
6. Edge cases
7. Documentation

Be specific with line references and provide concrete improvement suggestions.

User input: {input}`
  },
  {
    name: 'explain',
    description: 'Explain code in detail',
    trigger: ['explain', 'what does', 'how does', 'explain this', 'walk through', 'describe'],
    prompt: `You are a code explanation expert. Break down the code in a clear, educational way.

For each section:
1. State what it does in plain language
2. Explain the key logic or algorithm
3. Point out any notable patterns or techniques
4. Highlight potential gotchas or edge cases

Use analogies when helpful. Keep explanations accessible but technically accurate.

User input: {input}`
  },
  {
    name: 'refactor',
    description: 'Refactor code with best practices',
    trigger: ['refactor', 'clean up', 'improve code', 'optimize', 'restructure', 'rewrite'],
    prompt: `You are a refactoring expert. Improve the code while preserving its behavior.

Refactoring priorities:
1. Reduce complexity and duplication
2. Improve readability and naming
3. Apply design patterns where appropriate
4. Separate concerns
5. Add missing error handling
6. Follow language/framework best practices

Explain what you changed and why. Preserve all existing functionality.

User input: {input}`
  },
  {
    name: 'test',
    description: 'Generate and run tests',
    trigger: ['test', 'write tests', 'add tests', 'unit test', 'test this', 'create tests'],
    prompt: `You are a testing specialist. Write comprehensive tests for the code provided.

Testing approach:
1. Identify the testable units
2. Write unit tests for core logic
3. Include edge cases and error paths
4. Add integration tests if applicable
5. Ensure tests are clear and maintainable

Use the project's existing test framework. Run the tests after writing them and fix any failures.

User input: {input}`
  }
];

export class SkillRegistry {
  constructor(dataDir) {
    this.dir = join(dataDir, 'skills');
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    this.skills = new Map();
    this._loadBuiltIn();
    this._loadCustom();
  }

  _loadBuiltIn() {
    for (const skill of BUILT_IN_SKILLS) {
      this.skills.set(skill.name, {
        name: skill.name,
        description: skill.description,
        trigger: skill.trigger,
        prompt: skill.prompt,
        builtIn: true
      });
    }
  }

  _loadCustom() {
    if (!existsSync(this.dir)) return;
    const files = readdirSync(this.dir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      try {
        const content = readFileSync(join(this.dir, file), 'utf-8');
        const parsed = this._parseSkillFile(content);
        if (parsed) {
          this.skills.set(parsed.name, { ...parsed, builtIn: false });
        }
      } catch {
        // skip invalid files
      }
    }
  }

  _parseSkillFile(content) {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!frontmatterMatch) return null;

    const frontmatter = frontmatterMatch[1];
    const prompt = frontmatterMatch[2].trim();

    const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
    const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
    const triggerMatch = frontmatter.match(/^trigger:\s*(.+)$/m);

    if (!nameMatch) return null;

    return {
      name: nameMatch[1].trim(),
      description: descMatch ? descMatch[1].trim() : '',
      trigger: triggerMatch ? triggerMatch[1].split(',').map(t => t.trim()).filter(Boolean) : [],
      prompt
    };
  }

  get(name) {
    return this.skills.get(name) ?? null;
  }

  list() {
    return Array.from(this.skills.values()).map(s => ({
      name: s.name,
      description: s.description,
      trigger: s.trigger,
      builtIn: s.builtIn
    }));
  }

  add(name, description, trigger, prompt) {
    const skill = {
      name,
      description,
      trigger: Array.isArray(trigger) ? trigger : [trigger],
      prompt,
      builtIn: false
    };
    this.skills.set(name, skill);

    const content = `---
name: ${name}
description: ${description}
trigger: ${skill.trigger.join(', ')}
---
${prompt}`;

    writeFileSync(join(this.dir, `${name}.md`), content, 'utf-8');
    return skill;
  }

  delete(name) {
    const skill = this.skills.get(name);
    if (!skill) return { success: false, error: 'Skill not found' };
    if (skill.builtIn) return { success: false, error: 'Cannot delete built-in skills' };

    this.skills.delete(name);
    const filePath = join(this.dir, `${name}.md`);
    if (existsSync(filePath)) {
      try { unlinkSync(filePath); } catch {}
    }
    return { success: true };
  }

  match(input) {
    const lowerInput = input.toLowerCase();
    let bestMatch = null;
    let bestScore = 0;

    for (const skill of this.skills.values()) {
      for (const trigger of skill.trigger) {
        const lowerTrigger = trigger.toLowerCase();
        if (lowerInput.includes(lowerTrigger)) {
          const score = lowerTrigger.length;
          if (score > bestScore) {
            bestScore = score;
            bestMatch = skill;
          }
        }
      }
    }

    return bestMatch;
  }

  execute(name, input) {
    const skill = this.skills.get(name);
    if (!skill) return null;
    return skill.prompt.replace('{input}', input);
  }
}
