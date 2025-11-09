@ -1,230 +1,320 @@
# 구조

---
**개선사항 및 보완점 (풀스택 개발자 관점)**

현재 프로젝트는 `pnpm` 워크스페이스를 활용한 모노레포 구조로 `api` (NestJS)와 `web` (Next.js) 애플리케이션이 잘 분리되어 있습니다. 이는 확장성과 관리 용이성 측면에서 좋은 시작점입니다. 다음은 프로젝트의 견고함과 개발 효율성을 더욱 높이기 위한 개선 및 보완 사항입니다.

### 1. 모노레포 공통 패키지 활용 극대화

현재 `api`와 `web` 간에 공유될 수 있는 코드(예: 타입 정의, 유틸리티 함수, UI 컴포넌트)가 개별 앱 내에 중복되거나 비효율적으로 관리될 가능성이 있습니다.

*   **`packages/shared-types` 또는 `packages/common` 생성:**
    *   `api`와 `web` 애플리케이션 간에 공유되는 TypeScript 타입 정의 (인터페이스, DTOs), Enum, 상수 등을 이 패키지에 모아 관리합니다.
    *   이를 통해 타입 불일치로 인한 런타임 오류를 방지하고, 코드의 일관성을 유지할 수 있습니다. 특히 API 요청/응답 스키마나 WebSocket 이벤트 페이로드 등에 유용합니다.
*   **`packages/config` (선택 사항):**
    *   공통 `tsconfig.json`, `eslint.config.mjs`, `prettierrc` 등을 정의하여 모든 워크스페이스 패키지에 일관된 개발 환경을 제공합니다.

### 2. 백엔드 (NestJS - `ai-meet/apps/api`) 개선 사항

NestJS는 강력한 프레임워크이므로, 그 기능을 최대한 활용하여 견고한 API를 구축할 수 있습니다.

*   **환경 변수 관리:**
    *   `@nestjs/config` 모듈을 사용하여 `.env` 파일을 체계적으로 관리하고, 환경 변수에 대한 유효성 검사를 추가합니다. `process.env`를 직접 사용하는 것보다 안전하고 관리하기 용이합니다.
*   **데이터베이스 통합:**
    *   현재 데이터베이스 관련 모듈이 보이지 않습니다. TypeORM, Prisma, Mongoose 등 ORM/ODM을 선택하여 데이터베이스 연결 및 스키마를 정의하고, 관련 모듈(예: `DatabaseModule`, `UserModule`, `MeetingModule`)을 구성합니다.
    *   마이그레이션 도구를 사용하여 데이터베이스 스키마 변경 이력을 관리하고 배포 시 자동 적용되도록 합니다.
*   **입력 유효성 검사 (Validation):**
    *   `class-validator`와 `class-transformer`를 DTO(Data Transfer Object)에 적용하여 API 요청 데이터에 대한 강력한 유효성 검사를 구현합니다. 전역 `ValidationPipe`를 설정하여 모든 요청에 자동으로 적용되도록 합니다.
*   **구조화된 로깅:**
    *   `console.log` 대신 Winston, Pino 등 전문 로깅 라이브러리를 사용하여 구조화된 로깅을 구현합니다. 이는 운영 환경에서 로그 분석 및 문제 해결에 필수적입니다.
    *   로그 레벨(debug, info, warn, error)을 구분하여 관리합니다.
*   **API 문서화:**
    *   `@nestjs/swagger` 모듈을 사용하여 OpenAPI (Swagger) 문서를 자동으로 생성합니다. 이는 프론트엔드 개발자 및 다른 팀원들과의 API 명세 공유에 매우 유용합니다.
*   **헬스 체크 엔드포인트:**
    *   `/health`와 같은 헬스 체크 엔드포인트를 구현하여 서비스의 상태를 모니터링 시스템에 노출합니다.

### 3. 프론트엔드 (Next.js - `ai-meet/apps/web`) 개선 사항

Next.js의 App Router와 React의 기능을 활용하여 사용자 경험과 개발 효율성을 높일 수 있습니다.

