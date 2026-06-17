# 설정 — 노션 가져오기 (Notion Import)

Notion export(HTML/Markdown + CSV + 첨부 에셋)를 QuickNote 페이지·DB로 변환해 가져오는 기능. 설정 모달의 "가져오기" 탭에서 zip 또는 폴더를 선택해 실행한다.

> **이 기능은 계속 개선 대상이다.** Notion export 포맷은 비표준·비일관적(인코딩 횟수 불일치, 폴더명 변형, 빈 파일 혼입 등)이라 회귀가 잦다. 수정 시 아래 "함정"을 먼저 확인할 것.

## 관련 파일

| 파일 | 역할 |
|------|------|
| `src/components/settings/NotionImportTab.tsx` | 일반 페이지 가져오기 UI·메인 흐름(스캔→에셋 업로드→HTML 변환→페이지 생성) |
| `src/components/settings/NotionCsvFolderSection.tsx` | CSV(데이터베이스) 가져오기 UI·다단계 진행률 |
| `src/lib/notionImport/folderScanner.ts` | 폴더/파일배열 스캔 → `NotionZipPreview`(pages + assets) |
| `src/lib/notionImport/zipParser.ts` | zip 파싱 → 동일 preview 구조 |
| `src/lib/notionImport/assetUpload.ts` | 에셋 경로 매칭 리졸버 + S3 업로드 + 문서 노드 변환 |
| `src/lib/notionImport/htmlToDoc.ts` | HTML → TipTap JSONContent 변환 |
| `src/lib/notionImport/htmlToDoc/pageMentions.ts` | 페이지 멘션·deferred 토큰(`__QN_PM__`) 헬퍼 |
| `src/lib/notionImport/resolveNotionPageHref.ts` | Notion HTML 내부 href → 스캔된 페이지 path 해석 |
| `src/lib/notionImport/hydrateChildPageMentions.ts` | 멘션 해소 실패로 제목만 남은 문단 → 구조적 자식 멘션 보강 |
| `src/lib/notionImport/linkUtils.ts` | 외부 URL 정규화·북마크 요약 (`normalizeImportedLinkHref`) |
| `src/lib/notionImport/csvFolderImporter.ts` | CSV-HTML 쌍 감지·DB 생성·행/셀 채우기 |
| `src/lib/notionImport/columnInference.ts` | CSV 컬럼 타입 추론(text/number/date/select/status/person 등) + `mapNotionPropertyType`(권위 타입 매핑) |
| `src/lib/notionImport/rowPropertyMeta.ts` | 행 페이지 `table.properties` → 컬럼 권위 타입·옵션 색 추출 |
| `src/lib/notionImport/personName.ts` | 사람 이름 정규화·토큰화·워크스페이스 구성원 매칭 |

## 컬럼 타입 추론 — 사람(person) 감지

`inferNotionColumnType`(`columnInference.ts`)이 헤더 키워드 + 값 패턴 + (HTML 경로면) `cellMeta`로 컬럼 타입을 정한다. person 으로 판정되면 다운스트림(`NotionCsvFolderSection`)에서 `splitPersonTokens` → `resolveImportedPersonMemberId`로 워크스페이스 구성원 memberId 배열로 저장돼 **구성원 멘션**으로 렌더된다.

person 감지 신호(강→약):
1. **강한 헤더 키워드**(`headerSuggestsPerson`): `담당`/`담당자`/`작성자`/`멘토`/`person`/`owner` → 즉시 person.
2. **대괄호 이름 패턴**(`looksLikeBracketedPersonValue`): 값이 `최진평 [CAT]` / `이다은[BK]` 처럼 `이름 [태그]` 꼴(쉼표 다중도 허용)이 60% 이상이면 **헤더 키워드와 무관하게** person. Notion 이 사람 속성을 텍스트로 내보낼 때 흔한 강한 신호.
3. **약한 헤더 키워드 + 토큰 비율**(`headerWeaklySuggestsPerson`): `이름`/`name`/`구성원`/`멤버`/`member`/`assignee` 헤더에서 값이 사람 토큰으로 80% 이상 분해되면 person.

> **주의 — 약한 키워드는 단독 판정 금지**: `이름` 같은 헤더는 일반 텍스트 컬럼일 수도 있으므로(예: 제품명) 값 패턴 확인 없이 person 으로 단정하지 않는다. 대괄호 태그만 있고 이름이 없는 값(`[긴급]` 등)은 person 패턴이 아니다. 회귀 테스트: `src/__tests__/notionImport/columnInference.test.ts`.

