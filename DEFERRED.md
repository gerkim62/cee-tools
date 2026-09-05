# Deferred Tasks & Future Enhancements

The following tasks from the Saka backlog have been reviewed and deferred for future milestone releases per user instructions:

---

### 1. Caching Strategy (Item 12)
- **Description**: Implement query response caching (server-side Redis / memory cache for repeated agent queries) and client-side conversation caching in the extension.
- **Decision**: Deferred to prioritize UX responsiveness, prompt accuracy, and stability fixes first.

---

### 2. Full Saka Article JSON Retrieval & FAQ Deep Indexing (Item 17)
- **Description**: Fetch the full raw Saka article JSON to render rich interactive previews in the citation inspector pane and index FAQs / rated embedded links from SakaHub.
- **Decision**: Deferred for now ("defer f0r noe"). The current text excerpt and direct SakaHub link are sufficient for current workflows.

---

### 3. SakaHub In-Page Quote Auto-Highlighter Investigation (Item 18)
- **Description**: Investigate quote highlighting failures in the SakaHub Angular SPA when opening citation links (e.g. dynamic DOM rendering, iframe isolation, custom shadow roots, or non-breaking whitespace mismatches).
- **Decision**: Deferred / ignored for now. Will be revisited when a live DOM snippet or test environment is available to inspect SakaHub's internal article component structure.
