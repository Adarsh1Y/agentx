import { exec } from 'child_process';
import { promisify } from 'util';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const execAsync = promisify(exec);

const SECRET_PATTERNS = [
  { regex: /(?:password|passwd|pwd)\s*[=:]\s*["'][^"']+["']/gi, name: 'Hardcoded password', severity: 'high' },
  { regex: /(?:api[_-]?key|apikey)\s*[=:]\s*["'][^"']+["']/gi, name: 'Hardcoded API key', severity: 'high' },
  { regex: /(?:token|secret|auth[_-]?token|access[_-]?token)\s*[=:]\s*["'][^"']+["']/gi, name: 'Hardcoded token/secret', severity: 'high' },
  { regex: /(?:private[_-]?key|secret[_-]?key)\s*[=:]\s*["'][^"']+["']/gi, name: 'Hardcoded private/secret key', severity: 'critical' },
  { regex: /AKIA[0-9A-Z]{16}/g, name: 'AWS Access Key ID', severity: 'critical' },
  { regex: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36}/g, name: 'GitHub token', severity: 'critical' },
  { regex: /sk-[A-Za-z0-9]{20,}/g, name: 'OpenAI/secret key pattern', severity: 'high' },
  { regex: /-----BEGIN (RSA |EC |DSA )?PRIVATE KEY-----/g, name: 'Embedded private key', severity: 'critical' },
];

