import { useState, useCallback, useRef } from 'react';
import { ChatMessage, AskStreamServerMessage } from '../../types.js';
import { getBackendUrl, getClientId } from '../../scripts/syncer.js';
import { bgFetch } from '../../scripts/bg-fetch.js';

export function useChat() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversationTitle, setConversationTitle] = useState<string | null>(null);
  const [isCompacted, setIsCompacted] = useState(false);
  const [conversationSummary, setConversationSummary] = useState<string | null>(null);
  const [isCompacting, setIsCompacting] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [statusLog, setStatusLog] = useState<string[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const portRef = useRef<chrome.runtime.Port | null>(null);

  const startNewChat = useCallback(() => {
    if (portRef.current) {
      try {
        portRef.current.disconnect();
      } catch {}
      portRef.current = null;
    }
    setConversationId(null);
    setConversationTitle(null);
    setIsCompacted(false);
    setConversationSummary(null);
    setMessages([]);
    setStatusLog([]);
    setIsStreaming(false);
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    try {
      const backendUrl = await getBackendUrl();
      const res = await bgFetch(`${backendUrl}/conversations/${id}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = res.data;

      setConversationId(data.conversation.id);
      setConversationTitle(data.conversation.title || null);
      setIsCompacted(Boolean(data.conversation.isCompacted));
      setConversationSummary(data.conversation.summary || null);
      const formattedMessages: ChatMessage[] = (data.messages || []).map((m: any) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        citations: m.citations || undefined,
        executionSteps: m.executionSteps || undefined,
        clarifyingQuestion: m.clarifyingQuestion || undefined,
        suggestedFollowUps: m.suggestedFollowUps || undefined,
        createdAt: m.createdAt,
      }));
      setMessages(formattedMessages);
      setStatusLog([]);
      setIsStreaming(false);
    } catch (err) {
      console.error('[useChat] Failed loading conversation via background:', err);
    }
  }, []);

  const compactCurrentConversation = useCallback(async () => {
    if (!conversationId || isCompacting || isStreaming) return;
    setIsCompacting(true);
    try {
      const backendUrl = await getBackendUrl();
      const res = await bgFetch(`${backendUrl}/conversations/${conversationId}/compact`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.data?.error || 'Compaction failed'}`);
      const data = res.data;
      if (data?.newConversation?.id) {
        await loadConversation(data.newConversation.id);
      }
    } catch (err) {
      console.error('[useChat] Compaction failed:', err);
    } finally {
      setIsCompacting(false);
    }
  }, [conversationId, isCompacting, isStreaming, loadConversation]);

  const sendMessage = useCallback(
    async (rawQuestion: string) => {
      const trimmed = rawQuestion.trim();
      if (!trimmed || isStreaming) return;

      const userMsgId = `user_${Date.now()}`;
      const assistantMsgId = `asst_${Date.now()}`;

      const userMsg: ChatMessage = {
        id: userMsgId,
        role: 'user',
        content: trimmed,
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setIsStreaming(true);
      setStatusLog(['> Understanding request...']);

      // Placeholder assistant message
      const assistantMsg: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        citations: [],
        createdAt: new Date().toISOString(),
        isStreaming: true,
      };
      setMessages((prev) => [...prev, assistantMsg]);

      let hasReceivedDone = false;

      try {
        const clientId = await getClientId();
        const backendUrl = await getBackendUrl();

        // Connect long-lived port to background service worker (Bypasses page CORS/CSP)
        const port = chrome.runtime.connect({ name: 'ASK_STREAM' });
        portRef.current = port;

        const formatFriendlyError = (rawErr: string) => {
          return `⚠️ **Ask Saka Service Unavailable**\n\nWe were unable to connect to the knowledge service to answer your question right now. Please try again in a few moments.\n\n<details><summary style="cursor:pointer;color:#94a3b8;font-size:11.5px;margin-top:6px;">Technical details</summary><pre style="font-size:11px;color:#cbd5e1;background:rgba(0,0,0,0.3);padding:6px;border-radius:4px;margin-top:4px;overflow-x:auto;">${rawErr}</pre></details>`;
        };

        port.onMessage.addListener((msg: AskStreamServerMessage) => {
          if (msg.type === 'status') {
            setStatusLog((prev) => {
              const line = `> ${msg.message}`;
              if (prev[prev.length - 1] === line) return prev;
              return [...prev, line];
            });

            if (msg.label && msg.detail) {
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantMsgId) return m;
                  const existing = m.executionSteps || [];
                  const filtered = existing.filter((s) => s.label !== msg.label);
                  return {
                    ...m,
                    executionSteps: [...filtered, { label: msg.label!, detail: msg.detail! }],
                  };
                })
              );
            }
          } else if (msg.type === 'token') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId ? { ...m, content: m.content + msg.delta } : m
              )
            );
          } else if (msg.type === 'citations') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId ? { ...m, citations: msg.citations } : m
              )
            );
          } else if (msg.type === 'done') {
            hasReceivedDone = true;
            if (msg.conversationId) {
              setConversationId(msg.conversationId);
            }
            if (msg.conversationTitle) {
              setConversationTitle(msg.conversationTitle);
            }
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      content: msg.answer || m.content,
                      citations: msg.citations || m.citations,
                      executionSteps: msg.executionSteps || m.executionSteps,
                      clarifyingQuestion: msg.clarifyingQuestion,
                      suggestedFollowUps: msg.suggestedFollowUps,
                      isStreaming: false,
                    }
                  : m
              )
            );
            setIsStreaming(false);
            try {
              port.disconnect();
            } catch {}
            portRef.current = null;
          } else if (msg.type === 'error') {
            hasReceivedDone = true;
            const friendly = formatFriendlyError(msg.message);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      content: friendly,
                      isStreaming: false,
                    }
                  : m
              )
            );
            setIsStreaming(false);
            try {
              port.disconnect();
            } catch {}
            portRef.current = null;
          }
        });

        port.onDisconnect.addListener(() => {
          if (!hasReceivedDone) {
            const rawMsg = chrome.runtime.lastError?.message || 'Connection lost';
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      content: m.content
                        ? `${m.content}\n\n⚠️ *(Response was interrupted due to a temporary connection issue. Please try asking again.)*`
                        : `⚠️ **Connection Interrupted**\n\nThe connection was closed before completing your response. Please try submitting your question again.\n\n<details><summary style="cursor:pointer;color:#94a3b8;font-size:11.5px;margin-top:6px;">Technical details</summary><pre style="font-size:11px;color:#cbd5e1;background:rgba(0,0,0,0.3);padding:6px;border-radius:4px;margin-top:4px;overflow-x:auto;">${rawMsg}</pre></details>`,
                      isStreaming: false,
                    }
                  : m
              )
            );
          }
          setIsStreaming(false);
          portRef.current = null;
        });

        port.postMessage({
          type: 'START_ASK',
          question: trimmed,
          conversationId: conversationId || undefined,
          clientId,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  content: `❌ **Connection error**: ${msg}`,
                  isStreaming: false,
                }
              : m
          )
        );
        setIsStreaming(false);
      }
    },
    [conversationId, isStreaming]
  );

  return {
    conversationId,
    conversationTitle,
    isCompacted,
    conversationSummary,
    isCompacting,
    compactCurrentConversation,
    messages,
    statusLog,
    isStreaming,
    sendMessage,
    startNewChat,
    loadConversation,
  };
}
