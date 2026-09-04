import { config } from '../config.js';
import { chatCompletion } from './openrouter.js';
import { QUERY_TRANSLATION_SYSTEM_PROMPT } from '../prompts.js';
import { RAG_CONSTANTS } from '../constants.js';

export interface TranslatedQuery {
  needsContext: boolean;
  primary: string;    // Clean, canonical search query for dense retrieval & cross-encoder
  fallback: string;   // Primary query + raw user input appended verbatim for safety
  alt: string | null; // Secondary interpretation if two distinct support flows are plausible
}

export function parseTranslationResponse(raw: string, rawQuery: string): TranslatedQuery {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed && typeof parsed === 'object') {
        const needsContext = parsed.needsContext !== false;
        const primary = typeof parsed.primary === 'string' && parsed.primary.trim()
          ? parsed.primary.trim()
          : rawQuery;
        const fallback = typeof parsed.fallback === 'string' && parsed.fallback.trim()
          ? parsed.fallback.trim()
          : `${primary} ${rawQuery}`.trim();
        const alt = typeof parsed.alt === 'string' && parsed.alt.trim() && !/^none\.?$/i.test(parsed.alt.trim())
          ? parsed.alt.trim()
          : null;

        return { needsContext, primary, fallback, alt };
      }
    }
  } catch (err) {
    console.warn('[QueryTranslator] JSON parse warning, falling back to line extraction:', err);
  }

  // Graceful fallback for plaintext lines if model ever omits JSON brackets
  const lines = raw.split('\n');
  let primary = '';
  let fallback = '';
  let alt: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^primary query\s*:\s*/i.test(trimmed)) {
      primary = trimmed.replace(/^primary query\s*:\s*/i, '').trim();
    } else if (/^fallback\s*:\s*/i.test(trimmed)) {
      fallback = trimmed.replace(/^fallback\s*:\s*/i, '').trim();
    } else if (/^alt interpretation\s*:\s*/i.test(trimmed)) {
      const val = trimmed.replace(/^alt interpretation\s*:\s*/i, '').trim();
      if (val && !/^none\.?$/i.test(val)) {
        alt = val;
      }
    }
  }

  return {
    needsContext: true,
    primary: primary || rawQuery,
    fallback: fallback || `${primary || rawQuery} ${rawQuery}`.trim(),
    alt,
  };
}

/**
 * Translates raw agent questions into structured retrieval query variants.
 * Resolves pronouns / references using conversation context when available.
 */
export async function translateQuery(
  rawQuery: string,
  previousTurnsContext?: string
): Promise<TranslatedQuery> {
  const trimmed = rawQuery.trim();
  if (!trimmed) {
    return { needsContext: true, primary: '', fallback: '', alt: null };
  }

  const userPrompt = previousTurnsContext
    ? `Recent Conversation Context:\n${previousTurnsContext}\n\nCurrent Question: ${trimmed}`
    : trimmed;

  try {
    const raw = await chatCompletion(
      [
        { role: 'system', content: QUERY_TRANSLATION_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      {
        temperature: RAG_CONSTANTS.QUERY_TRANSLATION_TEMPERATURE,
        model: config.QUERY_TRANSLATION_MODEL,
        responseFormat: { type: 'json_object' },
      }
    );

    return parseTranslationResponse(raw, trimmed);
  } catch (err) {
    console.warn('[QueryTranslator] Translation failed, falling back to raw query:', err);
    return { needsContext: true, primary: trimmed, fallback: trimmed, alt: null };
  }
}
