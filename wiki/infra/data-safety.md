# 데이터 손실 방지

## 작업 시작 전 체크리스트
- [ ] `infra/` 변경 있는가? → CDK 배포 먼저
- [ ] `Page` 또는 `Database` 타입 변경되는가? → persist version 계획 수립
- [ ] AppSync 스키마(`infra/graphql/`) 변경되는가? → 프론트 타입 동기화 확인

## 머지 전 체크리스트
- [ ] CDK 배포 완료 확인
- [ ] 개발 환경에서 페이지 생성 → 웹에서 즉시 보이는지 확인
- [ ] persist version 변경 시 마이그레이션 테스트 완료

## 데이터가 사라진 경우 진단

**Step 1: outbox 확인**
```
DevTools → Application → IndexedDB → outbox 테이블
```
entries 있으면 → 뮤테이션 서버 미전달 (CDK 미배포 or 네트워크 문제)

**Step 2: AppSync 로그**
```
AWS 콘솔 → AppSync → Logging → 최근 요청 에러
```

**Step 3: localStorage 확인**
```js
JSON.parse(localStorage.getItem('quicknote.pages.v1') ?? '{}')
```

**Step 4: localStorage 초기화 (최후 수단)**
```js
["quicknote.pages.v1","quicknote.databases.v1","quicknote.settings.v1"]
  .forEach(k => localStorage.removeItem(k));
location.reload();
```
