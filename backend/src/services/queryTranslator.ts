import { config } from '../config.js';
import { chatCompletion } from './openrouter.js';

export interface TranslatedQuery {
  primary: string;    // Clean, canonical search query for dense retrieval & cross-encoder
  fallback: string;   // Primary query + raw user input appended verbatim for safety
  alt: string | null; // Secondary interpretation if two distinct support flows are plausible
}

const SYSTEM_PROMPT = `You are a query translation assistant for Saka Hub, Safaricom's internal knowledge base used by agents during live customer calls. Input is in English, typed quickly and informally: typos, call center abbreviations, product nicknames, and fragmented phrasing.

Task: Rewrite the raw English query into optimized retrieval input for a hybrid dense+sparse RAG pipeline. Never answer the question — only resolve terms, fix typos, and expand intent into official procedural terminology without inventing policies.

Method:
1. Normalize Brand Terms & Acronyms:
   - Resolve product nicknames to official services:
     fuliza → Fuliza M-PESA overdraft | okoa → Okoa Jahazi emergency airtime credit
     bonga → Bonga Points rewards | pochi → Pochi la Biashara merchant business wallet
     tunukiwa → Tunukiwa personalized offers | paybill → Lipa na M-PESA Paybill
     till → Lipa na M-PESA Buy Goods Till | fibre → Safaricom Home Fibre internet
   - Expand call center shorthand:
     rev → reversal | txn / trans → transaction | bal → balance | acc → account | sub → subscription | cust → customer
2. Expand Vague Verbs into Concrete Procedural Actions:
   - stuck / hang / pending → transaction pending, failed, or system timeout
   - block / locked / bar → line barred, SIM PIN/PUK locked, or account restricted
   - reverse / wrong number → transaction reversal request, incorrect recipient dispute
   - cancel / stop → unsubscribe, cancel service, or deactivate
3. Primary Query: Exactly one clear, semantically rich, grammatically complete English sentence. Not a keyword list.
4. Fallback: Primary query with the agent's original raw phrase appended verbatim.
5. Ambiguity: If two distinct support flows are plausible (e.g. SIM swap vs SIM line unbarring), provide a second full English query. Otherwise null.

Output Format: You MUST return a strictly valid JSON object matching this schema:
{
  "primary": "Clear, semantically rich, grammatically complete English sentence",
  "fallback": "Primary query with agent's raw phrase appended verbatim",
  "alt": "Second full query if ambiguous, or null"
}`;

export function parseTranslationResponse(raw: string, rawQuery: string): TranslatedQuery {
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed && typeof parsed === 'object') {
        const primary = typeof parsed.primary === 'string' && parsed.primary.trim()
          ? parsed.primary.trim()
          : rawQuery;
        const fallback = typeof parsed.fallback === 'string' && parsed.fallback.trim()
          ? parsed.fallback.trim()
          : `${primary} ${rawQuery}`.trim();
        const alt = typeof parsed.alt === 'string' && parsed.alt.trim() && !/^none\.?$/i.test(parsed.alt.trim())
          ? parsed.alt.trim()
          : null;

        return { primary, fallback, alt };
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
    primary: primary || rawQuery,
    fallback: fallback || `${primary || rawQuery} ${rawQuery}`.trim(),
    alt,
  };
}

/**
 * Translates raw agent questions into structured retrieval query variants.
 */
export async function translateQuery(rawQuery: string): Promise<TranslatedQuery> {
  const trimmed = rawQuery.trim();
  if (!trimmed) {
    return { primary: '', fallback: '', alt: null };
  }

  try {
    const raw = await chatCompletion(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: trimmed },
      ],
      {
        temperature: 0.0,
        model: config.QUERY_TRANSLATION_MODEL,
        responseFormat: { type: 'json_object' },
      }
    );

    return parseTranslationResponse(raw, trimmed);
  } catch (err) {
    console.warn('[QueryTranslator] Translation failed, falling back to raw query:', err);
    return { primary: trimmed, fallback: trimmed, alt: null };
  }
}
