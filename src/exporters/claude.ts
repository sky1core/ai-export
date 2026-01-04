// Claude Exporter (ISOLATED world)

import {
  type Conversation,
  type ExportOptions,
  type ExportResult,
  type ImageInfo,
  type FileInfo,
} from '../types/index.js';

// Claude API 원본 데이터 타입
interface ClaudeRawData {
  name?: string;
  created_at?: string;
  model?: string;
  system_prompt?: string;
  chat_messages?: ClaudeChatMessage[];
}

interface ClaudeChatMessage {
  sender: 'human' | 'assistant';
  created_at?: string;
  model?: string;
  text?: string;
  content?: ClaudeContentBlock[];
  files_v2?: ClaudeFileV2[];
  attachments?: ClaudeAttachment[];
}

interface ClaudeContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  summaries?: { summary: string }[];
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string | unknown;
  source?: {
    type: 'base64' | 'url';
    data?: string;
    media_type?: string;
    url?: string;
  };
}

interface ClaudeFileV2 {
  uuid?: string;
  id?: string;
  url?: string;
  download_url?: string;
  preview_url?: string;
  file_name?: string;
  name?: string;
  file_type?: string;
  type?: string;
}

interface ClaudeAttachment {
  id: string;
  file_name?: string;
  file_type?: string;
  url?: string;
  preview_url?: string;
  extracted_content?: string;
}

interface DownloadedFile {
  originalName: string;
  localName: string;
  isImage: boolean;
  sourceId?: string;
}

interface ToolUse {
  id: string;
  name: string;
  input: unknown;
}

interface ToolResult {
  toolUseId: string;
  content: string;
}

interface ArtifactState {
  content: string;
  title: string;
  version: number;
  hash: string;
  ext: string;
}

interface BuildContext {
  basename: string;
  downloadedFiles: DownloadedFile[];
  options: ExportOptions;
}

