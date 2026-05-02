# 개발 목표

개인 노션앱을 개발한다. 향후 많은 기능들을 확장해나갈 수 있도록 구조를 설계한다.

github "[https://github.com/zzamjak-cloud](https://github.com/zzamjak-cloud)" 에 "JPnote" 레포를 신규 생성한 후, 프로젝트 공간으로 구성한다.

참고할만한 기존 프로젝트 링크

*   QuickFolder(네이티브 탐색기) : /Users/woody/Library/CloudStorage/[GoogleDrive-zzamjak@gmail.com](mailto:GoogleDrive-zzamjak@gmail.com)/내 드라이브/Jinpyoung/JPNote
    
*   TeamScheduler(웹 스케줄러) : /Users/woody/Desktop/AI/claude-code-study/TeamScheduler
    

## 1\. 프로젝트 아키텍처 개요

본격적인 개발에 앞서 데이터가 어떻게 흐를지 이해하는 것이 중요합니다.

*   **Frontend:** React + Vite (UI/UX 및 상태 관리)
    
*   **Desktop Layer:** Tauri (Rust 기반 로컬 파일 시스템 접근 및 시스템 리소스 제어)
    
*   **Backend:** AWS Lambda (Serverless) 또는 AppRunner
    
*   **Database:** DynamoDB (NoSQL, 블록 구조에 최적화) + S3 (이미지/파일 저장)
    

## 2\. 주요 구현 기능 및 개발 순서

개발은 **\[핵심 엔진 -> 로컬 앱화 -> 클라우드 확장\]** 순으로 진행.

### 1단계: 핵심 에디터 엔진 구현 (Web)

가장 어려운 "노션다운" 에디터를 먼저 만듭니다. 처음부터 직접 바닥부터 만들기보다는 프레임워크를 활용해 커스터마이징하는 것을 추천합니다.

*   **Block-based Editor:** 모든 콘텐츠를 '블록' 단위로 취급합니다. (텍스트, 이미지, 할 일 목록 등)
    
    *   _추천 라이브러리:_ `TipTap`, `Slate.js` 또는 `Editor.js`
        
*   **Slash Command:** `/`를 입력했을 때 블록 유형을 선택하는 메뉴 팝업.
    
*   **Drag & Drop:** 블록의 순서를 바꾸는 기능 (`dnd-kit` 활용).
    

### 2단계: Tauri를 이용한 데스크톱 이식

웹 엔진이 어느 정도 완성되면 Tauri를 입혀 네이티브 환경을 구축합니다.

*   **Tauri 설정:** Rust를 이용해 시스템 트레이, 단축키, 창 제어 기능을 구현합니다.
    
*   **로컬 캐싱:** SQLite나 단순 JSON 파일을 Rust 단에서 관리하여 오프라인에서도 메모를 볼 수 있게 합니다.
    

### 3단계: AWS 백엔드 및 데이터 동기화

이제 로컬 데이터를 클라우드와 연결할 차례입니다.

*   **Data Modeling:** Notion은 계층 구조가 중요합니다. DynamoDB를 사용하여 `page_id`와 `block_id`를 설계합니다.
    
*   **Auth:** AWS Cognito를 이용한 사용자 인증.
    
*   **API:** API Gateway + Lambda를 통한 CRUD API 구축.
    

### 4단계: 고급 기능 확장 (실시간 & 최적화)

*   **실시간 동기화:** WebSocket(AWS AppSync 추천)을 활용해 여러 기기에서 동시 수정 시 실시간 반영.
    
*   **이미지 업로드:** S3 Pre-signed URL을 이용한 보안 업로드.
    
*   **검색 엔진:** 클라우드 내 검색을 위한 전용 인덱싱.
    

* * *

## 3\. 추천 개발 로드맵 (우선순위)

**순서단계주요 작업 내용1MVP 에디터**React와 TipTap을 이용해 텍스트 블록 생성/삭제 기능 구현**2데이터 스키마**JSON 형태로 블록 데이터를 정의하고 LocalStorage에 저장 테스트**3Tauri 연동**Vite 프로젝트를 Tauri로 빌드하여 `.exe` 또는 `.app` 실행 파일 생성**4AWS 기초**Lambda와 DynamoDB를 연결해 로그인 및 데이터 저장 기능 구현**5동기화 로직**로컬 수정 사항을 AWS에 비동기로 업데이트하는 로직 구축

* * *

## 4\. 개발 팁

1.  **데이터 구조가 핵심입니다:** 노션은 모든 것이 블록입니다. `parent_id`를 활용한 트리 구조 설계에 가장 많은 시간을 투자하세요.
    
