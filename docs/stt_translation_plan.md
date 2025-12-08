# Real-time STT & Translation Architecture Plan

음성 인식(STT) 및 실시간 번역 자막 기능을 구현하기 위한 아키텍처 계획입니다.

## 1. 요구사항 분석
- **실시간성**: 발화와 동시에 자막이 떠야 함 (Latency 최소화).
- **다국어 번역**: 인식된 텍스트를 각 참가자의 설정 언어로 번역하여 전송.
- **확장성**: 여러 명이 동시에 말할 때도 처리 가능해야 함.

## 2. 기술적 접근 방식 비교

### Option A: Client-side Web Speech API (비추천)
- **방식**: 브라우저 내장 API(`webkitSpeechRecognition`) 사용.
- **장점**: 무료, 서버 부하 없음.
- **단점**:
    - 크롬 외 브라우저 지원 미비.
    - 마이크 권한 충돌 가능성 (`getUserMedia`와 동시에 사용 시).
    - **번역 불가**: 인식된 텍스트를 다시 번역 API로 보내야 하므로 딜레이 발생.

### Option B: Server-side Pipeline (추천)
- **방식**: 클라이언트가 오디오 데이터를 서버로 보내고, 서버가 STT/번역 엔진(OpenAI Whisper, Google Cloud STT 등)과 연동.
- **장점**:
    - 모든 브라우저 호환.
    - 중앙 제어 가능 (욕설 필터링, 로깅 등).
    - 번역 엔진과 직접 연동하여 속도 최적화 가능.

## 3. 추천 아키텍처 (Server-side Pipeline)

기존의 비디오 스트리밍(`media-chunk`)과는 별도로 **오디오 전용 채널**을 운영하는 것이 효율적입니다.

### 데이터 흐름 (Data Flow)

1.  **Audio Capture (Client)**
    -   `AudioContext`에서 `ScriptProcessor` 또는 `AudioWorklet`을 사용하여 **PCM 오디오 데이터(Raw Audio)**를 추출합니다.
    -   (비디오가 포함된 WebM 청크는 디코딩 비용이 비싸므로 STT용으로는 부적합)
    -   추출된 오디오를 1초~3초 단위 혹은 VAD(Voice Activity Detection)로 끊어서 소켓으로 전송합니다.
    -   Event: `socket.emit('audio-stream', { audioData, language: 'ko' })`

2.  **Processing (Server - NestJS)**
    -   `audio-stream` 이벤트를 받아서 버퍼링합니다.
    -   외부 STT API (예: OpenAI Whisper API, Google Cloud Speech-to-Text)에 스트림을 전달합니다.
    -   **Tip**: 비용 절감을 위해 VAD(목소리 감지) 라이브러리를 서버에 두어, 무음 구간은 API 호출을 생략합니다.

3.  **Translation (Server)**
    -   STT 결과 텍스트가 나오면, 타겟 언어(영어, 일본어 등)로 번역 API(DeepL, Google Translate)를 호출합니다.
    -   *고급*: OpenAI GPT-4o Realtime API를 쓰면 STT와 번역을 한 번에 처리할 수도 있습니다.

4.  **Broadcasting (Server -> Client)**
    -   번역된 자막을 방 전체에 브로드캐스트합니다.
    -   Event: `socket.emit('subtitle', { userId, text, translations: { en: "Hello", ja: "こんにちは" } })`

5.  **Display (Client)**
    -   수신된 자막을 화면 하단에 오버레이로 표시합니다.

## 4. 단계별 구현 로드맵

### Phase 1: 오디오 추출 및 전송 (Client)
- `AudioWorklet`을 구현하여 마이크 입력에서 순수 오디오 데이터(PCM) 추출.
- WebSocket으로 바이너리 전송 구현.

### Phase 2: STT 연동 (Server)
- OpenAI Whisper API (또는 Faster-Whisper 로컬 모델) 연동.
- 텍스트 인식 후 클라이언트로 반환 (`original-text`).

### Phase 3: 번역 및 자막 UI
- DeepL 또는 Google Translate API 연동.
- 클라이언트 자막 UI 컴포넌트 구현.

## 5. 비용 및 성능 고려사항
- **비용**: 실시간 STT/번역 API는 유료입니다. (분당 과금)
- **성능**: 로컬에서 Whisper 모델을 돌리려면 GPU 서버가 필요합니다. 클라우드 API를 쓰면 관리는 편하지만 딜레이(1~2초)가 생길 수 있습니다.
