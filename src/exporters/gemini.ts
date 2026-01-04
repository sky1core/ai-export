// Gemini Exporter (ISOLATED world, DOM 파싱 방식)

import {
  type Conversation,
  type ExportOptions,
  type ExportResult,
  type ImageInfo,
} from '../types/index.js';

// DOM 추출 메시지 타입
interface ExtractedMessage {
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  imageInfos?: DownloadedImage[];
}

interface DownloadedImage {
  localName: string;
  downloaded: boolean;
}

// AIExport 확장
Object.assign(AIExport, {
  name: 'Gemini',
  service: 'gemini',
  serviceName: 'Gemini',

  async export(options: ExportOptions = {}): Promise<ExportResult> {
    try {
      const title = this.extractTitle();
      const conversationId = this.getConversationIdFromUrl();
      const filename = AIExport.utils.generateFilename(title, 'gemini', conversationId || '');
      const basename = AIExport.utils.getBasename(filename);

      // DOM에서 메시지와 이미지 추출
      const { messages, images } = await this.extractMessagesWithImages(basename);

      if (messages.length === 0) {
        throw new Error('대화 내용을 찾을 수 없습니다.');
      }

      // 표준 Conversation 포맷으로 변환
      const conversation = this.buildStandardConversation({
        title,
        messages,
        basename
      });

      // 공통 toMarkdown으로 마크다운 생성
      const markdown = AIExport.toMarkdown(conversation, options);

      // 마크다운 다운로드
      await AIExport.utils.downloadMarkdown(markdown, filename);

      return {
        success: true,
        filename,
        title,
        createdAt: null,
        conversationId,
        service: 'gemini',
        filesCount: images.length
      };
    } catch (error) {
      console.error('[Gemini Exporter]', error);
      return { success: false, error: (error as Error).message };
    }
  },

  // DOM 추출 데이터 → 표준 Conversation 포맷
  buildStandardConversation({ title, messages, basename }: {
    title: string;
    messages: ExtractedMessage[];
    basename: string;
  }): Conversation {
    const builder = AIExport.createConversationBuilder({
      title,
      service: 'gemini',
      createdAt: null,
      basename
    });

    for (const msg of messages) {
      // 메시지 타입별로 분리하여 타입 안전성 확보
      if (msg.role === 'user') {
        // 이미지 (다운로드된 것만 포함)
        let userImages: ImageInfo[] | undefined;
        if (msg.imageInfos?.length) {
          const downloadedImages = msg.imageInfos.filter(i => i.downloaded);
          if (downloadedImages.length > 0) {
            userImages = downloadedImages.map((i): ImageInfo => ({
              filename: i.localName,
              originalName: i.localName
            }));
          }
        }

        builder.addUserMessage({
          content: msg.content || '',
          timestamp: null,
          images: userImages
        });
      } else {
        // Thinking (assistant 안에 포함)
        const hiddenMessages = msg.thinking ? [{ category: 'Thinking', content: msg.thinking }] : undefined;

        // 이미지 (다운로드된 것만 포함)
        let assistantImages: ImageInfo[] | undefined;
        if (msg.imageInfos?.length) {
          const downloadedImages = msg.imageInfos.filter(i => i.downloaded);
          if (downloadedImages.length > 0) {
            assistantImages = downloadedImages.map((i): ImageInfo => ({
              filename: i.localName,
              originalName: i.localName
            }));
          }
        }

        builder.addAssistantMessage({
          content: msg.content || '',
          timestamp: null,
          images: assistantImages,
          hiddenMessages
        });
      }
    }

    return builder.build();
  },

  // DOM에서 메시지와 이미지를 함께 추출
  async extractMessagesWithImages(basename: string): Promise<{ messages: ExtractedMessage[]; images: DownloadedImage[] }> {
    const messages: ExtractedMessage[] = [];
    const images: DownloadedImage[] = [];
    let imageCounter = 0;

    // conversation-container 찾기 (각 대화 턴)
    const conversationContainers = document.querySelectorAll('.conversation-container');
    const seenUserTexts = new Set<string>();

    for (const container of conversationContainers) {
      // USER-QUERY 찾기
      const userQuery = container.querySelector('user-query');
      const queryTextEl = userQuery?.querySelector('.query-text');
      const queryText = queryTextEl?.textContent?.trim() || '';

      // 중복 제거
      if (seenUserTexts.has(queryText)) continue;
      seenUserTexts.add(queryText);

      // 사용자 메시지 이미지 추출
      const userImageInfos: DownloadedImage[] = [];
      if (userQuery) {
        const userImgEls = userQuery.querySelectorAll('img');
        for (const img of userImgEls) {
          const imgInfo = await this.downloadImage((img as HTMLImageElement).src, basename, imageCounter);
          if (imgInfo) {
            userImageInfos.push(imgInfo);
            if (imgInfo.downloaded) images.push(imgInfo);
            imageCounter++;
          }
        }
      }

      // 사용자 메시지 추가
      if (queryText) {
        messages.push({
          role: 'user',
          content: queryText,
          imageInfos: userImageInfos.length > 0 ? userImageInfos : undefined
        });
      }

      // MODEL-RESPONSE 찾기
      const modelResponse = container.querySelector('model-response');
      if (modelResponse) {
        const modelResponseText = modelResponse.querySelector('.model-response-text');
        const responseText = modelResponseText?.textContent?.trim() || '';

        // thinking 블록 찾기
        let thinking: string | undefined;
        const thoughtEl = modelResponse.querySelector('.model-thoughts');
        if (thoughtEl) {
          thinking = thoughtEl.textContent?.trim() || undefined;
        }

        // 응답 내 이미지 찾기 (생성된 이미지 포함)
        const assistantImageInfos: DownloadedImage[] = [];
        const genImagesContainer = modelResponse.querySelector('.generated-images');
        const imgSearchContainer = genImagesContainer || modelResponseText || modelResponse;
        const imgEls = imgSearchContainer.querySelectorAll('img');
        for (const img of imgEls) {
          const imgInfo = await this.downloadImage((img as HTMLImageElement).src, basename, imageCounter);
          if (imgInfo) {
            assistantImageInfos.push(imgInfo);
            if (imgInfo.downloaded) images.push(imgInfo);
            imageCounter++;
          }
        }

        // 응답 메시지 추가
        const assistantMsg: ExtractedMessage = {
          role: 'assistant',
          content: responseText,
          thinking,
          imageInfos: assistantImageInfos.length > 0 ? assistantImageInfos : undefined
        };

        messages.push(assistantMsg);
      }
    }

    return { messages, images };
  },

  // 이미지 다운로드 (실패 시 null 반환)
  async downloadImage(url: string, basename: string, index: number): Promise<DownloadedImage | null> {
    if (!url) return null;

    // data URL 처리
    if (url.startsWith('data:')) {
      const mimeMatch = url.match(/^data:([^;]+);/);
      const mimeType = mimeMatch?.[1] || 'image/png';
      const ext = this.getExtensionFromMime(mimeType);
      const localName = `image_${index + 1}${ext}`;

      try {
        await AIExport.utils.downloadFile(url, `${basename}/${localName}`);
        return { localName, downloaded: true };
      } catch (e) {
        console.error('[Gemini] Data URL download failed:', e);
        return null;
      }
    }

    // 일반 URL 처리 - 직접 fetch 시도 후 실패하면 background로 fallback
    try {
      const blob = await AIExport.utils.fetchAsBlob(url);
      const ext = this.getExtensionFromMime(blob.type);
      const localName = `image_${index + 1}${ext}`;
      const dataUrl = await AIExport.utils.blobToDataUrl(blob);
      await AIExport.utils.downloadFile(dataUrl, `${basename}/${localName}`);
      return { localName, downloaded: true };
    } catch (e) {
      console.log(`[Gemini] Direct fetch failed, trying via background: ${(e as Error).message}`);

      // CORS 우회: background.js를 통해 fetch
      try {
        const { dataUrl, mimeType } = await AIExport.utils.fetchImageViaBackground(url);
        const ext = this.getExtensionFromMime(mimeType);
        const localName = `image_${index + 1}${ext}`;
        await AIExport.utils.downloadFile(dataUrl, `${basename}/${localName}`);
        return { localName, downloaded: true };
      } catch (e2) {
        console.error(`[Gemini] Image download failed: ${(e2 as Error).message}`);
        return null;
      }
    }
  },

  // 유틸리티 함수들
  extractTitle(): string {
    const titleEl = document.querySelector('.conversation-title, [data-conversation-title]');
    if (titleEl && titleEl.textContent?.trim()) {
      return titleEl.textContent.trim();
    }
    return 'Gemini Conversation';
  },

  getConversationIdFromUrl(): string | null {
    const url = new URL(window.location.href);
    const pathParts = url.pathname.split('/').filter(Boolean);
    if (pathParts[0] === 'app' && pathParts[1]) {
      return pathParts[1];
    }
    return null;
  },

  getExtensionFromMime(mimeType: string): string {
    return AIExport.utils.getExtensionFromMime(mimeType) || '.png';
  }
});

console.log('[Gemini Exporter] Loaded');
