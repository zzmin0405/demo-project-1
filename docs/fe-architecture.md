# 프론트엔드 아키텍처

## 실시간 미디어 스트리밍 아키텍처 (웹소켓 기반)

### 1. 개요

본 시스템의 실시간 미디어(음성/영상) 스트리밍은 기존의 P2P WebRTC 방식에서 서버를 경유하는 웹소켓(WebSocket) 기반의 릴레이(Relay) 방식으로 변경되었습니다. 이 아키텍처는 사용자의 네트워크 환경(NAT/방화벽) 제약으로 인해 P2P 연결이 실패하는 경우를 우회하고, 보다 확실한 연결성을 보장하기 위해 채택되었습니다.

다만, 모든 미디어 데이터가 중앙 서버를 경유하므로 서버 부하 및 네트워크 비용이 증가하며, P2P 방식에 비해 지연 시간(Latency)이 길어지는 단점이 있습니다.

### 2. 주요 기술 스택

- **Socket.IO:** 클라이언트와 서버 간의 실시간, 양방향 통신을 위한 웹소켓 라이브러리. 미디어 데이터 조각(Chunk) 및 각종 이벤트(입장, 퇴장 등)를 전달하는 데 사용됩니다.
- **MediaRecorder API:** 사용자의 로컬 카메라와 마이크로부터 얻은 `MediaStream`을 일정한 시간 간격(timeslice)으로 잘라, 전송 가능한 `Blob` 형태의 데이터 조각으로 만드는 데 사용됩니다.
- **MediaSource Extensions (MSE) API:** 다른 사용자로부터 수신한 미디어 데이터 조각들을 브라우저의 `<video>` 엘리먼트에서 재생할 수 있도록 버퍼에 추가하고 디코딩하는 역할을 합니다.

### 3. 동작 흐름

#### 3.1. 송신 클라이언트

1.  `navigator.mediaDevices.getUserMedia()`를 통해 사용자의 카메라/마이크 접근 권한을 얻고, 로컬 `MediaStream`을 생성합니다.
2.  생성된 `MediaStream`을 `MediaRecorder` 인스턴스에 전달합니다.
3.  `mediaRecorder.start(timeslice)`를 호출하여 녹화를 시작합니다. (현재 `timeslice`는 1500ms로 설정되어, 1.5초 분량의 데이터가 모일 때마다 `dataavailable` 이벤트가 발생합니다.)
4.  `ondataavailable` 이벤트 핸들러는 녹화된 데이터 조각(`Blob`)을 받아, `media-chunk`라는 이름의 웹소켓 이벤트를 통해 서버로 전송합니다.

#### 3.2. 중계 서버 (NestJS)

1.  클라이언트로부터 `media-chunk` 이벤트를 수신합니다.
2.  이벤트를 보낸 클라이언트가 속한 방(Room)을 찾습니다.
3.  해당 클라이언트를 제외한, 같은 방에 있는 다른 모든 클라이언트에게 원본 데이터 조각을 그대로 브로드캐스트(Broadcast)합니다.

#### 3.3. 수신 클라이언트

1.  서버로부터 `media-chunk` 이벤트를 수신합니다.
2.  데이터를 보낸 사용자에 해당하는 `<video>` 엘리먼트에 `MediaSource` 객체를 연결합니다.
3.  `MediaSource`가 준비되면(`sourceopen` 이벤트), `addSourceBuffer()`를 통해 미디어 데이터를 받을 `SourceBuffer`를 생성합니다.
4.  서버로부터 받은 데이터 조각을 `sourceBuffer.appendBuffer()`를 사용하여 버퍼에 순차적으로 추가합니다.
5.  브라우저는 버퍼에 쌓인 데이터를 디코딩하여 `<video>` 엘리먼트를 통해 재생합니다.
6.  버퍼가 처리 중일 때 도착하는 데이터는 임시 큐(Queue)에 저장했다가, 버퍼가 준비되면 순차적으로 추가하여 데이터 손실을 방지합니다.

### 4. 장단점

-   **장점:**
    -   복잡한 NAT/방화벽 환경에서도 안정적인 연결을 보장합니다. (STUN/TURN 서버 불필요)
    -   P2P 연결 설정에 비해 초기 연결 로직이 비교적 단순합니다.

