import fetch from 'node-fetch';

export async function webSearch(query, numResults = 5) {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' }
    });
    const html = await res.text();
    const results = [];
    const linkRegex = /<a rel="nofollow" class="result__a" href="([^"]+)">([^<]+)<\/a>/g;
    let match;
    while ((match = linkRegex.exec(html)) !== null && results.length < numResults) {
      results.push({ title: match[2], url: match[1] });
    }
    return { success: true, results, count: results.length };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export async function fetchUrl(url, format = 'text') {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' },
      timeout: 15000
    });
    if (!res.ok) return { success: false, error: `HTTP ${res.status}: ${res.statusText}` };
    const text = await res.text();
    if (format === 'text') {
      const stripped = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      return { success: true, url, content: stripped.slice(0, 10000) };
    }
    return { success: true, url, content: text.slice(0, 10000) };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export async function testApi(url, method = 'GET', body = null, headers = {}) {
  try {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      timeout: 10000
    };
    if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    const data = await res.text();
    return {
      success: res.ok,
      status: res.status,
      statusText: res.statusText,
      headers: Object.fromEntries(res.headers.entries()),
      body: data.slice(0, 5000)
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export default { webSearch, fetchUrl, testApi };