// AIExport 확장
Object.assign(AIExport, {
  name: 'Claude',
  service: 'claude',
  serviceName: 'Claude',
  _organizationId: null as string | null,

  async export(options: ExportOptions = {}): Promise<ExportResult> {
    try {
      const conversationId = this.getConversationIdFromUrl();
      if (!conversationId) {
        throw new Error('대화 ID를 찾을 수 없습니다. /chat/{id} 페이지에서 실행해주세요.');
      }

      // API에서 원본 데이터 가져오기
      const orgId = await this.getOrganizationId();
      const rawData: ClaudeRawData = await this.fetchConversationData(conversationId, orgId);

      const title = rawData.name || 'Claude Conversation';
      const filename = AIExport.utils.generateFilename(title, 'claude', conversationId);
      const basename = AIExport.utils.getBasename(filename);

      // 파일 추출 및 다운로드
      const downloadedFiles = await this.extractAndDownloadFiles(rawData, basename);

      // 표준 Conversation 포맷으로 변환
      const conversation = this.buildStandardConversation(rawData, {
        basename,
        downloadedFiles,
        options
      });

      // 공통 toMarkdown으로 마크다운 생성
      const markdown = AIExport.toMarkdown(conversation, options);

      // 마크다운 다운로드
      await AIExport.utils.downloadMarkdown(markdown, filename);

      return {
        success: true,
        filename,
        title,
        createdAt: rawData.created_at,
        conversationId,
        service: 'claude',
        model: rawData.model,
        filesCount: downloadedFiles.length
      };
    } catch (error) {
      console.error('[Claude Exporter]', error);
      return { success: false, error: (error as Error).message };
    }
  },

  // Claude API 응답 → 표준 Conversation 포맷
  buildStandardConversation(rawData: ClaudeRawData, { basename, downloadedFiles }: BuildContext): Conversation {
    const fileMap = new Map<string, DownloadedFile>();
    for (const f of downloadedFiles) {
      if (f.sourceId) fileMap.set(f.sourceId, f);
    }

    const builder = AIExport.createConversationBuilder({
      title: rawData.name || 'Claude Conversation',
      service: 'claude',
      createdAt: rawData.created_at || null,
      basename
    });

    // 시스템 프롬프트
    if (rawData.system_prompt) {
      builder.addHiddenMessage({
        category: 'System Prompt',
        content: rawData.system_prompt
      });
    }

    // 메시지 변환
    // ⚠️ 메시지 타입 규칙:
    // 숨은 메시지 → 시스템 프롬프트, Thinking, Tool 호출/결과
    // UserMessage → 실제 사용자 입력만
    // AssistantMessage → 사용자에게 보이는 응답만
    for (const msg of (rawData.chat_messages || [])) {
      const isHuman = msg.sender === 'human';

      // 텍스트 추출
      let content = '';
      let thinking: { title: string; content: string } | null = null;
      const msgImages: ImageInfo[] = [];
      const msgFiles: FileInfo[] = [];

      // Tool 관련 정보
      const toolUses: ToolUse[] = [];
      const toolResults: ToolResult[] = [];

      if (msg.content && Array.isArray(msg.content)) {
        // Thinking 블록 추출
        for (const block of msg.content) {
          if (block.type === 'thinking') {
            thinking = {
              title: block.summaries?.[0]?.summary || null,
              content: block.thinking || ''
            };
          }
        }

        // 텍스트/툴 블록 추출
        for (const block of msg.content) {
          if (block.type === 'text') {
            const text = block.text || '';
            content += text + '\n';
          } else if (block.type === 'tool_use') {
            // Tool 호출 정보
            toolUses.push({
              id: block.id || '',
              name: block.name || '',
              input: block.input || {}
            });
            // create_file인 경우 파일 참조 추가
            if (block.name === 'create_file' && block.input?.path) {
              const sourceId = `${block.input.path}:create`;
              const downloaded = fileMap.get(sourceId);
              if (downloaded) {
                msgFiles.push({ filename: downloaded.localName, originalName: downloaded.originalName });
              }
            }
            // str_replace인 경우 파일 참조 추가
            if (block.name === 'str_replace' && block.input?.path) {
              const sourceId = `${block.input.path}:${block.id}`;
              const downloaded = fileMap.get(sourceId);
              if (downloaded) {
                msgFiles.push({ filename: downloaded.localName, originalName: downloaded.originalName });
              }
            }
          } else if (block.type === 'tool_result') {
            // Tool 실행 결과
            toolResults.push({
              toolUseId: block.tool_use_id || '',
              content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
            });
          }
        }
      } else {
        content = msg.text || '';
      }

      // 첨부 파일 매핑
      if (msg.files_v2?.length) {
        for (const file of msg.files_v2) {
          const id = file.uuid || file.id;
          if (!id) continue;
          const downloaded = fileMap.get(id);
          if (downloaded) {
            if (downloaded.isImage) {
              msgImages.push({ filename: downloaded.localName, originalName: downloaded.originalName });
            } else {
              msgFiles.push({ filename: downloaded.localName, originalName: downloaded.originalName });
            }
          }
        }
      }

      if (msg.attachments?.length) {
        for (const att of msg.attachments) {
          const downloaded = fileMap.get(att.id);
          if (downloaded) {
            if (downloaded.isImage) {
              msgImages.push({ filename: downloaded.localName, originalName: downloaded.originalName });
            } else {
              msgFiles.push({ filename: downloaded.localName, originalName: downloaded.originalName });
            }
          }
        }
      }

      // 메인 메시지 content 구성
      // 텍스트에서 thinking 요약 blockquote 제거 (> **Thinking**... / > *Thinking*... 형태)
      let cleanContent = content.trim();
      if (!isHuman) {
        cleanContent = this.removeThinkingSummary(cleanContent);
      }

      // 메시지 생성 (core 메서드 사용 - 직접 할당 금지)
      // 메시지 타입별로 분리하여 타입 안전성 확보
      if (isHuman) {
        // User 메시지
        const userInput = {
          content: cleanContent.trim(),
          timestamp: msg.created_at ? new Date(msg.created_at).getTime() : null,
          images: msgImages.length > 0 ? msgImages : undefined,
          files: msgFiles.length > 0 ? msgFiles : undefined
        };

        // 내용이 있거나 이미지/파일이 있으면 추가
        if (userInput.content || msgImages.length > 0 || msgFiles.length > 0) {
          builder.addUserMessage(userInput);
        }
      } else {
        // Assistant 메시지
        const hiddenMessages: { category: string; title?: string | null; depth?: number | null; content: string }[] = [];

        // assistant 메시지 안의 숨은 메시지들 (Thinking, Tool 등)
        // Thinking (assistant 안에 포함)
        if (thinking) {
          hiddenMessages.push({
            category: 'Thinking',
            title: thinking.title || null,
            content: thinking.content || ''
          });
        }

        // Tool 호출 (assistant 안에 포함)
        for (const tool of toolUses) {
          hiddenMessages.push({
            category: 'Tool Call',
            title: tool.name || null,
            depth: 2,
            content: `\`\`\`\n${JSON.stringify(tool.input, null, 2)}\n\`\`\``
          });
        }

        // Tool 결과 (assistant 안에 포함)
        for (const result of toolResults) {
          const toolUse = toolUses.find(t => t.id === result.toolUseId);
          hiddenMessages.push({
            category: 'Tool Result',
            title: toolUse?.name || null,
            depth: 2,
            content: result.content
          });
        }

        const assistantInput = {
          content: cleanContent.trim(),
          timestamp: msg.created_at ? new Date(msg.created_at).getTime() : null,
          model: msg.model || rawData.model,
          images: msgImages.length > 0 ? msgImages : undefined,
          files: msgFiles.length > 0 ? msgFiles : undefined,
          hiddenMessages: hiddenMessages.length > 0 ? hiddenMessages : undefined
        };

        // 내용이 있거나 이미지/파일이 있거나 hiddenMessages가 있으면 추가
        if (assistantInput.content || msgImages.length > 0 || msgFiles.length > 0 || hiddenMessages.length > 0) {
          builder.addAssistantMessage(assistantInput);
        }
      }
    }

    return builder.build();
  },

  // thinking 요약 blockquote 제거 (> **Thinking**... / > *Thinking*... 로 시작하는 연속된 blockquote)
  removeThinkingSummary(content: string): string {
    const lines = content.split('\n');
    const result: string[] = [];
    let inThinkingBlock = false;
    const thinkingHeaderPattern = /^>\s*(\*\*|\*)?(Thinking|Reasoning)(\*\*|\*)?/;

    for (const line of lines) {
      // Thinking/Reasoning blockquote 발견 → thinking 블록 시작
      if (thinkingHeaderPattern.test(line)) {
        inThinkingBlock = true;
        continue;
      }

      // thinking 블록 안에서 blockquote 라인 계속 스킵
      if (inThinkingBlock) {
        // 빈 줄이거나 blockquote가 아니면 thinking 블록 종료
        if (line.trim() === '' || !line.startsWith('>')) {
          inThinkingBlock = false;
          // 빈 줄은 추가하지 않고 다음 라인부터 정상 처리
          if (line.trim() !== '') {
            result.push(line);
          }
        }
        // blockquote 라인은 스킵
        continue;
      }

      result.push(line);
    }

    // 연속된 빈 줄 정리
    return result.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  },

  // path 해시 생성 (8자리)
  hashPath(path: string): string {
    let hash = 0;
    for (const char of path) {
      hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
    }
    return Math.abs(hash).toString(16).padStart(8, '0').slice(0, 8);
  },

  // 대화에서 파일 추출 및 다운로드
  async extractAndDownloadFiles(rawData: ClaudeRawData, basename: string): Promise<DownloadedFile[]> {
    const files: DownloadedFile[] = [];
    const messages = rawData.chat_messages || [];
    let imageCounter = 0;
    let attachmentCounter = 0;

    // 아티팩트 상태 관리 (path → { content, title, version, hash, ext })
    const artifactStates: Record<string, ArtifactState> = {};

    for (const msg of messages) {
      // files_v2 처리
      if (msg.files_v2?.length) {
        for (const file of msg.files_v2) {
          const fileInfo = await this.processFile(file, basename, imageCounter, attachmentCounter);
          if (fileInfo) {
            files.push(fileInfo);
            if (fileInfo.isImage) imageCounter++;
            else attachmentCounter++;
          }
        }
      }

      // attachments 처리
      if (msg.attachments?.length) {
        for (const att of msg.attachments) {
          const fileInfo = await this.processAttachment(att, basename, imageCounter, attachmentCounter);
          if (fileInfo) {
            files.push(fileInfo);
            if (fileInfo.isImage) imageCounter++;
            else attachmentCounter++;
          }
        }
      }

      // content 블록 처리
      if (msg.content && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block.type === 'image') {
            const fileInfo = await this.processImageBlock(block, basename, imageCounter);
            if (fileInfo) {
              files.push(fileInfo);
              imageCounter++;
            }
          } else if (block.type === 'tool_use' && block.name === 'create_file') {
            // Claude 아티팩트 생성 (버전 1)
            const fileInfo = await this.processCreateFile(block, basename, artifactStates);
            if (fileInfo) {
              files.push(fileInfo);
            }
          } else if (block.type === 'tool_use' && block.name === 'str_replace') {
            // Claude 아티팩트 수정 (버전 N+1)
            const fileInfo = await this.processStrReplace(block, basename, artifactStates);
            if (fileInfo) {
              files.push(fileInfo);
            }
          }
        }
      }
    }

    return files;
  },

  // tool_use create_file 블록 처리 (버전 1)
  async processCreateFile(
    block: ClaudeContentBlock,
    basename: string,
    artifactStates: Record<string, ArtifactState>
  ): Promise<DownloadedFile | null> {
    const input = (block.input || {}) as { path?: string; file_text?: string };
    const filePath = input.path || '';
    const fileText = input.file_text || '';

    if (!filePath || !fileText) return null;

    // 파일 내용에서 첫 번째 마크다운 헤더 추출 (UI에서 표시되는 제목)
    const headerMatch = fileText.match(/^#\s+(.+?)(?:\n|$)/m);
    const pathFileName = filePath.split('/').pop() || 'artifact.txt';
    const ext = pathFileName.includes('.') ? '.' + pathFileName.split('.').pop() : '';

    let displayTitle: string;
    if (headerMatch) {
      // 헤더에서 콜론 이전 부분만 추출 (예: "에이전트 코딩의 제자백가: 부제목" → "에이전트 코딩의 제자백가")
      displayTitle = headerMatch[1].split(':')[0].trim();
    } else {
      // 헤더가 없으면 파일명에서 추출
      displayTitle = pathFileName.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
    }

    // 해시 생성 및 상태 저장
    const hash = this.hashPath(filePath);
    artifactStates[filePath] = {
      content: fileText,
      title: displayTitle,
      version: 1,
      hash,
      ext
    };

    // 파일명: artifact_{hash}_v{N}_{제목}.{ext}
    const safeTitle = AIExport.utils.sanitizeFilename(displayTitle);
    const localName = `artifact_${hash}_v1_${safeTitle}${ext}`;

    try {
      // MIME 타입을 octet-stream으로 설정해서 Chrome이 확장자를 변경하지 않도록 함
      const blob = new Blob([fileText], { type: 'application/octet-stream' });
      const dataUrl = await AIExport.utils.blobToDataUrl(blob);
      await AIExport.utils.downloadFile(dataUrl, `${basename}/${localName}`);

      return {
        originalName: displayTitle,
        localName,
        isImage: false,
        sourceId: `${filePath}:create`
      };
    } catch (e) {
      console.error('[Claude] create_file processing failed:', e);
      return null;
    }
  },

  // tool_use str_replace 블록 처리 (버전 N+1)
  async processStrReplace(
    block: ClaudeContentBlock,
    basename: string,
    artifactStates: Record<string, ArtifactState>
  ): Promise<DownloadedFile | null> {
    const input = (block.input || {}) as { path?: string; old_str?: string; new_str?: string };
    const filePath = input.path || '';
    const oldStr = input.old_str || '';
    const newStr = input.new_str || '';

    if (!filePath || !oldStr) return null;

    // 상태에서 현재 내용 가져오기
    const state = artifactStates[filePath];
    if (!state) {
      console.warn('[Claude] str_replace: No state found for path:', filePath);
      return null;
    }

    // diff 적용
    const newContent = state.content.replace(oldStr, newStr);
    if (newContent === state.content) {
      console.warn('[Claude] str_replace: old_str not found in content');
      return null;
    }

    // 상태 업데이트
    state.content = newContent;
    state.version++;

    // 파일명: artifact_{hash}_v{N}_{제목}.{ext}
    const safeTitle = AIExport.utils.sanitizeFilename(state.title);
    const localName = `artifact_${state.hash}_v${state.version}_${safeTitle}${state.ext}`;

    try {
      const blob = new Blob([newContent], { type: 'application/octet-stream' });
      const dataUrl = await AIExport.utils.blobToDataUrl(blob);
      await AIExport.utils.downloadFile(dataUrl, `${basename}/${localName}`);

      return {
        originalName: state.title,
        localName,
        isImage: false,
        sourceId: `${filePath}:${block.id}`
      };
    } catch (e) {
      console.error('[Claude] str_replace processing failed:', e);
      return null;
    }
  },

  // files_v2 항목 처리
  async processFile(
    file: ClaudeFileV2,
    basename: string,
    imageIdx: number,
    fileIdx: number
  ): Promise<DownloadedFile | null> {
    const url = file.url || file.download_url || file.preview_url;
    if (!url) return null;

    const originalName = file.file_name || file.name || 'file';
    const mimeType = file.file_type || file.type || 'application/octet-stream';
    const isImage = mimeType.startsWith('image/');

    const ext = AIExport.utils.getExtensionFromMime(mimeType);
    // 확장자 제거한 baseName 추출 (확장자 중복 방지)
    const baseName = originalName.replace(/\.[a-zA-Z0-9]+$/, '');
    const localName = isImage
      ? `image_${imageIdx + 1}${ext}`
      : `file_${fileIdx + 1}_${AIExport.utils.sanitizeFilename(baseName).substring(0, 50)}${ext}`;

    const downloaded = await this.downloadFile(url, basename, localName);
    if (!downloaded) return null;

    return {
      originalName,
      localName,
      isImage,
      sourceId: file.uuid || file.id
    };
  },

  // attachments 항목 처리
  async processAttachment(
    att: ClaudeAttachment,
    basename: string,
    imageIdx: number,
    fileIdx: number
  ): Promise<DownloadedFile | null> {
    const originalName = att.file_name || 'attachment';
    const mimeType = att.file_type || 'application/octet-stream';
    const isImage = mimeType.startsWith('image/');

    let ext = AIExport.utils.getExtensionFromMime(mimeType);
    // 확장자 제거한 baseName 추출 (확장자 중복 방지)
    const baseName = originalName.replace(/\.[a-zA-Z0-9]+$/, '');

    // URL이 있으면 다운로드, 없으면 extracted_content를 직접 저장
    const url = att.url || att.preview_url;

    if (url) {
      const localName = isImage
        ? `image_${imageIdx + 1}${ext}`
        : `file_${fileIdx + 1}_${AIExport.utils.sanitizeFilename(baseName).substring(0, 50)}${ext}`;
      const downloaded = await this.downloadFile(url, basename, localName);
      if (!downloaded) return null;
      return { originalName, localName, isImage, sourceId: att.id };
    } else if (att.extracted_content) {
      // extracted_content는 텍스트 내용 - 확장자 없으면 .txt 강제
      if (!ext) ext = '.txt';

      // 파일명 정보가 없으면 순번으로 명명 (baseName이 'attachment'이면 파일명 정보 없는 것)
      const hasFileName = baseName && baseName !== 'attachment';
      const displayName = hasFileName ? baseName : `attachment_${fileIdx + 1}`;
      const localName = AIExport.utils.sanitizeFilename(displayName).substring(0, 80) + ext;

      const downloaded = await this.saveTextContent(att.extracted_content, basename, localName);
      if (!downloaded) return null;
      return { originalName: displayName, localName, isImage: false, sourceId: att.id };
    }

    return null;
  },

  // content 블록의 image 타입 처리
  async processImageBlock(
    block: ClaudeContentBlock,
    basename: string,
    imageIdx: number
  ): Promise<DownloadedFile | null> {
    const source = block.source;
    if (!source) return null;

    if (source.type === 'base64') {
      const mimeType = source.media_type || 'image/png';
      const ext = AIExport.utils.getExtensionFromMime(mimeType);
      const localName = `image_${imageIdx + 1}${ext}`;

      try {
        const byteChars = atob(source.data || '');
        const byteArray = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) {
          byteArray[i] = byteChars.charCodeAt(i);
        }
        const blob = new Blob([byteArray], { type: mimeType });
        const dataUrl = await AIExport.utils.blobToDataUrl(blob);
        await AIExport.utils.downloadFile(dataUrl, `${basename}/${localName}`);

        return {
          originalName: `image_${imageIdx + 1}`,
          localName,
          isImage: true
        };
      } catch (e) {
        console.error('[Claude] Base64 decode error:', e);
        return null;
      }
    } else if (source.type === 'url') {
      const ext = AIExport.utils.getExtensionFromMime(source.media_type || 'image/png');
      const localName = `image_${imageIdx + 1}${ext}`;
      const downloaded = await this.downloadFile(source.url || '', basename, localName);
      if (!downloaded) return null;

      return {
        originalName: `image_${imageIdx + 1}`,
        localName,
        isImage: true
      };
    }

    return null;
  },

  // 파일 다운로드 실행
  async downloadFile(url: string, basename: string, localName: string): Promise<boolean> {
    try {
      const blob = await AIExport.utils.fetchAsBlob(url);
      const dataUrl = await AIExport.utils.blobToDataUrl(blob);
      await AIExport.utils.downloadFile(dataUrl, `${basename}/${localName}`);
      return true;
    } catch (e) {
      console.error(`[Claude] File download failed: ${url}`, e);
      return false;
    }
  },

  // 텍스트 콘텐츠를 파일로 직접 저장 (extracted_content용)
  async saveTextContent(content: string, basename: string, localName: string): Promise<boolean> {
    try {
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const dataUrl = await AIExport.utils.blobToDataUrl(blob);
      await AIExport.utils.downloadFile(dataUrl, `${basename}/${localName}`);
      return true;
    } catch (e) {
      console.error(`[Claude] Text content save failed:`, e);
      return false;
    }
  },

  // 유틸리티 함수들
  getConversationIdFromUrl(): string | null {
    const url = new URL(window.location.href);
    const pathParts = url.pathname.split('/').filter(Boolean);
    if (pathParts[0] === 'chat' && pathParts[1]) {
      return pathParts[1];
    }
    return null;
  },

  async getOrganizationId(): Promise<string> {
    if (this._organizationId) return this._organizationId;

    const response = await fetch('https://claude.ai/api/organizations', {
      credentials: 'include'
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('로그인이 필요합니다.');
      }
      throw new Error(`Organization 조회 실패: ${response.status}`);
    }

    const orgs = await response.json();
    if (!orgs || orgs.length === 0) {
      throw new Error('Organization을 찾을 수 없습니다.');
    }

    this._organizationId = orgs[0].uuid;
    return this._organizationId!;
  },

  async fetchConversationData(conversationId: string, orgId: string): Promise<ClaudeRawData> {
    const url = `https://claude.ai/api/organizations/${orgId}/chat_conversations/${conversationId}?rendering_mode=messages&render_all_tools=true`;

    const response = await fetch(url, {
      credentials: 'include'
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('대화를 찾을 수 없습니다.');
      }
      throw new Error(`대화 데이터 조회 실패: ${response.status}`);
    }

    return await response.json();
  },
});

console.log('[Claude Exporter] Loaded');