2.  **Rust 활용:** 처음에는 Rust 비중이 작겠지만, 파일 암호화나 대용량 텍스트 처리 등 성능이 필요한 부분은 점진적으로 Tauri의 `command` 기능을 통해 Rust로 넘기세요.
    
3.  **오프라인 퍼스트:** 로컬 앱인 만큼, 네트워크가 끊겨도 사용 가능하고 나중에 서버와 병합(Reconciliation)하는 전략을 고민해보시면 실력이 비약적으로 상승할 것입니다.
    

# 인증 시스템

구글 인증과 특정 이메일 화이트리스트(Whitelist) 기능은 보안의 핵심이겠네요. AWS 환경을 사용하시기로 했으니, **AWS Cognito**와 **Google OAuth 2.0**을 연동하는 것이 가장 정석적이고 관리하기 편한 방법입니다.

구체적인 구현 전략과 인증 흐름을 정리해 드릴게요.

* * *

## 1\. 인증 아키텍처 (Google + Cognito)

사용자가 구글 로그인을 시도하면, AWS Cognito가 중간에서 토큰을 검증하고 화이트리스트 여부를 판단하는 구조입니다.

### 구현 단계

1.  **Google Cloud Console 설정:**
    
    *   OAuth 2.0 클라이언트 ID를 생성합니다.
        
    *   승인된 리디렉션 URI에 Cognito 도메인을 등록합니다.
        
2.  **AWS Cognito 설정:**
    
    *   **User Pool**을 생성하고 Google을 Identity Provider(IdP)로 설정합니다.
        
    *   Google에서 받은 `Client ID`와 `Client Secret`을 입력합니다.
        
3.  **Frontend (React) 연동:**
    
    *   `aws-amplify` 라이브러리나 `Tauri` 전용 OAuth 라이브러리를 사용하여 로그인 버튼을 구현합니다.
        

* * *

## 2\. 특정 이메일 화이트리스트 구현 전략

"개발자가 등록한 이메일만 허용"하는 기능은 크게 두 가지 방식으로 구현할 수 있습니다.

### 방법 A: Cognito Post-Confirmation Lambda Trigger (추천)

가장 깔끔한 서버리스 방식입니다. 사용자가 구글 로그인을 마친 직후, Cognito가 특정 Lambda 함수를 실행합니다.

*   **동작 원리:** 1. 사용자가 로그인 시도. 2. Lambda 함수가 실행되어 해당 사용자의 이메일이 **DynamoDB의 '허용 목록' 테이블**에 있는지 확인. 3. 목록에 없다면 로그인을 거부(Error 발생)하고, 있다면 승인.
    
*   **장점:** 백엔드 API 단계까지 가기 전에 인증 단에서 차단하므로 보안성이 높습니다.
    

### 방법 B: Pre-Sign-up Trigger

사용자가 아예 가입조차 못 하게 막는 방식입니다.

*   구글 로그인을 통해 들어온 이메일 정보를 확인하여, 미리 정의된 리스트에 없으면 가입 프로세스를 중단시킵니다.
    

* * *

## 3\. Tauri에서의 인증 처리 주의사항

웹과 달리 데스크톱 앱(Tauri)에서는 리디렉션 처리가 조금 까다롭습니다.

*   **Deep Link 활용:** 구글 로그인 완료 후 브라우저에서 앱으로 다시 돌아오려면 `my-app://callback` 같은 커스텀 프로토콜(Deep Link)을 Tauri 설정(`tauri.conf.json`)에서 정의해야 합니다.
    
*   **Local Server 방식:** 또는 Tauri 앱 내부에 일시적으로 아주 작은 HTTP 서버를 띄워 인증 코드를 받는 방식도 많이 쓰입니다.
    

* * *

## 4\. 업데이트된 개발 순서 (보안 강화 버전)

1.  **Google Cloud & AWS Cognito 연동:** 기본적인 소셜 로그인 환경 구축.
    
2.  **Whitelist Lambda 작성:** 특정 이메일만 허용하는 로직 추가.
    
3.  **Tauri Deep Link 설정:** 웹 브라우저 로그인 후 데스크톱 앱으로 토큰을 전달받는 흐름 완성.
    
4.  **API 권한 제어:** API Gateway에서 Cognito Authorizer를 설정하여, 인증된 사용자만 블록 데이터를 읽고 쓸 수 있게 보호.
    

# 자동 업데이트 계획

github actions를 통한 릴리즈 빌드 생성, 기존 설치 사용자들의 로컬 네이티브 앱 자동 업데이트 시스템 구축