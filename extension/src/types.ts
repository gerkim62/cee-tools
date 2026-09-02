/**
 * Production raw article structure received directly from SakaHub API
 */
export interface SakaArticleRaw {
  id: string;
  articleId?: string;
  articleTitle?: string;
  title?: string;
  articleNumber?: string | null;
  articleContent?: string;
  articleActiveStatus?: boolean;
  articleStatus?: string;
  articleVersion?: number;
  currentActiveContentPublishDate?: string;
  updatedAt?: string;
  lastUpdated?: string;
  articleFlag?: string;
  articleBannerImageURL?: string | null;
  isBookmarked?: boolean;
  [key: string]: unknown;
}

/**
 * Clean normalized article used internally by the syncer and pipeline
 */
export interface SakaNormalizedArticle {
  id: string;
  title: string;
  articleNumber: string | null;
  contentHtml: string;
  lastUpdated: string;
  updatedAtEpochMs: number;
  publishedAt: string | null;
  articleFlag: string;
  version: number;
}

export interface SakaPageEnvelope {
  header?: Record<string, unknown>;
  body?: {
    content?: SakaArticleRaw[];
    totalElements?: number;
    totalPages?: number;
    pageable?: Record<string, unknown>;
  };
  content?: SakaArticleRaw[];
  totalElements?: number;
  totalPages?: number;
}

export type SakaFetchResponse = SakaArticleRaw[] | SakaPageEnvelope;

export interface ProbeResult {
  totalElements: number;
  newestLastUpdated: string | null;
  newestArticleTitle: string | null;
}

export interface BackendSyncStatus {
  totalIndexed: number;
  maxLastUpdated: string | null;
  isSyncing: boolean;
  lockExpiresAt: string | null;
  activeCollection?: string;
}

export interface SyncProgressUpdate {
  stage: 'probing' | 'locking' | 'scraping' | 'cleaning' | 'uploading' | 'completed' | 'error';
  message: string;
  progressPercent: number;
  details?: Record<string, unknown>;
}

export interface ChangedArticlePayload {
  id: string;
  title: string;
  articleNumber?: string | null;
  markdownContent: string;
  lastUpdated: string;
  publishedAt?: string | null;
  articleFlag?: string | null;
}

export interface ReindexBatchRequest {
  changed: ChangedArticlePayload[];
  deletedIds: string[];
  clientId?: string;
}

export interface StalenessCheckResult {
  isBehind: boolean;
  isSyncing: boolean;
  reason?: string;
  sakaCount: number;
  backendCount: number;
  newestSakaDate: string | null;
  maxBackendDate: string | null;
}

export interface Citation {
  articleId: string;
  articleTitle: string;
  articleNumber?: string;
  sectionHeading: string;
  quote: string;
  urlWithTextFragment: string;
}

export interface AskResponse {
  answer: string;
  citations: Citation[];
}

export type ExtensionMessage =
  | { type: 'CHECK_STALENESS' }
  | { type: 'START_SYNC' }
  | { type: 'GET_SYNC_STATE' }
  | { type: 'SYNC_PROGRESS'; progress: SyncProgressUpdate }
  | { type: 'SYNC_COMPLETED'; result: unknown }
  | { type: 'SYNC_ERROR'; error: string };
