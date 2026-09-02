import TurndownService from 'turndown';

/**
 * Converts any HTML table (including Word-pasted tables lacking <th>/<thead>)
 * into a clean, GitHub-flavored Markdown pipe table.
 * Uses TypeScript type narrowing (instanceof) with zero type assertions ('as').
 */
function convertTableToMarkdown(table: HTMLTableElement): string {
  const rows = Array.from(table.rows);
  if (rows.length === 0) return '';

  // Extract cell texts, normalize internal spaces, and escape markdown pipes
  const tableData = rows.map((row) =>
    Array.from(row.cells).map((cell) =>
      (cell.textContent || '')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\|/g, '\\|')
        .trim()
    )
  );

  const colCount = Math.max(...tableData.map((r) => r.length));
  if (colCount === 0) return '';

  const markdownRows: string[] = [];

  // Row 0: Header row (or first data row treated as header)
  const headerCells = tableData[0] || [];
  const paddedHeader = Array.from({ length: colCount }, (_, i) => headerCells[i] || '');
  markdownRows.push(`| ${paddedHeader.join(' | ')} |`);

  // Row 1: Markdown alignment separator
  const separator = Array.from({ length: colCount }, () => '---');
  markdownRows.push(`| ${separator.join(' | ')} |`);

  // Remaining rows: Data rows
  for (let r = 1; r < tableData.length; r++) {
    const rowCells = tableData[r] || [];
    const paddedRow = Array.from({ length: colCount }, (_, i) => rowCells[i] || '');
    markdownRows.push(`| ${paddedRow.join(' | ')} |`);
  }

  return `\n\n${markdownRows.join('\n')}\n\n`;
}

function createTurndownService(): TurndownService {
  const service = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
    strongDelimiter: '**',
  });

  // Remove non-content elements
  service.remove(['style', 'script', 'meta', 'link', 'title']);

  // Table rule using type narrowing (zero 'as' casts)
  service.addRule('table', {
    filter: 'table',
    replacement: (_content, node) => {
      if (node instanceof HTMLTableElement) {
        return convertTableToMarkdown(node);
      }
      return _content;
    },
  });

  // Strikethrough rule
  service.addRule('strikethrough', {
    filter: ['del', 's'],
    replacement: (content) => `~${content}~`,
  });

  // Replace corporate SharePoint screenshot img tags with concise semantic marker
  service.addRule('images', {
    filter: 'img',
    replacement: (_content, node) => {
      if (node instanceof HTMLImageElement) {
        const alt = node.getAttribute('alt')?.trim();
        return alt ? ` [Screenshot: ${alt}] ` : ' [Screenshot] ';
      }
      return ' [Screenshot] ';
    },
  });

  // Clean empty anchors
  service.addRule('cleanAnchors', {
    filter: (node) => node instanceof HTMLAnchorElement && !node.getAttribute('href'),
    replacement: (content) => content,
  });

  return service;
}

const turndownInstance = createTurndownService();

/**
 * Pre-cleans raw Word/TinyMCE HTML by stripping MSO conditional comments, <o:p>, and <xml>,
 * then converts to clean Markdown using Turndown with robust table conversion.
 */
export function cleanWordHtmlToMarkdown(html: string): string {
  if (!html || typeof html !== 'string') return '';

  // 1. Strip Word conditional comments <!--[if ...]>...<![endif]-->
  let preprocessed = html.replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, '');
  preprocessed = preprocessed.replace(/<!--[\s\S]*?-->/g, '');

  // 2. Remove Word namespace tags like <o:p> and <xml>
  preprocessed = preprocessed.replace(/<\/?(o:p|xml)[^>]*>/gi, '');

  // 3. Convert via Turndown
  let markdown = '';
  try {
    markdown = turndownInstance.turndown(preprocessed);
  } catch (err) {
    console.warn('[Turndown Cleaner] Conversion warning, falling back to basic text:', err);
    markdown = preprocessed.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  }

  // 4. Normalize consecutive newlines and trim whitespace
  return markdown
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+\n/g, '\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
