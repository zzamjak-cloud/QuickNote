# AI 통합 (OpenRouter + Claude API)

QuickNote의 Gemini, Claude, OpenAI 모델 호출은 OpenRouter 통합 키
(`https://openrouter.ai/api/v1/chat/completions`)를 쓰고, Claude 모델은 Anthropic API 키가
등록되어 있으면 Anthropic Messages API로 직접 호출한다. 사용자가 입력한 키는 서버에서 KMS로
암호화하며 클라이언트나 조회 응답에 원문을 반환하지 않는다.

## 키·모델 계약

키 슬롯은 `openrouter`, `anthropic` 두 개다(`keys.<slot>`). 레거시 `gemini`/`openai` 직접 키는
읽지 않는다. 모델 ID는 두 경로 모두 OpenRouter slug(`anthropic/claude-sonnet-5` 등) 하나로 저장·
전송하며, 네이티브 ID(`claude-sonnet-5`)로의 변환은 `lambda/ai-proxy/anthropic.ts` 안에서만 한다.
네이티브 ID를 화이트리스트나 DDB에 넣으면 `normalizeModelId`의 레거시 맵이 slug로 되돌린다.

| 등록된 키 | 허용 모델 | 폴백 기본 모델 | `anthropic/*` 호출 경로 |
|---|---|---|---|
| OpenRouter만 | 전체 − 직접 전용 | Gemini 3.8 Flash | OpenRouter |
| Claude만 | `anthropic/*` 전체 | Claude Haiku 4.5 | Anthropic 직접 |
| 둘 다 | 전체 | Gemini 3.8 Flash | Anthropic 직접(우선) |

직접 전용 모델(`AI_DIRECT_ONLY_MODELS`: `anthropic/claude-sonnet-5.5`, `anthropic/claude-opus-5.5`)은
Claude 키로만 호출한다. OpenRouter 경유는 검증하지 않았다. `AI_DEFAULT_MODEL_BY_PROVIDER.anthropic`은
OpenRouter 키만 있을 때 번역에도 쓰이므로 직접 전용 모델로 바꾸지 않는다.

라우팅은 서버 `keyProviderForModel`, 허용 목록은 `allowedModelsForKeys`(클라이언트
`availableModels`)가 결정한다. 조회 응답의 호환 필드 `hasKey`는 "키가 하나라도 있음"이고
`provider`는 OpenRouter 키가 없을 때만 `anthropic`이다. Claude 키는 `sk-ant-` 접두사를 검증한다.
화이트리스트와 기본값은 아래 두 파일을 항상 함께 수정한다.

- 클라이언트: `src/lib/ai/models.ts`
- 서버: `infra/lambda/v5-resolvers/handlers/aiConfig.ts`

설정 UI는 두 키 입력란을 노출한다. OpenRouter Lambda 경로는 `Authorization: Bearer <key>`와 선택적 앱 귀속
헤더 `HTTP-Referer`, `X-OpenRouter-Title`을 전송한다. 실제 API 키나 요청 본문은 로그와 완료
보고에 남기지 않는다.

## 모델 화이트리스트

- Google: `google/gemini-3.8-flash`(기본), `google/gemini-3.5-flash`,
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
- `max_tokens`는 64,000으로 고정한다. 화이트리스트 전 모델이 허용하는 최댓값이며 상한은
  Claude Haiku 4.5(64,000)가 결정한다. Gemini 3.x는 65,536까지 가능하지만 모델별 분기
  대신 공통 상한을 쓴다. 화이트리스트에 출력 한도가 더 낮은 모델을 추가하면 이 값도
  함께 낮춰야 한다.

공급사 어댑터는 `lambda/ai-proxy/openai.ts`(OpenRouter)와 `lambda/ai-proxy/anthropic.ts`
(Anthropic 공식 SDK `@anthropic-ai/sdk`)다. 공통 계약인 `ProviderError`와 `AiStreamResult`는
`lambda/ai-proxy/provider.ts`에 있다.

### Anthropic 직접 경로 계약

- 모델별 규약은 `anthropic.ts`의 `CLAUDE_MODELS` 표가 정한다.
  - **Haiku 4.5·Sonnet 5:** thinking을 끈다. Sonnet 5는 생략하면 adaptive라 `disabled`를 명시한다.
    도구 사용 시 thinking-off 보정 지침을 system 끝에 덧붙인다.
  - **Opus 5.5·Sonnet 5.5:** thinking을 끌 수 없다. adaptive에 `output_config.effort: "medium"`,
    `fallbacks: "default"`(거절 시 같은 호출 안에서 대체 모델), `thinking.block_binding.
    prefix_mismatch_behavior: "drop_block"`(되돌린 블록 검증 실패 시 400 대신 블록만 버림)을 쓰며
    베타 `server-side-fallback-2026-07-01`·`thinking-binding-controls-2026-08-01`을 보낸다.
