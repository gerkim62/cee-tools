import {
  SakaArticleRaw,
  SakaNormalizedArticle,
  ProbeResult,
  SakaFetchResponse,
} from '../types.js';

const SAKAHUB_BASE_URL = 'https://sakahub.safaricom.co.ke/api/v1/published-articles';
const MAX_PAGE_SIZE = 152;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Normalizes a raw SakaHub article into a strictly validated SakaNormalizedArticle.
 * Filters out unpublished or inactive articles.
 */
export function normalizeSakaArticle(raw: SakaArticleRaw): SakaNormalizedArticle | null {
  if (!raw || typeof raw !== 'object') return null;

  const id = raw.id || raw.articleId;
  if (!id || typeof id !== 'string') return null;

  // Gate check: only index active, published articles
  if (raw.articleStatus && raw.articleStatus.toUpperCase() !== 'PUBLISHED') {
    return null;
  }
  if (raw.articleActiveStatus === false) {
    return null;
  }

  // Clean title
  const rawTitle = raw.articleTitle || raw.title || 'Untitled';
  const title = String(rawTitle).trim();

  // Normalize empty or whitespace article numbers to null
  const rawNum = raw.articleNumber;
  const articleNumber =
    typeof rawNum === 'string' && rawNum.trim().length > 0 ? rawNum.trim() : null;

  // Parse timestamps safely (handles nanoseconds e.g. 2026-09-02T16:13:52.686914291)
  const rawUpdated = raw.updatedAt || raw.lastUpdated || raw.currentActiveContentPublishDate;
  const updatedDate = rawUpdated ? new Date(rawUpdated) : new Date();
  const validUpdated = !isNaN(updatedDate.getTime());
  const lastUpdated = validUpdated ? updatedDate.toISOString() : new Date().toISOString();
  const updatedAtEpochMs = validUpdated ? updatedDate.getTime() : Date.now();

  let publishedAt: string | null = null;
  if (raw.currentActiveContentPublishDate) {
    const pDate = new Date(raw.currentActiveContentPublishDate);
    if (!isNaN(pDate.getTime())) {
      publishedAt = pDate.toISOString();
    }
  }

  return {
    id,
    title,
    articleNumber,
    contentHtml: typeof raw.articleContent === 'string' ? raw.articleContent : '',
    lastUpdated,
    updatedAtEpochMs,
    publishedAt,
    articleFlag: typeof raw.articleFlag === 'string' ? raw.articleFlag : 'Default',
    version: typeof raw.articleVersion === 'number' ? raw.articleVersion : 1,
  };
}

/**
 * Universal extractor handling direct arrays, `{ content: [] }`, or `{ body: { content: [] } }`
 */
export function extractArticlesFromResponse(data: unknown): {
  rawArticles: SakaArticleRaw[];
  totalElements?: number;
  totalPages?: number;
} {
  if (Array.isArray(data)) {
    return {
      rawArticles: data as SakaArticleRaw[],
      totalElements: data.length,
      totalPages: 1,
    };
  }

  if (typeof data === 'object' && data !== null) {
    const obj = data as Record<string, unknown>;

    // Case 1: Wrapped in Spring Boot body envelope { body: { content: [...] } }
    if (typeof obj.body === 'object' && obj.body !== null) {
      const body = obj.body as Record<string, unknown>;
      const content = Array.isArray(body.content) ? (body.content as SakaArticleRaw[]) : [];
      return {
        rawArticles: content,
        totalElements: typeof body.totalElements === 'number' ? body.totalElements : undefined,
        totalPages: typeof body.totalPages === 'number' ? body.totalPages : undefined,
      };
    }

    // Case 2: Direct envelope { content: [...], totalPages, totalElements }
    if (Array.isArray(obj.content)) {
      return {
        rawArticles: obj.content as SakaArticleRaw[],
        totalElements: typeof obj.totalElements === 'number' ? obj.totalElements : undefined,
        totalPages: typeof obj.totalPages === 'number' ? obj.totalPages : undefined,
      };
    }
  }

  return { rawArticles: [] };
}

