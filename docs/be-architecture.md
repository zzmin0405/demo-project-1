# AI-Meet 프로젝트 시스템 문서 (2024.12.02 업데이트)

> 이 문서는 현재 진행 중인 **AI-Meet** 프로젝트의 최신 아키텍처, 기술 스택, 시스템 상태 및 향후 계획을 기술합니다.

---

## 📊 시스템 개요

### 핵심 원칙
- **아키텍처**: Next.js (Client) ↔ WebSocket (Socket.IO) ↔ NestJS (Backend) ↔ PostgreSQL (Prisma)
- **실시간 통신**: **WebSocket 기반 미디어 스트리밍** (MediaRecorder → Server → MediaSource Extensions)
    - *참고: WebRTC P2P 방식이 아닌, 서버 릴레이 방식의 커스텀 스트리밍 구현*
- **UI**: Next.js 15 (App Router), React 19, shadcn/ui, Tailwind CSS
- **인증**: NextAuth.js (Google OAuth) + Prisma Adapter
- **개발 환경**: pnpm Workspace (Monorepo), Windows OS

---

## 🏗️ 아키텍처

### 1. 데이터 흐름

```mermaid
graph TD
    Client[Next.js Client] -->|HTTP/REST| API[NestJS API]
    Client -->|WebSocket (Signaling & Chat)| Gateway[Socket.IO Gateway]
    Client -->|WebSocket (Media Stream)| Gateway
    
    API -->|Query/Mutation| DB[(PostgreSQL)]
    Gateway -->|Save Chat/Log| DB
    Gateway -->|Relay Media| Client2[Other Clients]
    
    subgraph Backend
    API
    Gateway
    DB
    end
```

1.  **인증 (Auth)**:
    *   사용자는 **NextAuth.js**를 통해 Google 로그인을 수행합니다.
    *   로그인 성공 시 세션 쿠키가 생성되며, 클라이언트는 이를 통해 API 요청을 인증합니다.
    *   WebSocket 연결 시에도 인증된 세션 정보를 활용합니다.

2.  **회의 생성 (Meeting Creation)**:
    *   `POST /api/meeting`: 회의 방을 생성하고 DB에 `MeetingRoom` 레코드를 저장합니다.
    *   설정(채팅 저장 여부 등)을 함께 저장합니다.

3.  **실시간 통신 (Real-time)**:
    *   **Signaling**: Socket.IO를 통해 `join-room`, `leave-room`, `camera-state-changed` 등의 이벤트를 교환합니다.
    *   **Media Streaming**:
        *   **Sender**: `MediaRecorder` API를 사용하여 100ms~500ms 단위로 `WebM` 청크를 생성, `media-chunk` 이벤트로 서버에 전송합니다.
        *   **Server**: 받은 청크를 해당 방의 다른 참가자들에게 즉시 브로드캐스트(Relay)합니다.
        *   **Receiver**: `MediaSource Extensions (MSE)`를 사용하여 수신된 청크를 `SourceBuffer`에 추가하고 재생합니다.
    *   **Chat**: Socket.IO를 통해 메시지를 주고받으며, `isChatSaved` 설정에 따라 DB에 저장됩니다.

### 4. AI 미디어 처리 파이프라인 (STT & 번역) - *Planned*

```mermaid
graph LR
    Client[Client Mic] -->|Audio Stream (PCM)| Gateway[NestJS Gateway]
    Gateway -->|Buffering| STT[STT Service (Whisper)]
    STT -->|Text| Trans[Translation API (DeepL)]
    Trans -->|Subtitles| Gateway
    Gateway -->|Broadcast| Room[Meeting Room]
```

1.  **오디오 스트리밍**:
    *   클라이언트 `AudioWorklet`에서 PCM 오디오 데이터를 추출하여 별도 채널로 전송합니다.
2.  **STT (Speech-to-Text)**:
    *   **OpenAI Whisper** 또는 **Google Cloud STT** API를 사용하여 실시간으로 텍스트로 변환합니다.
    *   비용 최적화를 위해 VAD(목소리 감지) 적용 예정.
3.  **실시간 번역**:
    *   변환된 텍스트를 **DeepL** 또는 **Google Translate** API를 통해 타겟 언어로 번역합니다.
4.  **자막 전송**:
    *   생성된 자막(원문/번역문)을 `subtitle` 이벤트로 룸 내 모든 사용자에게 브로드캐스트합니다.

### 5. 네트워크 불안정 대응 전략 (Network Resilience)

TCP 기반 WebSocket 통신의 특성을 고려한 안정성 전략입니다.

