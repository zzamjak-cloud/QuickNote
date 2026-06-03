# 페이지 관리

## 파일

| 파일 | 역할 |
|------|------|
| `src/store/pageStore.ts` | 페이지 CRUD, 제목/아이콘 (persist) |
| `src/components/page/` | 페이지 레이아웃, 템플릿 |
| `src/components/sidebar/` | 사이드바 네비게이션 |
| `src/Bootstrap.tsx` | 초기 페이지 fetch |

## 페이지 데이터 구조
```ts
Page {
  id: string
  title: string
  icon?: string
  content: JSONContent  // TipTap doc
  workspaceId: string
  parentId?: string     // 중첩 페이지
  createdAt: string
  updatedAt: string
}
```

## CRUD 흐름
1. 로컬 `pageStore` 즉시 업데이트 (낙관적 업데이트)
2. IndexedDB outbox → AppSync 뮤테이션
3. 다른 클라이언트는 AppSync 구독으로 실시간 수신

## persist
localStorage 키: `quicknote.pages.v1`
버전 관리: [store/schema-versioning.md](../store/schema-versioning.md)

## 중첩 페이지
`parentId` 로 트리 구조. 사이드바에서 중첩 렌더.

## 템플릿
`src/components/page/` 내 템플릿 정의. 새 페이지 생성 시 선택 가능.
