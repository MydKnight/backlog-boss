/**
 * Guide ingestion service.
 *
 * Fetches a URL server-side (no CORS issues) and extracts readable content.
 * Two content types are handled:
 *   - text/plain  → stored as-is (GameFAQs .txt FAQs)
 *   - text/html   → parsed with Mozilla Readability (same engine as Firefox Reader Mode)
 *
 * Returns a shape that maps directly onto the guides table columns.
 */

import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';

const FETCH_TIMEOUT_MS = 15_000;
const MAX_CONTENT_BYTES = 10 * 1024 * 1024; // 10 MB — guides can be long

/**
 * Fetch and parse a guide URL.
 *
 * @param {string} url
 * @returns {Promise<{
 *   title: string,
 *   content: string,
 *   contentType: 'html' | 'text',
 *   contentLength: number,
 *   parseWarning: boolean,
 * }>}
 * @throws Error with a user-readable message on fetch/parse failure
 */
export async function fetchAndParseGuide(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Upgrade-Insecure-Requests': '1',
      },
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('Request timed out after 15 seconds.');
    throw new Error(`Could not reach URL: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`Server returned ${res.status} ${res.statusText}`);
  }

  const contentType = res.headers.get('content-type') ?? '';

  // --- Plain text (GameFAQs .txt FAQs, etc.) ---
  if (contentType.includes('text/plain')) {
    const text = await res.text();
    if (text.length > MAX_CONTENT_BYTES) {
      throw new Error('Guide file is too large (> 10 MB).');
    }
    return {
      title: titleFromUrl(url),
      content: text,
      contentType: 'text',
      contentLength: text.length,
      parseWarning: false,
    };
  }

  // --- HTML ---
  const html = await res.text();
  if (html.length > MAX_CONTENT_BYTES) {
    throw new Error('Page is too large (> 10 MB).');
  }

  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  if (!article || !article.content || article.content.length < 200) {
    // Readability got nothing useful — fall back to full HTML with a warning
    // Strip script/style tags at minimum so the reader isn't broken
    const stripped = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '');
    return {
      title: article?.title || titleFromUrl(url),
      content: stripped,
      contentType: 'html',
      contentLength: stripped.length,
      parseWarning: true,
    };
  }

  return {
    title: article.title || titleFromUrl(url),
    content: article.content,
    contentType: 'html',
    contentLength: article.content.length,
    parseWarning: false,
  };
}

function titleFromUrl(url) {
  try {
    const u = new URL(url);
    // Last non-empty path segment, with dashes→spaces and extension stripped
    const seg = u.pathname.split('/').filter(Boolean).pop() ?? u.hostname;
    return seg.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
  } catch {
    return url;
  }
}
