// AI Export - 공통 유틸리티 (ISOLATED world)

// core는 표준 포맷 검증/정규화/렌더링의 단일 진입점이다.
// exporter는 구조적 포맷(헤더/인용/구분선)을 만들지 않고, 내용(content)만 채운다.
import {
  UserMessage,
  AssistantMessage,
  HiddenMessage,
  type Message,
  type Conversation,
  type ConversationInit,
  type ConversationBuilder,
  type ExportOptions,
  type AIExportType,
  type AIExportUtils,
  type UserMessageInput,
  type AssistantMessageInput,
  type HiddenMessageInput,
  type HiddenMessageInfo,
  type ImageInfo,
  type FileInfo,
  type SearchResult,
  type Segment,
} from '../types/index.js';

// 공통 유틸리티: exporter에서 재구현하지 말고 여기만 사용한다.
const utils: AIExportUtils = {
  // 마크다운 다운로드 (chrome.runtime 직접 호출)
  async downloadMarkdown(content: string, filename: string): Promise<void> {
    await chrome.runtime.sendMessage({
      action: 'download',
      content,
      filename: `ai-export/${filename}`
    });
  },

  // 파일 다운로드 (이미지, 첨부파일 등)
  async downloadFile(dataUrl: string, filename: string): Promise<void> {
    await chrome.runtime.sendMessage({
      action: 'downloadFile',
      dataUrl,
      filename: `ai-export/${filename}`
    });
  },

  // Blob을 dataUrl로 변환
  async blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  },

  // URL에서 이미지/파일을 Blob으로 가져오기
  async fetchAsBlob(url: string, headers: Record<string, string> = {}): Promise<Blob> {
    const response = await fetch(url, {
      headers: {
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        ...headers
      },
      credentials: 'include'
    });
    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.status}`);
    }
    return await response.blob();
  },

  // background.js를 통해 이미지 fetch (CORS 우회)
  async fetchImageViaBackground(url: string): Promise<{ dataUrl: string; mimeType: string }> {
    const result = await chrome.runtime.sendMessage({
      action: 'fetchImage',
      url
    });
    if (result?.success) {
      return {
        dataUrl: result.dataUrl,
        mimeType: result.mimeType
      };
    } else {
      throw new Error(result?.error || 'Fetch failed');
    }
  },

  generateFilename(title?: string, service: string = 'ai', conversationId: string = ''): string {
    const safeTitle = utils.sanitizeFilename(title || 'conversation');
    const prefix = (service || 'ai').toLowerCase();
    const id = conversationId ? conversationId.substring(0, 8) : Date.now().toString(36);
    return `${prefix}_${id}_${safeTitle}.md`;
  },

  // .md 확장자 제외한 기본 이름 (서브디렉토리용)
  getBasename(filename: string): string {
    return filename.replace(/\.md$/, '');
  },

  sanitizeFilename(name: string): string {
    return name
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 80);
  },

  formatTimestamp(value: string | number | null | undefined): string {
    if (!value) return '';
    const date = new Date(value);
    return date.toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  },

  // MIME 타입 또는 확장자에서 확장자 추출
  getExtensionFromMime(mimeType: string | null): string {
    if (!mimeType) return '';

    // 이미 확장자 형태면 (점 없이 txt, md, png 등) 그대로 사용
    if (!mimeType.includes('/')) {
      return '.' + mimeType.toLowerCase();
    }

    // MIME 타입인 경우 매핑
    const map: Record<string, string> = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/gif': '.gif',
      'image/webp': '.webp',
      'image/svg+xml': '.svg',
      'application/pdf': '.pdf',
      'text/plain': '.txt',
      'text/html': '.html',
      'text/markdown': '.md',
      'application/json': '.json',
      'application/octet-stream': '.bin'
    };
    return map[mimeType] || '';
  },

  // 파일명 또는 MIME 타입에서 확장자 추출
  getExtension(filename: string, mimeType: string): string {
    // 파일명에서 확장자 추출 시도
    const extMatch = filename.match(/\.([a-zA-Z0-9]+)$/);
    if (extMatch) {
      return '.' + extMatch[1].toLowerCase();
    }
    // 파일명에 확장자 없으면 MIME 타입에서 추출
    return utils.getExtensionFromMime(mimeType);
  },

  // Python/Perl 정규식을 JavaScript로 변환
  pythonRegexToJS(pattern: string): string {
    let jsPattern = pattern;
    // \A → ^ (문자열 시작)
    jsPattern = jsPattern.replace(/\\A/g, '^');
    // \Z → $ (문자열 끝)
    jsPattern = jsPattern.replace(/\\Z/g, '$');
    // (?s) 플래그 제거 (JS에서는 's' 플래그로 처리)
    jsPattern = jsPattern.replace(/\(\?s\)/g, '');
    // (?m) 플래그 제거 (JS에서는 'm' 플래그로 처리)
    jsPattern = jsPattern.replace(/\(\?m\)/g, '');
    return jsPattern;
  },
};

// 표준 포맷 화이트리스트: LLM별 임의 필드 유입을 차단한다.
const allowedUserKeys = new Set([
  'content',
  'timestamp',
  'images',
  'files',
  'imageTitle',
  'searchQueries',
  'searchResults',
]);

const allowedAssistantKeys = new Set([
  ...allowedUserKeys,
  'model',
  'hiddenMessages',
  'segments',
]);

const allowedHiddenKeys = new Set([
  'category',
  'title',
  'depth',
  'content',
]);

const allowedUserInputKeys = new Set(allowedUserKeys);
const allowedAssistantInputKeys = new Set(allowedAssistantKeys);
const allowedHiddenInputKeys = new Set(allowedHiddenKeys);
const allowedConversationInitKeys = new Set(['title', 'service', 'createdAt', 'basename']);
const allowedImageInfoKeys = new Set(['filename', 'originalName']);
const allowedFileInfoKeys = new Set(['filename', 'originalName']);
const allowedHiddenMessageInfoKeys = new Set(['category', 'title', 'depth', 'content']);
const allowedSearchResultKeys = new Set(['url', 'title', 'domain']);

function assertAllowedKeys(value: Record<string, unknown>, allowed: Set<string>, context: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`[AIExport] Invalid field "${key}" in ${context}`);
    }
  }
}

function assertString(value: unknown, context: string): asserts value is string {
  if (typeof value !== 'string') {
    throw new Error(`[AIExport] Expected string for ${context}`);
  }
}

function assertStringOrNull(value: unknown, context: string): void {
  if (value !== null && typeof value !== 'string') {
    throw new Error(`[AIExport] Expected string|null for ${context}`);
  }
}

function assertNumberOrNull(value: unknown, context: string): void {
  if (value !== null && typeof value !== 'number') {
    throw new Error(`[AIExport] Expected number|null for ${context}`);
  }
}

// normalize*는 입력 스키마를 강제하고 렌더링 전에 일관된 형태로 만든다.
function normalizeImages(images: ImageInfo[] | undefined, context: string): ImageInfo[] | undefined {
  if (images === null) {
    throw new Error(`[AIExport] Expected array for ${context}`);
  }
  if (!images || images.length === 0) return undefined;
  if (!Array.isArray(images)) {
    throw new Error(`[AIExport] Expected array for ${context}`);
  }
  return images.map((img, index) => {
    if (!img || typeof img !== 'object') {
      throw new Error(`[AIExport] Expected object for ${context}[${index}]`);
    }
    const ctx = `${context}[${index}]`;
    assertAllowedKeys(img as Record<string, unknown>, allowedImageInfoKeys, ctx);
    assertString(img.filename, `${ctx}.filename`);
    if (img.originalName !== undefined) {
      assertStringOrNull(img.originalName, `${ctx}.originalName`);
    }
    return {
      filename: img.filename,
      originalName: img.originalName ?? null,
    };
  });
}

function normalizeFiles(files: FileInfo[] | undefined, context: string): FileInfo[] | undefined {
  if (files === null) {
    throw new Error(`[AIExport] Expected array for ${context}`);
  }
  if (!files || files.length === 0) return undefined;
  if (!Array.isArray(files)) {
    throw new Error(`[AIExport] Expected array for ${context}`);
  }
  return files.map((file, index) => {
    if (!file || typeof file !== 'object') {
      throw new Error(`[AIExport] Expected object for ${context}[${index}]`);
    }
    const ctx = `${context}[${index}]`;
    assertAllowedKeys(file as Record<string, unknown>, allowedFileInfoKeys, ctx);
    assertString(file.filename, `${ctx}.filename`);
    if (file.originalName !== undefined) {
      assertStringOrNull(file.originalName, `${ctx}.originalName`);
    }
    return {
      filename: file.filename,
      originalName: file.originalName ?? null,
    };
  });
}

function normalizeHiddenMessages(list: HiddenMessageInfo[] | undefined, context: string): HiddenMessageInfo[] | undefined {
  if (list === null) {
    throw new Error(`[AIExport] Expected array for ${context}`);
  }
  if (!list || list.length === 0) return undefined;
  if (!Array.isArray(list)) {
    throw new Error(`[AIExport] Expected array for ${context}`);
  }
  return list.map((msg, index) => {
    if (!msg || typeof msg !== 'object') {
      throw new Error(`[AIExport] Expected object for ${context}[${index}]`);
    }
    const ctx = `${context}[${index}]`;
    assertAllowedKeys(msg as Record<string, unknown>, allowedHiddenMessageInfoKeys, ctx);
    assertString(msg.category, `${ctx}.category`);
    if (msg.title !== undefined) {
      assertStringOrNull(msg.title, `${ctx}.title`);
    }
    if (msg.depth !== undefined) {
      assertNumberOrNull(msg.depth, `${ctx}.depth`);
    }
    assertString(msg.content, `${ctx}.content`);
    return {
      category: msg.category,
      title: msg.title ?? null,
      depth: msg.depth,
      content: msg.content,
    };
  });
}

const allowedSegmentKeys = new Set(['type', 'content', 'category', 'title', 'depth']);

function normalizeSegments(list: Segment[] | undefined, context: string): Segment[] | undefined {
  if (list === null) {
    throw new Error(`[AIExport] Expected array for ${context}`);
  }
  if (!list || list.length === 0) return undefined;
  if (!Array.isArray(list)) {
    throw new Error(`[AIExport] Expected array for ${context}`);
  }
  return list.map((seg, index) => {
    if (!seg || typeof seg !== 'object') {
      throw new Error(`[AIExport] Expected object for ${context}[${index}]`);
    }
    const ctx = `${context}[${index}]`;
    assertAllowedKeys(seg as Record<string, unknown>, allowedSegmentKeys, ctx);

    if (seg.type === 'text') {
      assertString(seg.content, `${ctx}.content`);
      return { type: 'text' as const, content: seg.content };
    } else if (seg.type === 'hidden') {
      assertString(seg.category, `${ctx}.category`);
      if (seg.title !== undefined) {
        assertStringOrNull(seg.title, `${ctx}.title`);
      }
      if (seg.depth !== undefined) {
        assertNumberOrNull(seg.depth, `${ctx}.depth`);
      }
      assertString(seg.content, `${ctx}.content`);
      return {
        type: 'hidden' as const,
        category: seg.category,
        title: seg.title ?? null,
        depth: seg.depth,
        content: seg.content,
      };
    } else {
      throw new Error(`[AIExport] Invalid segment type at ${ctx}: ${(seg as { type: string }).type}`);
    }
  });
}

function normalizeSearchQueries(queries: string[] | undefined, context: string): string[] | undefined {
  if (queries === null) {
    throw new Error(`[AIExport] Expected array for ${context}`);
  }
  if (!queries || queries.length === 0) return undefined;
  if (!Array.isArray(queries)) {
    throw new Error(`[AIExport] Expected array for ${context}`);
  }
  for (let i = 0; i < queries.length; i += 1) {
    assertString(queries[i], `${context}[${i}]`);
  }
  return [...queries];
}

function normalizeSearchResults(results: SearchResult[] | undefined, context: string): SearchResult[] | undefined {
  if (results === null) {
    throw new Error(`[AIExport] Expected array for ${context}`);
  }
  if (!results || results.length === 0) return undefined;
  if (!Array.isArray(results)) {
    throw new Error(`[AIExport] Expected array for ${context}`);
  }
  return results.map((result, index) => {
    if (!result || typeof result !== 'object') {
      throw new Error(`[AIExport] Expected object for ${context}[${index}]`);
    }
    const ctx = `${context}[${index}]`;
    assertAllowedKeys(result as Record<string, unknown>, allowedSearchResultKeys, ctx);
    assertString(result.url, `${ctx}.url`);
    assertString(result.title, `${ctx}.title`);
    if (result.domain !== undefined) {
      assertStringOrNull(result.domain, `${ctx}.domain`);
    }
    return {
      url: result.url,
      title: result.title,
      domain: result.domain ?? null,
    };
  });
}

// 메시지/대화 검증은 core에서만 수행한다. exporter가 우회하면 포맷이 깨진다.
function assertValidMessage(msg: unknown, index: number): asserts msg is Message {
  if (!msg || typeof msg !== 'object') {
    throw new Error(`[AIExport] Invalid message at index ${index}`);
  }

  const isUser = msg instanceof UserMessage;
  const isAssistant = msg instanceof AssistantMessage;
  const isHidden = msg instanceof HiddenMessage;

  if (!isUser && !isAssistant && !isHidden) {
    throw new Error(`[AIExport] Invalid message type at index ${index}`);
  }

  if (isHidden) {
    assertAllowedKeys(msg as Record<string, unknown>, allowedHiddenKeys, `HiddenMessage[${index}]`);
    assertString((msg as HiddenMessage).category, `HiddenMessage[${index}].category`);
    if ((msg as HiddenMessage).depth !== undefined) {
      assertNumberOrNull((msg as HiddenMessage).depth, `HiddenMessage[${index}].depth`);
    }
    assertString((msg as HiddenMessage).content, `HiddenMessage[${index}].content`);
    return;
  }

  if (isUser) {
    assertAllowedKeys(msg as Record<string, unknown>, allowedUserKeys, `UserMessage[${index}]`);
  } else {
    assertAllowedKeys(msg as Record<string, unknown>, allowedAssistantKeys, `AssistantMessage[${index}]`);
    const assistant = msg as AssistantMessage;
    if (assistant.model !== undefined) {
      assertStringOrNull(assistant.model, `AssistantMessage[${index}].model`);
    }
    if (assistant.hiddenMessages !== undefined) {
      normalizeHiddenMessages(assistant.hiddenMessages, `AssistantMessage[${index}].hiddenMessages`);
    }
  }

  const base = msg as UserMessage | AssistantMessage;
  assertString(base.content, `Message[${index}].content`);
  if (base.timestamp !== undefined) {
    assertNumberOrNull(base.timestamp, `Message[${index}].timestamp`);
  }
  if (base.imageTitle !== undefined) {
    assertStringOrNull(base.imageTitle, `Message[${index}].imageTitle`);
  }
  if (base.images !== undefined) {
    normalizeImages(base.images, `Message[${index}].images`);
  }
  if (base.files !== undefined) {
    normalizeFiles(base.files, `Message[${index}].files`);
  }
  if (base.searchQueries !== undefined) {
    normalizeSearchQueries(base.searchQueries, `Message[${index}].searchQueries`);
  }
  if (base.searchResults !== undefined) {
    normalizeSearchResults(base.searchResults, `Message[${index}].searchResults`);
  }
}

function assertValidConversation(conversation: Conversation): void {
  if (!conversation || typeof conversation !== 'object') {
    throw new Error('[AIExport] Invalid conversation');
  }
  assertString(conversation.title, 'Conversation.title');
  assertString(conversation.service, 'Conversation.service');
  assertString(conversation.basename, 'Conversation.basename');
  assertString(conversation.exportedAt, 'Conversation.exportedAt');
  if (conversation.createdAt !== undefined) {
    assertStringOrNull(conversation.createdAt, 'Conversation.createdAt');
  }
  if (!Array.isArray(conversation.messages)) {
    throw new Error('[AIExport] Invalid messages array');
  }
  for (let i = 0; i < conversation.messages.length; i += 1) {
    assertValidMessage(conversation.messages[i], i);
  }
}

/**
 * 메시지 헤더 렌더링
 *
 * 스펙 규칙:
 * - User: 🧑 **User** · 타임스탬프
 * - Assistant: 🤖 **Assistant** · 타임스탬프 · 모델명
 * - Hidden: 헤더 없음 (renderHiddenMessage에서 처리)
 */
function renderHeader(msg: Message, showTimestamp: boolean, showModelName: boolean): string {
  // Hidden 메시지는 헤더 없음 (renderHiddenMessage에서 별도 처리)
  if (msg instanceof HiddenMessage) {
    return '';
  }

  const isUser = msg instanceof UserMessage;
  const icon = isUser ? '🧑' : '🤖';
  const label = isUser ? 'User' : 'Assistant';

  let header = `${icon} **${label}**`;

  // timestamp는 User/Assistant에만 있음
  const timestamp = (msg as UserMessage | AssistantMessage).timestamp;
  if (showTimestamp && timestamp) {
    header += ` · ${utils.formatTimestamp(timestamp)}`;
  }
  // model은 AssistantMessage에만 존재 (showModelName 옵션으로 제어)
  if (showModelName && msg instanceof AssistantMessage && (msg as AssistantMessage).model) {
    header += ` · *${(msg as AssistantMessage).model}*`;
  }

  return header + '\n\n';
}

/**
 * 숨은 메시지 인용 형식으로 렌더링
 * - 독립 HiddenMessage와 assistant.hiddenMessages 모두 이 함수로 렌더링
 * - 포맷: > **카테고리** 타이틀 (뎁스 1), > *카테고리* 타이틀 (뎁스 2+)
 * - 인용/헤더 포맷은 core에서만 처리한다 (content 내부 포맷은 exporter가 제공 가능).
 */
function renderHiddenMessage(
  category: string,
  title: string | null | undefined,
  content: string,
  depth: number
): string {
  const quotePrefix = '>'.repeat(depth);
  const linePrefix = `${quotePrefix} `;
  const hasHeader = Boolean(category || title);
  const headerParts: string[] = [];
  if (category) {
    const emphasis = depth === 1 ? '**' : '*';
    headerParts.push(`${emphasis}${category}${emphasis}`);
  }
  if (title) {
    // depth 2 이상에서 카테고리와 타이틀 사이 구분자 추가
    if (depth >= 2 && category) {
      headerParts.push(`· ${title}`);
    } else {
      headerParts.push(title);
    }
  }

  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized ? normalized.split('\n') : [];

  let md = '';
  if (hasHeader) {
    md += `${linePrefix}${headerParts.join(' ')}\n`;
  }
  if (lines.length > 0) {
    if (hasHeader) {
      md += `${quotePrefix}\n`;
    }
    for (const line of lines) {
      md += `${linePrefix}${line}\n`;
    }
  }
  if (!md) return '';
  return md + '\n';
}

function resolveHiddenMessageDepth(
  value: number | null | undefined,
  fallback: number
): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(1, Math.floor(value));
  }
  return fallback;
}

/**
 * Conversation 객체를 마크다운으로 변환
 *
 * 스펙 규칙:
 * - 숨은 메시지는 showHiddenMessages 옵션이 true일 때만 표시
 * - assistant.hiddenMessages도 showHiddenMessages 옵션으로 제어
 * - User 메시지 앞에만 구분선(---) 추가
 * - 파일/이미지 링크 출력 위치도 여기에서만 정의한다.
 */
function toMarkdown(conversation: Conversation, options: ExportOptions = {}): string {
  const { showTimestamp = false, showHiddenMessages = false, hiddenMessageDepth, showModelName = false } = options;
  const normalizedHiddenMessageDepth =
    typeof hiddenMessageDepth === 'number' && Number.isFinite(hiddenMessageDepth)
      ? Math.max(1, Math.floor(hiddenMessageDepth))
      : 1;
  assertValidConversation(conversation);
  const { title, service, createdAt, exportedAt, basename, messages } = conversation;

  let md = `# ${title || '제목 없음'}\n\n`;

  // 메타 정보: 서비스명(볼드) + 나머지(이탤릭)
  let serviceBold = '';
  if (service) {
    // 서비스명 대문자화 (chatgpt → ChatGPT, claude → Claude)
    const serviceName = service === 'chatgpt' ? 'ChatGPT' :
      service.charAt(0).toUpperCase() + service.slice(1);
    serviceBold = `**${serviceName}** `;
  }
  const metaLines: string[] = [];
  if (showTimestamp && createdAt) {
    metaLines.push(`Created: ${utils.formatTimestamp(createdAt)}`);
  }
  if (showTimestamp) {
    metaLines.push(`Exported: ${utils.formatTimestamp(exportedAt)}`);
  }
  if (showHiddenMessages) {
    metaLines.push('Includes hidden messages');
  }
  if (serviceBold || metaLines.length > 0) {
    let metaLine = serviceBold;
    if (metaLines.length > 0) {
      if (serviceBold) {
        metaLine += '*| ' + metaLines.join(' | ') + '*';
      } else {
        metaLine += '*' + metaLines.join(' | ') + '*';
      }
    }
    md += metaLine + '\n\n';
  }

  // 메시지 변환
  for (const msg of messages) {
    // 숨은 메시지는 showHiddenMessages 옵션으로 제어
    if (msg instanceof HiddenMessage) {
      if (!showHiddenMessages) continue;
      const hiddenMsg = msg as HiddenMessage;
      const depth = resolveHiddenMessageDepth(hiddenMsg.depth, normalizedHiddenMessageDepth);
      md += renderHiddenMessage(
        hiddenMsg.category,
        hiddenMsg.title,
        hiddenMsg.content,
        depth
      );
      md += '\n';
      continue;
    }

    // User 메시지 앞에만 구분선
    if (msg instanceof UserMessage) {
      md += '---\n\n';
    }

    // 헤더
    md += renderHeader(msg, showTimestamp, showModelName);

    // User/Assistant 공통 필드 (숨은 메시지에는 없음)
    const userOrAssistant = msg as UserMessage | AssistantMessage;

    // 검색 쿼리/결과는 숨은 메시지로 렌더링
    if (showHiddenMessages && userOrAssistant.searchQueries?.length) {
      md += renderHiddenMessage(
        'Search',
        null,
        userOrAssistant.searchQueries.join(', '),
        normalizedHiddenMessageDepth
      );
    }

    if (showHiddenMessages && userOrAssistant.searchResults?.length) {
      const lines: string[] = [];
      for (const result of userOrAssistant.searchResults) {
        if (result.url && result.title) {
          let line = `- [${result.title}](${result.url})`;
          if (result.domain) {
            line += ` · ${result.domain}`;
          }
          lines.push(line);
        }
      }
      if (lines.length) {
        md += renderHiddenMessage(
          'Sources',
          null,
          lines.join('\n'),
          normalizedHiddenMessageDepth
        );
      }
    }

    // 이미지 제목 (UI에 표시되는 제목)
    if (userOrAssistant.imageTitle) {
      md += `🖼️ *Image: ${userOrAssistant.imageTitle}*\n\n`;
    }

    // 이미지 첨부
    if (userOrAssistant.images?.length) {
      for (const img of userOrAssistant.images) {
        const imgPath = basename ? `${basename}/${img.filename}` : img.filename;
        md += `<img src="${imgPath}" alt="image" width="360" />\n\n`;
      }
    }

    // 파일 첨부: 본문을 직접 쓰지 않고 링크만 출력한다.
    if (userOrAssistant.files?.length) {
      for (const file of userOrAssistant.files) {
        const filePath = basename ? `${basename}/${file.filename}` : file.filename;
        // 표시명: originalName 우선, 없으면 filename
        let displayName = file.originalName || file.filename;
        // filename에서 버전 추출 (artifact_xxx_v2_... 패턴)
        const versionMatch = file.filename.match(/_v(\d+)_/);
        if (versionMatch && file.originalName) {
          displayName = `${file.originalName} (v${versionMatch[1]})`;
        }
        md += `📄 [${displayName}](${filePath})\n\n`;
      }
    }

    // Assistant 메시지: segments 또는 기존 방식
    if (msg instanceof AssistantMessage) {
      const assistantMsg = msg as AssistantMessage;

      // segments가 있으면 순서대로 렌더링
      if (assistantMsg.segments?.length) {
        for (const seg of assistantMsg.segments) {
          if (seg.type === 'text') {
            if (seg.content) {
              md += seg.content + '\n\n';
            }
          } else if (seg.type === 'hidden' && showHiddenMessages) {
            const depth = resolveHiddenMessageDepth(seg.depth, normalizedHiddenMessageDepth);
            md += renderHiddenMessage(seg.category, seg.title, seg.content, depth);
          }
        }
      } else {
        // 기존 로직: hiddenMessages 전체 + content
        if (showHiddenMessages && assistantMsg.hiddenMessages?.length) {
          for (const sys of assistantMsg.hiddenMessages) {
            const depth = resolveHiddenMessageDepth(sys.depth, normalizedHiddenMessageDepth);
            md += renderHiddenMessage(sys.category, sys.title, sys.content, depth);
          }
        }
        // 메시지 내용
        if (msg.content) {
          md += msg.content + '\n';
        }
      }
    } else {
      // User/Hidden 메시지
      if (msg.content) {
        md += msg.content + '\n';
      }
    }

    md += '\n';
  }

  // 마크다운 표 앞에 빈 줄이 없으면 추가 (GFM 표준 준수)
  // 패턴: 개행 하나 + 표 헤더 + 표 구분선 → 빈 줄 추가
  md = md.replace(/([^\n])\n(\|[^\n]+\|\n\|[-:| ]+\|)/g, '$1\n\n$2');

  return md;
}

