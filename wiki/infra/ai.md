# OpenRouter AI 통합

QuickNote의 Gemini, Claude, OpenAI 모델 호출은 OpenRouter 단일 API 키와
`https://openrouter.ai/api/v1/chat/completions` 엔드포인트를 사용한다. 사용자가 입력한 키는
서버에서 KMS로 암호화하며 클라이언트나 조회 응답에 원문을 반환하지 않는다.

## 단일 계약

키 제공사는 `openrouter` 하나이며, 모델은 OpenRouter slug를 그대로 저장하고 전송한다.
화이트리스트와 기본값은 아래 두 파일을 항상 함께 수정한다.

- 클라이언트: `src/lib/ai/models.ts`
- 서버: `infra/lambda/v5-resolvers/handlers/aiConfig.ts`

설정 UI는 OpenRouter 키 하나만 노출한다. 키가 등록되면 원제공사와 무관하게 화이트리스트의
모든 모델을 선택할 수 있다. Lambda 프록시는 `Authorization: Bearer <key>`와 선택적 앱 귀속
헤더 `HTTP-Referer`, `X-OpenRouter-Title`을 전송한다. 실제 API 키나 요청 본문은 로그와 완료
보고에 남기지 않는다.

## 모델 화이트리스트

- Google: `google/gemini-3.6-flash`(기본), `google/gemini-3.5-flash`,
  `google/gemini-3.5-flash-lite`, `google/gemini-3.1-pro-preview`
- Anthropic: `anthropic/claude-haiku-4.5`, `anthropic/claude-sonnet-5`
- OpenAI: `openai/gpt-5-mini`, `openai/gpt-5.1`

모델 카탈로그 변경 여부는 배포 전 OpenRouter `GET /api/v1/models`로 확인한다. 서버
화이트리스트에 없는 모델은 요청 단계에서 거절된다.

## 스트리밍과 도구 호출

OpenRouter의 OpenAI 호환 SSE를 사용하며 다음 계약을 유지한다.

- 도구가 활성화된 모든 요청과 후속 도구 결과 요청에 OpenAI function calling 형식의
  `tools`를 포함한다.
- `: OPENROUTER PROCESSING` 같은 SSE 주석과 빈 줄은 무시하고 `data: [DONE]`에서 정상
  종료한다.
- HTTP 200 이후 `data` 이벤트의 `error`도 공급사 오류로 처리한다.
- usage 전용 마지막 청크가 `finish_reason`을 반복해도 도구 호출을 한 번만 확정한다.
- 클라이언트 연결이 끊기면 upstream reader를 취소해 불필요한 토큰 소모를 막는다.

OpenRouter 호출은 Lambda에서만 발생한다. Tauri/WebView는 기존 AI Lambda Function URL에만
접속하므로 `src-tauri/tauri.conf.json`의 CSP에 `openrouter.ai`를 추가하지 않는다.

## 레거시 마이그레이션

기존 직접 제공사 모델 ID는 조회와 요청 시 대응하는 OpenRouter slug로 정규화한다. 예:
`gemini-3.6-flash` → `google/gemini-3.6-flash`.

기존 Gemini/OpenAI/Anthropic API 키는 OpenRouter 키가 아니므로 자동 변환하거나 재사용하지
않는다. 설정에서 OpenRouter 키를 새로 등록해야 하며, 등록 시 레거시 직접 제공사 키 슬롯을
정리한다. OpenRouter 키가 없으면 AI는 활성 상태여도 요청을 거절한다.

## 검증

```bash
npm run test:run -- src/lib/ai/__tests__/models.test.ts
cd infra && npm test -- lambda/ai-proxy/openai.test.ts lambda/v5-resolvers/handlers/aiConfig.test.ts
npm run build
```

유료 API를 자동 테스트에서 호출하지 않는다. 배포 검증은 `develop` 백엔드 배포 후 dev 웹에서
키 마스킹, 전체 모델 목록, 일반 스트리밍, 이미지, 도구 호출 왕복, 사용량 집계를 확인한다.
같은 항목을 승인된 `main`/live 배포 후 다시 확인한다.

## 공식 문서

- <https://openrouter.ai/docs/quickstart>
- <https://openrouter.ai/docs/guides/features/tool-calling>
- <https://openrouter.ai/docs/api_reference/streaming>
- <https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties>