*   **상태 관리 전략:**
    *   복잡한 미팅 애플리케이션의 경우, `useState`와 `useContext`만으로는 전역 상태 관리가 어려울 수 있습니다. Zustand, Jotai, Recoil 또는 Redux Toolkit과 같은 전역 상태 관리 라이브러리를 도입하여 애플리케이션의 복잡한 상태를 효율적으로 관리합니다.
*   **데이터 페칭 및 캐싱:**
    *   `react-query` (TanStack Query) 또는 `SWR`과 같은 데이터 페칭 라이브러리를 사용하여 백엔드 API와의 통신을 추상화하고, 캐싱, 재시도, 백그라운드 업데이트 등의 기능을 활용하여 사용자 경험을 개선하고 개발 복잡성을 줄입니다.
*   **컴포넌트 구조화:**
    *   `components/` 디렉토리 내에서 `components/ui/` 외에 기능별 또는 도메인별로 컴포넌트를 더 세분화하여 관리합니다 (예: `components/meeting/`, `components/auth/`, `components/layout/`). 이는 코드의 응집도를 높이고 재사용성을 향상시킵니다.
*   **환경 변수 관리:**
    *   Next.js의 환경 변수 규칙(`NEXT_PUBLIC_` 접두사)을 명확히 이해하고 적용하여 클라이언트/서버 환경 변수를 올바르게 분리합니다.

### 4. 공통 인프라 및 개발 프로세스 개선

*   **CI/CD 파이프라인 구축:**
    *   GitHub Actions, GitLab CI, Jenkins 등 CI/CD 도구를 사용하여 코드 푸시 시 자동으로 테스트 실행, 린팅, 빌드, 배포를 자동화합니다. 이는 코드 품질을 유지하고 배포 프로세스의 안정성을 확보하는 데 필수적입니다.
*   **컨테이너화 (Docker):**
    *   `api` 및 `web` 애플리케이션 각각에 대한 `Dockerfile`을 작성하여 컨테이너화합니다.
    *   루트 디렉토리에 `docker-compose.yml` 파일을 구성하여 로컬 개발 환경에서 데이터베이스, 백엔드, 프론트엔드를 한 번에 쉽게 실행할 수 있도록 합니다. 이는 개발 환경 설정의 일관성을 보장합니다.
*   **테스팅 전략 강화:**
    *   **단위 테스트:** 서비스 로직, 유틸리티 함수 등 개별 단위에 대한 테스트 커버리지를 높입니다.
    *   **통합 테스트:** API 엔드포인트, 데이터베이스 연동 등 여러 컴포넌트 간의 상호작용을 검증하는 통합 테스트를 작성합니다.
    *   **E2E 테스트:** Playwright 또는 Cypress와 같은 도구를 사용하여 사용자 시나리오 기반의 엔드투엔드 테스트를 구현하여 핵심 사용자 흐름의 안정성을 확보합니다.
*   **코드 품질 도구:**
    *   ESLint, Prettier 설정을 모든 프로젝트에 일관되게 적용하고, Git Hooks (예: Husky)를 사용하여 커밋 전에 자동으로 린팅 및 포맷팅을 실행하도록 합니다.
    *   TypeScript의 엄격한 모드를 활성화하고, 가능한 한 많은 타입 정보를 명시하여 코드의 안정성을 높입니다.

이러한 개선 사항들을 적용하면 프로젝트의 유지보수성, 확장성, 안정성이 크게 향상될 것입니다.
---
# AI-Meet 프로젝트 시스템 문서

> 이 문서는 AI가 프로젝트의 아키텍처와 UI 전체를 빠르게 이해하기 위해 작성되었습니다.
> 다음 방문 시 이 문서부터 읽으면 프로젝트의 전체 그림을 한 번에 파악할 수 있습니다.

---

## 📊 시스템 개요