// =====================================
// 메시지 생성/조작 메서드
// =====================================

/**
 * User 메시지 생성
 * - exporter는 content에 마크다운 포맷을 직접 만들지 않는다.
 */
function createUserMessage(input: UserMessageInput): UserMessage {
  assertAllowedKeys(input as Record<string, unknown>, allowedUserInputKeys, 'UserMessageInput');
  assertString(input.content, 'UserMessageInput.content');
  if (input.timestamp !== undefined) {
    assertNumberOrNull(input.timestamp, 'UserMessageInput.timestamp');
  }
  if (input.imageTitle !== undefined) {
    assertStringOrNull(input.imageTitle, 'UserMessageInput.imageTitle');
  }

  const images = normalizeImages(input.images, 'UserMessageInput.images');
  const files = normalizeFiles(input.files, 'UserMessageInput.files');

  const searchQueries = normalizeSearchQueries(input.searchQueries, 'UserMessageInput.searchQueries');
  const searchResults = normalizeSearchResults(input.searchResults, 'UserMessageInput.searchResults');

  return new UserMessage({
    content: input.content,
    timestamp: input.timestamp ?? null,
    images,
    files,
    imageTitle: input.imageTitle,
    searchQueries,
    searchResults
  });
}

/**
 * Assistant 메시지 생성
 * - 인용/헤더 포맷은 core에서 처리한다 (content 내부 포맷은 exporter가 제공 가능).
 */
