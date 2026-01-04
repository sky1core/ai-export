// 이미지 정보
export interface ImageInfo {
  filename: string;
  originalName?: string | null;
}

// 파일 정보
export interface FileInfo {
  filename: string;
  originalName?: string | null;
}

// 검색 결과
export interface SearchResult {
  url: string;
  title: string;
  domain?: string | null;
}

// 숨은 메시지 (공통 타입 - 독립/assistant 내부 모두 동일)
export interface HiddenMessageInfo {
  category: string;
  title?: string | null;
  depth?: number | null;
  content: string;
}

// 세그먼트 타입 (AssistantMessage 내 순서 유지용)
export interface TextSegment {
  type: 'text';
  content: string;
}

export interface HiddenSegment {
  type: 'hidden';
  category: string;
  title?: string | null;
  depth?: number | null;
  content: string;
}

export type Segment = TextSegment | HiddenSegment;

interface MessageBaseInput {
  content: string;
  timestamp?: number | null;
  images?: ImageInfo[];
  files?: FileInfo[];
  imageTitle?: string | null;
  searchQueries?: string[];
  searchResults?: SearchResult[];
}

// Conversation builder inputs
export interface ConversationInit {
  title: string;
  service: string;
  createdAt?: string | null;
  basename: string;
}

export interface UserMessageInput extends MessageBaseInput {}

export interface AssistantMessageInput extends MessageBaseInput {
  model?: string | null;
  hiddenMessages?: HiddenMessageInfo[];
  segments?: Segment[];  // 블록 순서 유지용 (있으면 content/hiddenMessages 대신 사용)
}

export interface HiddenMessageInput {
  category: string;
  title?: string | null;
  depth?: number | null;
  content: string;
}

export interface ConversationBuilder {
  addUserMessage(input: UserMessageInput): void;
  addAssistantMessage(input: AssistantMessageInput): void;
  addHiddenMessage(input: HiddenMessageInput): void;
  build(): Conversation;
}

function freezeStringList(list?: string[]): string[] | undefined {
  if (!list || list.length === 0) return undefined;
  return Object.freeze([...list]);
}

function freezeObjectList<T extends object>(list?: T[]): T[] | undefined {
  if (!list || list.length === 0) return undefined;
  const frozen = list.map((item) => Object.freeze({ ...item }));
  return Object.freeze(frozen);
}

// User 메시지
export class UserMessage {
  readonly content: string;
  readonly timestamp?: number | null;
  readonly images?: ImageInfo[];
  readonly files?: FileInfo[];
  readonly imageTitle?: string | null;
  readonly searchQueries?: string[];
  readonly searchResults?: SearchResult[];
  #brand: true = true;

  constructor(input: UserMessageInput) {
    this.content = input.content;
    this.timestamp = input.timestamp ?? null;
    this.images = freezeObjectList(input.images);
    this.files = freezeObjectList(input.files);
    if (input.imageTitle !== undefined) this.imageTitle = input.imageTitle;
    this.searchQueries = freezeStringList(input.searchQueries);
    this.searchResults = freezeObjectList(input.searchResults);
    Object.freeze(this);
  }
}

// Assistant 메시지
export class AssistantMessage {
  readonly content: string;
  readonly timestamp?: number | null;
  readonly images?: ImageInfo[];
  readonly files?: FileInfo[];
  readonly imageTitle?: string | null;
  readonly searchQueries?: string[];
  readonly searchResults?: SearchResult[];
  readonly model?: string | null;
  readonly hiddenMessages?: HiddenMessageInfo[];
  readonly segments?: Segment[];  // 블록 순서 유지용
  #brand: true = true;

  constructor(input: AssistantMessageInput) {
    this.content = input.content;
    this.timestamp = input.timestamp ?? null;
    this.images = freezeObjectList(input.images);
    this.files = freezeObjectList(input.files);
    if (input.imageTitle !== undefined) this.imageTitle = input.imageTitle;
    this.searchQueries = freezeStringList(input.searchQueries);
    this.searchResults = freezeObjectList(input.searchResults);
    if (input.model !== undefined) this.model = input.model;
    this.hiddenMessages = freezeObjectList(input.hiddenMessages);
    this.segments = freezeObjectList(input.segments);
    Object.freeze(this);
  }
}

// 숨은 메시지 (독립적)
export class HiddenMessage {
  readonly category: string;
  readonly title?: string | null;
  readonly depth?: number | null;
  readonly content: string;
  #brand: true = true;

  constructor(input: HiddenMessageInput) {
    this.category = input.category;
    if (input.title !== undefined) this.title = input.title;
    if (input.depth !== undefined) this.depth = input.depth;
    this.content = input.content;
    Object.freeze(this);
  }
}

// 메시지 유니온 타입
export type Message = UserMessage | AssistantMessage | HiddenMessage;

// 대화
export interface Conversation {
  title: string;
  service: string;
  createdAt?: string | null;
  exportedAt: string;
  basename: string;
  messages: Message[];
}

// Export 옵션
export interface ExportOptions {
  showTimestamp?: boolean;
  showHiddenMessages?: boolean;
  hiddenMessageDepth?: number;
  showModelName?: boolean;
}

// Export 결과
export interface ExportResult {
  success: boolean;
  filename?: string;
  title?: string;
  createdAt?: string | null;
  conversationId?: string | null;
  service?: string;
  filesCount?: number;
  model?: string;
  error?: string;
}

// 유틸리티 함수 타입
export interface AIExportUtils {
  sanitizeFilename(name: string): string;
  generateFilename(title?: string, service?: string, conversationId?: string): string;
  getBasename(filename: string): string;
  formatTimestamp(timestamp: string | number | null | undefined): string;
  downloadMarkdown(content: string, filename: string): Promise<void>;
  downloadFile(dataUrl: string, filename: string): Promise<void>;
  fetchAsBlob(url: string, headers?: Record<string, string>): Promise<Blob>;
  blobToDataUrl(blob: Blob): Promise<string>;
  fetchImageViaBackground(url: string): Promise<{ dataUrl: string; mimeType: string }>;
  getExtensionFromMime(mimeType: string | null): string;
  getExtension(filename: string, mimeType: string): string;
  pythonRegexToJS(pattern: string): string;
}

// AIExport 전역 객체 타입
export interface AIExportType {
  utils: AIExportUtils;
  toMarkdown(conversation: Conversation, options?: ExportOptions): string;
  _renderHeader(msg: Message, showTimestamp: boolean): string;

  // Conversation builder (exporter entrypoint)
  createConversationBuilder(init: ConversationInit): ConversationBuilder;

  // Exporter별 확장
  name?: string;
  service?: string;
  serviceName?: string;
  export?(options?: ExportOptions): Promise<ExportResult>;

  // Claude exporter
  buildStandardConversation?: (rawData: unknown, context: unknown) => Conversation;
  getConversationIdFromUrl?: () => string | null;

  // ChatGPT exporter
  extractConversation?: () => Promise<unknown>;

  // Gemini exporter
  extractTitle?: () => string;
  extractMessagesWithImages?: (basename: string) => Promise<unknown>;
}

// 전역 타입 확장
declare global {
  var AIExport: AIExportType;
}