### 핵심 원칙
- **아키텍처**: Next.js (Client Island) ↔ WebSocket (Socket.IO) ↔ NestJS (Backend) ↔ Supabase (Auth)
- **실시간 통신**: WebRTC (Peer-to-Peer) 기반, WebSocket을 통한 시그널링 서버 운영
- **UI**: Next.js (App Router), shadcn/ui, Tailwind CSS
- **인증**: Supabase Auth (JWT 기반), WebSocket 연결 시 토큰 인증
- **개발 환경**: pnpm Workspace를 사용한 모노레포

---

## 🏗️ 아키텍처

### 1. 데이터 흐름 (중요!)

```
Next.js Client (meeting-client.tsx)
    ├─ Supabase 클라이언트 라이브러리로 로그인, JWT(Access Token) 획득
    └─ 획득한 토큰을 auth.token에 담아 WebSocket 연결 요청
    ↓
NestJS Backend (events.gateway.ts)
    ├─ @UseGuards(SupabaseAuthGuard) - 연결 시도 가로채기
    ├─ SupabaseAuthGuard
    │   ├─ 파일: src/auth/supabase-auth.guard.ts
    │   ├─ 역할: 클라이언트가 보낸 JWT의 유효성 검증
    │   └─ 성공 시: JWT payload를 디코딩하여 socket 객체에 `user`로 저장
    └─ 연결 승인
    ↓
WebSocket 이벤트 처리 (events.gateway.ts)
    ├─ 이벤트: 'join-room', 'offer', 'answer', 'ice-candidate' 등
    ├─ 역할: WebRTC 시그널링 메시지를 특정 클라이언트에게 중계
    └─ 상태 관리: 접속 중인 유저와 룸 정보를 `roomToUsers` Map으로 관리
    ↓
WebRTC P2P 통신
    ├─ 클라이언트 간 직접 미디어 스트림(영상/음성) 교환
    └─ STUN 서버 사용 (stun:stun.l.google.com:19302)
```

### 2. 백엔드 API 구조

- **주 통신 방식**: REST API 대신 WebSocket 사용
- **`EventsGateway` (src/events/events.gateway.ts)**: 모든 실시간 로직의 중심
    - `handleConnection`: 클라이언트 접속 처리 및 로그
    - `handleDisconnect`: 클라이언트 접속 해제 처리, `leaveRoom` 호출
    - `@SubscribeMessage('join-room')`: 유저가 룸에 참여했을 때의 로직 처리
    - `@SubscribeMessage('offer', 'answer', ...)`: WebRTC 시그널링 메시지 중계

### 3. 프론트엔드 구조

- **`meeting-client.tsx`**: 미팅룸의 모든 로직을 담당하는 핵심 클라이언트 컴포넌트
    - `useEffect`: 컴포넌트 마운트 시 `initialize` 함수 호출
    - `initialize`: Supabase 세션 확인, WebSocket 연결 및 이벤트 리스너 등록
    - `createPeerConnection`: 새로운 참여자를 위한 RTCPeerConnection 객체 생성 및 이벤트 핸들러 설정
    - 상태 관리: `useState`와 `useRef`를 사용하여 참여자 목록, 미디어 스트림, 소켓, PeerConnection 등 관리

---

## 📝 주요 기능 구현 계획 (Feature Implementation Plan)

> 이 섹션은 회의 애플리케이션의 핵심 관리 기능을 단계별로 구현하기 위한 계획을 정의합니다.

### Phase 1: 기본 역할 및 권한 시스템 구축 (Foundation)

이 단계는 모든 관리 기능의 기반이 됩니다.

#### 가. 역할(Role) 분리: Host vs. Participant

