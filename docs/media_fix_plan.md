# 미디어 전송 및 재생 문제 해결 가이드

이 문서는 현재 AI Meet 프로젝트에서 발생하고 있는 미디어 전송 실패 및 재생 불가(검은 화면, 소리 안 들림) 현상을 해결하기 위한 구체적인 코드 수정 가이드입니다.

## 1. 브라우저 자동 재생 정책 (Autoplay Policy) 해결

### 문제 상황
브라우저는 사용자의 명시적인 상호작용(클릭, 탭 등)이 없으면 오디오가 포함된 미디어의 자동 재생을 차단합니다. 이로 인해 데이터는 수신되지만 영상이 멈춰있거나 소리가 들리지 않습니다.

### 해결 방법
사용자가 "회의 참가" 버튼을 누르거나 화면을 클릭할 때, `AudioContext`를 강제로 재개(Resume)시켜야 합니다.

**수정 위치**: `apps/web/app/meeting/[roomId]/meeting-client.tsx`

```typescript
// 1. AudioContext 상태 확인 및 재개 함수 추가
const resumeAudioContext = async () => {
  if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
    await audioContextRef.current.resume();
    console.log('AudioContext resumed by user interaction');
  }
};

// 2. 전체 컨테이너에 클릭 이벤트 리스너 추가 (또는 특정 버튼)
return (
  <div 
    className="..."
    onClick={() => {
      resumeAudioContext(); // 클릭 시 오디오 컨텍스트 활성화
      // 기존 로직...
    }}
  >
    {/* ... */}
  </div>
);
```

## 2. 소켓 연결 레이스 컨디션 (Race Condition) 해결

### 문제 상황
`MediaRecorder`가 데이터를 뱉어내는 시점(`ondataavailable`)에 소켓 연결이 아직 완료되지 않았거나(`socketRef.current`가 null), 연결 도중 끊긴 경우 데이터가 소리 없이 버려집니다.

### 해결 방법
소켓이 연결될 때까지 데이터를 임시 큐에 저장하거나, 연결 상태를 체크하여 재연결을 시도해야 합니다.

**수정 위치**: `apps/web/app/meeting/[roomId]/meeting-client.tsx`

```typescript
// 1. 전송 대기열(Queue) 추가
const pendingChunksRef = useRef<{ chunk: Blob, mimeType: string }[]>([]);

// 2. ondataavailable 수정
mediaRecorder.ondataavailable = (event) => {
  if (event.data && event.data.size > 0) {
    if (socketRef.current && socketRef.current.connected) {
      // 연결 상태면 즉시 전송
      flushPendingChunks(); // 쌓인거 먼저 보냄
      socketRef.current.emit('media-chunk', { chunk: event.data, mimeType });
    } else {
      // 연결 안됐으면 큐에 저장
      console.warn('Socket not ready, buffering chunk...');
      pendingChunksRef.current.push({ chunk: event.data, mimeType });
    }
  }
};

// 3. 소켓 연결 시 큐 비우기
socket.on('connect', () => {
  flushPendingChunks();
});

const flushPendingChunks = () => {
  while (pendingChunksRef.current.length > 0) {
    const item = pendingChunksRef.current.shift();
    if (item && socketRef.current) {
       socketRef.current.emit('media-chunk', item);
    }
  }
};
```

## 3. 안정성 튜닝 (끊김 완화)

### 문제 상황
현재 100ms 간격의 청크 전송은 네트워크 지연에 매우 취약하여 잦은 끊김(Stuttering)을 유발합니다.

### 해결 방법
청크 크기를 늘리고 버퍼 여유를 확보합니다.

**수정 위치**: `apps/web/app/meeting/[roomId]/meeting-client.tsx`

```typescript
// 1. 청크 간격 증가 (100ms -> 500ms 권장)
mediaRecorder.start(500); 

// 2. 지연 보정 로직 완화 (0.1초 -> 0.5초)
// 기존: videoElement.currentTime = end - 0.1;
// 변경:
if (latency > 3) {
  videoElement.currentTime = end - 0.5; // 여유를 두고 점프
}
```

## 4. 코덱 호환성 (Codec Compatibility)

### 문제 상황
일부 브라우저(Safari 등)는 `VP8` 코덱을 지원하지 않을 수 있습니다.

### 해결 방법
`MediaRecorder` 생성 시 브라우저가 지원하는 코덱을 우선순위에 따라 선택하도록 로직을 강화합니다. (현재 코드는 이미 `possibleTypes`를 순회하며 체크하고 있어 비교적 잘 되어 있으나, 수신 측에서 에러가 날 경우에 대한 처리가 필요합니다.)

```typescript
// 수신 측 (setupMediaSource)
if (!MediaSource.isTypeSupported(mimeType)) {
  console.error(`${mimeType} is not supported`);
  // TODO: 사용자에게 "브라우저 호환성 문제" 알림 표시
  alert('이 브라우저에서는 해당 비디오 형식을 재생할 수 없습니다. Chrome을 권장합니다.');
  return;
}
```
