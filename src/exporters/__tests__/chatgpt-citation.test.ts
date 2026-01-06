import { describe, it, expect } from 'vitest';
import {
  CITATION_REGEX,
  removeCitationMarkers,
  replaceCitationMarkers,
  type ContentReference
} from '../chatgpt-citation.js';

/**
 * ChatGPT Citation Marker 테스트
 *
 * Citation marker 패턴 (알려진 규칙):
 * - citeturn{N}(search|view|file){N}
 * - 여러 개 연결 가능: citeturn0search0turn1search2
 * - file prefix 가능: fileciteturn0file0
 */

describe('ChatGPT Citation Marker', () => {
  describe('CITATION_REGEX', () => {
    it('기본 패턴 매칭 - search', () => {
      expect('citeturn0search0'.match(CITATION_REGEX)).toBeTruthy();
    });

    it('기본 패턴 매칭 - view', () => {
      expect('citeturn4view4'.match(CITATION_REGEX)).toBeTruthy();
    });

    it('기본 패턴 매칭 - file', () => {
      expect('citeturn0file0'.match(CITATION_REGEX)).toBeTruthy();
    });

    it('file prefix 패턴 매칭', () => {
      expect('fileciteturn0file0'.match(CITATION_REGEX)).toBeTruthy();
    });

    it('복합 패턴 매칭', () => {
      expect('citeturn1search0turn1search2'.match(CITATION_REGEX)).toBeTruthy();
    });
  });

  describe('removeCitationMarkers', () => {
    it('기본 citation marker 제거 - search', () => {
      expect(removeCitationMarkers('텍스트 citeturn0search0 끝')).toBe('텍스트  끝');
    });

    it('기본 citation marker 제거 - view', () => {
      expect(removeCitationMarkers('텍스트 citeturn4view4 끝')).toBe('텍스트  끝');
    });

    it('기본 citation marker 제거 - file', () => {
      expect(removeCitationMarkers('텍스트 citeturn0file0 끝')).toBe('텍스트  끝');
    });

    it('file prefix citation marker 제거', () => {
      expect(removeCitationMarkers('텍스트 fileciteturn0file0 끝')).toBe('텍스트  끝');
    });

    it('복합 citation marker 제거 (여러 reference)', () => {
      expect(removeCitationMarkers('텍스트 citeturn1search0turn1search2 끝')).toBe('텍스트  끝');
    });

    it('여러 citation marker 동시 제거', () => {
      const input = '첫번째 citeturn0search0 중간 citeturn1view1 마지막';
      expect(removeCitationMarkers(input)).toBe('첫번째  중간  마지막');
    });

    it('Private Use Area 문자 제거', () => {
      const pua = String.fromCharCode(0xE200);
      expect(removeCitationMarkers(`텍스트 ${pua}citeturn0search0${pua} 끝`)).toBe('텍스트  끝');
    });

    it('중국어 괄호 citation 제거', () => {
      expect(removeCitationMarkers('텍스트 【1†source】 끝')).toBe('텍스트  끝');
    });

    it('빈 문자열', () => {
      expect(removeCitationMarkers('')).toBe('');
    });

    it('citation marker만 있는 경우', () => {
      expect(removeCitationMarkers('citeturn0search0')).toBe('');
    });
  });

  describe('replaceCitationMarkers (인덱스 기반)', () => {
    it('단일 citation을 링크로 대체', () => {
      const text = '텍스트 citeturn0search0 끝';
      const refs: ContentReference[] = [
        { start_idx: 4, end_idx: 20, alt: '([링크](https://example.com))' }
      ];
      expect(replaceCitationMarkers(text, refs)).toBe('텍스트 ([링크](https://example.com)) 끝');
    });

    it('여러 citation을 순서대로 대체', () => {
      const text = '첫번째 citeturn0search0 두번째 citeturn1view1 끝';
      const refs: ContentReference[] = [
        { start_idx: 4, end_idx: 20, alt: '([A](url1))' },
        { start_idx: 25, end_idx: 39, alt: '([B](url2))' }
      ];
      expect(replaceCitationMarkers(text, refs)).toBe('첫번째 ([A](url1)) 두번째 ([B](url2)) 끝');
    });

    it('contentReferences가 없으면 정규식으로 제거', () => {
      const text = '텍스트 citeturn0search0 끝';
      expect(replaceCitationMarkers(text, [])).toBe('텍스트  끝');
      expect(replaceCitationMarkers(text, undefined)).toBe('텍스트  끝');
    });

    it('복합 패턴 대체', () => {
      const text = '텍스트 citeturn1search0turn1search2 끝';
      const refs: ContentReference[] = [
        { start_idx: 4, end_idx: 32, alt: '([복합링크](url))' }
      ];
      expect(replaceCitationMarkers(text, refs)).toBe('텍스트 ([복합링크](url)) 끝');
    });

    it('PUA 문자가 포함된 content에서 인덱스 기반 대체', () => {
      // 실제 API에서 PUA 문자가 citation marker를 감싸는 경우
      const pua1 = String.fromCharCode(0xE200);
      const pua2 = String.fromCharCode(0xE201);
      const text = `텍스트 ${pua1}citeturn0search0${pua2} 끝`;
      // API는 PUA 포함 인덱스를 제공
      const refs: ContentReference[] = [
        { start_idx: 4, end_idx: 22, alt: '([링크](url))' }
      ];
      expect(replaceCitationMarkers(text, refs)).toBe('텍스트 ([링크](url)) 끝');
    });
  });

  describe('실제 API 케이스 (2026-01-06 수집)', () => {
    it('citeturn3search16turn3search2 - 복합 reference', () => {
      const text = '구조로 설명합니다. citeturn3search16turn3search2\n\n---';
      const refs: ContentReference[] = [
        { start_idx: 11, end_idx: 40, alt: '([IBKR](https://example.com))' }
      ];
      expect(replaceCitationMarkers(text, refs)).toBe('구조로 설명합니다. ([IBKR](https://example.com))\n\n---');
    });

    it('citeturn4view4 - view 타입 reference', () => {
      const text = '텍스트 citeturn4view4 끝';
      const refs: ContentReference[] = [
        { start_idx: 4, end_idx: 18, alt: '([Bybit](https://www.bybit.com))' }
      ];
      expect(replaceCitationMarkers(text, refs)).toBe('텍스트 ([Bybit](https://www.bybit.com)) 끝');
    });

    it('citeturn0search1 - search 타입 reference', () => {
      const text = '설명 citeturn0search1 추가';
      const refs: ContentReference[] = [
        { start_idx: 3, end_idx: 19, alt: '([Bybit](https://www.bybit.com/en/help-center))' }
      ];
      expect(replaceCitationMarkers(text, refs)).toBe('설명 ([Bybit](https://www.bybit.com/en/help-center)) 추가');
    });
  });
});
