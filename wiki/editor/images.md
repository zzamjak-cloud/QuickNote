# lib/images

## 역할
이미지 업로드(presigned S3), 압축(WebP 재인코딩), URL 캐싱, React 훅 제공을 담당하는 이미지 서브시스템.

## 위치
`src/lib/images/`

## 파일 목록

| 파일 | 역할 |
|------|------|
| `upload.ts` | presigned URL 발급 → S3 PUT → confirmImage 3단계 업로드 |
| `compressImage.ts` | Canvas API로 래스터 이미지를 WebP Blob으로 압축·리사이즈 |
| `registry.ts` | imageId → PreSignedURL 인메모리+localStorage TTL 캐시 (앱 전역 싱글턴) |
| `hooks.ts` | `useImageUrl` — `quicknote-image://` 가상 스킴을 표시 가능한 URL로 해석하는 React 훅 |
| `resizeAvatar.ts` | 아바타 전용 리사이즈 유틸 |
| `__tests__/` | 단위 테스트 |

---

## upload.ts

### 주요 exports
| 이름 | 설명 |
|------|------|
| `uploadImage(file, opts?)` | 이미지 파일을 업로드하고 `quicknote-image://{imageId}` ref 반환 |

### 동작 흐름
1. MIME 타입 검증 (`image/png`, `image/jpeg`, `image/webp` 허용), 20MB 상한 검사
2. `crypto.subtle.digest('SHA-256')` — 파일 해시 계산
3. `GET_IMAGE_UPLOAD_URL` GraphQL mutation → `{ imageId, uploadUrl, alreadyUploaded }` 획득
4. `alreadyUploaded === false` 이면 S3 presigned URL로 `fetch PUT`
5. `CONFIRM_IMAGE` GraphQL mutation 호출
6. `encodeImageRef(imageId)` → `quicknote-image://{imageId}` 반환

### 주의사항
- 동일 파일은 SHA-256 해시로 서버에서 중복 감지 (`alreadyUploaded: true`) → S3 PUT 생략
- GIF는 `ALLOWED_MIME`에 없으므로 업로드 불가 (MP4 변환 후 파일 첨부 경로 사용)

---

## compressImage.ts

### 주요 exports
| 이름 | 설명 |
|------|------|
| `compressImage(file, opts?)` | 래스터 → WebP Blob (maxWidth 1920, maxHeight 3840, quality 0.82) |
| `prepareImageFileForUpload(file)` | 업로드 전 처리: GIF 차단, 나머지는 WebP 압축 후 File 반환 |
| `prepareCoverImageForUpload(file)` | 커버 배너 전용: 4:1 비율 중앙 크롭 + 최대 1280px WebP |
| `prepareIconImageForUpload(file)` | 커스텀 아이콘 전용: 128×128 WebP (비율 유지, 빈 영역 투명) |
| `compressCoverImage(file)` | 커버 배너 압축 Blob 반환 |
| `coverBannerCropSource(w, h, aspect)` | 배너 비율 기준 중앙 크롭 영역 계산 (테스트용 순수 함수) |

### 주요 상수
| 이름 | 값 | 설명 |
|------|----|------|
| `COVER_BANNER_ASPECT_W_PER_H` | 4 | 커버 배너 가로:세로 비율 |
| `COVER_MAX_OUTPUT_WIDTH_PX` | 1280 | 커버 최대 출력 폭 |
| `COVER_WEBP_QUALITY` | 0.82 | 커버 WebP 품질 |
| `ICON_OUTPUT_SIZE_PX` | 128 | 아이콘 출력 크기 |
| `ICON_WEBP_QUALITY` | 0.84 | 아이콘 WebP 품질 |

### 주의사항
- Canvas 메모리 누수 방지: `canvas.toBlob` 완료 후 `.finally`에서 `canvas.width = 0` 리셋
- 아이콘 압축 실패 시 `createImageBitmap` 폴백, 둘 다 실패하면 원본 그대로 업로드
- GIF는 모든 prepare 함수에서 즉시 에러 throw

---

## registry.ts

### 주요 exports
| 이름 | 설명 |
|------|------|
| `imageUrlCache` | `ImageUrlCache` 싱글턴 — `imageId → PreSignedURL` TTL 캐시 |

### 캐시 계층
| 계층 | TTL | 설명 |
|------|-----|------|
| 인메모리 (`ImageUrlCache`) | 50분 | 앱 세션 내 재사용 |
| localStorage | 45분 | 페이지 새로고침 후 재사용 |

### 동작 흐름
1. `imageUrlCache.get(imageId)` 호출
2. 인메모리 캐시 적중 → 즉시 반환
3. localStorage에 유효한 URL 있으면 반환
4. 미스 → `GET_IMAGE_DOWNLOAD_URL` GraphQL query → 인증 오류 시 토큰 갱신 후 1회 재시도
5. 응답 URL을 localStorage에 저장 후 반환

### 주의사항
- `STALE_DOWNLOAD_URL_PARAMS` — `x-amz-checksum-` 파라미터가 포함된 구식 캐시 URL은 자동 무효화
- `EXPIRE_SKEW_MS` (30초) 여유를 두고 만료 처리 — 경계 케이스에서 만료 URL 제공 방지

---

## hooks.ts

### 주요 exports
| 이름 | 설명 |
|------|------|
| `useImageUrl(srcOrRef)` | `quicknote-image://` ref 또는 일반 URL → 표시 가능한 URL 반환 |
| `UseImageUrlResult` | `{ url: string \| null; error: string \| null }` |

### 동작 흐름 (useImageUrl)
1. `decodeImageRef(src)` 또는 `decodeFileRef(src)` — 가상 스킴 파싱
2. id 없으면 (일반 URL/data:) → 그대로 `url` 반환
3. `peekMediaObjectUrl(id)` — 인메모리 object URL 동기 적중 시 즉시 표시 (로딩 플래시 없음)
4. `getMediaObjectUrl(id)` — IndexedDB blob 캐시 조회
5. 캐시 미스 → `imageUrlCache.get(id)` → PreSignedURL 획득
6. `fetchMediaBlob(downloadUrl)` — CORS 허용 시 blob 다운로드
7. blob 성공 → `rememberMediaObjectUrl` + `writeMediaBlob` (인메모리 + IndexedDB 저장)
8. blob 실패(CORS 차단) → PreSignedURL 직접 `<img src>` 사용

### 주의사항
- `initialImageUrl`로 초기 state를 동기 설정 — 재진입 시 로딩 플래시 제거
- `canceled` 플래그로 언마운트 후 비동기 콜백 실행 방지
- CORS 비활성 환경에서는 blob 캐싱 불가 → `<img>` 자체 CORS 면제로 표시는 가능하나 오프라인 캐시 미사용
