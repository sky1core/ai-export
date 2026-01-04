// ChatGPT Exporter (ISOLATED world)

import {
  type Conversation,
  type ExportOptions,
  type ExportResult,
  type ImageInfo,
  type FileInfo,
  type SearchResult,
} from '../types/index.js';

// ChatGPT API 원본 데이터 타입
interface ChatGPTRawData {
  title?: string;
  create_time?: number;
  mapping?: Record<string, ChatGPTNode>;
  current_node?: string;
  default_model_slug?: string;
  model_slug?: string;
}

interface ChatGPTNode {
  id: string;
  parent?: string;
  children?: string[];
  message?: ChatGPTMessage;
}

interface ChatGPTMessage {
  author?: { role: string; name?: string };
  content: ChatGPTContent;
  create_time?: number;
  metadata?: ChatGPTMessageMetadata;
  recipient?: string;
  channel?: string;
}

interface ChatGPTContent {
  content_type: string;
  parts?: (string | ChatGPTImagePart)[];
  text?: string;
  content?: string;  // reasoning_recap에서 사용
  thoughts?: { content?: string; summary?: string }[];
  language?: string;
  response_format_name?: string;
  user_profile?: string;
  user_instructions?: string;
}

interface ChatGPTImagePart {
  content_type: string;
  asset_pointer?: string;
}

interface ChatGPTAttachment {
  id: string;
  name?: string;
  mime_type?: string;
  size?: number;
  source?: string;
  is_big_paste?: boolean;
}

interface ChatGPTMessageMetadata {
  model_slug?: string;
  reasoning_title?: string;
  reasoning_status?: string;
  attachments?: ChatGPTAttachment[];
  search_queries?: { q: string }[];
  search_result_groups?: ChatGPTSearchResultGroup[];
  dalle?: { prompt?: string };
  is_visually_hidden_from_conversation?: boolean;
  user_context_message_data?: { about_model_message?: string };
  content_references?: ChatGPTContentReference[];
  canvas?: { textdoc_id?: string };
  async_task_type?: string;
  image_gen_title?: string;
  async_task_title?: string;
}

interface ChatGPTSearchResultGroup {
  domain?: string;
  entries?: { url: string; title: string; snippet?: string; attribution?: string }[];
}

interface ChatGPTContentReference {
  start_idx: number;
  end_idx: number;
  matched_text?: string;
  alt?: string;
}

type ExtractedHiddenMessage = {
  category: string;
  title?: string | null;
  depth?: number | null;
  content: string;
};

interface ExtractedMessage {
  nodeId?: string;
  role: string;
  content: string;
  timestamp?: number;
  images?: string[];
  files?: FileInfo[];
  model?: string;
  searchQueries?: { q: string }[];
  searchResults?: SearchResult[];
  dalle?: { prompt?: string };
  hidden?: boolean;
  customInstructions?: string;
  toolName?: string;
  imageTitle?: string;
  dallePrompt?: string;
  canvasFile?: string;
  canvasOriginalName?: string | null;
  thinkingContent?: string;
  thinkingTitle?: string;
  hiddenMessages?: ExtractedHiddenMessage[];
}

interface ImageDownload {
  filename: string;
  blob: Blob;
}

interface AttachmentDownload {
  filename: string;
  blob: Blob;
  originalName: string;
}

interface CanvasFile {
  filename: string;
  content: string;
  docId: string;
  version: number;
}

interface CanvasState {
  content: string;
  title: string;
  type: string;
  version: number;
  idPrefix: string;
}

interface PendingThoughts {
  content: string;
  title: string;
}

