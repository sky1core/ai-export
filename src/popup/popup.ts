// AI Export - Popup Script

import type { ExportOptions, ExportResult } from '../types/index.js';

const STORAGE_KEYS = {
  TIMESTAMP: 'showTimestamp',
  MODEL_NAME: 'showModelName',
  HIDDEN_MESSAGES: 'showHiddenMessages'
} as const;

interface ServiceInfoResponse {
  success: boolean;
  service?: string;
  serviceName?: string;
  conversationId?: string | null;
}

// 옵션 로드
document.addEventListener('DOMContentLoaded', async () => {
  const result = await chrome.storage.local.get(Object.values(STORAGE_KEYS));

  const chkTimestamp = document.getElementById('showTimestamp') as HTMLInputElement;
  const chkModelName = document.getElementById('showModelName') as HTMLInputElement;
  const chkHiddenMessages = document.getElementById('showHiddenMessages') as HTMLInputElement;

  // 기본값: false
  chkTimestamp.checked = result[STORAGE_KEYS.TIMESTAMP] === true;
  chkModelName.checked = result[STORAGE_KEYS.MODEL_NAME] === true;
  chkHiddenMessages.checked = result[STORAGE_KEYS.HIDDEN_MESSAGES] === true;

  // 변경 시 저장
  chkTimestamp.addEventListener('change', () => {
    chrome.storage.local.set({ [STORAGE_KEYS.TIMESTAMP]: chkTimestamp.checked });
  });
  chkModelName.addEventListener('change', () => {
    chrome.storage.local.set({ [STORAGE_KEYS.MODEL_NAME]: chkModelName.checked });
  });
  chkHiddenMessages.addEventListener('change', () => {
    chrome.storage.local.set({ [STORAGE_KEYS.HIDDEN_MESSAGES]: chkHiddenMessages.checked });
  });

  // 서비스 정보 로드
  loadServiceInfo();
});

// 서비스별 주의사항
const SERVICE_NOTICES: Record<string, string> = {
  chatgpt: '💡 저장 전 페이지 새로고침을 권장합니다.',
  gemini: '⚠️ Gemini는 실험적 지원입니다. 일부 기능이 지원되지 않을 수 있습니다.'
};

// 지원되는 도메인
const SUPPORTED_DOMAINS = ['chatgpt.com', 'claude.ai', 'gemini.google.com'];

function isSupportedUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const hostname = new URL(url).hostname;
    return SUPPORTED_DOMAINS.some(domain => hostname === domain || hostname.endsWith('.' + domain));
  } catch {
    return false;
  }
}

// 서비스 정보 조회
async function loadServiceInfo(): Promise<void> {
  const infoServiceEl = document.getElementById('infoService')!;
  const noticeEl = document.getElementById('notice')!;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab.id) {
      throw new Error('No active tab');
    }

    const response: ServiceInfoResponse = await chrome.tabs.sendMessage(tab.id, {
      action: 'getInfo'
    });

    if (response && response.success) {
      infoServiceEl.textContent = response.serviceName || '';
      infoServiceEl.className = `info-value service ${response.service}`;

      // 서비스별 주의사항 표시
      const notice = SERVICE_NOTICES[response.service || ''];
      if (notice) {
        noticeEl.textContent = notice;
        noticeEl.classList.add('visible');
      }
    } else {
      const errorMsg = isSupportedUrl(tab.url) ? '페이지 새로고침 필요' : '지원되지 않는 페이지';
      infoServiceEl.textContent = errorMsg;
      infoServiceEl.className = 'info-value info-error';
    }
  } catch (error) {
    console.error('[Popup] getInfo error:', error);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const errorMsg = isSupportedUrl(tab?.url) ? '페이지 새로고침 필요' : '지원되지 않는 페이지';
    infoServiceEl.textContent = errorMsg;
    infoServiceEl.className = 'info-value info-error';
  }
}

// Export 버튼
document.getElementById('exportBtn')!.addEventListener('click', async () => {
  const statusEl = document.getElementById('status')!;
  const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement;

  const options: ExportOptions = {
    showTimestamp: (document.getElementById('showTimestamp') as HTMLInputElement).checked,
    showModelName: (document.getElementById('showModelName') as HTMLInputElement).checked,
    showHiddenMessages: (document.getElementById('showHiddenMessages') as HTMLInputElement).checked
  };

  statusEl.textContent = 'Exporting...';
  statusEl.className = 'status';
  exportBtn.disabled = true;

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab.id) {
      throw new Error('No active tab');
    }

    const response: ExportResult = await chrome.tabs.sendMessage(tab.id, {
      action: 'export',
      options
    });

    if (response.success) {
      // export()가 이미 파일 다운로드를 처리함
      statusEl.textContent = `Exported: ${response.filename}`;
      statusEl.className = 'status success';
    } else {
      statusEl.textContent = response.error || 'Export failed';
      statusEl.className = 'status error';
    }
  } catch (error) {
    console.error('[Popup]', error);
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const errorMsg = isSupportedUrl(tab?.url) ? '페이지 새로고침 후 다시 시도하세요' : '지원되지 않는 페이지입니다';
    statusEl.textContent = errorMsg;
    statusEl.className = 'status error';
  } finally {
    exportBtn.disabled = false;
  }
});