*   **What**: 회의를 개설한 사람(Host)과 일반 참가자(Participant)의 역할을 명확히 구분합니다.
*   **Why**: Host에게 회의를 원활하게 진행할 수 있는 강력한 권한을 부여하기 위함입니다. (예: 강제 음소거, 내보내기 등)
*   **How**:
    *   **Backend (`api`)**:
        1.  회의실(Room) 상태에 `hostId` 필드를 추가합니다. 회의실 생성 시 요청자의 ID를 `hostId`로 저장합니다.
        2.  사용자가 WebSocket을 통해 특정 방에 접속(`join-room` 이벤트)하면, 해당 사용자의 ID와 방의 `hostId`를 비교합니다.
        3.  일치하면 해당 사용자의 소켓 정보에 `role: 'host'`를, 불일치하면 `role: 'participant'`를 부여하여 세션을 관리합니다.
    *   **Frontend (`web`)**:
        1.  서버로부터 받은 역할 정보를 상태(State)로 관리합니다.
        2.  자신이 Host일 경우에만 관리용 UI(예: 다른 참가자 옆의 '강퇴' 버튼)가 보이도록 조건부 렌더링을 적용합니다.
        3.  참가자 목록에서 Host를 시각적으로 구분할 수 있는 UI(예: 왕관 아이콘, "Host" 뱃지)를 추가합니다.

---

### Phase 2: 회의 진행 보조 기능 (Interaction)

참가자들 간의 상호작용을 원활하게 하고, 진행자의 부담을 덜어주는 기능입니다.

#### 나. 손들기 (Hand Raising)

*   **What**: 참가자가 발언권을 얻고 싶을 때 '손들기' 버튼을 눌러 의사를 표현하는 기능입니다.
*   **Why**: 여러 사람이 동시에 말하는 혼란을 방지하고, Host가 발언 순서를 정하는 등 질서 있는 회의 진행을 돕습니다.
*   **How**:
    *   **Backend (`api`)**:
        1.  각 참가자의 상태 정보에 `handRaised: boolean` 필드를 추가합니다.
        2.  `raise-hand` (클라이언트 -> 서버): 해당 참가자의 `handRaised`를 `true`로 변경하고, 변경된 전체 참가자 목록을 방 안의 모든 사람에게 브로드캐스트(`participants-update` 이벤트)합니다.
        3.  `lower-hand` (클라이언트/Host -> 서버): `handRaised`를 `false`로 변경하고 위와 같이 브로드캐스트합니다.
    *   **Frontend (`web`)**:
        1.  '손들기' UI 버튼을 만듭니다. 클릭 시 `raise-hand` 이벤트를 서버로 보냅니다.
        2.  참가자 목록에서 손을 든 사람 옆에 아이콘(✋)을 표시합니다. Host의 화면에서는 손을 든 사람을 목록 상단으로 정렬해주면 더 좋습니다.

#### 다. 강제 음소거 / 비디오 중지 (Force Mute / Stop Video)

*   **What**: Host가 특정 참가자의 마이크나 카메라를 강제로 끄는 기능입니다.
*   **Why**: 갑작스러운 소음이나 부적절한 화면 송출 등 돌발 상황에 Host가 즉시 대처하여 회의의 질을 유지할 수 있습니다.
*   **How**:
    *   **Backend (`api`)**:
        1.  Host 전용 이벤트를 만듭니다. (예: `force-mute`, `force-stop-video`) 이 이벤트는 Host 역할이 있는 사용자만 호출할 수 있도록 Guard를 설정합니다.
        2.  Host가 이 이벤트를 호출하면, 서버는 대상 참가자(Target User)에게만 "당신은 음소거되었습니다"(`you-are-muted`)와 같은 개인적인 이벤트를 보냅니다.
        3.  동시에, 해당 참가자의 오디오/비디오 상태가 꺼졌음을 전체 참가자 목록에 반영하여 모두에게 브로드캐스트합니다.
    *   **Frontend (`web`)**:
        1.  **Host**: 참가자 목록에서 다른 참가자에게 '음소거', '비디오 중지' 버튼이 보입니다.
        2.  **Participant**: `you-are-muted` 이벤트를 수신하면, 자신의 마이크 스트림을 스스로 끄고 UI(마이크 아이콘)를 음소거 상태로 변경합니다. (개인정보보호 정책상 Host가 강제로 남의 마이크를 켤 수는 없습니다.)