function createAssistantMessage(input: AssistantMessageInput): AssistantMessage {
  assertAllowedKeys(input as Record<string, unknown>, allowedAssistantInputKeys, 'AssistantMessageInput');
  assertString(input.content, 'AssistantMessageInput.content');
  if (input.timestamp !== undefined) {
    assertNumberOrNull(input.timestamp, 'AssistantMessageInput.timestamp');
  }
  if (input.model !== undefined) {
    assertStringOrNull(input.model, 'AssistantMessageInput.model');
  }
  if (input.imageTitle !== undefined) {
    assertStringOrNull(input.imageTitle, 'AssistantMessageInput.imageTitle');
  }

  const images = normalizeImages(input.images, 'AssistantMessageInput.images');
  const files = normalizeFiles(input.files, 'AssistantMessageInput.files');

  const searchQueries = normalizeSearchQueries(input.searchQueries, 'AssistantMessageInput.searchQueries');
  const searchResults = normalizeSearchResults(input.searchResults, 'AssistantMessageInput.searchResults');
  const hiddenMessages = normalizeHiddenMessages(input.hiddenMessages, 'AssistantMessageInput.hiddenMessages');
  const segments = normalizeSegments(input.segments, 'AssistantMessageInput.segments');

  return new AssistantMessage({
    content: input.content,
    timestamp: input.timestamp ?? null,
    model: input.model ?? null,
    images,
    files,
    imageTitle: input.imageTitle,
    searchQueries,
    searchResults,
    hiddenMessages,
    segments
  });
}

