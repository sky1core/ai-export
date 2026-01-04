# AI Export

Claude, Gemini, ChatGPT 대화를 마크다운으로 내보내는 크롬 확장 프로그램.

## 지원 서비스

- Claude (claude.ai)
- ChatGPT (chatgpt.com)
- Gemini (gemini.google.com) - 실험적 지원 (일부 기능 미동작)

## 설치

### GitHub Releases에서 다운로드 (권장)

1. [Releases](../../releases) 페이지에서 최신 버전 zip 다운로드
2. 압축 해제
3. `chrome://extensions` 접속
4. "개발자 모드" 활성화
5. "압축해제된 확장 프로그램을 로드합니다" 클릭
6. 압축 해제한 폴더 선택

### 직접 빌드

```bash
git clone https://github.com/sky1core/ai-export.git
cd ai-export
npm install
npm run build
```

빌드 후 `chrome://extensions`에서 이 폴더를 로드

## 사용법

1. 지원하는 AI 서비스의 대화 페이지로 이동
2. 확장 프로그램 아이콘 클릭
3. "대화 저장" 버튼 클릭
4. `~/Downloads/ai-export/` 폴더에 마크다운 파일 저장됨

## 옵션

- **날짜/시각 표시**: 각 메시지에 타임스탬프 추가
- **모델명 표시**: 어시스턴트 응답에 사용된 모델명 표시
- **숨은 메시지 포함**: 웹 검색, 코드 실행 등 도구 사용 내역 포함

## 저장 내용

- 대화 메시지 (User/Assistant)
- 이미지 (ChatGPT DALL-E 등)
- Artifact (Claude 코드/문서)
- 코드 블록

이미지나 artifact가 포함된 대화는 서브디렉토리에 함께 저장됨.

**숨은 메시지 옵션 활성화 시 추가:**
- Thinking 블록 (심층사고 내용)
- 웹 검색 쿼리/결과
- 도구 사용 내역

## 파일명 형식

```
{service}_{id}_{제목}.md
```

- `service`: claude, gemini, chatgpt
- `id`: 대화 고유 ID (8자리) - 여러 번 저장해도 같은 대화는 같은 ID
