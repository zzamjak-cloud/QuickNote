# 인증 & 권한

## 파일

| 파일 | 역할 |
|------|------|
| `src/components/auth/LoginScreen.tsx` | 로그인 화면 |
| `src/components/auth/AuthGate.tsx` | 인증 게이트 (미로그인 시 LoginScreen 렌더) |
| `src/components/auth/UserMenu.tsx` | 유저 메뉴 (로그아웃 등) |
| `src/store/authStore.ts` | 로그인 상태, 사용자 정보 |
| `src/store/workspaceAccessCacheStore.ts` | 워크스페이스 접근 권한 캐시 |
| `src/lib/auth/` | 인증 유틸 |

## 인증 흐름
1. 앱 진입 → `AuthGate` 가 `authStore` 확인
2. 미인증 → `LoginScreen` 렌더 (OAuth 등)
3. 인증 완료 → `authStore` 업데이트 → 앱 렌더

## 워크스페이스 권한
- `workspaceAccessCacheStore` 에 멤버별 역할 캐시
- 워크스페이스 진입 시 권한 fetch → 캐시 저장
- 권한 없는 워크스페이스 접근 시 접근 거부 UI
