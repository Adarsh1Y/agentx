import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, renameSync, unlinkSync, appendFileSync } from 'fs';
import { join, dirname, extname } from 'path';

export function readFile(filePath) {
  if (!existsSync(filePath)) return { success: false, error: `File not found: ${filePath}` };
  try {
    const content = readFileSync(filePath, 'utf-8');
    const stats = statSync(filePath);
    return { success: true, content, size: stats.size, lines: content.split('\n').length };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export function writeFile(filePath, content) {
  try {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(filePath, content, 'utf-8');
    return { success: true, path: filePath, size: content.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export function editFile(filePath, oldText, newText) {
  if (!existsSync(filePath)) return { success: false, error: `File not found: ${filePath}` };
  try {
    let content = readFileSync(filePath, 'utf-8');
    if (!content.includes(oldText)) {
      return { success: false, error: 'Text not found in file. Check the exact content.' };
    }
    content = content.replace(oldText, newText);
    writeFileSync(filePath, content, 'utf-8');
    return { success: true, path: filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export function listDir(dirPath, recursive = false) {
  if (!existsSync(dirPath)) return { success: false, error: `Directory not found: ${dirPath}` };
  try {
    const entries = [];
    function walk(dir, prefix = '') {
      const items = readdirSync(dir);
      for (const item of items) {
        const fullPath = join(dir, item);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          entries.push({ name: item, type: 'dir', path: prefix + item });
          if (recursive) walk(fullPath, prefix + item + '/');
        } else {
          entries.push({ name: item, type: 'file', path: prefix + item, size: stat.size });
        }
      }
    }
    walk(dirPath);
    return { success: true, entries, count: entries.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export function fileExists(filePath) {
  return { exists: existsSync(filePath) };
}

export function deleteFile(filePath) {
  if (!existsSync(filePath)) return { success: false, error: `File not found: ${filePath}` };
  try {
    unlinkSync(filePath);
    return { success: true, path: filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export function createDir(dirPath) {
  try {
    mkdirSync(dirPath, { recursive: true });
    return { success: true, path: dirPath };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export function searchFiles(dirPath, pattern) {
  if (!existsSync(dirPath)) return { success: false, error: `Directory not found: ${dirPath}` };
  try {
    const results = [];
    const regex = new RegExp(pattern, 'i');
    function walk(dir) {
      const items = readdirSync(dir);
      for (const item of items) {
        const fullPath = join(dir, item);
        const stat = statSync(fullPath);
        if (stat.isDirectory() && item !== 'node_modules' && item !== '.git') {
          walk(fullPath);
        } else if (stat.isFile() && regex.test(item)) {
          results.push(fullPath);
        }
      }
    }
    walk(dirPath);
    return { success: true, files: results, count: results.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export function grepInFiles(dirPath, pattern, extensions = []) {
  if (!existsSync(dirPath)) return { success: false, error: `Directory not found: ${dirPath}` };
  try {
    const results = [];
    const regex = new RegExp(pattern, 'i');
    function walk(dir) {
      const items = readdirSync(dir);
      for (const item of items) {
        const fullPath = join(dir, item);
        const stat = statSync(fullPath);
        if (stat.isDirectory() && item !== 'node_modules' && item !== '.git') {
          walk(fullPath);
        } else if (stat.isFile()) {
          if (extensions.length && !extensions.includes(extname(item))) continue;
          try {
            const content = readFileSync(fullPath, 'utf-8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (regex.test(lines[i])) {
                results.push({ file: fullPath, line: i + 1, content: lines[i].trim() });
              }
            }
          } catch {}
        }
      }
    }
    walk(dirPath);
    return { success: true, matches: results.slice(0, 50), count: results.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export default { readFile, writeFile, editFile, listDir, fileExists, deleteFile, createDir, searchFiles, grepInFiles };