-   **단점:**
    -   모든 트래픽이 서버를 경유하므로, 사용자 수에 비례하여 서버 부하와 네트워크 비용이 크게 증가합니다.
    -   P2P 방식에 비해 데이터 전송 경로가 길어져 지연 시간(Latency)이 현저히 높아집니다.
    -   클라이언트 측에서 `MediaSource Extensions` API를 이용한 버퍼 관리가 복잡하며, 불안정한 네트워크 환경에서 끊김 현상(Choppy playback)이 발생하기 쉽습니다.

---

## 5. 배포 및 주요 문제 해결

### 5.1. 환경 분리: 로컬 vs Vercel

개발 및 배포 과정에서 **로컬 환경**과 **Vercel 배포 환경**은 완전히 분리되어 있음을 인지하는 것이 중요합니다.

-   **로컬 환경:** 내 컴퓨터에서 프론트엔드(`localhost:3000`)와 백엔드(`localhost:3001`)를 모두 실행하는 환경.
-   **Vercel 환경:** Vercel의 서버에서 프론트엔드와 백엔드가 각각 별도의 공개 주소로 실행되는 환경. Vercel에 배포된 앱은 내 컴퓨터의 로컬 서버와 절대 통신할 수 없습니다.

### 5.2. 외부 테스트 (ngrok)

다른 네트워크의 사용자와 테스트하기 위해 `ngrok`을 사용하여 로컬 서버를 외부에 노출시켰습니다.

-   **실행:** 프론트엔드(3000번 포트)와 백엔드(3001번 포트)를 위해 **두 개의 별도 터미널**에서 각각 `ngrok http 3000`과 `ngrok http 3001`을 실행해야 합니다.
-   **설정:**
    -   `ai-meet/apps/web/.env.local`의 `NEXT_PUBLIC_WEBSOCKET_URL`에는 **백엔드용 ngrok 주소**를 설정합니다.
    -   Supabase 대시보드의 `Site URL`에는 **프론트엔드용 ngrok 주소**를 설정합니다.
-   **문제 해결:**
    -   `endpoint ... is already online` 오류 발생 시: `taskkill /F /IM ngrok.exe` 명령어로 모든 ngrok 프로세스를 강제 종료한 후 다시 시도합니다. 이는 `ngrok.yml` 설정 파일에 특정 도메인이 고정값으로 저장되어 있을 때 주로 발생합니다.

### 5.3. Vercel 배포

Vercel에 배포 시, 모노레포의 `web`과 `api` 앱은 각각 별도의 주소로 배포됩니다.

