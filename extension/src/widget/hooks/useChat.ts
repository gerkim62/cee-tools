import { useState, useCallback, useRef } from 'react';
import { ChatMessage, AskStreamServerMessage } from '../../types.js';
import { getBackendUrl, getClientId } from '../../scripts/syncer.js';
import { bgFetch } from '../../scripts/bg-fetch.js';

export function useChat() {
  const [conversationId, setConversationId] = useState<string | null>(null);
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
      const formattedMessages: ChatMessage[] = (data.messages || []).map((m: any) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        citations: m.citations || undefined,
        createdAt: m.createdAt,
      }));
      setMessages(formattedMessages);
      setStatusLog([]);
      setIsStreaming(false);
    } catch (err) {
      console.error('[useChat] Failed loading conversation via background:', err);
    }
  }, []);

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

      try {
        const clientId = await getClientId();

        // Connect long-lived port to background service worker (Bypasses page CORS/CSP)
        const port = chrome.runtime.connect({ name: 'ASK_STREAM' });
        portRef.current = port;

        port.onMessage.addListener((msg: AskStreamServerMessage) => {
          if (msg.type === 'status') {
            setStatusLog((prev) => {
              const line = `> ${msg.message}`;
              if (prev[prev.length - 1] === line) return prev;
              return [...prev, line];
            });
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
            if (msg.conversationId) {
              setConversationId(msg.conversationId);
            }
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      content: msg.answer || m.content,
                      citations: msg.citations || m.citations,
                      isStreaming: false,
                    }
                  : m
              )
            );
            setIsStreaming(false);
            port.disconnect();
            portRef.current = null;
          } else if (msg.type === 'error') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      content: `❌ **Error querying SakaHub**: ${msg.message}`,
                      isStreaming: false,
                    }
                  : m
              )
            );
            setIsStreaming(false);
            port.disconnect();
            portRef.current = null;
          }
        });

        port.onDisconnect.addListener(() => {
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
    messages,
    statusLog,
    isStreaming,
    sendMessage,
    startNewChat,
    loadConversation,
  };
}
