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
