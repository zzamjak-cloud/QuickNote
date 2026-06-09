# Database Architecture

이 문서는 QuickNote 데이터베이스 모델의 운영 기준을 정리한다. 구현 세부는 변경될 수 있지만, 아래 원칙은 schema 변경과 리팩토링 시 유지해야 한다.

## Source Of Truth

AppSync가 원격 source of truth다. 로컬 Zustand persist와 IndexedDB/Tauri SQLite outbox는 빠른 렌더링과 오프라인 작업을 위한 캐시/전송 큐다.

로컬 스토어는 다음 역할을 가진다.

- `pageStore`: 페이지 본문, 페이지 메타, DB row page, `dbCells`를 보관한다.
- `databaseStore`: DB meta, column 정의, row order, row preset을 보관한다.
- `databaseViewPrefsStore`: 검색, 필터, 정렬, view preference처럼 서버 schema가 아닌 UI preference를 보관한다.

서버 전송 전후의 DB schema 정규화 진입점은 `src/lib/database/schema/normalizeDatabase.ts`다. persist migration, local-to-GQL serialization, GQL-to-local apply가 같은 정규화 규칙을 사용해야 한다.

## Direct Page DB And Inline DB

QuickNote에는 DB를 보여주는 방식이 두 가지다.

- Direct page DB: 페이지 자체가 하나의 DB 화면이다. `page.databaseId`가 연결되고, DB title/page title이 사용자에게 DB 문서처럼 보인다.
- Inline DB: 일반 문서 안에 database block이 포함된다. block attrs가 특정 `databaseId`를 참조하고, 문서 흐름 안에서 DB view를 렌더링한다.

두 방식 모두 동일한 `DatabaseBundle`과 row page를 사용한다. 차이는 저장 schema가 아니라 진입점과 렌더링 위치다.

운영 기준:

- DB schema 변경은 direct page와 inline block 양쪽에서 모두 검증한다.
- row page의 실제 값은 `page.dbCells`에 저장한다.
- DB row 표시 순서는 `DatabaseBundle.rowPageOrder`를 기준으로 한다.
- view별 검색/필터/정렬 상태는 DB schema가 아니라 view preference로 취급한다.

## Column Config Schema

`ColumnDef.config`는 column type별 선택 설정을 담는다. 알 수 없는 필드가 들어오더라도 정규화 경로에서 안전하게 거르거나 보존 대상만 명시적으로 통과시켜야 한다.

주요 config:

- `options`: `select`, `multiSelect`, `status` 옵션 목록.
- `linkedScope`: 조직, 팀, 프로젝트 같은 scheduler scope 옵션을 store에서 미러링한다.
- `sourceFromDb`: 다른 DB column 옵션을 source로 사용한다. `databaseId`, `columnId`, `automation`, `viaPageLinkColumnId`를 보존한다.
- `progressSource`: 다른 DB row 상태를 기준으로 진행률을 계산한다. `databaseId`, `columnId`, `completedValue`, `scope`를 보존한다.
- `pageLinkScopeDatabaseId`: page link 검색 범위를 특정 DB로 제한한다.
- `pageLinkMirrorColumnId`: 연결 페이지에서 표시할 mirror column.
- `searchFilters`: page link 검색 popup에서 적용할 추가 필터.
- `itemFetchSourceDatabaseId`, `itemFetchMatchColumnId`: 현재 row title과 source DB의 match column을 비교해 관련 page를 가져온다.

새 config 필드를 추가할 때는 다음 경로를 함께 확인한다.

- `src/types/database.ts`
- `src/lib/database/schema/normalizeDatabase.ts`
- `src/store/__tests__/persistedStoreMigrations.test.ts`
- `src/store/databaseStore/__tests__/databaseGqlSerialization.test.ts`
- `src/lib/sync/__tests__/storeApplyDatabase.test.ts`
- `infra/lambda/v5-resolvers/handlers/pageDatabase.test.ts`

## Schema Change Checklist

DB type 또는 필수 field를 바꾸는 경우:

- `DATABASE_STORE_VERSION` 또는 관련 persist version bump 필요 여부를 판단한다.
- `normalizeDatabaseBundle`이 기존 데이터를 안전하게 받아들이는지 확인한다.
- migration quarantine에 들어갈 데이터가 사용자 데이터 손실로 이어지지 않는지 확인한다.
- GraphQL schema 변경이 있으면 CDK 배포가 프론트 배포보다 먼저 완료되어야 한다.
- AppSync resolver fixture가 AWSJSON column/preset payload를 그대로 보존하는지 확인한다.

## Cleanup Policy

미사용 코드 제거는 static tool 결과만으로 결정하지 않는다. 다음 항목은 false positive가 잦다.

- Tauri/native 조건부 import
- `import()` 기반 lazy import
- AppSync resolver handler switch에서만 참조되는 handler
- TipTap extension command와 module augmentation
- infra Lambda entrypoint

삭제 기준은 `typecheck`, 관련 테스트, runtime import 경로 확인을 모두 만족하는 것이다.