export interface FetchPageResult {
  articles: SakaNormalizedArticle[];
  totalElements?: number;
  totalPages?: number;
}

export const SAKAHUB_AUTH_ERROR = 'SAKAHUB_AUTH_REQUIRED';

/**
 * Validates that SakaHub returned actual JSON articles, not a 307 redirect to /login or HTML login page.
 */
export function parseAndValidateSakaResponse(response: Response, text: string): unknown {
  // Check if redirected to login, not-found, or SSO
  if (
    response.redirected ||
    response.url.includes('/login') ||
    response.url.includes('/not-found') ||
    response.status === 307 ||
    response.status === 302 ||
    response.status === 401
  ) {
    throw new Error(SAKAHUB_AUTH_ERROR);
  }

  if (!response.ok) {
    throw new Error(`[SakaHub API Error] HTTP ${response.status} ${response.statusText}`);
  }

  // Check if body is HTML (SakaHub returns the HTML login page when session is inactive)
  const trimmed = text.trim();
  if (
    trimmed.startsWith('<!DOCTYPE') ||
    trimmed.startsWith('<html') ||
    trimmed.includes('<body') ||
    trimmed.includes('login')
  ) {
    throw new Error(SAKAHUB_AUTH_ERROR);
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(SAKAHUB_AUTH_ERROR);
  }

  if (json && typeof json === 'object' && (json as any).message === 'User is not authenticated') {
    throw new Error(SAKAHUB_AUTH_ERROR);
  }

  return json;
}

/**
 * Lightweight probe fetching page=0&size=1.
 * Returns totalElements count and newest article's normalized lastUpdated.
 */
export async function probeSakaHub(): Promise<ProbeResult> {
  const url = `${SAKAHUB_BASE_URL}?page=0&size=1`;

  const response = await fetch(url, {
    method: 'GET',
    mode: 'cors',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      'x-kbui-api-client': 'internal',
    },
  });

  const text = await response.text();
  const json = parseAndValidateSakaResponse(response, text);

  const { rawArticles, totalElements } = extractArticlesFromResponse(json);

  const rawFirst = rawArticles[0];
  const normalizedFirst = rawFirst ? normalizeSakaArticle(rawFirst) : null;

  return {
    totalElements: typeof totalElements === 'number' ? totalElements : rawArticles.length,
    newestLastUpdated: normalizedFirst ? normalizedFirst.lastUpdated : null,
    newestArticleTitle: normalizedFirst ? normalizedFirst.title : null,
  };
}

/**
 * Fetches a specific page of published articles with exponential backoff and universal normalization.
 */
export async function fetchSakaHubPage(
  page: number,
  size: number = MAX_PAGE_SIZE,
  retries: number = 3
): Promise<FetchPageResult> {
  const url = `${SAKAHUB_BASE_URL}?page=${page}&size=${size}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        mode: 'cors',
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'x-kbui-api-client': 'internal',
        },
      });

      const text = await response.text();
      const json = parseAndValidateSakaResponse(response, text);

      const { rawArticles, totalElements, totalPages } = extractArticlesFromResponse(json);

      const normalizedArticles: SakaNormalizedArticle[] = [];
      for (const raw of rawArticles) {
        const norm = normalizeSakaArticle(raw);
        if (norm) {
          normalizedArticles.push(norm);
        }
      }

      return {
        articles: normalizedArticles,
        totalElements,
        totalPages,
      };
    } catch (err: unknown) {
      if (err instanceof Error && err.message === SAKAHUB_AUTH_ERROR) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[SakaHub Fetch] Page ${page} attempt ${attempt} failed: ${msg}`);
      if (attempt === retries) {
        throw new Error(`Failed fetching page ${page} after ${retries} attempts: ${msg}`);
      }
      await sleep(1000 * Math.pow(2, attempt - 1));
    }
  }

  throw new Error(`Failed to fetch page ${page}`);
}

