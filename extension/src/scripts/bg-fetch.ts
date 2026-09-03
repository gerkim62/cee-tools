/**
 * Executes a network fetch through the extension background service worker.
 * Bypasses host page Content Security Policy (CSP), mixed-content blocks, and CORS restrictions.
 */
export async function bgFetch<T = any>(
  url: string,
  options?: RequestInit
): Promise<{ ok: boolean; status: number; data: T }> {
  return new Promise((resolve, reject) => {
    let serializedHeaders: Record<string, string> | undefined;
    if (options?.headers) {
      if (options.headers instanceof Headers) {
        serializedHeaders = {};
        options.headers.forEach((val, key) => {
          serializedHeaders![key] = val;
        });
      } else if (Array.isArray(options.headers)) {
        serializedHeaders = Object.fromEntries(options.headers);
      } else {
        serializedHeaders = options.headers as Record<string, string>;
      }
    }

    const payload = {
      type: 'BG_FETCH' as const,
      url,
      options: options
        ? {
            method: options.method,
            headers: serializedHeaders,
            body: typeof options.body === 'string' ? options.body : undefined,
          }
        : undefined,
    };

    chrome.runtime.sendMessage(payload, (res) => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
      if (!res || !res.success) {
        return reject(new Error(res?.error || 'Background network request failed'));
      }
      resolve({ ok: res.ok, status: res.status, data: res.data });
    });
  });
}
