# Always-On Media (Soft Mute) 전략 분석

사용자께서 제안하신 **"미디어 데이터는 항상 전송하되, 보여주기 여부만 HTML/CSS로 제어하는 방식"**에 대한 기술적 분석과 장단점입니다.

## 1. 제안된 방식의 개념
- **기존 방식 (Hard Mute)**: 카메라를 끄면 `videoTrack.enabled = false`로 설정하여 하드웨어 레벨에서 데이터 전송을 중단합니다.
- **제안 방식 (Soft Mute)**: 카메라는 계속 켜두고(`videoTrack.enabled = true`), 데이터를 계속 서버로 보냅니다. 단지 수신 측에서 `camera-state-changed` 이벤트를 받으면 `<video>` 태그를 `hidden` 처리하여 안 보이게 만듭니다.

## 2. 장점 (Pros)
1.  **즉각적인 반응 속도 (Zero Latency Switching)**
    - 카메라를 켜고 끄는 것이 단순히 CSS 클래스 토글이 되므로 딜레이가 전혀 없습니다.
    - 현재 겪고 있는 "키프레임 대기(검은 화면)" 문제가 원천적으로 사라집니다.
2.  **버퍼 안정성**
    - 데이터가 끊기지 않고 계속 흐르므로, `SourceBuffer`나 `MediaRecorder`가 멈췄다 다시 시작할 때 발생하는 오류(타임스탬프 불일치 등)가 줄어듭니다.

## 3. 단점 및 치명적 리스크 (Cons)
1.  **개인정보보호 및 사용자 경험 (Critical)**
    - **카메라 불빛(LED)이 계속 켜져 있습니다.** 사용자가 앱에서 "카메라 끄기"를 눌렀는데도 노트북/웹캠의 녹화 불빛이 꺼지지 않으면, 사용자는 **"이 앱이 나를 몰래 촬영하고 있다"**고 오해하게 됩니다. 이는 서비스 신뢰도에 치명적입니다.
2.  **보안 취약점 (Security Risk - Critical)**
    - **HTML/CSS 조작 가능성**: 수신 측에서 단순히 `hidden` 클래스로 가리고 있는 것이라면, 악의적인 사용자가 브라우저 개발자 도구(F12)를 열어 `hidden` 클래스를 지우거나 DOM을 조작하면 **상대방이 껐다고 생각한 영상을 훔쳐볼 수 있습니다.**
    - **네트워크 패킷 감청**: 화면에 렌더링하지 않더라도 네트워크 탭이나 패킷 스니핑 툴을 통해 비디오 데이터가 계속 들어오고 있다는 것을 알 수 있고, 이를 저장하여 재생할 수 있습니다.
    - **결론**: **절대로 상용 서비스에 적용해서는 안 되는 방식입니다.**
3.  **데이터 및 배터리 소모**
    - 화면을 안 보여주는데도 고화질 비디오 데이터를 계속 전송하므로 네트워크 대역폭과 CPU/배터리를 불필요하게 소모합니다. (특히 모바일 환경에서 치명적)

## 4. 절충안 (Recommended)
완전한 Always-On 대신, **"오디오는 Always-On, 비디오는 Hard Mute 유지"** 또는 **"더미 비디오 전송"** 방식을 추천합니다.

### A. 오디오만 Always-On (Soft Mute)
- 마이크는 데이터를 계속 보내되, 끄기 버튼을 누르면 `GainNode` 볼륨만 `0`으로 줄입니다.
- **이유**: 오디오 데이터는 작아서 부담이 적고, 마이크는 LED가 없는 경우가 많아 거부감이 덜합니다.

### B. 비디오: 검은 화면 송출 (Black Frame)
- 카메라를 끄면 실제 카메라 트랙 대신 `Canvas`로 그린 검은 화면 스트림으로 교체하여 전송합니다.
- **장점**: 데이터 연결은 유지되므로 끊김은 없지만, 실제 사생활은 보호됩니다.
- **단점**: 구현 난이도가 조금 높습니다 (CanvasStream 교체 로직 필요).

## 5. 구현 가이드 (제안하신 방식 적용 시)

만약 단점을 감수하고 제안하신 방식을 적용한다면 다음과 같이 수정합니다.

**수정 파일**: `apps/web/app/meeting/[roomId]/meeting-client.tsx`

### Sender (보내는 쪽)
`toggleCamera` 함수에서 트랙을 끄지 않고 이벤트만 보냅니다.

```typescript
const toggleCamera = () => {
  // videoTrack.enabled = !videoTrack.enabled; // <--- 이 줄 삭제 (하드웨어 끄기 방지)
  
  const newHasVideo = !localVideoOn;
  setLocalVideoOn(newHasVideo); // UI 상태만 변경
  
  // 서버에 상태 알림
  socketRef.current?.emit('camera-state-changed', {
    roomId,
    userId: currentUserId,
    hasVideo: newHasVideo
  });
};
```

### Receiver (받는 쪽)
상태 변화에 따라 CSS로 숨깁니다.

```typescript
// 렌더링 부분
<div className="relative">
  <video 
    ref={el => { remoteVideoRefs.current[participant.userId] = el; }}
    className={participant.hasVideo ? "block" : "hidden"} // <--- CSS로 제어
    autoPlay 
    playsInline 
  />
  {!participant.hasVideo && (
    <div className="absolute inset-0 bg-gray-800 flex items-center justify-center">
      <span>카메라 꺼짐</span>
    </div>
  )}
</div>
```