1.  **지연 보정 (Latency Compensation)**:
    *   수신 측 버퍼가 일정 수준(3초) 이상 쌓이면 `playbackRate`를 높이거나 `currentTime`을 점프하여 실시간성을 유지합니다.
2.  **재연결 로직 (Reconnection)**:
    *   Socket.IO의 자동 재연결 기능을 활용하며, 재연결 시 `initializeMediaStream`을 재호출하여 미디어 전송을 복구합니다.

---

## 💻 백엔드 구조 (NestJS)

*   **`apps/api`**:
    *   **`EventsGateway`**: WebSocket 이벤트를 처리하는 핵심 모듈.
        *   `handleConnection`: 클라이언트 접속 처리.
        *   `handleJoinRoom`: 방 입장 처리.
        *   `handleMediaChunk`: **미디어 데이터 릴레이 (핵심)**.
        *   `handleChatMessage`: 채팅 메시지 중계 및 DB 저장.
    *   **`PrismaService`**: DB 접근을 위한 싱글톤 서비스.

---

## 🖥️ 프론트엔드 구조 (Next.js)

*   **`apps/web`**:
    *   **`app/page.tsx`**: 메인 랜딩 페이지. 회의 생성/참여 UI.
    *   **`app/meeting/[roomId]/meeting-client.tsx`**: 화상 회의 핵심 클라이언트.
        *   `MediaRecorder` (송신) 및 `MediaSource` (수신) 관리.
        *   Socket.IO 이벤트 핸들링.
    *   **`components/meeting/participant-card.tsx`**: 참가자 비디오/아바타 표시 컴포넌트.
    *   **`components/create-meeting-modal.tsx`**: 회의 생성 모달.

---

## 📝 현재 진행 상황 (Current Status)

### ✅ 구현 완료 (Completed)

1.  **기반 시스템**:
    *   Next.js + NestJS 모노레포 환경.
    *   PostgreSQL + Prisma ORM.
    *   NextAuth.js 구글 로그인.

2.  **화상 회의 핵심**:
    *   **WebSocket 기반 미디어 스트리밍** (WebRTC 아님).
    *   마이크/카메라 토글, 장치 선택.
    *   실시간 채팅.

3.  **회의 관리 및 UX**:
    *   회의 생성 및 설정 (채팅 저장 등).
    *   반응형 레이아웃 (Speaker/Grid 모드).
    *   다국어 지원 (I18n).

### 🚧 진행 중 / 예정 (In Progress / Planned)

**Phase 3: 완성도 향상 (Polish & Interactive)**
1.  **디스코드 스타일 미디어 토글**:
    *   즉각적인 UI 반응 (검은 화면 제거).
    *   키프레임 강제 전송을 통한 딜레이 최소화.
2.  **스마트 그리드 레이아웃**:
    *   참가자 수에 따른 빈 공간 최소화.
    *   Filmstrip 뷰 (발표자 모드 개선).
3.  **AI 기능 (STT & 번역)**:
    *   실시간 자막 및 번역 파이프라인 구축.

---

## ⚙️ 환경 변수 (Environment Variables)

### 백엔드 (`apps/api/.env`)
| 변수명 | 설명 |
|---|---|
| `DATABASE_URL` | PostgreSQL 데이터베이스 연결 문자열 |
| `PORT` | API 서버 포트 (기본: 3001) |

### 프론트엔드 (`apps/web/.env`)
| 변수명 | 설명 |
|---|---|
| `DATABASE_URL` | Prisma용 DB 연결 문자열 |
| `NEXTAUTH_SECRET` | NextAuth 세션 암호화 키 |
| `NEXTAUTH_URL` | 앱의 기본 URL |
| `GOOGLE_CLIENT_ID` | 구글 OAuth 클라이언트 ID |
| `GOOGLE_CLIENT_SECRET` | 구글 OAuth 클라이언트 시크릿 |
| `NEXT_PUBLIC_API_URL` | 백엔드 API 주소 |

---

## 🗄️ 데이터베이스 스키마 (Prisma)

```prisma
model User {
  id            String    @id @default(cuid())
  name          String?
  email         String?   @unique
  image         String?
  createdRooms  MeetingRoom[] @relation("CreatedRooms")
  // ... NextAuth fields
}

model MeetingRoom {
  id          String   @id @default(cuid())
  title       String
  creatorId   String
  creator     User     @relation("CreatedRooms", fields: [creatorId], references: [id])
  isChatSaved Boolean  @default(true)
  createdAt   DateTime @default(now())
  participants Participant[]
  chatLogs     ChatLog[]
}
```