-   **주요 설정:**
    1.  **Vercel 환경 변수 (`Settings` > `Environment Variables`):**
        -   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` 설정은 필수입니다.
        -   `NEXT_PUBLIC_WEBSOCKET_URL`에는 `localhost`나 `ngrok` 주소가 아닌, **Vercel이 `api` 앱에 할당한 실제 배포 주소**를 입력해야 합니다. 이 주소는 Vercel 대시보드의 `Deployments` 탭 > 해당 배포 선택 > `Source` 섹션의 `api` 항목에서 찾을 수 있습니다.
    2.  **Supabase `Site URL` (`Authentication` > `URL Configuration`):**
        -   Vercel이 `web` 앱에 할당한 **실제 프론트엔드 배포 주소**를 입력해야 합니다.
    3.  **Vercel 배포 접근 제한:**
        -   외부인이 Vercel 배포 주소에 접속할 때 Vercel 로그인 창이 뜨는 문제.
        -   Vercel 프로젝트의 `Settings` > `Security` 또는 `Git` 메뉴에서 'Deployment Protection' 또는 'Require access for preview deployments' 옵션을 비활성화하여 해결합니다. (무료 플랜의 경우 GitHub 저장소의 'Visibility'를 'Public'으로 변경해야 할 수 있습니다.)

### 5.4. 주요 해결 문제 요약

-   **Google OAuth 로그인 실패:**
    -   `requested path is invalid`: Vercel 환경 변수 누락 또는 Supabase `Site URL` 설정 오류로 발생. 각 배포 환경에 맞는 올바른 URL을 설정하여 해결했습니다.
    -   `localhost` 리디렉션 루프: `/auth/callback/route.ts`의 리디렉션 로직을 `new URL('/', request.url)`로 수정하고, 클라이언트의 `signInWithOAuth`에서 `redirectTo` 옵션을 제거하여 해결했습니다.
    -   `429 Too Many Requests`: 짧은 시간 동안의 반복적인 로그인 실패로 인한 Supabase의 일시적인 IP 차단. 일정 시간 대기 후 해결되었습니다.
-   **웹소켓 연결 실패 (`ERR_CONNECTION_REFUSED`):**
    -   백엔드 서버가 IPv6(`[::1]`)에만 바인딩되는 문제: NestJS의 `main.ts` 파일에서 `app.listen(port, '0.0.0.0')`으로 수정하여 해결했습니다.
    -   환경 변수 미적용: `.env.local` 파일 수정 후, **개발 서버를 반드시 재시작**해야 함을 확인했습니다.
    -   로컬/Vercel 환경 혼동: 각 환경에 맞는 `NEXT_PUBLIC_WEBSOCKET_URL`을 설정해야 함을 명확히 했습니다.
-   **미디어 스트림 끊김:**
    -   웹소켓 방식의 부하 및 지연 시간 문제로 발생.
    -   `MediaRecorder`의 `timeslice` 값을 `500ms`에서 `1500ms`로 늘려 서버 및 네트워크 부하를 줄여 안정성을 일부 개선했습니다.

---

## 6. 최근 주요 변경 사항 (2025.11)

### 6.1. 인증 및 데이터베이스 마이그레이션
- **Supabase 제거:** 기존 Supabase 인증 및 데이터베이스 의존성을 완전히 제거했습니다.
- **NextAuth.js 도입:** Google OAuth 로그인을 위해 NextAuth.js를 도입하고, 세션 기반 인증으로 전환했습니다.
- **Prisma + PostgreSQL:** ORM으로 Prisma를 채택하고, 로컬 PostgreSQL 데이터베이스와 연동했습니다.
    - **스키마 확장:** `User` 모델 외에 `MeetingRoom`, `Participant`, `ChatLog`, `MeetingSummary` 모델을 추가하여 졸업작품 요구사항을 충족했습니다.

### 6.2. UI/UX 리디자인 (Zoom 스타일)
- **레이아웃 개편:** 기존의 단순한 비디오 그리드에서 벗어나, Zoom과 유사한 전문적인 화상 회의 UI로 전면 개편했습니다.
    - **스피커 뷰:** 현재 발화자(또는 핀 고정된 사용자)를 크게 보여주고, 나머지 참여자는 하단 필름스트립으로 표시합니다.
    - **그리드 뷰:** 모든 참여자를 균등한 격자 형태로 보여주는 반응형 레이아웃을 구현했습니다.
- **컨트롤 바:** 하단에 플로팅 형태의 컨트롤 바를 배치하여 마이크, 카메라, 화면 공유, 설정, 참여자 목록, 채팅, 종료 버튼을 직관적으로 제공합니다.
- **참여자 카드:** 각 참여자 비디오 위에 이름표, 음소거 상태 아이콘, 호버 시 핀 고정/강퇴 등의 제어 버튼이 나타나는 오버레이를 추가했습니다.

### 6.3. 기능 고도화
- **오디오 제어 시스템:**
    - **로컬 볼륨 제어:** `AudioContext`와 `GainNode`를 활용하여 내 마이크의 입력 볼륨을 소프트웨어적으로 조절하는 기능을 구현했습니다.
    - **원격 볼륨 제어:** 수신되는 오디오의 볼륨을 조절하는 기능을 추가했습니다.
- **채팅 기능:**
    - **실시간 채팅:** Socket.IO를 이용한 실시간 채팅을 구현했습니다.
    - **채팅 패널:** 우측에서 슬라이드되어 나오는 채팅 패널을 통해 회의 중 메시지를 주고받을 수 있습니다.
    - **메시지 영속성:** 모든 채팅 내역은 PostgreSQL(`ChatLog`)에 저장되어 나중에 다시 볼 수 있습니다.
- **상태 동기화:**
    - 마이크/카메라 On/Off 상태가 모든 참여자에게 실시간으로 동기화됩니다.
    - 중간에 입장한 사용자도 현재 방의 상태(참여자 목록, 각자의 미디어 상태)를 정확히 동기화받습니다.

### 6.4. 백엔드 구조 개선
- **NestJS Gateway:** `EventsGateway`를 리팩토링하여 인증 가드(`SupabaseAuthGuard` -> NextAuth 호환 로직)를 적용하고, PrismaService를 주입받아 DB 작업을 처리하도록 개선했습니다.
- **단일 회의 참여 제한:** 한 사용자가 동시에 여러 회의에 참여하지 못하도록 서버 측에서 검증 로직을 추가했습니다.
