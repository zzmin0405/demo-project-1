# Codex Handoff Prompt

노트북 Codex에서 이 파일 내용을 참고해 프로젝트를 이어서 작업하면 된다.

## 새 Codex에 붙여넣을 프롬프트

```text
프로젝트 이어서 작업하려고 함.

프로젝트 위치는 ai-meet이고, 브랜치는 codex/broadcast-receive-only-latency 사용.
최근 커밋은 ddf43ae feat: show meeting summaries on profile 까지 완료됨.

프로젝트는 실시간 다국어 회의 플랫폼임.
핵심 기능:
- 회의방 생성/입장
- 영상·음성 송수신
- 방장/화자 권한 제어
- 단일 화자 모드 / 전체 화자 모드
- Web Speech API 기반 STT
- Deepgram 서버 STT 옵션
- google-translate-api-x 기반 번역 자막
- 다국어 자막 선택
- 자막 지연시간 표시
- STT 기록 DB 저장
- 회의 요약 생성
- 마이페이지에서 회의 요약 및 발화 기록 확인

배포 구조:
- Web: localhost:3000
- API: localhost:3001
- Cloudflare tunnel 사용
- https://yumeet.site -> localhost:3000
- https://api.yumeet.site -> localhost:3001

필요한 환경변수:
- DATABASE_URL
- NEXTAUTH_SECRET
- NEXTAUTH_URL=https://yumeet.site
- NEXT_PUBLIC_WEBSOCKET_URL=https://api.yumeet.site
- BACKEND_URL=http://127.0.0.1:3001
- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- OPENAI_API_KEY 있으면 회의 요약 생성 가능
- DEEPGRAM_API_KEY 있으면 Deepgram STT 사용 가능

최근 작업 내용:
- 회의 설정 모달에 회의 요약 섹션 추가
- 저장된 요약이 없으면 발표용 예시 요약 표시
- 방장은 요약 생성 가능
- 참가자도 저장된 요약 조회 가능
- 마이페이지 회의 카드에서 회의 요약 확인 가능
- 마이페이지에서 각 회의별 최근 STT 발화 기록 확인 가능
- 발화 기록에는 말한 사람, 시간, 발화 내용 표시
- 실제 저장 데이터가 없으면 발표용 예시 데이터 표시

DB 관련:
- Prisma schema에는 MeetingRoom.isSttSaved, SttTranscriptLog, MeetingSummary가 있음
- prisma db push는 실행 필요할 수 있음
- 명령어:
  pnpm --dir ai-meet/apps/web exec prisma db push

검증했던 명령:
- pnpm --dir ai-meet/apps/web exec tsc --noEmit
- pnpm --dir ai-meet/apps/web build
- pnpm --dir ai-meet/apps/api build
- pnpm --dir ai-meet/apps/api test -- events.gateway.spec.ts --runInBand

노트북에서 할 일:
1. git fetch/pull 해서 최신 커밋 ddf43ae까지 받기
2. env 설정 확인
3. PostgreSQL DB 실행
4. prisma db push
5. API 서버 localhost:3001 실행
6. Web 서버 localhost:3000 실행
7. Cloudflare tunnel 실행
8. https://yumeet.site 와 https://api.yumeet.site 접속 확인
9. 회의 생성 -> STT 기록 저장 켜기 -> 발화 -> 번역 자막 -> 요약 생성 -> 마이페이지 요약/발화 기록 확인 흐름 테스트

이 맥락 기준으로 서버 실행과 발표 전 안정화 도와줘.
```

## 실행 순서

```powershell
git fetch
git checkout codex/broadcast-receive-only-latency
git pull

pnpm --dir ai-meet/apps/web exec prisma db push
pnpm --dir ai-meet/apps/api build
pnpm --dir ai-meet/apps/web build
```

서버 실행은 터미널을 나눠서 진행한다.

```powershell
pnpm --dir ai-meet/apps/api start:dev
```

```powershell
pnpm --dir ai-meet/apps/web dev
```

Cloudflare tunnel은 프로젝트 루트에서 실행한다.

```powershell
.\start-tunnel.ps1
```

## 발표 전 테스트 흐름

1. `https://yumeet.site` 접속
2. 로그인
3. 회의 생성
4. 다른 브라우저 또는 다른 기기로 회의 입장
5. 방장이 화자 권한 부여/회수 확인
6. 단일 화자 모드와 전체 화자 모드 전환 확인
7. 자막 켜기
8. STT 기록 저장 켜기
9. 발화 후 원문/번역 자막 표시 확인
10. 회의 요약 생성 확인
11. 마이페이지에서 회의 요약과 발화 기록 확인

## 주의사항

- `yumeet.site` 접속은 Cloudflare tunnel이 켜져 있어야 가능하다.
- `api.yumeet.site`도 API 서버와 tunnel이 같이 켜져 있어야 WebSocket 연결이 된다.
- `OPENAI_API_KEY`가 없으면 실제 회의 요약 생성은 실패할 수 있지만, 화면에는 발표용 예시 요약이 표시된다.
- `DEEPGRAM_API_KEY`가 없으면 Deepgram STT 대신 Web Speech API로 동작한다.
- 발표 전에는 같은 네트워크와 같은 브라우저 환경에서 2회 이상 리허설하는 것이 좋다.
