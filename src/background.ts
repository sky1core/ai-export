// AI Export - Background Service Worker

interface DownloadMessage {
  action: 'download';
  filename: string;
  content: string;
}

interface DownloadFileMessage {
  action: 'downloadFile';
  filename: string;
  dataUrl: string;
}

interface FetchImageMessage {
  action: 'fetchImage';
  url: string;
}

type Message = DownloadMessage | DownloadFileMessage | FetchImageMessage;

interface DownloadResponse {
  success: boolean;
  downloadId?: number;
  error?: string;
}

interface FetchImageResponse {
  success: boolean;
  dataUrl?: string;
  mimeType?: string;
  error?: string;
}

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  console.log('[Background] Message received:', message.action);

  // 텍스트 콘텐츠 다운로드 (마크다운)
  if (message.action === 'download') {
    const { filename, content } = message;

    try {
      const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
      const reader = new FileReader();

      reader.onloadend = () => {
        const dataUrl = reader.result as string;

        chrome.downloads.download({
          url: dataUrl,
          filename: filename,
          saveAs: false
        }, (downloadId) => {
          if (chrome.runtime.lastError) {
            console.error('[Background] Download error:', chrome.runtime.lastError);
            (sendResponse as (response: DownloadResponse) => void)({
              success: false,
              error: chrome.runtime.lastError.message
            });
          } else {
            console.log('[Background] Download started:', downloadId);
            (sendResponse as (response: DownloadResponse) => void)({
              success: true,
              downloadId
            });
          }
        });
      };

      reader.readAsDataURL(blob);
    } catch (error) {
      console.error('[Background] Error:', error);
      (sendResponse as (response: DownloadResponse) => void)({
        success: false,
        error: (error as Error).message
      });
    }

    return true; // async response
  }

  // dataUrl로 파일 다운로드 (이미지, 첨부파일 등)
  if (message.action === 'downloadFile') {
    const { filename, dataUrl } = message;

    if (!dataUrl || !filename) {
      (sendResponse as (response: DownloadResponse) => void)({
        success: false,
        error: 'dataUrl/filename 누락'
      });
      return true;
    }

    chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('[Background] Download error:', chrome.runtime.lastError);
        (sendResponse as (response: DownloadResponse) => void)({
          success: false,
          error: chrome.runtime.lastError.message
        });
      } else {
        console.log('[Background] File download started:', downloadId);
        (sendResponse as (response: DownloadResponse) => void)({
          success: true,
          downloadId
        });
      }
    });

    return true; // async response
  }

  // URL에서 이미지를 fetch하고 dataUrl로 반환 (CORS 우회)
  if (message.action === 'fetchImage') {
    const { url } = message;

    if (!url) {
      (sendResponse as (response: FetchImageResponse) => void)({
        success: false,
        error: 'url 누락'
      });
      return true;
    }

    fetch(url, {
      headers: {
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      },
      credentials: 'include',
      mode: 'cors'
    })
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.blob();
      })
      .then(blob => {
        const reader = new FileReader();
        reader.onloadend = () => {
          (sendResponse as (response: FetchImageResponse) => void)({
            success: true,
            dataUrl: reader.result as string,
            mimeType: blob.type
          });
        };
        reader.onerror = () => {
          (sendResponse as (response: FetchImageResponse) => void)({
            success: false,
            error: 'FileReader error'
          });
        };
        reader.readAsDataURL(blob);
      })
      .catch(error => {
        console.error('[Background] fetchImage error:', error);
        (sendResponse as (response: FetchImageResponse) => void)({
          success: false,
          error: (error as Error).message
        });
      });

    return true; // async response
  }
});
