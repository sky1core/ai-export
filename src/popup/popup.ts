// AI Export - Popup Script

import type { ExportOptions, ExportResult } from '../types/index.js';

const STORAGE_KEYS = {
  TIMESTAMP: 'showTimestamp',
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
  const chkHiddenMessages = document.getElementById('showHiddenMessages') as HTMLInputElement;

  // 기본값: false
  chkTimestamp.checked = result[STORAGE_KEYS.TIMESTAMP] === true;
  chkHiddenMessages.checked = result[STORAGE_KEYS.HIDDEN_MESSAGES] === true;

  // 변경 시 저장
  chkTimestamp.addEventListener('change', () => {
    chrome.storage.local.set({ [STORAGE_KEYS.TIMESTAMP]: chkTimestamp.checked });
  });
  chkHiddenMessages.addEventListener('change', () => {
    chrome.storage.local.set({ [STORAGE_KEYS.HIDDEN_MESSAGES]: chkHiddenMessages.checked });
  });

  // 서비스 정보 로드
  loadServiceInfo();
});

// 서비스 정보 조회
async function loadServiceInfo(): Promise<void> {
  const infoServiceEl = document.getElementById('infoService')!;

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
    } else {
      infoServiceEl.textContent = '지원되지 않는 페이지';
      infoServiceEl.className = 'info-value info-error';
    }
  } catch (error) {
    console.error('[Popup] getInfo error:', error);
    infoServiceEl.textContent = '지원되지 않는 페이지';
    infoServiceEl.className = 'info-value info-error';
  }
}

// Export 버튼
document.getElementById('exportBtn')!.addEventListener('click', async () => {
  const statusEl = document.getElementById('status')!;
  const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement;

  const options: ExportOptions = {
    showTimestamp: (document.getElementById('showTimestamp') as HTMLInputElement).checked,
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
    statusEl.textContent = '이 페이지에서 지원되지 않습니다';
    statusEl.className = 'status error';
  } finally {
    exportBtn.disabled = false;
  }
});
