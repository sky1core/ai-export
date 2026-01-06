/**
 * ChatGPT Citation Marker 처리 유틸리티
 *
 * Citation marker 패턴 (알려진 규칙):
 * - citeturn{N}(search|view|file){N}
 * - 여러 개 연결 가능: citeturn0search0turn1search2
 * - file prefix 가능: fileciteturn0file0
 */

// Citation marker 정규식: citeturn{N}(search|view|file){N} 패턴 (반복 가능)
export const CITATION_REGEX = /(?:file)?citeturn\d+(?:search|view|file)\d+(?:turn\d+(?:search|view|file)\d+)*/gi;

export interface ContentReference {
  start_idx: number;
  end_idx: number;
  matched_text?: string;
  alt?: string;
}

/**
 * Citation 마커 제거 (contentReferences 없을 때 사용)
 * - 중국어 괄호 citation 【...】 제거
 * - Private Use Area (PUA) 문자 제거
 * - Citation marker 정규식으로 제거
 */
export function removeCitationMarkers(text: string): string {
  if (!text) return text;
  return text.replace(/\u3010[^】]*\u3011/g, '')
             .replace(/[\uE200-\uE2FF]/g, '')
             .replace(CITATION_REGEX, '');
}

/**
 * Citation 마커를 링크로 대체
 * - contentReferences가 있으면 인덱스 기반으로 대체
 * - 없으면 정규식으로 단순 제거
 */
export function replaceCitationMarkers(text: string, contentReferences?: ContentReference[]): string {
  if (!text) return text;

  if (!contentReferences?.length) {
    return text.replace(/[\uE200-\uE2FF]/g, '').replace(CITATION_REGEX, '').trim();
  }

  // 인덱스 기반 대체 (역순으로 뒤에서부터 - 앞 인덱스가 틀어지지 않도록)
  const sorted = [...contentReferences].sort((a, b) => b.start_idx - a.start_idx);

  let result = text;
  for (const ref of sorted) {
    if (ref.start_idx !== undefined && ref.end_idx !== undefined && ref.alt) {
      result = result.substring(0, ref.start_idx) + ref.alt + result.substring(ref.end_idx);
    }
  }

  // 대체 후 PUA 제거 및 남은 citation marker 정리
  return result.replace(/[\uE200-\uE2FF]/g, '').replace(CITATION_REGEX, '').trim();
}