---

### Phase 3: 강력한 참가자 통제 기능 (Control)

회의의 보안과 질서를 유지하기 위한 필수적인 기능입니다.

#### 라. 참가자 내보내기 (Kick Participant)

*   **What**: Host가 특정 참가자를 회의에서 강제로 퇴장시키는 기능입니다.
*   **Why**: 부적절한 행동을 하는 참가자를 즉시 차단하여 회의 환경을 보호합니다.
*   **How**:
    *   **Backend (`api`)**:
        1.  Host 전용 `kick-participant` 이벤트를 만듭니다.
        2.  Host가 호출하면, 서버는 대상 참가자에게 `you-are-kicked` 이벤트를 보낸 후, 해당 소켓 연결을 강제로 끊습니다.
        3.  퇴장 처리된 참가자 정보를 제외한 최신 참가자 목록을 나머지 사람들에게 브로드캐스트합니다.
        4.  (심화) 한 번 강퇴된 사용자가 같은 방에 다시 들어오지 못하도록 '블랙리스트'를 잠시동안 유지하는 로직을 추가할 수 있습니다.
    *   **Frontend (`web`)**:
        1.  **Host**: 참가자 메뉴에 '내보내기(Kick)' 옵션을 추가합니다.
        2.  **Kicked User**: `you-are-kicked` 이벤트를 받으면 "호스트에 의해 회의에서 제외되었습니다." 라는 메시지를 표시하고 회의 페이지에서 자동으로 벗어나도록 처리합니다.

#### 마. 대기실 (Waiting Room / Lobby)

*   **What**: 참가자가 회의에 바로 들어오지 않고, Host가 입장을 수락할 때까지 가상의 대기 공간에서 기다리게 하는 기능입니다.
*   **Why**: 허가된 인원만 회의에 참여시킬 수 있어 보안 수준을 크게 높일 수 있습니다. (예: 외부인, 초대받지 않은 사람의 난입 방지)
*   **How**:
    *   **Backend (`api`)**:
        1.  방 상태에 `waitingRoomEnabled: boolean` 플래그를 추가합니다.
        2.  이 기능이 켜져 있으면, `join-room` 요청 시 바로 입장시키는 대신 '대기자 명단(`pendingUsers`)'에 추가합니다.
        3.  Host에게만 `user-is-waiting` 이벤트를 보내 새로운 대기자가 있음을 알립니다.
        4.  Host가 `approve-join` 이벤트를 보내면, 해당 사용자를 대기자 명단에서 제거하고 정식으로 방에 입장시킵니다.
    *   **Frontend (`web`)**:
        1.  **Participant**: 입장 시도 후 "호스트가 입장을 수락할 때까지 잠시 기다려주세요..." 와 같은 대기 화면을 표시합니다.
        2.  **Host**: "OOO님이 입장을 기다리고 있습니다" 와 같은 알림과 함께 '수락(Admit)'/'거절(Deny)' 버튼을 표시합니다.

---

## 🎨 UI 레이아웃

### 기본 구조 (layout.tsx)

```
<html lang="en">
  <body>
    <Header />
    <main className="container mx-auto p-4">
      {children}
    </main>
  </body>
</html>
```

- **Header**: 모든 페이지 상단에 표시되는 공통 헤더 (`@/components/header.tsx`)
- **main**: 페이지의 실제 콘텐츠가 렌더링되는 영역. `container`, `mx-auto` 클래스로 중앙 정렬 및 최대 너비 제한.

---

## 🔐 인증 처리

### 인증 흐름

