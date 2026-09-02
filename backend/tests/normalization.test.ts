import { test, describe } from 'node:test';
import assert from 'node:assert';
import {
  normalizeSakaArticle,
  extractArticlesFromResponse,
} from '../../extension/src/scripts/sakahub-api.js';
import type { SakaArticleRaw } from '../../extension/src/types.js';

describe('SakaHub Universal Normalizer & Schema Adaptation', () => {
  const sampleRawArticle: SakaArticleRaw = {
    id: '9d0967c3-104c-4dc7-b7e1-0938bbf37fb1',
    articleId: '9d0967c3-104c-4dc7-b7e1-0938bbf37fb1',
    articleTitle: 'Paybill Troubleshooting and Reversal Guidelines (Care Center & Retail) ',
    articleNumber: 'LPPP-0014',
    articleContent: '<p class="MsoNormal">Some guideline content</p>',
    articleActiveStatus: true,
    articleStatus: 'PUBLISHED',
    articleVersion: 1,
    currentActiveContentPublishDate: '2026-09-02T16:13:52.677651841',
    updatedAt: '2026-09-02T16:13:52.686914291',
    articleFlag: 'Default',
    articleBannerImageURL: null,
    isBookmarked: false,
  };

  test('should cleanly normalize real-world raw SakaHub article fields', () => {
    const normalized = normalizeSakaArticle(sampleRawArticle);
    assert.ok(normalized !== null);
    assert.strictEqual(normalized.id, '9d0967c3-104c-4dc7-b7e1-0938bbf37fb1');
    // Verifies trailing space is trimmed
    assert.strictEqual(
      normalized.title,
      'Paybill Troubleshooting and Reversal Guidelines (Care Center & Retail)'
    );
    assert.strictEqual(normalized.articleNumber, 'LPPP-0014');
    assert.strictEqual(normalized.articleFlag, 'Default');
    assert.strictEqual(normalized.version, 1);
    // Verifies nanosecond timestamps are parsed to valid numbers/strings
    assert.ok(normalized.updatedAtEpochMs > 0);
    assert.ok(normalized.lastUpdated.includes('2026-09-02'));
    assert.ok(normalized.publishedAt !== null && normalized.publishedAt.includes('2026-09-02'));
  });

  test('should normalize empty string articleNumber to null', () => {
    const rawWithEmptyNum: SakaArticleRaw = {
      ...sampleRawArticle,
      id: 'empty-num-id',
      articleNumber: '   ',
    };
    const normalized = normalizeSakaArticle(rawWithEmptyNum);
    assert.ok(normalized !== null);
    assert.strictEqual(normalized.articleNumber, null);
  });

  test('should gate-filter unpublished and inactive articles', () => {
    const draftArticle: SakaArticleRaw = {
      ...sampleRawArticle,
      articleStatus: 'DRAFT',
    };
    assert.strictEqual(normalizeSakaArticle(draftArticle), null);

    const inactiveArticle: SakaArticleRaw = {
      ...sampleRawArticle,
      articleActiveStatus: false,
    };
    assert.strictEqual(normalizeSakaArticle(inactiveArticle), null);
  });

  test('should extract articles from direct flat array', () => {
    const rawList = [sampleRawArticle];
    const { rawArticles, totalElements, totalPages } = extractArticlesFromResponse(rawList);
    assert.strictEqual(rawArticles.length, 1);
    assert.strictEqual(totalElements, 1);
    assert.strictEqual(totalPages, 1);
  });

  test('should extract articles from Spring Boot body envelope', () => {
    const envelope = {
      body: {
        content: [sampleRawArticle],
        totalElements: 992,
        totalPages: 7,
      },
    };
    const { rawArticles, totalElements, totalPages } = extractArticlesFromResponse(envelope);
    assert.strictEqual(rawArticles.length, 1);
    assert.strictEqual(totalElements, 992);
    assert.strictEqual(totalPages, 7);
  });

  test('should extract articles from direct content envelope', () => {
    const directContent = {
      content: [sampleRawArticle],
      totalElements: 992,
      totalPages: 7,
    };
    const { rawArticles, totalElements, totalPages } = extractArticlesFromResponse(directContent);
    assert.strictEqual(rawArticles.length, 1);
    assert.strictEqual(totalElements, 992);
    assert.strictEqual(totalPages, 7);
  });
});
