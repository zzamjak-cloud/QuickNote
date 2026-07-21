# AI 제공사와 모델

## 단일 계약

AI 모델 화이트리스트와 기본값은 아래 두 파일을 항상 함께 수정한다.

- 클라이언트: `src/lib/ai/models.ts`
- 서버: `infra/lambda/v5-resolvers/handlers/aiConfig.ts`

서버 화이트리스트에 없는 모델은 요청 단계에서 거절된다. 클라이언트 목록만 바꾸면 UI에는
보이지만 호출할 수 없고, 서버 목록만 바꾸면 사용자가 선택할 수 없다.

## Gemini 3.6 Flash

- 모델 ID: `gemini-3.6-flash`
- 상태: Stable/GA, 프로덕션 사용 가능(2026-07-21 출시)
- 기본 출력 한도: QuickNote는 `32_768` 토큰으로 요청한다.
- 공식 문서:
  - <https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash>
  - <https://ai.google.dev/gemini-api/docs/latest-model>

## 선택 가능한 Gemini 모델

- `gemini-3.6-flash` — 최신 기본값
- `gemini-3.5-flash` — 균형형
- `gemini-3.5-flash-lite` — 빠른 저비용 모델
- `gemini-3.1-pro-preview` — 복잡한 추론용 고성능 모델(Preview)

일반적으로 Preview 모델은 운영 중 ID 변경과 종료 가능성이 있어 드롭다운에서 제외하지만,
`gemini-3.1-pro-preview`는 2.5 Pro의 상위 선택지로 명시적으로 제공한다. 모든 Gemini 3.x 요청은
기본 `temperature: 1.0` 최적화를 유지하도록 `temperature`, `top_p`, `top_k`를 포함하지 않는다.
마지막 non-empty 턴을 `model` 역할로 미리 채우지 않는다. GenerateContent 함수 호출은 모델이
반환한 함수 호출 `id`와 `thoughtSignature`를 그대로 보존하고, 후속 `FunctionResponse`에 같은
`id`와 함수 `name`을 포함한다. 일반 응답 파트의 `thoughtSignature`도 원래 파트 위치에 보존한다.
불투명한 호출 ID는 길이를 잘라 변형하지 않고, 허용 상한을
넘으면 요청 자체를 거부한다.

기존 `gemini-2.5-flash`와 `gemini-2.5-pro`는 화이트리스트에서 제거했다. 해당 값이 로컬 또는
서버 설정에 남아 있으면 공통 모델 검증이 `gemini-3.6-flash`로 폴백한다. 고성능 모델이 필요하면
`gemini-3.1-pro-preview`를 선택한다.

## 검증

```bash
npm run test:run -- src/lib/ai/__tests__/models.test.ts
cd infra && npm test -- lambda/ai-proxy/gemini.test.ts lambda/v5-resolvers/handlers/aiConfig.test.ts
npm run build
```

배포 검증은 `develop` 백엔드 배포가 끝난 뒤 dev 웹에서 모델 라벨, 실제 요청 모델 ID, 스트리밍
응답과 도구 호출 왕복을 확인한다. 같은 항목을 `main`/live 배포 후 다시 확인한다. API 키 원문과
Gemini 요청 본문은 로그나 완료 보고에 남기지 않는다.