## 컬럼 타입·옵션 — 행 properties 테이블이 권위 소스 (핵심 함정)

메인 DB HTML 의 `collection-content` 뷰는 Notion 에서 **"보이는 속성"만** 내보낸다. 숨김 컬럼(체크박스·셀렉트 등)은 이 테이블에 아예 없으므로, collection-content 의 `cellMeta` 만 쓰면 숨은 컬럼의 타입을 휴리스틱으로 오판하고 옵션 색도 잃는다.

- 증상: 노션 DB 가져오기 후 일부 컬럼의 **타입이 틀리거나(예: checkbox→No/Yes select, select→status)** 셀렉트/멀티셀렉트 **옵션 색이 전부 회색**.
- 원인: 메인 뷰에 노출되지 않은 컬럼은 collection-content 에 없음.

→ 각 **행(레코드) 페이지 HTML** 에는 `<table class="properties">` 가 있고, 여기엔 **모든 속성**이 `tr.property-row-<notionType>` 클래스(원본 타입) + `select-value-color-*` 색 토큰과 함께 들어있다. 이를 권위 소스로 삼는다(`rowPropertyMeta.ts`).

흐름(`NotionCsvFolderSection`):
1. 컬럼 생성 전, 행 HTML 들을 한 번 스캔(phase `컬럼 분석`)해 `parseNotionRowProperties` 로 헤더별 **원본 타입 다수결** + **옵션 라벨→색** 을 모은다. (full DOM 파싱 OOM 회피 위해 properties 테이블 조각만 잘라 파싱.)
2. 컬럼 타입은 `mapNotionPropertyType(원본타입)` 결과가 있으면 **휴리스틱보다 우선** 적용. 매핑 불가(formula/rollup/relation/files)는 null → 휴리스틱 폴백.
3. 옵션 색은 collection-content 색 → **행 properties 색** → CSV 라벨(색 없음) 순으로 병합(색 있는 값이 색 없는 값을 덮어쓰되 기존 색은 보존).
4. checkbox 셀은 CSV 의 `"Yes"/"No"` 를 boolean 으로 변환 저장.

회귀 테스트: `src/__tests__/notionImport/rowPropertyMeta.test.ts`.

## 페이지 멘션 (link-to-page · 내부 href)

Notion export 본문의 **자식 페이지 연결**(`<figure class="link-to-page">`, 인라인 `<a href="…html">`)은 TipTap **페이지 멘션**(`mention`, `mentionKind: "page"`, `id: p:<pageId>`)으로 변환해야 한다. 제목 텍스트만 남기면 클릭 이동·아이콘 연동이 되지 않는다.

### 변환 흐름 (`NotionImportTab`)

1. **HTML 변환 시** — `notionHtmlToDoc(..., { resolvePageMentionByHref })` 가 href 마다 `resolveImportedPageMention` 호출.
2. **href 해석** — `resolveNotionPageHref`(`resolveNotionPageHref.ts`)가 스캔된 `pageByPath` 와 대조해 대상 path 를 찾고, `ensurePageIdForSource` 로 pageId 를 확보한다.
3. **임포트 종료 후 보강** — `hydrateStructuralChildPageMentions` 가 **폴더 구조상 직계 자식**인데 멘션 해소에 실패해 **제목 plain text 한 줄**만 남은 문단을 멘션으로 치환한다.

### href 해석 후보 (`resolveNotionPageHref`)

| 패턴 | 예 |
|------|-----|
| `./`·`../` 상대 경로 | `./Sub.html`, `../Sibling.html` |
| source 디렉터리 + 파일명 | `Parent dir/Child.html` (source 가 `Parent dir/Parent.html`) |
| **형제 폴더 패턴** | source `Parent abc.html` + href `Child def.html` → `Parent abc/Child def.html` |
| basename·path 정규화 일치 | hex32·확장자 제거 후 segment 비교 |
| hex32 id (파일명 **끝**) | href/path 에 id 만 남아도 **유일한** 페이지면 매칭 |

> **회귀 주의 — hex32 매칭**
> Notion export 파일명의 페이지 id 는 **끝**에 온다. href/path 에 hex 가 여러 개 있으면 **마지막** hex 를 페이지 id 로 쓴다. 첫 번째 hex(부모 폴더 id)만 보면 자식 href 가 부모 페이지로 잘못 매칭된다. 테스트: `src/__tests__/notionImport/resolveNotionPageHref.test.ts`.

### link-to-page 실패 폴백

