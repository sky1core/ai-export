// AI Export - Content Script (ISOLATED world)
// 직접 exporter를 호출하고 chrome.runtime으로 background와 통신

import type { ExportOptions, ExportResult } from './types/index.js';

console.log('[AI Export] Content script loaded');

// popup에서 메시지 수신
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  console.log('[AI Export] Message from popup:', message);

  if (message.action === 'export') {
    const options: ExportOptions = message.options || {};

    // 직접 export 실행
    AIExport.export!(options)
      .then((result: ExportResult) => {
        console.log('[AI Export] Export result:', result);
        sendResponse(result);
      })
      .catch((error: Error) => {
        console.error('[AI Export] Export error:', error);
        sendResponse({ success: false, error: error.message });
      });
    return true; // async response
  }

  if (message.action === 'getInfo') {
    const result = {
      success: true,
      service: AIExport.service,
      serviceName: AIExport.serviceName,
      conversationId: AIExport.getConversationIdFromUrl?.() || null
    };
    console.log('[AI Export] GetInfo result:', result);
    sendResponse(result);
    return;
  }
});

console.log(`[AI Export] ${AIExport?.name || 'Unknown'} exporter ready`);
