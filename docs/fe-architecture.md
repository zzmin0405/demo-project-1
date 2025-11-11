# 프론트엔드 아키텍처 (FE Architecture)

## 실시간 미디어 스트리밍 아키텍처 (웹소켓 기반)

### 1. 개요 (Overview)

본 시스템의 실시간 미디어(음성/영상) 스트리밍은 기존의 P2P WebRTC 방식에서 서버를 경유하는 웹소켓(WebSocket) 기반의 릴레이(Relay) 방식으로 변경되었습니다. 이 아키텍처는 사용자의 네트워크 환경(NAT/방화벽) 제약으로 인해 P2P 연결이 실패하는 경우를 우회하고, 보다 확실한 연결성을 보장하기 위해 채택되었습니다.

다만, 모든 미디어 데이터가 중앙 서버를 경유하므로 서버 부하 및 네트워크 비용이 증가하며, P2P 방식에 비해 지연 시간(Latency)이 길어지는 단점이 있습니다.

### 2. 주요 기술 스택 (Key Technology Stack)

- **Socket.IO:** 클라이언트와 서버 간의 실시간, 양방향 통신을 위한 웹소켓 라이브러리. 미디어 데이터 조각(Chunk) 및 각종 이벤트(입장, 퇴장 등)를 전달하는 데 사용됩니다.
- **MediaRecorder API:** 사용자의 로컬 카메라와 마이크로부터 얻은 `MediaStream`을 일정한 시간 간격(timeslice)으로 잘라, 전송 가능한 `Blob` 형태의 데이터 조각으로 만드는 데 사용됩니다.
- **MediaSource Extensions (MSE) API:** 다른 사용자로부터 수신한 미디어 데이터 조각들을 브라우저의 `<video>` 엘리먼트에서 재생할 수 있도록 버퍼에 추가하고 디코딩하는 역할을 합니다.

### 3. 동작 흐름 (Workflow)

#### 3.1. 송신 클라이언트 (Sending Client)

1.  `navigator.mediaDevices.getUserMedia()`를 통해 사용자의 카메라/마이크 접근 권한을 얻고, 로컬 `MediaStream`을 생성합니다.
2.  생성된 `MediaStream`을 `MediaRecorder` 인스턴스에 전달합니다.
3.  `mediaRecorder.start(timeslice)`를 호출하여 녹화를 시작합니다. (현재 `timeslice`는 1500ms로 설정되어, 1.5초 분량의 데이터가 모일 때마다 `dataavailable` 이벤트가 발생합니다.)
4.  `ondataavailable` 이벤트 핸들러는 녹화된 데이터 조각(`Blob`)을 받아, `media-chunk`라는 이름의 웹소켓 이벤트를 통해 서버로 전송합니다.

#### 3.2. 중계 서버 (Relay Server - NestJS)

1.  클라이언트로부터 `media-chunk` 이벤트를 수신합니다.
2.  이벤트를 보낸 클라이언트가 속한 방(Room)을 찾습니다.
3.  해당 클라이언트를 제외한, 같은 방에 있는 다른 모든 클라이언트에게 원본 데이터 조각을 그대로 브로드캐스트(Broadcast)합니다.

#### 3.3. 수신 클라이언트 (Receiving Client)

1.  서버로부터 `media-chunk` 이벤트를 수신합니다.
2.  데이터를 보낸 사용자에 해당하는 `<video>` 엘리먼트에 `MediaSource` 객체를 연결합니다.
3.  `MediaSource`가 준비되면(`sourceopen` 이벤트), `addSourceBuffer()`를 통해 미디어 데이터를 받을 `SourceBuffer`를 생성합니다.
4.  서버로부터 받은 데이터 조각을 `sourceBuffer.appendBuffer()`를 사용하여 버퍼에 순차적으로 추가합니다.
5.  브라우저는 버퍼에 쌓인 데이터를 디코딩하여 `<video>` 엘리먼트를 통해 재생합니다.
6.  버퍼가 처리 중일 때 도착하는 데이터는 임시 큐(Queue)에 저장했다가, 버퍼가 준비되면 순차적으로 추가하여 데이터 손실을 방지합니다.

### 4. 장단점 (Pros and Cons)

-   **장점 (Pros):**
    -   복잡한 NAT/방화벽 환경에서도 안정적인 연결을 보장합니다. (STUN/TURN 서버 불필요)
    -   P2P 연결 설정에 비해 초기 연결 로직이 비교적 단순합니다.

-   **단점 (Cons):**
    -   모든 트래픽이 서버를 경유하므로, 사용자 수에 비례하여 서버 부하와 네트워크 비용이 크게 증가합니다.
    -   P2P 방식에 비해 데이터 전송 경로가 길어져 지연 시간(Latency)이 현저히 높아집니다.
    -   클라이언트 측에서 `MediaSource Extensions` API를 이용한 버퍼 관리가 복잡하며, 불안정한 네트워크 환경에서 끊김 현상(Choppy playback)이 발생하기 쉽습니다.