- **thinking 원문 왕복:** 도구를 호출한 턴이면 서버가 `done` 이벤트에 assistant 콘텐츠 블록 원문
  (`anthropicContent`)을 내려준다. 클라이언트는 이를 다음 라운드 `assistant_tools.anthropicContent`
  로 수정 없이 되돌린다. thinking 블록 서명에는 system·tools·이전 메시지가 묶여 있으므로, 한 번
  보내는 동안의 도구 라운드는 append-only여야 하고 system·tools도 바뀌면 안 된다. 최종 답변
  턴과 이전 질문의 thinking은 다음 질문에서 텍스트로만 보낸다. 앞쪽 thinking 블록을 통째로
  빼는 것은 대화 검증에서 허용된다.
- 서버는 `anthropicContent`를 블록 100개·20만 자 상한으로 검증하고, `tool_use` ID 목록이
  `toolCalls`와 같아야 받아들인다. 직접 경로에서만 쓰고 OpenRouter 경로는 무시한다.
- 대체 모델 전환(`fallback` 블록)이 있으면 마지막 `fallback` 이전의 thinking·tool_use 등은
  되돌리지 않고 text·fallback 블록만 제자리에 남긴다. 도구 호출도 그 이후 블록에서만 뽑는다.
  대체 모델까지 거절하면(`stop_reason: "refusal"`) 오류로 알린다. 사용량은 최상위 `usage`가
  대체 모델 반복까지 포함한 합계다.
- 생각 시간이 붙어 한 라운드가 길어질 수 있어 ai-proxy Lambda 제한 시간은 300초다.
- 컨텍스트 블록은 system 두 번째 블록에 `cache_control: ephemeral`을 건다. 사용량은
  `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`로 집계해 월 한도와
  기준을 맞춘다.
- 연속 도구 결과는 한 user 메시지로 합치고, 빈 assistant 텍스트는 제거한다.
- `baseURL`을 고정하고 SDK 재시도(`maxRetries`)를 끈다. SDK 1.x는 API 키를
  `Authorization: Bearer`로 전송한다.
- `stop_reason`(`max_tokens`·`tool_use`)을 그대로 넘긴다. 클라이언트 `isLengthCutFinish`가
  `max_tokens`를 이어쓰기 대상으로 인식한다.
- 공용 vitest 설정이 jsdom이라 SDK가 브라우저로 오인한다. 어댑터 테스트는 `navigator`를
  숨긴 뒤 `fetch`를 스텁한다.

제공사 호출은 Lambda에서만 발생한다. Tauri/WebView는 기존 AI Lambda Function URL에만
접속하므로 `src-tauri/tauri.conf.json`의 CSP에 `openrouter.ai`·`api.anthropic.com`을 추가하지 않는다.

## 레거시 마이그레이션

기존 직접 제공사 모델 ID는 조회와 요청 시 대응하는 OpenRouter slug로 정규화한다. 예:
`gemini-3.8-flash` → `google/gemini-3.8-flash`.

기존 Gemini/OpenAI 직접 키는 재사용하지 않는다. 직접 제공사 시절의 `keys.anthropic` 슬롯이
남아 있어도 되살리지 않도록, 지금 등록하는 슬롯에는 `v: 2`를 기록하고 `resolveKeysMap`은
anthropic 슬롯 중 `v === 2`만 인정한다. 레거시 슬롯은 다음 키 등록·삭제 때 키 맵 통째 SET으로 정리된다. 키 등록·삭제는
키 맵을 통째로 SET하며 남은 레거시 필드(`apiKeyEnc` 등)도 함께 제거한다. 선택한 모델에 맞는
키가 없으면 AI는 활성 상태여도 요청을 거절한다.

## 검증

```bash
npm run test:run -- src/lib/ai/__tests__/models.test.ts
cd infra && npx vitest run lambda/ai-proxy lambda/v5-resolvers/handlers/aiConfig.test.ts
npm run build
```

유료 API를 자동 테스트에서 호출하지 않는다. 배포 검증은 `develop` 백엔드 배포 후 dev 웹에서
키 마스킹, 키 조합별 모델 목록, 일반 스트리밍, 이미지, 도구 호출 왕복, 사용량 집계를 OpenRouter
경로와 Claude 직접 경로 각각에서 확인한다.
같은 항목을 승인된 `main`/live 배포 후 다시 확인한다.

## 공식 문서

- <https://openrouter.ai/docs/quickstart>
- <https://openrouter.ai/docs/guides/features/tool-calling>
- <https://openrouter.ai/docs/api_reference/streaming>
- <https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties>
- <https://platform.claude.com/docs/en/api/messages>
