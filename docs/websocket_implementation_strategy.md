# WebSocket 기반 Discord 스타일 구현 전략

네, **WebSocket으로도 충분히 구현 가능합니다.**
오히려 시그널링(이벤트 전달) 측면에서는 WebSocket이 매우 빠르고 확실하기 때문에 장점이 있습니다.

핵심은 **"데이터 전송(Media)"**과 **"상태 알림(Signaling)"**을 분리해서 처리하는 것입니다.

## 1. 구현 원리 (Architecture)

### A. 끄기 (Mute) - "즉시 숨기기"
1.  **Sender (나)**: 카메라 끄기 버튼 클릭.
    -   `MediaRecorder.stop()`: 실제 데이터 전송 즉시 중단 (네트워크 절약, LED 꺼짐).
    -   `socket.emit('camera-off')`: 서버에 "나 껐어"라고 알림.
    -   내 화면: 즉시 내 비디오를 숨기고 아바타를 보여줌.
2.  **Server**: 방에 있는 모든 사람에게 `camera-off` 브로드캐스트.
3.  **Receiver (상대방)**: `camera-off` 이벤트 수신.
    -   **즉시** 해당 유저의 `<video>` 태그를 `hidden` 처리하고 아바타를 띄움.
    -   (데이터가 끊겨서 검은 화면이 될 틈을 주지 않음)

### B. 켜기 (Unmute) - "새 출발"
1.  **Sender (나)**: 카메라 켜기 버튼 클릭.
    -   `setupMediaRecorder()` 재호출: 레코더를 새로 시작합니다.
    -   **중요**: `MediaRecorder`는 시작할 때 무조건 **Init Segment(키프레임)**를 가장 먼저 내보냅니다.
    -   `socket.emit('camera-on')`: 서버에 "나 켰어"라고 알림.
2.  **Server**: `camera-on` 브로드캐스트.
3.  **Receiver (상대방)**: `camera-on` 이벤트 수신.
    -   아바타를 치우고 `<video>` 태그를 다시 보여줄 준비를 함 (로딩 스피너 표시 등).
    -   잠시 후 도착하는 첫 데이터(키프레임)를 받아서 재생 시작.

## 2. 코드 구현 가이드

### 1단계: 즉각적인 UI 전환 (Signaling)
`meeting-client.tsx`에서 상태 변경 이벤트를 처리하는 부분입니다.

```typescript
// 수신 측 (Receiver)
socket.on('camera-state-changed', ({ userId, hasVideo }) => {
  setParticipants(prev => prev.map(p => {
    if (p.userId === userId) {
      // 데이터 수신 여부와 상관없이 UI 상태(flag)를 즉시 변경
      return { ...p, hasVideo }; 
    }
    return p;
  }));
});

// 렌더링 부분 (JSX)
{participant.hasVideo ? (
  <video ... /> // 비디오
) : (
  <Avatar ... /> // 아바타 (즉시 보여짐)
)}
```

### 2단계: 키프레임 강제 전송 (Sender)
`toggleCamera` 함수에서 단순히 트랙만 켜는 게 아니라, 레코더를 재시작해야 합니다.

```typescript
// 송신 측 (Sender)
const toggleCamera = async () => {
  const newHasVideo = !localVideoOn;
  
  if (newHasVideo) {
    // 1. 켜기: 트랙 활성화 + 레코더 재시작 (키프레임 생성)
    if (localStreamRef.current) {
       const videoTrack = localStreamRef.current.getVideoTracks()[0];
       if (videoTrack) videoTrack.enabled = true;
       
       // 핵심: 레코더를 재시작해야 새 키프레임이 나감
       setupMediaRecorder(localStreamRef.current); 
    }
  } else {
    // 2. 끄기: 트랙 비활성화 (데이터 전송 중단은 setupMediaRecorder 내부 로직에 의존하거나 명시적 stop)
    if (localStreamRef.current) {
       const videoTrack = localStreamRef.current.getVideoTracks()[0];
       if (videoTrack) videoTrack.enabled = false;
       // (선택) mediaRecorderRef.current.stop() 호출하여 확실하게 끊기
    }
  }

  setLocalVideoOn(newHasVideo);
  socketRef.current?.emit('camera-state-changed', { ..., hasVideo: newHasVideo });
};
```

## 3. 결론
WebSocket이라고 해서 안 되는 것은 없습니다. **"이벤트(Signaling)를 믿고 UI를 먼저 바꾸는 것"**이 핵심입니다.
현재 코드는 "데이터가 오면 보여준다"는 수동적인 방식이라 딜레이가 생기는 것이며, 위와 같이 **"이벤트 주도(Event-Driven)"** 방식으로 바꾸면 디스코드와 유사한 경험을 만들 수 있습니다.
