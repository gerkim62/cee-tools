import { test, describe } from 'node:test';
import assert from 'node:assert';
import { splitArticle } from '../src/services/chunker.js';

describe('Markdown Chunker Service', () => {
  test('should hierarchically split article by Markdown headings', async () => {
    const article = {
      id: 'art-001',
      title: 'M-Pesa Tariff Guide',
      articleNumber: 'SOP-202',
      lastUpdated: '2026-09-02T10:00:00Z',
      markdownContent: `# Overview
This document outlines the official tariff structure for all M-Pesa services.

## Withdrawal Tariffs
Withdrawal fees apply when withdrawing funds from an authorized M-Pesa Agent.

### Tier 1: 10 to 100 KES
The fee for withdrawing between 10 and 100 KES is 10 KES.

### Tier 2: 101 to 500 KES
The fee for withdrawing between 101 and 500 KES is 28 KES.

## Send Money Tariffs
Sending money to unregistered users incurs standard transfer rates.
`,
    };

    const chunks = await splitArticle(article);

    assert.ok(chunks.length >= 3, `Expected at least 3 chunks, got ${chunks.length}`);
    assert.strictEqual(chunks[0].metadata.articleId, 'art-001');
    assert.strictEqual(chunks[0].metadata.articleTitle, 'M-Pesa Tariff Guide');

    // Verify heading breadcrumbs
    const headings = chunks.map(c => c.metadata.sectionHeading);
    assert.ok(headings.some(h => h.includes('Withdrawal Tariffs')));
    assert.ok(headings.some(h => h.includes('Send Money Tariffs')));

    // Verify all chunks have non-empty text and fragments
    for (const chunk of chunks) {
      assert.ok(chunk.text.length > 0);
      assert.ok(chunk.structuralPrefix.includes('M-Pesa Tariff Guide'));
      assert.ok(chunk.textFragment.startsWith('#:~:text='));
    }
  });

  test('should cleanly handle flat markdown articles without headings', async () => {
    const flatArticle = {
      id: 'art-002',
      title: 'General Notification Policy',
      lastUpdated: '2026-09-01T12:00:00Z',
      markdownContent: `All customer notifications must be dispatched within five minutes of an account status change.
Ensure that SMS gateway templates comply with regional telecommunication regulations.
Failure to deliver timely notices may result in system flags and escalation to the compliance desk.`,
    };

    const chunks = await splitArticle(flatArticle);

    assert.ok(chunks.length >= 1);
    assert.strictEqual(chunks[0].metadata.articleId, 'art-002');
    assert.strictEqual(chunks[0].metadata.sectionHeading, 'General');
    assert.ok(chunks[0].text.includes('All customer notifications'));
  });
});