`htmlToDoc.ts` 의 `linkToPageFallbackParagraph` — 멘션 해소 실패 시 **아이콘 `<img>` 를 본문 이미지로 추출하지 않고** 제목 텍스트만 보존한다(이미지+멘션 중복 회귀 방지). 이후 `hydrateStructuralChildPageMentions` 가 구조적 자식이면 멘션으로 승격한다.

### 토글 내부 deferred 멘션

토글(`<details>`) 본문은 `deferPageMentions: true` 로 변환 후 `relocateDeferredMentionsInToggleBlocks` 가 `__QN_PM__` 토큰을 블록 단위 멘션으로 재배치한다. 일반 본문·리스트 안 `link-to-page` 는 즉시 멘션으로 변환한다.

회귀 테스트: `src/__tests__/notionImport/htmlToDoc.test.ts`, `mentionImageDup.test.ts`, `resolveNotionPageHref.test.ts`.

## 외부 웹 링크 (임포트 후 클릭)

- **인라인 링크** — `htmlToDoc` `inlineFromNode` 가 `<a href>` 를 TipTap `link` 마크로 변환(`normalizeImportedLinkHref` 통과 시). `target: _blank`, `rel: noopener noreferrer nofollow`.
- **단독 URL 문단** — `maybeBookmarkBlockFromParagraph` → `bookmarkBlock` (NodeView 버튼 클릭으로 열림).
- **에디터에서 인라인 링크 클릭** — Link extension 은 `openOnClick: false` 이므로 **클릭 열기는 `App.tsx` capture 핸들러**가 담당([navigation/overview.md](../navigation/overview.md)). 임포트 직후 커서만 pointer 이고 클릭 무반응이면 App.tsx 쪽 회귀를 의심한다.

## 입력 경로 3가지 (스캐너 분기)

| 진입 | 스캐너 | 비고 |
|------|--------|------|
| zip 업로드 | `parseNotionZip` (`zipParser.ts`) | entry에서 실제 size 추출 |
| 네이티브/Tauri 폴더 선택 | `scanNotionFolder` (FileSystemDirectoryHandle) | **스캔 시점에 size를 모름 → getFile()로 채워야 함** |
| 웹 `<input webkitdirectory>` 파일배열 | `scanNotionFolderFiles` | `File.size` 즉시 사용 가능 |

세 경로 모두 `NotionZipPreview { pages, assets }`로 수렴한다. **세 경로가 동일한 필드(특히 `asset.size`)를 채우는지 항상 함께 점검할 것.** 한 경로만 누락하면 그 입력 방식에서만 깨지는 회귀가 된다.

## 에셋 매칭 — 인코딩 횟수 불일치 (핵심 함정)

Notion export는 **같은 폴더 안에서도 파일명/href의 URL 인코딩 횟수가 불일치**한다.
- 디스크 파일명이 `%EB%A8%B8%EC%A7%80…`처럼 **1회 인코딩이 리터럴로 박혀** 저장되기도 하고(특히 Google Drive 동기화 경유),
- HTML의 `<img src>`는 `%25EB%25A8%25B8…`(2회 인코딩)일 수 있다.

→ `assetUpload.ts`의 `safeDecode()`가 **변화가 없을 때까지 반복 디코드(최대 5회)** 해 양쪽 표준형을 수렴시킨다. 단발 `decodeURIComponent`로 바꾸면 매칭이 깨진다.

매칭 우선순위(`createNotionAssetResolver.resolve`):
1. 정규화 경로 직접(`byPath`) → 2. suffix 일치 → 3. **leaf(파일명, hex32 suffix·공백·확장자 제거 후 소문자) 매칭**. leaf 후보가 여럿이면 현재 페이지와의 공유 디렉터리 깊이(`sharedDirScore`)로 점수화.

`collection-content`(인라인 DB) 영역의 이미지(컬럼 헤더 아이콘 등)는 업로드에서 제외한다 — DB는 `databaseBlock`으로 치환되고 아이콘은 lucide 기본을 쓰므로 올리면 미사용 자산만 쌓인다.

## 인라인 DB 래퍼 페이지 (본문에 DB 를 품은 페이지)

CSV 가져오기(`NotionCsvFolderSection`)는 CSV+동명 폴더 쌍만 순회하므로, **본문에 인라인 DB 를 품은 상위 "래퍼 페이지"** (인라인 DB 위/아래에 텍스트가 있는 일반 페이지)는 과거에 생성되지 않고 DB 만 fullPage 페이지로 들어갔다.

