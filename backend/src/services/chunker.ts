import { MarkdownTextSplitter, RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { config } from '../config.js';
import { RAG_CONSTANTS } from '../constants.js';

export interface ChunkMetadata {
  articleId: string;
  articleTitle: string;
  articleNumber?: string;
  sectionHeading: string;
  lastUpdated: string;
  chunkIndex: number;
}

export interface ChunkResult {
  text: string;
  parentText: string;
  structuralPrefix: string;
  metadata: ChunkMetadata;
  textFragment: string;
}

/**
 * Encodes a text fragment component per W3C Text Fragment specification.
 * Syntactical delimiters dash (-), comma (,), and ampersand (&) inside
 * text words must be percent-encoded.
 */
export function encodeTextFragment(text: string): string {
  return encodeURIComponent(text)
    .replace(/-/g, '%2D')
    .replace(/,/g, '%2C')
    .replace(/&/g, '%26');
}

/**
 * Decodes common HTML entities to their literal character representation.
 */
export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * Strips markdown emphasis markers from headings (e.g. "**Title**" -> "Title")
 */
function cleanHeadingText(text: string): string {
  return decodeHtmlEntities(text)
    .replace(/^(\*\*|__|\*|_)/, '')
    .replace(/(\*\*|__|\*|_)$/, '')
    .replace(/^#+\s*/, '')
    .trim();
}

/**
 * Generates an adaptive Chrome Text Fragment (#:~:text=...)
 * - If words < 10: uses exact textStart string (#:~:text=phrase)
 * - If words >= 10: uses official Range format (#:~:text=textStart,textEnd)
 */
export function generateTextFragment(quote: string): string {
  // Decode HTML entities and strip Markdown syntax carefully without breaking USSD codes like *334#
  let clean = decodeHtmlEntities(quote)
    // Strip markdown links [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Strip bold/italic markdown markers: **text** or __text__
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    // Strip inline code `code`
    .replace(/`([^`]+)`/g, '$1')
  // Strip markdown heading markers at line start: # Title
  clean = clean.replace(/^#+\s+/gm, '').replace(/\s+/g, ' ').trim();

  // Strip leading list bullets, middle dots, numbering and punctuation without stripping USSD codes like *334#
  clean = clean
    .replace(/^[·•\u00b7\u2022]\s*/, '') // Middle dot or bullet
    .replace(/^[-–—]\s+/, '')            // Dash list marker
    .replace(/^\*\s+/, '')               // Markdown star bullet (space required, preserves *334#)
    .replace(/^\d+[\.\)]\s+/, '')        // Numbered list: "1. " or "1) "
    .replace(/^[a-zA-Z][\.\)]\s+/, '')   // Letter list: "a. " or "a) "
    .replace(/^\([a-zA-Z\d]+\)\s+/, '')  // Parenthesized list: "(1) " or "(a) "
    .replace(/[\s·•\u00b7\u2022\-]+$/, '') // Trailing bullets or dashes
    .trim();

  const words = clean.split(' ').filter(Boolean);
  if (words.length === 0) return '';

  if (words.length < RAG_CONSTANTS.TEXT_FRAGMENT.RANGE_THRESHOLD_WORDS) {
    return `#:~:text=${encodeTextFragment(words.join(' '))}`;
  }

  // Range format: first N words and last N words separated by literal comma
  const startWords = words.slice(0, RAG_CONSTANTS.TEXT_FRAGMENT.SLICE_WORDS_COUNT).join(' ');
  const endWords = words.slice(-RAG_CONSTANTS.TEXT_FRAGMENT.SLICE_WORDS_COUNT).join(' ');
  return `#:~:text=${encodeTextFragment(startWords)},${encodeTextFragment(endWords)}`;
}

interface SectionBlock {
  headingPath: string;
  content: string;
}

/**
 * Parses markdown into hierarchical sections based on #, ##, ### headings.
 */
export function parseMarkdownSections(markdown: string): SectionBlock[] {
  const lines = markdown.split('\n');
  const sections: SectionBlock[] = [];

  let currentH1 = '';
  let currentH2 = '';
  let currentH3 = '';
  let currentBuffer: string[] = [];

  function flushCurrent() {
    const content = currentBuffer.join('\n').trim();
    if (content) {
      const headingPath = [currentH1, currentH2, currentH3].filter(Boolean).join(' > ') || 'General';
      sections.push({ headingPath, content });
    }
    currentBuffer = [];
  }

  for (const line of lines) {
    const h1Match = line.match(/^#\s+(.+)$/);
    const h2Match = line.match(/^##\s+(.+)$/);
    const h3Match = line.match(/^###\s+(.+)$/);

    if (h1Match) {
      flushCurrent();
      currentH1 = cleanHeadingText(h1Match[1]);
      currentH2 = '';
      currentH3 = '';
    } else if (h2Match) {
      flushCurrent();
      currentH2 = cleanHeadingText(h2Match[1]);
      currentH3 = '';
    } else if (h3Match) {
      flushCurrent();
      currentH3 = cleanHeadingText(h3Match[1]);
    } else {
      currentBuffer.push(line);
    }
  }

  flushCurrent();
  return sections;
}

/**
 * Splits an article into chunks using hierarchical Markdown heading parsing
 * followed by RecursiveCharacterTextSplitter within each section.
 */
export async function splitArticle(article: {
  id: string;
  title: string;
  articleNumber?: string;
  markdownContent: string;
  lastUpdated: string;
}): Promise<ChunkResult[]> {
  const sections = parseMarkdownSections(article.markdownContent);

  const recursiveSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: config.CHUNK_SIZE,
    chunkOverlap: config.CHUNK_OVERLAP,
    separators: [...RAG_CONSTANTS.SPLITTER_SEPARATORS],
  });

  const results: ChunkResult[] = [];
  let chunkIndex = 0;

  for (const section of sections) {
    const subChunks = await recursiveSplitter.splitText(section.content);

    for (const text of subChunks) {
      const trimmed = text.trim();
      if (!trimmed) continue;

      const structuralPrefix = `[Article: ${article.title} | Section: ${section.headingPath}]`;
      const textFragment = generateTextFragment(trimmed);

      results.push({
        text: trimmed,
        parentText: section.content.trim(),
        structuralPrefix,
        metadata: {
          articleId: article.id,
          articleTitle: article.title,
          articleNumber: article.articleNumber,
          sectionHeading: section.headingPath,
          lastUpdated: article.lastUpdated,
          chunkIndex: chunkIndex++,
        },
        textFragment,
      });
    }
  }

  // Fallback if parsing produced no sections
  if (results.length === 0 && article.markdownContent.trim()) {
    const fallbackChunks = await recursiveSplitter.splitText(article.markdownContent);
    for (const text of fallbackChunks) {
      const trimmed = text.trim();
      if (!trimmed) continue;
      results.push({
        text: trimmed,
        parentText: article.markdownContent.trim(),
        structuralPrefix: `[Article: ${article.title} | Section: General]`,
        metadata: {
          articleId: article.id,
          articleTitle: article.title,
          articleNumber: article.articleNumber,
          sectionHeading: 'General',
          lastUpdated: article.lastUpdated,
          chunkIndex: chunkIndex++,
        },
        textFragment: generateTextFragment(trimmed),
      });
    }
  }

  return results;
}
