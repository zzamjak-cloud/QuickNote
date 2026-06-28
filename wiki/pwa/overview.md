# PWA (설치·Service Worker·오프라인 정합)

웹(Vercel) 전용 PWA. **Tauri 데스크톱 빌드에는 적용하지 않는다.** 상세 설계: `docs/pwa-plan.md`, `docs/pwa-phase3-offline-design.md`(gitignore, 로컬).

---

## 핵심 파일

| 파일 | 역할 |
|------|------|
| `vite.config.ts` | `VitePWA` 플러그인(웹 빌드만, `!isTauri`). manifest·Workbox precache 설정. Tauri 빌드는 `virtual:pwa-register` 를 `src/lib/pwa/registerStub.ts` 로 alias |
| `src/lib/pwa/swController.ts` | SW 등록 싱글턴(`initPwa`). 주기 업데이트 점검·`forcePwaUpdate`·업데이트 상태 구독 |
| `src/lib/pwa/installPrompt.ts` | `beforeinstallprompt` 부팅 캡처 싱글턴(`initInstallPrompt`) |
| `src/lib/pwa/displayMode.ts` | `isStandalonePwa()`·`isIos()` |
| `src/hooks/usePwaUpdate.ts` | swController 구독 → 업데이트 배너 |
| `src/hooks/useInstallPrompt.ts` | installPrompt 구독 → 설치 CTA |
| `src/hooks/useOnlineStatus.ts` | `navigator.onLine` 구독 |
| `src/components/ui/PwaUpdateBanner.tsx` | 새 버전 새로고침 배너 |
| `src/components/pwa/InstallAppCta.tsx` | 설정>내 프로필 "앱 설치" CTA |
| `src/components/pwa/OfflineBadge.tsx` | TopBar 오프라인·동기화 대기 배지 |
| `src/lib/sync/offlineGap.ts` | 오프라인 갭 추적 + 재접속 fetch escalation |
| `src/lib/sync/resetWorkspaceLocalCaches.ts` | 캐시+워터마크 동반 초기화 단일 진입점 |
| `scripts/generate-pwa-icons.mjs` | `public/favicon.svg` → `public/pwa-*.png` |

---

## ⛔ 불변식 (위반 시 데이터 정합 깨짐)

1. **SW 는 API/Cognito 를 절대 캐시하지 않는다.** Workbox precache 는 정적 셸·해시 청크만. `navigateFallback: /index.html` + `navigateFallbackDenylist: [/^\/api\//, /^\/auth\//]`. GraphQL 응답 캐시는 delta/watermark 정합을 깬다 → 영구 금지.
2. **SW 등록은 부팅 시점(`main.tsx` `initPwa()`)에서 — AuthGate 안이 아니다.** AuthGate 안에 두면 로그인 전(LoginScreen)엔 children 미렌더라 SW 가 등록 안 돼 **설치 불가**해진다.
3. **자동 reload 금지(`registerType: "prompt"`).** 편집 중 손실 방지. 새 SW 는 사용자가 배너로 확인 후 `applyPwaUpdate()` 로만 활성화. 예외: 청크404 루프 등 "이미 깨진 상태"에서 `forcePwaUpdate()`.
4. **캐시 비움과 워터마크 리셋은 항상 짝** — `resetWorkspaceLocalCaches(workspaceId)` 단일 진입점. 어긋나면 delta 페치가 비워진 데이터를 건너뛰어 영구 유실(댓글 사라짐·유령페이지 회귀 패밀리).
5. **epoch bump ↔ SW precache 교체는 동시 배포.** epoch 은 빌드타임에 박히므로 stale SW = stale epoch([collab-live-deploy-checklist §1.8](../infra/collab-live-deploy-checklist.md)).

---

## 셸 신선도 (stale SW 방지)

- `swController` 가 `onRegisteredSW` 에서 registration 보관 → **60분 주기 + `visibilitychange`(포커스 복귀)** 마다 `reg.update()`. 새 SW 감지 시 `onNeedRefresh` → 배너.
- 청크404(`vite:preloadError`)가 새로고침 후에도 반복되면(`src/lib/chunkReload.ts`) stale precache 로 보고 `forcePwaUpdate()`(SW 강제 교체 + reload, 쿨다운 1회 제한).

## 재접속 자가치유 (오프라인 갭 escalation)

`offlineGap.ts`: offline 진입 시각 기록 → 재접속 시 갭 기반 fetch 모드.
- gap < **10분** → delta(watermark)
- gap ≥ **10분** → meta-baseline(누락 항목 자가치유, prune 없음)
- gap ≥ **24시간** → full(prune 포함)

온라인 복귀(`Bootstrap.tsx` online 핸들러): **AppSync 핸드셰이크**(경량 authed 호출) 성공 후에만 flush — `navigator.onLine=true` 라도 캡티브 등 거짓 online 이면 backoff 재시도(최대 5회).

## 설치 UX

- Chrome/Edge/Android: `beforeinstallprompt` 캡처 → 설정>내 프로필 "설치" 버튼.
- iOS Safari: 공유 → "홈 화면에 추가" 안내(`isIos`).
- 그 외/프롬프트 전: 브라우저 메뉴 수동 안내 폴백.

---

## 로컬 테스트 주의

- **dev 서버(`npm run dev`)는 SW 비활성**(`devOptions.enabled:false`) → 설치 테스트 불가. `npm run build && npm run preview` 로 검증.
- 실기기 설치는 **HTTPS**(Vercel preview/prod) 필요. `localhost`/LAN IP 의 차이 주의.
- 새 빌드 반영: stale SW 가 옛 번들을 줄 수 있으니 **새로고침 1~2회**.

## 관련 위키
- [sync/architecture.md](../sync/architecture.md) — SW↔sync 캐시 정합·fetchMode·핸드셰이크
- [infra/collab-live-deploy-checklist.md](../infra/collab-live-deploy-checklist.md) §1.8 — epoch↔SW
- [mobile/overview.md](../mobile/overview.md) — 모바일 반응형