const DANGEROUS_PATTERNS = [
  { regex: /\beval\s*\(/g, name: 'eval() usage', severity: 'high' },
  { regex: /\bFunction\s*\(/g, name: 'Function() constructor', severity: 'high' },
  { regex: /\bexec\s*\(/g, name: 'exec() usage', severity: 'medium' },
  { regex: /\bspawn\s*\(/g, name: 'spawn() usage', severity: 'medium' },
  { regex: /execSync\s*\(/g, name: 'execSync() usage', severity: 'high' },
  { regex: /\bsetTimeout\s*\(\s*["']/g, name: 'setTimeout with string', severity: 'medium' },
  { regex: /\bsetInterval\s*\(\s*["']/g, name: 'setInterval with string', severity: 'medium' },
  { regex: /document\.write\s*\(/g, name: 'document.write()', severity: 'medium' },
  { regex: /innerHTML\s*=/g, name: 'innerHTML assignment', severity: 'medium' },
  { regex: /__proto__/g, name: '__proto__ usage', severity: 'low' },
];

const SQL_INJECTION_PATTERNS = [
  { regex: /(?:query|execute|raw)\s*\(\s*["'][^"']*\$\{[^}]+\}/g, name: 'SQL injection - string interpolation', severity: 'critical' },
  { regex: /(?:query|execute|raw)\s*\(\s*["'][^"']*["']\s*\+\s*/g, name: 'SQL injection - string concatenation', severity: 'critical' },
  { regex: /["'](?:SELECT|INSERT|UPDATE|DELETE|DROP)\s+[^"']*["']\s*\+\s*/gi, name: 'SQL query concatenation', severity: 'high' },
  { regex: /["'](?:SELECT|INSERT|UPDATE|DELETE|DROP)\s+[^"']*\$\{[^}]+\}/gi, name: 'SQL query interpolation', severity: 'critical' },
];

const INSECURE_PATTERNS = [
  { regex: /http:\/\/(?!localhost)[^\s"']+/gi, name: 'HTTP URL (non-HTTPS)', severity: 'medium', filter: (m) => m.startsWith('http://') },
  { regex: /app\.use\s*\(\s*express\.static\s*\(/g, name: 'Express static without options', severity: 'low' },
  { regex: /cors\s*\(\s*\)/g, name: 'CORS enabled for all origins', severity: 'medium' },
  { regex: /app\.disable\s*\(\s*["']x-frame-options["']\s*\)/g, name: 'X-Frame-Options disabled', severity: 'medium' },
  { regex: /app\.disable\s*\(\s*["']x-xss-protection["']\s*\)/g, name: 'X-XSS-Protection disabled', severity: 'medium' },
];

const MISSING_VALIDATION_PATTERNS = [
  { regex: /req\.(body|params|query|headers)\s*\[\s*["'][^"']+["']\s*\]/g, name: 'Request input without validation', severity: 'low' },
  { regex: /process\.env\.\w+/g, name: 'Environment variable access', severity: 'info' },
];

function getLanguageFromExt(ext) {
  const map = {
    '.js': 'javascript', '.ts': 'typescript', '.jsx': 'javascript', '.tsx': 'typescript',
    '.py': 'python', '.rb': 'ruby', '.php': 'php', '.java': 'java',
    '.go': 'go', '.rs': 'rust', '.c': 'c', '.cpp': 'cpp', '.h': 'c',
    '.sql': 'sql', '.sh': 'shell', '.bash': 'shell',
  };
  return map[ext] || 'unknown';
}

export async function scanDependencies(cwd) {
  const issues = [];
  const pkgPath = join(cwd, 'package.json');
  const reqPath = join(cwd, 'requirements.txt');

  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };

      try {
        const { stdout } = await execAsync('npm audit --json', { cwd, timeout: 30000 });
        const audit = JSON.parse(stdout);
        if (audit.vulnerabilities) {
          for (const [name, vuln] of Object.entries(audit.vulnerabilities)) {
            issues.push({
              type: 'dependency',
              name,
              severity: vuln.severity || 'medium',
              detail: `${vuln.title || 'Vulnerability found'} (${vuln.via?.[0]?.name || 'unknown'})`,
              fix: vuln.fixAvailable ? 'Run: npm audit fix' : 'Manual update required',
            });
          }
        }
      } catch {
        for (const [name, version] of Object.entries(deps)) {
          if (version.startsWith('^') || version.startsWith('~')) {
            const ver = version.slice(1);
            if (ver === '0.0.0' || ver === '0.1.0' || ver === '1.0.0') {
              issues.push({
                type: 'dependency',
                name,
                severity: 'low',
                detail: `Potentially outdated or placeholder version: ${version}`,
                fix: 'Verify version constraint',
              });
            }
          }
          if (['eval', 'vm2', 'serialize-javascript', 'node-fetch'].includes(name)) {
            issues.push({
              type: 'dependency',
              name,
              severity: 'medium',
              detail: `Package '${name}' has known security considerations`,
              fix: 'Review usage and ensure latest version',
            });
          }
        }
      }
    } catch (err) {
      issues.push({ type: 'dependency', name: 'package.json', severity: 'info', detail: `Could not parse: ${err.message}`, fix: null });
    }
  }

  if (existsSync(reqPath)) {
    try {
      const { stdout } = await execAsync('pip-audit --json', { cwd, timeout: 30000 });
      const results = JSON.parse(stdout);
      if (results.vulns) {
        for (const vuln of results.vulns) {
          issues.push({
            type: 'dependency',
            name: vuln.name,
            severity: vuln.severity || 'medium',
            detail: vuln.summary || 'Vulnerability found',
            fix: vuln.fix_versions?.length ? `Upgrade to ${vuln.fix_versions[0]}` : 'Manual update required',
          });
        }
      }
    } catch {
      const lines = readFileSync(reqPath, 'utf-8').split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
      for (const line of lines) {
        const match = line.match(/^([a-zA-Z0-9_-]+)==([0-9.]+)/);
        if (match) {
          const [, name, version] = match;
          const parts = version.split('.').map(Number);
          if (parts[0] === 0 || parts[1] === 0) {
            issues.push({
              type: 'dependency',
              name,
              severity: 'low',
              detail: `Potentially early version: ${version}`,
              fix: 'Verify version is intentional',
            });
          }
        }
      }
    }
  }

  return issues;
}

export function scanCodePatterns(filePath) {
  const issues = [];
  let content;

  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return issues;
  }

  const ext = filePath.slice(filePath.lastIndexOf('.'));
  const lang = getLanguageFromExt(ext);

  const allPatterns = [
    ...SECRET_PATTERNS,
    ...DANGEROUS_PATTERNS,
    ...SQL_INJECTION_PATTERNS,
    ...INSECURE_PATTERNS,
    ...MISSING_VALIDATION_PATTERNS,
  ];

  const lines = content.split('\n');
  for (const pattern of allPatterns) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith('//') || line.trim().startsWith('#') || line.trim().startsWith('*') || line.trim().startsWith('/*')) {
        continue;
      }
      const matches = line.match(pattern.regex);
      if (matches) {
        if (pattern.filter && !pattern.filter(matches[0])) continue;
        issues.push({
          type: 'code-pattern',
          name: pattern.name,
          severity: pattern.severity,
          file: filePath,
          line: i + 1,
          detail: line.trim().slice(0, 120),
          fix: getFixSuggestion(pattern.name),
        });
      }
    }
  }

  return issues;
}

function getFixSuggestion(name) {
  const fixes = {
    'Hardcoded password': 'Use environment variables or a secrets manager',
    'Hardcoded API key': 'Use environment variables or a secrets manager',
    'Hardcoded token/secret': 'Use environment variables or a secrets manager',
    'Hardcoded private/secret key': 'Use environment variables or a secrets manager',
    'AWS Access Key ID': 'Use IAM roles or environment variables',
    'GitHub token': 'Use environment variables or GitHub Actions secrets',
    'OpenAI/secret key pattern': 'Use environment variables',
    'Embedded private key': 'Store keys externally and reference via path',
    'eval() usage': 'Use JSON.parse() or safer alternatives',
    'Function() constructor': 'Use safer alternatives',
    'exec() usage': 'Use parameterized commands or safer APIs',
    'spawn() usage': 'Validate and sanitize command arguments',
    'execSync() usage': 'Use parameterized commands or safer APIs',
    'setTimeout with string': 'Pass a function instead of a string',
    'setInterval with string': 'Pass a function instead of a string',
    'document.write()': 'Use DOM manipulation methods',
    'innerHTML assignment': 'Use textContent or DOM methods',
    '__proto__ usage': 'Use Object.create(null) or Map',
    'SQL injection - string interpolation': 'Use parameterized queries',
    'SQL injection - string concatenation': 'Use parameterized queries',
    'SQL query concatenation': 'Use parameterized queries',
    'SQL query interpolation': 'Use parameterized queries',
    'HTTP URL (non-HTTPS)': 'Use HTTPS URLs',
    'CORS enabled for all origins': 'Specify allowed origins explicitly',
    'Express static without options': 'Add options to restrict served files',
    'X-Frame-Options disabled': 'Enable X-Frame-Options header',
    'X-XSS-Protection disabled': 'Enable XSS protection',
    'Request input without validation': 'Add input validation middleware',
    'Environment variable access': 'Ensure variable is required and validated',
  };
  return fixes[name] || 'Review and fix manually';
}

export async function scanProject(cwd) {
  const allIssues = [];

  const depIssues = await scanDependencies(cwd);
  allIssues.push(...depIssues);

  const codeExtensions = ['.js', '.ts', '.jsx', '.tsx', '.py', '.rb', '.php', '.java', '.go', '.rs', '.c', '.cpp', '.sql', '.sh'];
  const skipDirs = ['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '__pycache__', 'venv', '.venv'];

  function walkDir(dir) {
    if (!existsSync(dir)) return;
    const items = readdirSync(dir);
    for (const item of items) {
      const fullPath = join(dir, item);
      if (skipDirs.includes(item)) continue;
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          walkDir(fullPath);
        } else {
          const ext = item.slice(item.lastIndexOf('.'));
          if (codeExtensions.includes(ext)) {
            const fileIssues = scanCodePatterns(fullPath);
            allIssues.push(...fileIssues);
          }
        }
      } catch {}
    }
  }

  try {
    walkDir(cwd);
  } catch {}

  return allIssues;
}

export async function getSecurityReport(cwd) {
  const issues = await scanProject(cwd);
  const severityCounts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  const typeCounts = { dependency: 0, 'code-pattern': 0 };

  for (const issue of issues) {
    if (severityCounts[issue.severity] !== undefined) severityCounts[issue.severity]++;
    if (typeCounts[issue.type] !== undefined) typeCounts[issue.type]++;
  }

  const riskScore = severityCounts.critical * 10 + severityCounts.high * 5 + severityCounts.medium * 2 + severityCounts.low * 1;
  let riskLevel = 'LOW';
  if (riskScore > 50) riskLevel = 'CRITICAL';
  else if (riskScore > 20) riskLevel = 'HIGH';
  else if (riskScore > 10) riskLevel = 'MEDIUM';

  return {
    scannedAt: new Date().toISOString(),
    project: cwd,
    totalIssues: issues.length,
    riskLevel,
    riskScore,
    bySeverity: severityCounts,
    byType: typeCounts,
    issues: issues.map(i => ({
      type: i.type,
      name: i.name,
      severity: i.severity,
      file: i.file || null,
      line: i.line || null,
      detail: i.detail,
      fix: i.fix,
    })),
  };
}