수정(2026-06): `onImport` 시작에서 전체 트리를 스캔해 **DB folderPath 의 부모 디렉터리와 동명인 HTML**(`comparableImportedPath` 비교)을 래퍼 페이지로 탐지한다.
- 래퍼가 있는 DB → **fullPage 홈을 만들지 않고**(`markFullPageDatabaseHome` 스킵), 2차 패스에서 래퍼 본문 페이지를 만들어 같은 `dbId` 를 **inline `databaseBlock`** 으로 연결한다.
- 래퍼가 없는 순수 DB-only export(최상위 DB) → 기존처럼 fullPage DB 홈 유지.
- 중첩 DB(행 페이지 안의 인라인 DB)의 래퍼=행 페이지는 행/자식 임포트가 이미 인라인 연결하므로, 2차 패스는 `resolveImportedPageId` 로 이미 임포트된 경로를 건너뛴다.
- 래퍼 페이지의 `collection-content` 행 링크(`titleLinkPath`, `currentPagePath` 기준 해석 완료)를 `knownDbFolderPathList` 와 comparable 비교해 연결할 dbId 를 찾는다.

## 에셋 업로드 가드 (회귀 주의)

`uploadNotionAsset`은 본문을 읽기 전 2개 사전 차단 가드를 둔다:
- `asset.size > NOTION_ASSET_MAX_BYTES` → 거대 파일 읽기 자체 생략(메모리 보호)
- `asset.size === 0` → "빈 파일"로 차단

**두 가드 모두 `asset.size`가 정확하다는 전제에 의존한다.** 스캐너가 size를 0으로 두면 0바이트 가드에 걸려 **읽기 전에 전량 누락**된다(업로드·진행률·이미지 링크 모두 발생 안 함). 본문 읽은 뒤 `file.size === 0` 재검사 가드가 따로 있으므로, 사전 가드는 어디까지나 "정확한 size가 있을 때의 최적화"임을 기억할 것.

## 진행률 (S3 업로드 프로그래스바)

- 일반 페이지: `NotionImportTab`의 `ImportProgress`(label/done/total/current). 페이지 단위로 갱신되며, 한 페이지 안의 다수 에셋 업로드는 별도 세분 표시가 없다(`fetch` PUT은 진행 이벤트 미제공).
- CSV/DB: `NotionCsvFolderSection`이 DB·행·에셋 3단 진행률을 표시.

**증상 진단 팁**: "업로드 프로그래스바가 안 뜨고 이미지도 안 붙음" = 에셋이 업로드 큐에 아예 안 들어간 신호. 매칭 실패 또는 사전 가드 차단(특히 size=0)을 의심하라. 매칭 자체는 leaf 디코드 비교로 빠르게 검증 가능(HTML img src ↔ 디스크 파일명 디코드 후 leaf 대조).

## 알려진 회귀 이력

- **폴더 선택 시 전체 이미지 누락**: `scanNotionFolder`가 `size: 0` 하드코딩 → 0바이트 가드에 전량 차단. `getFile().size`로 실제 크기를 채워 해결(`.size`는 메타데이터라 본문 미로딩). 0바이트 가드는 원래 CSV용으로 추가됐다가 폴더 경로에 회귀를 유발한 사례.
- 자산 URL 인코딩 횟수 불일치로 이미지/동영상 첨부 깨짐 → `safeDecode` 반복 디코드로 해결.
- 0바이트/빈 페이지 처리, 리스트·콜아웃·토글 내부 이미지 중복 생성 등 — `git log -- src/lib/notionImport` 참고.
- **자식 페이지가 제목 텍스트만 남음** — href 가 `Parent.html` + `Parent/Child.html` 형제 폴더 패턴·상대 경로를 커버하지 못하면 `linkToPageFallbackParagraph` 폴백만 적용됨 → `resolveNotionPageHref`·`hydrateStructuralChildPageMentions` 경로 점검.
- **임포트 본문 웹 링크 클릭 무반응** — link 마크는 정상이어도 `openOnClick: false` + App.tsx 외부 링크 핸들러 누락 시 발생. 북마크 블록은 `bookmarkBlock.tsx` 자체 `onClick` 으로 별도 동작.

## 앞으로의 개선 방향 (TODO)

- 페이지 내 에셋 단위 진행률 표시(현재는 페이지 단위라 에셋 많은 페이지에서 멈춘 듯 보임).
- 매칭 실패 에셋의 사용자 가시 리포트(어떤 파일이 왜 누락됐는지).
- 비-이미지 `fileBlock`의 표시 이름이 인코딩된 원본명(`%EB…`)으로 남는 경우 디코드 적용.
- 스캐너 3경로의 preview 필드 채움을 공통화해 경로별 누락 회귀 방지.
