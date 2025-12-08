# Meeting Layout Improvement Plan (Smart Grid)

현재 회의 화면에서 빈 공간이 많이 남는 문제를 해결하기 위해, Google Meet이나 Zoom과 유사한 **"반응형 스마트 그리드(Smart Grid)"**를 도입합니다.

## 문제 분석
현재 코드는 `grid-cols-2` 등으로 열 개수가 고정되어 있어, 참가자 수가 홀수이거나 화면 비율이 달라지면 빈 공간이 크게 발생합니다.

## 개선 목표
1.  **동적 그리드 계산**: 참가자 수에 따라 최적의 행/열 개수를 자동으로 계산합니다.
2.  **꽉 찬 화면**: 빈 공간을 최소화하고 비디오 영역을 최대화합니다.
3.  **중앙 정렬**: 마지막 줄에 남는 비디오가 있으면 중앙에 배치합니다.

## 구현 방안

### 1. CSS Grid 대신 Flexbox + calc() 활용 (Google Meet 스타일)
CSS Grid는 셀 크기가 고정되기 쉬우므로, Flexbox와 `flex-basis`를 동적으로 계산하여 적용하는 방식이 유리합니다.

**수정 파일**: `apps/web/app/meeting/[roomId]/meeting-client.tsx`

```typescript
// 참가자 수에 따른 스타일 계산 함수
const getGridStyle = (count: number) => {
  if (count === 1) return "w-full h-full";
  if (count === 2) return "w-full md:w-1/2 h-1/2 md:h-full"; // 1:1 분할
  if (count <= 4) return "w-1/2 h-1/2"; // 2x2
  if (count <= 6) return "w-1/2 md:w-1/3 h-1/3 md:h-1/2"; // 2x3 or 3x2
  if (count <= 9) return "w-1/3 h-1/3"; // 3x3
  return "w-1/3 md:w-1/4 h-1/4"; // 4x4...
};

// 렌더링 로직 변경
<div className="flex flex-wrap justify-center content-center w-full h-full gap-2 p-4">
  {allParticipants.map(p => (
     <div className={cn("transition-all duration-300", getGridStyle(totalCount))}>
       <ParticipantCard ... />
     </div>
  ))}
</div>
```

### 2. Speaker View 개선 (Filmstrip Layout)
현재 Speaker View는 주 화자만 보여주고 나머지는 숨깁니다(`hidden`). 이를 개선하여 **주 화자를 크게 보여주고, 나머지 참가자는 하단에 작은 리스트(Filmstrip)로 보여주는 방식**으로 변경합니다.

-   **주 화자 영역**: 화면의 80% 차지.
-   **Filmstrip 영역**: 하단에 가로 스크롤 가능한 리스트로 배치.

### 3. View Mode Toggle (UX)
이미 구현된 'Speaker' / 'Gallery' 버튼을 유지하되, 각 모드의 동작을 위와 같이 고도화하여 사용자에게 명확한 선택지를 제공합니다.