1.  **로그인**: 사용자가 프론트엔드에서 Supabase Auth UI를 통해 로그인.
2.  **토큰 획득**: `@supabase/auth-helpers-nextjs` 라이브러리가 세션과 JWT(Access Token)를 자동으로 관리.
3.  **웹소켓 연결**: `meeting-client.tsx`에서 웹소켓 연결 시, `socket.auth.token`에 현재 세션의 Access Token을 담아 보냄.
4.  **서버 측 가드**: `SupabaseAuthGuard`가 연결 요청을 가로채 `auth.token`의 유효성을 검증.
    - **검증 로직**: `jsonwebtoken.verify()`를 사용하여 `SUPABASE_JWT_SECRET`으로 서명을 확인.
    - **성공**: 디코딩된 payload(유저 정보)를 `socket['user']`에 저장 후 연결 허용.
    - **실패**: 연결 거부.
5.  **이벤트 핸들러**: `handleJoinRoom` 등 각 이벤트 핸들러에서는 `socket['user'].sub`를 통해 인증된 사용자의 ID를 신뢰하고 사용.

### 관련 파일

| 위치 | 파일 | 역할 |
|------|------|------|
| 백엔드 | `src/auth/supabase-auth.guard.ts` | 웹소켓 연결 시 JWT 검증 가드 |
| 프론트엔드 | `src/app/meeting/[roomId]/meeting-client.tsx` | 토큰을 담아 웹소켓 연결 요청 |
| 프론트엔드 | `src/app/login/page.tsx` | Supabase UI를 사용한 로그인 페이지 |

---

## 📌 라우팅 정책 (middleware.ts)

- **파일**: `ai-meet/apps/web/middleware.ts`
- **역할**: 특정 페이지 접근 제어

### 규칙

1.  **로그인한 사용자가 `/login` 페이지 접근 시**:
    - 메인 페이지(`/`)로 리디렉션.
2.  **로그인하지 않은 사용자가 `/meeting/*` 페이지 접근 시**:
    - 로그인 페이지(`/login`)로 리디렉션.

```ts
// src/apps/web/middleware.ts

export const config = {
  matcher: ['/meeting/:path*', '/login'],
};
```

---

## 🚀 주요 컴포넌트 및 파일 참조

| 구분 | 파일 경로 | 역할 |
|------|-----------|------|
| **백엔드** | | |
| 게이트웨이 | `apps/api/src/events/events.gateway.ts` | 웹소켓 이벤트 핸들러, WebRTC 시그널링 로직 |
| 인증 가드 | `apps/api/src/auth/supabase-auth.guard.ts` | 웹소켓 연결 시 JWT 인증 처리 |
| 모듈 | `apps/api/src/events/events.module.ts` | 게이트웨이와 `ConfigModule`을 연결 |
| 메인 모듈 | `apps/api/src/app.module.ts` | NestJS 앱의 루트 모듈, 전역 설정 |
| **프론트엔드** | | |
| 메인 클라이언트 | `apps/web/app/meeting/[roomId]/meeting-client.tsx` | 미팅룸의 모든 UI와 실시간 로직 담당 |
| 페이지 | `apps/web/app/meeting/[roomId]/page.tsx` | `meeting-client.tsx`를 렌더링하는 RSC |
| 라우팅 미들웨어 | `apps/web/middleware.ts` | 인증 기반 페이지 접근 제어 |
| 메인 레이아웃 | `apps/web/app/layout.tsx` | 공통 UI 구조 (헤더, 메인 영역) |
| 헤더 | `apps/web/components/header.tsx` | 로그인 상태에 따른 UI 변경 및 로그아웃 처리 |
| 홈페이지 | `apps/web/app/page.tsx` | 미팅 생성 및 참여 UI |

---

## ⚙️ 환경 변수

### 백엔드 (`apps/api/.env`)

| 변수명 | 설명 |
|---|---|
| `PORT` | API 서버가 실행될 포트 (예: 3001) |
| `SUPABASE_JWT_SECRET` | Supabase 프로젝트의 JWT Secret. 토큰 검증에 필수. |

### 프론트엔드 (`apps/web/.env.local`)

| 변수명 | 설명 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 프로젝트 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 프로젝트의 `anon` public 키 |
| `NEXT_PUBLIC_WEBSOCKET_URL` | 연결할 백엔드 API 서버의 주소 (예: `http://localhost:3001` 또는 ngrok 주소) |