/**
 * 숨은 메시지 생성 (독립적 숨은 메시지)
 */
function createHiddenMessage(input: HiddenMessageInput): HiddenMessage {
  assertAllowedKeys(input as Record<string, unknown>, allowedHiddenInputKeys, 'HiddenMessageInput');
  assertString(input.category, 'HiddenMessageInput.category');
  if (input.title !== undefined) {
    assertStringOrNull(input.title, 'HiddenMessageInput.title');
  }
  if (input.depth !== undefined) {
    assertNumberOrNull(input.depth, 'HiddenMessageInput.depth');
  }
  assertString(input.content, 'HiddenMessageInput.content');

  return new HiddenMessage({
    category: input.category,
    title: input.title ?? null,
    depth: input.depth,
    content: input.content,
  });
}

// exporter는 messages 배열에 직접 push하지 말고 builder만 사용한다.
function createConversationBuilder(init: ConversationInit): ConversationBuilder {
  assertAllowedKeys(init as Record<string, unknown>, allowedConversationInitKeys, 'ConversationInit');
  assertString(init.title, 'ConversationInit.title');
  assertString(init.service, 'ConversationInit.service');
  assertString(init.basename, 'ConversationInit.basename');
  if (init.createdAt !== undefined) {
    assertStringOrNull(init.createdAt, 'ConversationInit.createdAt');
  }

  const messages: Message[] = [];
  const { title, service, createdAt, basename } = init;

  return {
    addUserMessage(input: UserMessageInput) {
      messages.push(createUserMessage(input));
    },
    addAssistantMessage(input: AssistantMessageInput) {
      messages.push(createAssistantMessage(input));
    },
    addHiddenMessage(input: HiddenMessageInput) {
      messages.push(createHiddenMessage(input));
    },
    build() {
      const conversation: Conversation = {
        title,
        service,
        createdAt: createdAt ?? null,
        exportedAt: new Date().toISOString(),
        basename,
        messages,
      };
      assertValidConversation(conversation);
      return conversation;
    },
  };
}

const AIExport: AIExportType = {
  utils,
  toMarkdown,
  _renderHeader: renderHeader,
  createConversationBuilder,
};

// 브라우저 환경에서만 globalThis에 할당
if (typeof globalThis !== 'undefined') {
  globalThis.AIExport = AIExport;
}

// 테스트에서 직접 import 가능하도록 export
export { AIExport, utils, toMarkdown, renderHeader };
export type { Message, Conversation, ExportOptions, ImageInfo, FileInfo } from '../types/index.js';

console.log('[AI Export] Markdown utils loaded');