// AIExport 확장
Object.assign(AIExport, {
  name: 'ChatGPT',
  service: 'chatgpt',
  serviceName: 'ChatGPT',

  async export(options: ExportOptions = {}): Promise<ExportResult> {
    try {
      const conversationId = this.getConversationIdFromUrl();
      if (!conversationId) {
        throw new Error('대화 ID를 찾을 수 없습니다. /c/{id} 페이지에서 실행해주세요.');
      }

      const token = await this.getAccessToken();
      const rawData: ChatGPTRawData = await this.fetchConversationData(conversationId, token);
      const title = rawData.title || 'ChatGPT Conversation';
      const filename = AIExport.utils.generateFilename(title, 'chatgpt', conversationId);
      const basename = AIExport.utils.getBasename(filename);

      // 메시지 추출 및 이미지/캔버스 다운로드
      const { messages, images, canvasFiles, files } = await this.extractMessagesWithImages(
        rawData.mapping, rawData.current_node, { conversationId, token, basename }
      );

      // 표준 Conversation 포맷으로 변환
      const conversation = this.buildStandardConversation(rawData, {
        messages,
        images,
        basename,
        options
      });

      // 공통 toMarkdown으로 마크다운 생성
      const markdown = AIExport.toMarkdown(conversation, options);

      // 마크다운 다운로드
      await AIExport.utils.downloadMarkdown(markdown, filename);

      // 이미지 다운로드 (서브디렉토리에)
      for (const img of images) {
        try {
          const dataUrl = await AIExport.utils.blobToDataUrl(img.blob);
          await AIExport.utils.downloadFile(dataUrl, `${basename}/${img.filename}`);
        } catch (e) {
          console.error('[ChatGPT Exporter] Image download failed:', img.filename, e);
        }
      }

      // 캔버스 파일 다운로드 (서브디렉토리에)
      for (const canvas of canvasFiles) {
        try {
          const blob = new Blob([canvas.content], { type: 'application/octet-stream' });
          const dataUrl = await AIExport.utils.blobToDataUrl(blob);
          await AIExport.utils.downloadFile(dataUrl, `${basename}/${canvas.filename}`);
        } catch (e) {
          console.error('[ChatGPT Exporter] Canvas download failed:', canvas.filename, e);
        }
      }

      // 첨부 파일 다운로드 (서브디렉토리에)
      for (const file of files) {
        try {
          const dataUrl = await AIExport.utils.blobToDataUrl(file.blob);
          await AIExport.utils.downloadFile(dataUrl, `${basename}/${file.filename}`);
        } catch (e) {
          console.error('[ChatGPT Exporter] File download failed:', file.filename, e);
        }
      }

      return {
        success: true,
        filename,
        title,
        createdAt: rawData.create_time ? new Date(rawData.create_time * 1000).toISOString() : null,
        conversationId,
        service: 'chatgpt',
        model: rawData.default_model_slug || rawData.model_slug,
        filesCount: images.length + canvasFiles.length + files.length
      };
    } catch (error) {
      console.error('[ChatGPT Exporter]', error);
      return { success: false, error: (error as Error).message };
    }
  },

  // ChatGPT 원본 데이터 → 표준 Conversation 포맷
  buildStandardConversation(
    rawData: ChatGPTRawData,
    { messages, basename }: { messages: ExtractedMessage[]; images: ImageDownload[]; basename: string; options: ExportOptions }
  ): Conversation {
    const builder = AIExport.createConversationBuilder({
      title: rawData.title || 'ChatGPT Conversation',
      service: 'chatgpt',
      createdAt: rawData.create_time ? new Date(rawData.create_time * 1000).toISOString() : null,
      basename
    });

    for (const msg of messages) {
      // 메인 메시지 content 구성
      const rawContent = this.removeCitationMarkers(msg.content || '');

      // 메시지 타입별 분기 처리 (타입 안전성 보장)
      if (msg.customInstructions) {
        // 숨은 메시지: 커스텀 인스트럭션
        builder.addHiddenMessage({
          category: 'Custom Instructions',
          content: msg.customInstructions
        });

      } else if (msg.role === 'user') {
        // User: 사용자 입력
        const userImages = msg.images?.length
          ? msg.images.map((imgFilename: string): ImageInfo => ({
            filename: imgFilename,
            originalName: imgFilename
          }))
          : undefined;

        const userInput = {
          content: rawContent.trim(),
          timestamp: msg.timestamp ? msg.timestamp * 1000 : null,
          imageTitle: msg.imageTitle || undefined,
          images: userImages,
          files: msg.files || undefined
        };

        if (userInput.content || userImages?.length) {
          builder.addUserMessage(userInput);
        }

      } else if (msg.role === 'assistant') {
        // Assistant: 응답 (Thinking, DALL-E 등은 hiddenMessages로)
        const hiddenMessages: { category: string; title?: string | null; depth?: number | null; content: string }[] = [];

        // Thinking
        if (msg.thinkingContent) {
          hiddenMessages.push({
            category: 'Thinking',
            title: msg.thinkingTitle || null,
            content: msg.thinkingContent
          });
        }

        // DALL-E 프롬프트
        const dallePrompt = msg.dallePrompt || msg.dalle?.prompt;
        if (dallePrompt) {
          hiddenMessages.push({
            category: 'DALL-E',
            content: `\`\`\`\n${dallePrompt}\n\`\`\``
          });
        }

        if (msg.hiddenMessages?.length) {
          hiddenMessages.push(...msg.hiddenMessages);
        }

        const assistantImages = msg.images?.length
          ? msg.images.map((imgFilename: string): ImageInfo => ({
            filename: imgFilename,
            originalName: imgFilename
          }))
          : undefined;

        const assistantFiles: FileInfo[] = [];
        if (msg.canvasFile) {
          assistantFiles.push({
            filename: msg.canvasFile,
            originalName: msg.canvasOriginalName || msg.canvasFile
          });
        }
        if (msg.files?.length) {
          assistantFiles.push(...msg.files);
        }

        const assistantInput = {
          content: rawContent.trim(),
          timestamp: msg.timestamp ? msg.timestamp * 1000 : null,
          model: msg.model || null,
          imageTitle: msg.imageTitle || undefined,
          images: assistantImages,
          files: assistantFiles.length ? assistantFiles : undefined,
          hiddenMessages: hiddenMessages.length ? hiddenMessages : undefined
        };

        if (assistantInput.content || assistantImages?.length || assistantFiles?.length || hiddenMessages.length) {
          builder.addAssistantMessage(assistantInput);
        }

      } else {
        // 숨은 메시지: tool 메시지 등
        if (rawContent.trim()) {
          builder.addHiddenMessage({
            category: 'Tool',
            content: rawContent.trim()
          });
        }
      }
    }

    return builder.build();
  },

  // 메시지와 이미지를 함께 추출
  async extractMessagesWithImages(
    mapping: Record<string, ChatGPTNode> | undefined,
    currentNode: string | undefined,
    { conversationId, token, basename }: { conversationId: string; token: string; basename: string }
  ): Promise<{ messages: ExtractedMessage[]; images: ImageDownload[]; canvasFiles: CanvasFile[]; files: AttachmentDownload[] }> {
    const messages: ExtractedMessage[] = [];
    const images: ImageDownload[] = [];
    const canvasFiles: CanvasFile[] = [];
    const files: AttachmentDownload[] = [];
    let imageCounter = 1;
    let attachmentCounter = 1;

    // Canvas 상태 관리 (버전별 저장)
    let pendingCanvasUpdate: Record<string, unknown> | null = null;
    const canvasTexts: Record<string, string> = {};
    const canvasStates: Record<string, CanvasState> = {};

    // assistant에 합칠 숨은 메시지 (Tool Call 등)
    const hiddenMessagesByAssistantId = new Map<string, ExtractedHiddenMessage[]>();
    const searchResultsByAssistantId = new Map<string, SearchResult[]>();
    const nextAssistantIdByNode = new Map<string, string | null>();
    const attachmentIdToFilename = new Map<string, string>();
    const usedAttachmentFilenames = new Set<string>();

    // DALL-E 프롬프트 상태 관리
    let pendingDallePrompt: string | null = null;

    // Canvas 파일 pending (다음 텍스트 assistant 메시지에 합침)
    let pendingCanvasFile: string | null = null;
    let pendingCanvasOriginalName: string | null = null;

    const ensureUniqueFilename = (filename: string): string => {
      let candidate = filename;
      if (!usedAttachmentFilenames.has(candidate)) {
        usedAttachmentFilenames.add(candidate);
        return candidate;
      }
      const dotIndex = candidate.lastIndexOf('.');
      const base = dotIndex >= 0 ? candidate.slice(0, dotIndex) : candidate;
      const ext = dotIndex >= 0 ? candidate.slice(dotIndex) : '';
      let counter = 2;
      while (usedAttachmentFilenames.has(`${base}_${counter}${ext}`)) {
        counter++;
      }
      candidate = `${base}_${counter}${ext}`;
      usedAttachmentFilenames.add(candidate);
      return candidate;
    };

    const fetchAttachment = async (attachment: ChatGPTAttachment): Promise<AttachmentDownload | null> => {
      if (!attachment.id) return null;
      const attachmentUrl = `https://chatgpt.com/backend-api/conversation/${conversationId}/attachment/${attachment.id}/download`;
      const attachResp = await fetch(attachmentUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      });

      if (!attachResp.ok) {
        throw new Error(`Attachment API failed: ${attachResp.status}`);
      }

      const attachJson = await attachResp.json();
      const signedUrl = attachJson.download_url;

      if (!signedUrl || !signedUrl.includes('sig=')) {
        console.warn('[ChatGPT] No valid signed URL:', signedUrl);
        return null;
      }

      const blob = await AIExport.utils.fetchAsBlob(signedUrl);
      const fallbackExt = AIExport.utils.getExtensionFromMime(attachment.mime_type || '') || '';
      const sanitizedName = attachment.name ? AIExport.utils.sanitizeFilename(attachment.name) : '';
      const baseName = sanitizedName || `file${fallbackExt}`;
      const idPrefix = attachment.id.slice(0, 8);
      const filename = `upload_${idPrefix}_${baseName}`;

      return { filename, blob, originalName: attachment.name || baseName };
    };

    const normalizeSearchQueries = (metadata?: ChatGPTMessageMetadata): { q: string }[] => {
      if (!metadata?.search_queries?.length) return [];
      return metadata.search_queries
        .map(q => (typeof q === 'string' ? q : q.q))
        .filter(Boolean)
        .map(q => ({ q: String(q) }));
    };

    const normalizeSearchResults = (metadata?: ChatGPTMessageMetadata): SearchResult[] => {
      if (!metadata?.search_result_groups?.length) return [];
      return metadata.search_result_groups.flatMap(group =>
        (group.entries || []).map(entry => ({
          url: entry.url,
          title: entry.title,
          domain: group.domain || entry.attribution || null
        }))
      );
    };

    const formatSearchResults = (results: SearchResult[]): string => {
      const lines: string[] = [];
      for (const result of results) {
        if (result.url && result.title) {
          let line = `- [${result.title}](${result.url})`;
          if (result.domain) {
            line += ` · ${result.domain}`;
          }
          lines.push(line);
        }
      }
      return lines.join('\n');
    };

    const appendHiddenMessage = (nodeId: string, sysMsg: ExtractedHiddenMessage): void => {
      const targetId = nextAssistantIdByNode.get(nodeId);
      if (!targetId) return;
      const list = hiddenMessagesByAssistantId.get(targetId) || [];
      list.push(sysMsg);
      hiddenMessagesByAssistantId.set(targetId, list);
    };

    const appendSearchResults = (nodeId: string, results: SearchResult[]): void => {
      if (!results.length) return;
      const targetId = nextAssistantIdByNode.get(nodeId);
      if (!targetId) return;
      const list = searchResultsByAssistantId.get(targetId) || [];
      list.push(...results);
      searchResultsByAssistantId.set(targetId, list);
    };

    const pushReasoningMessage = (nodeId: string, content: string, title?: string) => {
      const normalizedContent = content ?? '';
      if (!normalizedContent.trim()) return;
      appendHiddenMessage(nodeId, { category: 'Reasoning', title: title ?? null, content: normalizedContent });
    };

    const joinWithLineBreak = (parts: string[]): string =>
      parts.filter(Boolean).join('\n\n');

    const pushSearchQueries = (nodeId: string, queries: { q: string }[], title?: string) => {
      if (!queries.length) return;
      appendHiddenMessage(nodeId, {
        category: 'Search',
        title: title ?? null,
        content: ''
      });
    };

    const formatCodeBlock = (text: string, language?: string): string => {
      if (!text) return text;
      if (text.includes('```')) return text;
      let trimmedText = text;
      if (trimmedText.endsWith('\n')) {
        trimmedText = trimmedText.slice(0, -1);
        if (trimmedText.endsWith('\r')) {
          trimmedText = trimmedText.slice(0, -1);
        }
      }
      const lang = language && language !== 'unknown' ? language : '';
      const fence = lang ? '```' + lang : '```';
      return fence + '\n' + trimmedText + '\n```';
    };

    const formatToolCallBlock = (text: string): string => {
      const trimmed = text.trim();
      if (!trimmed) return '';
      if (trimmed.includes('```')) {
        return trimmed;
      }
      // JSON이면 pretty-print
      try {
        const parsed = JSON.parse(trimmed);
        return `\`\`\`\n${JSON.stringify(parsed, null, 2)}\n\`\`\``;
      } catch {
        return `\`\`\`\n${trimmed}\n\`\`\``;
      }
    };

    const formatToolResultBlock = (text: string): string => {
      const trimmed = text.trim();
      if (!trimmed) return '';
      if (trimmed.includes('```')) {
        return trimmed;
      }
      // JSON이면 pretty-print
      try {
        const parsed = JSON.parse(trimmed);
        return `\`\`\`\n${JSON.stringify(parsed, null, 2)}\n\`\`\``;
      } catch {
        return `\`\`\`\n${trimmed}\n\`\`\``;
      }
    };

    const stripFenceMarkers = (text: string): string => {
      const fence = '```';
      const start = text.indexOf(fence);
      const end = text.lastIndexOf(fence);
      if (start === -1 || end === -1 || end === start) return text;
      return text.slice(0, start) + text.slice(start + fence.length, end) + text.slice(end + fence.length);
    };

    if (!mapping) return { messages, images, canvasFiles, files };

    // currentNode가 없으면 기존 방식으로 fallback
    if (!currentNode) {
      return { messages: this.extractMessagesLegacy(mapping), images: [], canvasFiles: [], files: [] };
    }

    // current_node에서 root까지 역추적
    const path: string[] = [];
    let nodeId: string | undefined = currentNode;
    while (nodeId) {
      path.push(nodeId);
      const node: ChatGPTNode | undefined = mapping[nodeId];
      if (!node) break;
      nodeId = node.parent;
    }
    path.reverse();

    const isAssistantAnchor = (nodeId: string): boolean => {
      const msg = mapping?.[nodeId]?.message;
      if (!msg) return false;
      if (msg.author?.role !== 'assistant') return false;
      if (msg.recipient && msg.recipient !== 'all') return false;
      if (msg.metadata?.is_visually_hidden_from_conversation) return false;
      if (msg.metadata?.reasoning_status === 'is_reasoning') return false;
      const contentType = msg.content?.content_type;
      if (!contentType) return false;
      if (contentType === 'thoughts') return false;
      if (contentType === 'reasoning_recap') return false;
      if (contentType === 'model_editable_context') return false;
      if (contentType === 'user_editable_context') return false;
      return true;
    };

    let nextAssistantId: string | null = null;
    for (let i = path.length - 1; i >= 0; i--) {
      const id = path[i];
      if (isAssistantAnchor(id)) {
        nextAssistantId = id;
      }
      nextAssistantIdByNode.set(id, nextAssistantId);
    }

    // 경로상의 노드에서 메시지 추출
    for (const id of path) {
      const node = mapping[id];
      if (!node) continue;

      const msg = node.message;
      if (!msg || !msg.content) continue;

      const role = msg.author?.role;
      if (role !== 'user' && role !== 'assistant' && role !== 'system' && role !== 'tool') continue;

      const contentType = msg.content.content_type;
      const toolName = msg.author?.name;
      const isReasoning = msg.metadata?.reasoning_status === 'is_reasoning';
      let content = '';
      const messageImages: string[] = [];
      const metadataSearchQueries = normalizeSearchQueries(msg.metadata);
      const metadataSearchResults = normalizeSearchResults(msg.metadata);
      let messageFiles: FileInfo[] | undefined;

      if (role === 'tool' && toolName === 'file_search' && contentType === 'multimodal_text') {
        continue;
      }

      if (msg.metadata?.attachments?.length) {
        const attachmentFiles: FileInfo[] = [];
        for (const attachment of msg.metadata.attachments) {
          if (!attachment.id) continue;
          const cached = attachmentIdToFilename.get(attachment.id);
          if (cached) {
            attachmentFiles.push({ filename: cached, originalName: attachment.name || cached });
            continue;
          }
          try {
            const downloaded = await fetchAttachment(attachment);
            if (downloaded) {
              files.push(downloaded);
              attachmentIdToFilename.set(attachment.id, downloaded.filename);
              attachmentFiles.push({
                filename: downloaded.filename,
                originalName: downloaded.originalName
              });
              attachmentCounter++;
            }
          } catch (e) {
            console.error('[ChatGPT Exporter] Attachment download failed:', attachment.name || attachment.id, e);
          }
        }
        if (attachmentFiles.length) {
          messageFiles = attachmentFiles;
        }
      }

      // Reasoning 영역 처리: reasoning_status가 'is_reasoning'인 메시지들
      if (isReasoning) {
        const reasoningTitleFromMeta =
          role === 'assistant' ? msg.metadata?.reasoning_title || undefined : undefined;
        if (metadataSearchQueries.length) {
          pushSearchQueries(id, metadataSearchQueries, reasoningTitleFromMeta);
        }
        if (metadataSearchResults.length) {
          appendSearchResults(id, metadataSearchResults);
        }

        // Thoughts: o1, gpt-5 등의 reasoning 내용
        if (contentType === 'thoughts' && Array.isArray(msg.content.thoughts)) {
          for (const t of msg.content.thoughts) {
            const title = t.summary || reasoningTitleFromMeta;
            const content = t.content || '';
            pushReasoningMessage(id, content, title);
          }
          continue;
        }
        // Code: Tool Call 등 (reasoning 영역)
        else if (contentType === 'code' && typeof msg.content.text === 'string') {
          const rawCodeText = msg.content.text;
          // DALL-E/Canvas JSON은 별도 처리
          try {
            const codeObj = JSON.parse(rawCodeText);
            if (codeObj.size || codeObj.n || codeObj.prompt) {
              pendingDallePrompt = rawCodeText;
              continue;
            }
            if (codeObj.updates || codeObj.content || codeObj.text || codeObj.name) {
              pendingCanvasUpdate = codeObj;
              continue;
            }
            if (!metadataSearchQueries.length && Array.isArray(codeObj.search_query)) {
              const queries = codeObj.search_query
                .map((q: { q?: string } | string) => (typeof q === 'string' ? q : q.q))
                .filter(Boolean)
                .map((q: string) => ({ q }));
              pushSearchQueries(id, queries);
            }
          } catch {
            // JSON 파싱 실패 = 일반 코드
          }
          const toolCallContent = formatToolCallBlock(rawCodeText);
          if (toolCallContent) {
            appendHiddenMessage(id, {
              category: 'Tool Call',
              depth: 2,
              content: toolCallContent
            });
          }
          continue;
        }
        // Text: 일반 텍스트
        else if (contentType === 'text' && msg.content.parts) {
          const content = joinWithLineBreak(
            msg.content.parts.filter((p): p is string => typeof p === 'string')
          );
          pushReasoningMessage(id, content, reasoningTitleFromMeta);
          continue;
        }
        // Tool 결과: execution_output 등
        else if (contentType === 'execution_output' && msg.content.text) {
          const toolResultContent = formatToolResultBlock(msg.content.text);
          if (toolResultContent) {
            appendHiddenMessage(id, {
              category: 'Tool Result',
              depth: 2,
              content: toolResultContent
            });
          }
          continue;
        }
        continue;
      }

      // Reasoning Recap 처리
      if (contentType === 'reasoning_recap') {
        const recapContent = msg.content.content || msg.content.text || '';
        if (recapContent) {
          appendHiddenMessage(id, { category: 'Reasoning Recap', content: recapContent });
        }
        continue;
      }

      // Canvas 처리 (recipient가 canmore.*로 시작하면 Canvas)
      if (role === 'assistant' && msg.recipient?.startsWith('canmore.')) {
        let canvasJson = '';
        if (contentType === 'text' && Array.isArray(msg.content.parts)) {
          canvasJson = msg.content.parts.filter((p): p is string => typeof p === 'string').join('\n').trim();
        } else if (contentType === 'code' && typeof msg.content.text === 'string') {
          canvasJson = msg.content.text.trim();
        }
        if (canvasJson) {
          try {
            pendingCanvasUpdate = JSON.parse(canvasJson);
          } catch {
            // JSON 파싱 실패
          }
        }
        continue;
      }

      const isAssistantToolCall = role === 'assistant' && msg.recipient && msg.recipient !== 'all';
      if (isAssistantToolCall) {
        let toolContent = '';
        if (contentType === 'text' && Array.isArray(msg.content.parts)) {
          toolContent = msg.content.parts.filter((p): p is string => typeof p === 'string').join('\n');
        } else if (contentType === 'code' && typeof msg.content.text === 'string') {
          toolContent = msg.content.text;
        } else if (typeof msg.content.text === 'string') {
          toolContent = msg.content.text;
        }
        if (toolContent.trim()) {
          const toolCallContent = formatToolCallBlock(toolContent);
          if (toolCallContent) {
            appendHiddenMessage(id, {
              category: 'Tool Call',
              depth: 2,
              content: toolCallContent
            });
          }
        }
        continue;
      }

      if (role === 'tool') {
        if (metadataSearchQueries.length) {
          pushSearchQueries(id, metadataSearchQueries);
        }
        if (metadataSearchResults.length) {
          appendSearchResults(id, metadataSearchResults);
        }
      }

      if (role === 'tool' && contentType === 'execution_output') {
        const toolResultContent = formatToolResultBlock(msg.content.text || '');
        if (toolResultContent) {
          appendHiddenMessage(id, {
            category: 'Tool Result',
            depth: 2,
            content: toolResultContent
          });
        }
        continue;
      }

      // Code 타입 메시지 처리: DALL-E 또는 Canvas (reasoning 영역 밖)
      if (role === 'assistant' && contentType === 'code' && typeof msg.content.text === 'string') {
        try {
          const codeObj = JSON.parse(msg.content.text);
          // DALL-E 호출인 경우 (prompt 유무와 관계없이 전체 저장)
          if (codeObj.size || codeObj.n || codeObj.prompt) {
            // 전체 JSON을 그대로 저장 (사용자 요청: 필터링 금지)
            pendingDallePrompt = msg.content.text;
            continue;
          }
          // Canvas인 경우
          pendingCanvasUpdate = codeObj;
          continue;
        } catch {
          pendingCanvasUpdate = null;
          content = formatCodeBlock(msg.content.text, msg.content.language);
        }
      }
      // Text 타입이지만 Canvas JSON인 경우
      else if (role === 'assistant' && msg.content.parts && Array.isArray(msg.content.parts)) {
        const textContent = msg.content.parts.filter((p): p is string => typeof p === 'string').join('\n');
        if (textContent.trim().startsWith('{') && textContent.trim().endsWith('}')) {
          try {
            const parsed = JSON.parse(textContent.trim());
            if (parsed.updates || parsed.content || parsed.text || parsed.name) {
              pendingCanvasUpdate = parsed;
              continue;
            }
          } catch {
            // JSON 파싱 실패하면 일반 텍스트로 처리
          }
        }
        content = textContent;
      }
      // Canvas 처리: tool 메시지에서 Canvas 확정
      else if (role === 'tool' && msg.metadata?.canvas?.textdoc_id) {
        const docId = msg.metadata.canvas.textdoc_id;
        if (docId && pendingCanvasUpdate) {
          const idPrefix = docId.slice(0, 8);
          const canvasTitle = (pendingCanvasUpdate.name as string) || '';
          const canvasType = (pendingCanvasUpdate.type as string) || (pendingCanvasUpdate.language as string) || '';
          const ext = this.getCanvasExtension(canvasType);

          // 첫 생성인지 수정인지 판단
          const isFirstCreate = typeof pendingCanvasUpdate.content === 'string' ||
                               typeof pendingCanvasUpdate.text === 'string';
          const hasUpdates = Array.isArray(pendingCanvasUpdate.updates) &&
                            (pendingCanvasUpdate.updates as unknown[]).length > 0;

          if (isFirstCreate) {
            // 첫 생성: 버전 1
            const canvasContent = (pendingCanvasUpdate.content as string) || (pendingCanvasUpdate.text as string) || '';
            canvasTexts[docId] = canvasContent;
            canvasStates[docId] = {
              content: canvasContent,
              title: canvasTitle,
              type: canvasType,
              version: 1,
              idPrefix
            };

            // 파일 저장
            const safeTitle = AIExport.utils.sanitizeFilename(canvasTitle || 'canvas');
            const filename = `canvas_${idPrefix}_v1_${safeTitle}${ext}`;
            canvasFiles.push({
              filename,
              content: canvasContent,
              docId,
              version: 1
            });

            // Canvas 파일 pending (다음 텍스트 assistant에 합침)
            pendingCanvasFile = filename;
            pendingCanvasOriginalName = safeTitle + ext;
          } else if (hasUpdates && canvasStates[docId]) {
            // 수정: 버전 N+1
            const state = canvasStates[docId];
            this.applyCanvasUpdates(canvasTexts, docId, pendingCanvasUpdate.updates as CanvasUpdate[]);
            state.content = canvasTexts[docId];
            state.version++;

            const stateExt = this.getCanvasExtension(state.type);
            const safeTitle = AIExport.utils.sanitizeFilename(state.title || 'canvas');
            const filename = `canvas_${state.idPrefix}_v${state.version}_${safeTitle}${stateExt}`;
            canvasFiles.push({
              filename,
              content: state.content,
              docId,
              version: state.version
            });

            // Canvas 파일 pending (다음 텍스트 assistant에 합침)
            pendingCanvasFile = filename;
            pendingCanvasOriginalName = safeTitle + stateExt;
          }
          pendingCanvasUpdate = null;
        }
        continue;
      }
      // DALL-E 이미지 생성
      else if (role === 'tool' && msg.metadata?.async_task_type === 'image_gen') {
        const imageTitle = msg.metadata.image_gen_title || msg.metadata.async_task_title || '';
        const actualDallePrompt = pendingDallePrompt || '';
        pendingDallePrompt = null;

        if (contentType === 'multimodal_text' && Array.isArray(msg.content.parts)) {
          for (const part of msg.content.parts) {
            if (typeof part === 'object' && part.content_type === 'image_asset_pointer' && part.asset_pointer) {
              try {
                const imageInfo = await this.fetchImage(part, conversationId, token, imageCounter, imageTitle);
                if (imageInfo) {
                  images.push(imageInfo);
                  messageImages.push(imageInfo.filename);
                  imageCounter++;
                }
              } catch (e) {
                console.error('[ChatGPT] DALL-E image fetch failed:', e);
              }
            }
          }
        }

        if (messageImages.length > 0 || imageTitle || actualDallePrompt) {
          messages.push({
            role: 'assistant',
            content: '',
            timestamp: msg.create_time,
            images: messageImages.length > 0 ? messageImages : undefined,
            imageTitle: imageTitle || undefined,
            dallePrompt: actualDallePrompt || undefined
          });
        }
        continue;
      }
      // multimodal_text: 이미지 포함 메시지
      else if (contentType === 'multimodal_text' && Array.isArray(msg.content.parts)) {
        for (const part of msg.content.parts) {
          if (typeof part === 'string') {
            content += part + '\n';
          } else if (typeof part === 'object' && part.content_type === 'image_asset_pointer' && part.asset_pointer) {
            try {
              const imageInfo = await this.fetchImage(part, conversationId, token, imageCounter);
              if (imageInfo) {
                images.push(imageInfo);
                messageImages.push(imageInfo.filename);
                imageCounter++;
              }
            } catch (e) {
              console.error('[ChatGPT] Image fetch failed:', e);
            }
          }
        }
      } else if (msg.content.parts && Array.isArray(msg.content.parts)) {
        content = msg.content.parts.filter((p): p is string => typeof p === 'string').join('\n');
      } else if (msg.content.text) {
        content = msg.content.text;
      }

      // Citation 마커 처리
      const contentReferences = msg.metadata?.content_references;
      const processedContent = this.replaceCitationMarkers(content.trim(), contentReferences);

      const message: ExtractedMessage = {
        nodeId: id,
        role,
        content: processedContent,
        timestamp: msg.create_time,
        images: messageImages.length > 0 ? messageImages : undefined,
        files: messageFiles
      };

      if (contentType === 'user_editable_context' && typeof msg.content.user_instructions === 'string') {
        message.customInstructions = stripFenceMarkers(msg.content.user_instructions);
      }

      // 메타데이터 추가
      if (msg.metadata) {
        if (msg.metadata.model_slug) message.model = msg.metadata.model_slug;
        if (msg.metadata.dalle) message.dalle = msg.metadata.dalle;
        if (msg.metadata.is_visually_hidden_from_conversation) message.hidden = true;
        if (!message.customInstructions && msg.metadata.user_context_message_data?.about_model_message) {
          message.customInstructions = msg.metadata.user_context_message_data.about_model_message;
        }
      }

      // Tool 메시지에 도구 이름 추가
      if (role === 'tool' && msg.author?.name) {
        message.toolName = msg.author.name;
      }

      const pendingHiddenMessages = role === 'assistant'
        ? hiddenMessagesByAssistantId.get(id)
        : undefined;
      const pendingSearchResults = role === 'assistant'
        ? searchResultsByAssistantId.get(id)
        : undefined;
      const hasAssistantPending = role === 'assistant' &&
        ((pendingHiddenMessages && pendingHiddenMessages.length) ||
         (pendingSearchResults && pendingSearchResults.length));
      if (content.trim() || messageImages.length > 0 || messageFiles?.length || message.customInstructions || hasAssistantPending) {
        if (role === 'assistant') {
          const hiddenMessages: ExtractedHiddenMessage[] = [];
          if (pendingHiddenMessages?.length) {
            hiddenMessages.push(...pendingHiddenMessages);
          }
          if (pendingSearchResults?.length) {
            const sources = formatSearchResults(pendingSearchResults);
            if (sources) {
              hiddenMessages.push({ category: 'Sources', content: sources });
            }
          }
          if (hiddenMessages.length) {
            message.hiddenMessages = (message.hiddenMessages || []).concat(hiddenMessages);
          }
          hiddenMessagesByAssistantId.delete(id);
          searchResultsByAssistantId.delete(id);

          // Pending Canvas 파일 합치기
          if (pendingCanvasFile) {
            message.canvasFile = pendingCanvasFile;
            message.canvasOriginalName = pendingCanvasOriginalName;
            pendingCanvasFile = null;
            pendingCanvasOriginalName = null;
          }
        }
        messages.push(message);
      }
    }

    return { messages, images, canvasFiles, files };
  },

  // Canvas 타입에서 확장자 추출
  getCanvasExtension(canvasType: string): string {
    if (!canvasType) return '.txt';
    const type = canvasType.toLowerCase();
    if (type.includes('python')) return '.py';
    if (type.includes('javascript') || type.includes('js')) return '.js';
    if (type.includes('typescript') || type.includes('ts')) return '.ts';
    if (type.includes('html')) return '.html';
    if (type.includes('css')) return '.css';
    if (type.includes('java')) return '.java';
    if (type.includes('c++') || type.includes('cpp')) return '.cpp';
    if (type.includes('c#') || type.includes('csharp')) return '.cs';
    if (type.includes('go')) return '.go';
    if (type.includes('rust')) return '.rs';
    if (type.includes('ruby')) return '.rb';
    if (type.includes('php')) return '.php';
    if (type.includes('sql')) return '.sql';
    if (type.includes('markdown') || type.includes('md')) return '.md';
    if (type.includes('json')) return '.json';
    if (type.includes('yaml') || type.includes('yml')) return '.yaml';
    if (type.includes('xml')) return '.xml';
    if (type.includes('shell') || type.includes('bash')) return '.sh';
    return '.txt';
  },

  // Canvas updates 적용
  applyCanvasUpdates(canvasTexts: Record<string, string>, docId: string, updates: CanvasUpdate[]): void {
    let currentText = canvasTexts[docId] || '';
    for (const update of updates) {
      // Python/Perl 정규식을 JavaScript로 변환
      const pattern = AIExport.utils.pythonRegexToJS(update.pattern || '.*');
      const flags = update.multiple ? 'gs' : 's';
      try {
        const regex = new RegExp(pattern, flags);
        const replacement = update.replacement || '';
        currentText = currentText.replace(regex, replacement);
      } catch (e) {
        console.error('[ChatGPT] Canvas update regex error:', e);
      }
    }
    canvasTexts[docId] = currentText;
  },

  // 이미지 다운로드
  async fetchImage(
    part: ChatGPTImagePart,
    conversationId: string,
    token: string,
    counter: number,
    imageTitle: string | null = null
  ): Promise<ImageDownload | null> {
    const pointer = part.asset_pointer;
    if (!pointer) return null;

    let fileId: string | null = null;

    if (pointer.startsWith('file-service://')) {
      fileId = pointer.replace('file-service://', '');
    } else if (pointer.startsWith('sediment://')) {
      fileId = pointer.replace('sediment://', '');
    } else {
      console.warn('[ChatGPT] Unknown asset_pointer format:', pointer);
      return null;
    }

    const attachmentUrl = `https://chatgpt.com/backend-api/conversation/${conversationId}/attachment/${fileId}/download`;
    const attachResp = await fetch(attachmentUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    if (!attachResp.ok) {
      throw new Error(`Attachment API failed: ${attachResp.status}`);
    }

    const attachJson = await attachResp.json();
    const signedUrl = attachJson.download_url;

    if (!signedUrl || !signedUrl.includes('sig=')) {
      console.warn('[ChatGPT] No valid signed URL:', signedUrl);
      return null;
    }

    const blob = await AIExport.utils.fetchAsBlob(signedUrl);

    // 파일명 결정
    let filename: string;
    if (imageTitle) {
      const ext = AIExport.utils.getExtensionFromMime(blob.type) || '.webp';
      const baseName = AIExport.utils.sanitizeFilename(imageTitle.split(':')[0].trim());
      filename = `${baseName}_${counter}${ext}`;
    } else if (attachJson.file_name) {
      filename = AIExport.utils.sanitizeFilename(attachJson.file_name);
    } else {
      const ext = AIExport.utils.getExtensionFromMime(blob.type) || '.webp';
      filename = `image_${counter}${ext}`;
    }

    return { filename, blob };
  },

  // citation 마커 제거
  removeCitationMarkers(text: string): string {
    if (!text) return text;
    return text.replace(/\u3010[^】]*\u3011/g, '')
               .replace(/[\uE200-\uE2FF]/g, '')  // Private Use Area 문자 제거
               .replace(/(?:file)?citetur(?:n\d*[a-zA-Z]*\d*)?/g, '')
               .replace(/turn\d+[a-zA-Z]+\d+/g, '');  // cite 없이 turn만 있는 경우
  },

  // currentNode가 없을 때 사용하는 기존 DFS 방식
  extractMessagesLegacy(mapping: Record<string, ChatGPTNode>): ExtractedMessage[] {
    const messages: ExtractedMessage[] = [];
    const visited = new Set<string>();

    let rootId: string | null = null;
    for (const [id, node] of Object.entries(mapping)) {
      if (!node.parent) {
        rootId = id;
        break;
      }
    }

    const traverse = (nodeId: string | null): void => {
      if (!nodeId || visited.has(nodeId)) return;
      visited.add(nodeId);

      const node = mapping[nodeId];
      if (!node) return;

      const msg = node.message;
      if (msg && msg.content) {
        const role = msg.author?.role;
        if (role === 'user' || role === 'assistant') {
          let content = '';

          if (msg.content.parts && Array.isArray(msg.content.parts)) {
            content = msg.content.parts.filter((p): p is string => typeof p === 'string').join('\n');
          } else if (msg.content.text) {
            content = msg.content.text;
          }

          if (content.trim()) {
            messages.push({
              role,
              content: content.trim(),
              timestamp: msg.create_time
            });
          }
        }
      }

      if (node.children && Array.isArray(node.children)) {
        for (const childId of node.children) {
          traverse(childId);
        }
      }
    };

    traverse(rootId);
    return messages;
  },

  // Citation 마커를 링크로 대체
  replaceCitationMarkers(text: string, contentReferences?: ChatGPTContentReference[]): string {
    if (!text) return text;

    // Private Use Area 문자 먼저 제거 (citation 마커를 감싸는 특수 문자)
    const cleanText = text.replace(/[\uE200-\uE2FF]/g, '');

    if (!contentReferences?.length) {
      // fileciteturn0file0, citeturn0view0, citetur, turn0view0 등 다양한 형식 처리
      return cleanText.replace(/(?:file)?citetur(?:n\d*[a-zA-Z]*\d*)?/g, '')
                      .replace(/turn\d+[a-zA-Z]+\d+/g, '').trim();
    }

    const sorted = [...contentReferences].sort((a, b) => b.start_idx - a.start_idx);

    let result = cleanText;
    for (const ref of sorted) {
      if (ref.matched_text && ref.alt) {
        result = result.substring(0, ref.start_idx) + ref.alt + result.substring(ref.end_idx);
      }
    }

    // 대체되지 않고 남은 citation marker 제거 (부분 매칭된 잔여물 포함)
    return result.replace(/(?:file)?citetur(?:n\d*[a-zA-Z]*\d*)?/g, '')
                 .replace(/turn\d+[a-zA-Z]+\d+/g, '').trim();
  },

  // 유틸리티 함수들
  getConversationIdFromUrl(): string | null {
    const url = new URL(window.location.href);
    const pathParts = url.pathname.split('/').filter(Boolean);

    if (pathParts[0] === 'c' && pathParts[1]) {
      return pathParts[1];
    }

    const cIndex = pathParts.indexOf('c');
    if (cIndex !== -1 && pathParts[cIndex + 1]) {
      return pathParts[cIndex + 1];
    }

    return null;
  },

  async getAccessToken(): Promise<string> {
    const response = await fetch('https://chatgpt.com/api/auth/session', {
      method: 'GET',
      credentials: 'include'
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('로그인이 필요합니다.');
      }
      throw new Error(`세션 조회 실패: ${response.status}`);
    }

    const data = await response.json();
    if (!data || !data.accessToken) {
      throw new Error('로그인 토큰이 없습니다.');
    }

    return data.accessToken;
  },

  async fetchConversationData(conversationId: string, token: string): Promise<ChatGPTRawData> {
    const url = `https://chatgpt.com/backend-api/conversation/${conversationId}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': '*/*'
      }
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('대화를 찾을 수 없습니다.');
      }
      throw new Error(`대화 데이터 조회 실패: ${response.status}`);
    }

    return await response.json();
  }
});

// Canvas Update 타입
interface CanvasUpdate {
  pattern?: string;
  replacement?: string;
  multiple?: boolean;
}

console.log('[ChatGPT Exporter] Loaded');
