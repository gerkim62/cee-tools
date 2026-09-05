import { test, describe } from 'node:test';
import assert from 'node:assert';
import { parseTranslationResponse } from '../src/services/queryTranslator.js';
import {
  QUERY_TRANSLATION_SYSTEM_PROMPT,
  ASK_SAKA_SYSTEM_PROMPT,
  buildContextualChunkPrompt,
} from '../src/prompts.js';

describe('Query Translation & Prompt Suite', () => {
  test('should parse JSON query translation response correctly for informational query', () => {
    const rawResponse = JSON.stringify({
      needsContext: true,
      primary: 'PUK unlock procedure and requirements',
      fallback: 'PUK unlock procedure and requirements pul code',
      alt: null,
    });

    const result = parseTranslationResponse(rawResponse, 'pul code');
    assert.strictEqual(result.needsContext, true);
    assert.strictEqual(result.primary, 'PUK unlock procedure and requirements');
    assert.strictEqual(result.fallback, 'PUK unlock procedure and requirements pul code');
    assert.strictEqual(result.alt, null);
  });

  test('should parse JSON query translation response with alternative interpretation', () => {
    const rawResponse = JSON.stringify({
      needsContext: true,
      primary: 'transaction reversal procedure',
      fallback: 'transaction reversal procedure how to reverse',
      alt: 'airtime reversal procedure',
    });

    const result = parseTranslationResponse(rawResponse, 'how to reverse');
    assert.strictEqual(result.needsContext, true);
    assert.strictEqual(result.primary, 'transaction reversal procedure');
    assert.strictEqual(result.alt, 'airtime reversal procedure');
  });

  test('should correctly parse chit-chat / greeting with needsContext: false', () => {
    const rawResponse = JSON.stringify({
      needsContext: false,
      primary: 'hello good morning',
      fallback: 'hello good morning',
      alt: null,
    });

    const result = parseTranslationResponse(rawResponse, 'hello good morning');
    assert.strictEqual(result.needsContext, false);
    assert.strictEqual(result.primary, 'hello good morning');
  });

  test('should handle markdown fenced JSON code blocks', () => {
    const rawResponse = '```json\n{\n  "needsContext": true,\n  "primary": "Home Fibre reconnection",\n  "fallback": "Home Fibre reconnection ftth reconnect",\n  "alt": null\n}\n```';

    const result = parseTranslationResponse(rawResponse, 'ftth reconnect');
    assert.strictEqual(result.needsContext, true);
    assert.strictEqual(result.primary, 'Home Fibre reconnection');
  });

  test('prompts should maintain expected structure and tokens', () => {
    // Verify prompt definitions are non-empty and well-formed
    assert.ok(QUERY_TRANSLATION_SYSTEM_PROMPT.includes('needsContext'));
    assert.ok(QUERY_TRANSLATION_SYSTEM_PROMPT.includes('primary'));
    assert.ok(QUERY_TRANSLATION_SYSTEM_PROMPT.includes('fallback'));

    assert.ok(ASK_SAKA_SYSTEM_PROMPT.includes('ROLE & STYLE'));
    assert.ok(ASK_SAKA_SYSTEM_PROMPT.includes('ACCURACY & GROUNDING'));
    assert.ok(ASK_SAKA_SYSTEM_PROMPT.includes('[CLARIFICATION:'));
    assert.ok(ASK_SAKA_SYSTEM_PROMPT.includes('[SUGGESTIONS:'));

    const contextualPrompt = buildContextualChunkPrompt('Full doc text', 'Chunk text');
    assert.ok(contextualPrompt.includes('<document>\nFull doc text\n</document>'));
    assert.ok(contextualPrompt.includes('<chunk>\nChunk text\n</chunk>'));
  });
});
