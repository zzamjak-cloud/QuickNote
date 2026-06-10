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
| `src/lib/notionImport/csvFolderImporter.ts` | CSV-HTML 쌍 감지·DB 생성·행/셀 채우기 |

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

## 앞으로의 개선 방향 (TODO)

- 페이지 내 에셋 단위 진행률 표시(현재는 페이지 단위라 에셋 많은 페이지에서 멈춘 듯 보임).
- 매칭 실패 에셋의 사용자 가시 리포트(어떤 파일이 왜 누락됐는지).
- 비-이미지 `fileBlock`의 표시 이름이 인코딩된 원본명(`%EB…`)으로 남는 경우 디코드 적용.
- 스캐너 3경로의 preview 필드 채움을 공통화해 경로별 누락 회귀 방지.
