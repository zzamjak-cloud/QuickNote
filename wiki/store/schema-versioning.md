# Zustand Persist 스키마 버전 관리

## 버전 bump 필요 조건

| 변경 종류 | bump 필요 |
|---------|:---------:|
| 필수 필드 추가 | ✅ |
| 필드 이름 변경 | ✅ |
| 필드 삭제 | ✅ |
| 선택적 필드 추가 (`?`) | ❌ |
| 로직만 변경 | ❌ |

## 패턴 (`pageStore.ts` / `databaseStore.ts`)

```ts
version: 2,
migrate: (persisted: unknown, fromVersion: number) => {
  if (fromVersion < 1) return { pages: {}, activePageId: null };
  if (fromVersion < 2) {
    const data = persisted as { pages: Record<string, unknown> };
    for (const page of Object.values(data.pages)) {
      (page as Record<string, unknown>).newField ??= defaultValue;
    }
    return data;
  }
  return persisted;
},
```

## localStorage 직접 확인 (디버깅)
```js
JSON.parse(localStorage.getItem('quicknote.pages.v1') ?? '{}')
JSON.parse(localStorage.getItem('quicknote.databases.v1') ?? '{}')
```

## 초기화 (최후 수단)
```js
["quicknote.pages.v1","quicknote.databases.v1","quicknote.settings.v1"]
  .forEach(k => localStorage.removeItem(k));
location.reload();
// Bootstrap 이 AppSync 에서 전체 재페치함
```
