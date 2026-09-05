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
  stage: 'idle' | 'probing' | 'locking' | 'scraping' | 'cleaning' | 'uploading' | 'completed' | 'error';
  message: string;
  progressPercent: number;
  processedCount?: number;
  totalCount?: number;
  currentBatch?: number;
  totalBatches?: number;
  addedCount?: number;
  updatedCount?: number;
  deletedCount?: number;
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

export interface ClarifyingQuestion {
  type: 'single_choice' | 'multi_choice' | 'free_text';
  prompt: string;
  options?: string[];
}

export interface AskResponse {
  answer: string;
  citations: Citation[];
  conversationId?: string;
  conversationTitle?: string;
  executionSteps?: ExecutionStep[];
  clarifyingQuestion?: ClarifyingQuestion;
  suggestedFollowUps?: string[];
}

export interface ConversationSummary {
  id: string;
  clientId: string;
  title: string;
  isCompacted?: boolean;
  summary?: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
  snippetMatch?: string | null;
}

export interface ExecutionStep {
  label: string;
  detail: string;
}

export interface ChatMessage {
  id: string;
  parentId?: string | null;
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  executionSteps?: ExecutionStep[];
  clarifyingQuestion?: ClarifyingQuestion;
  suggestedFollowUps?: string[];
  createdAt: string;
  isStreaming?: boolean;
}

export type WidgetView = 'chat' | 'history' | 'sync' | 'settings';

export type ExtensionMessage =
  | { type: 'CHECK_STALENESS' }
  | { type: 'START_SYNC'; mode?: 'smart' | 'deep' }
  | { type: 'GET_SYNC_STATE' }
  | { type: 'SYNC_PROGRESS'; progress: SyncProgressUpdate }
  | { type: 'SYNC_COMPLETED'; result: unknown }
  | { type: 'SYNC_ERROR'; error: string }
  | { type: 'BG_FETCH'; url: string; options?: RequestInit }
  | { type: 'SAKAHUB_RELAY_FETCH'; url: string; options?: { headers?: Record<string, string> } };

export interface SakaHubRelayFetchResponse {
  success: boolean;
  status?: number;
  redirected?: boolean;
  url?: string;
  text?: string;
  error?: string;
}

export interface AskStreamClientMessage {
  type: 'START_ASK';
  question: string;
  conversationId?: string;
  clientId: string;
  parentId?: string | null;
  retryUserMessageId?: string | null;
}

export type AskStreamServerMessage =
  | { type: 'status'; message: string; label?: string; detail?: string; step?: string }
  | { type: 'token'; delta: string; token?: string }
  | { type: 'citations'; citations: Citation[] }
  | {
      type: 'done';
      answer?: string;
      citations?: Citation[];
      conversationId?: string;
      conversationTitle?: string;
      executionSteps?: ExecutionStep[];
      clarifyingQuestion?: ClarifyingQuestion;
      suggestedFollowUps?: string[];
      messageId?: string;
      userMessageId?: string;
      parentId?: string | null;
    }
  | { type: 'error'; message: string };


