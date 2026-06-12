import { Captions, Languages, Mic, PanelRight, Radio, Users, Video } from "lucide-react";

const liveCaption = {
  speaker: "김민재",
  ko: "오늘 발표에서는 실시간 번역 자막과 회의 기록이 어떻게 연결되는지 보여드리겠습니다.",
  en: "In today's presentation, I will show how live translated captions connect with meeting records.",
  ja: "本日の発表では、リアルタイム翻訳字幕と会議記録がどのようにつながるかを紹介します。",
  zh: "今天的演示将展示实时翻译字幕如何与会议记录连接起来。",
};

const transcriptItems = [
  {
    time: "10:31",
    speaker: "김민재",
    ko: "이 플랫폼은 Next.js와 NestJS 기반의 실시간 번역 화상회의 서비스입니다.",
    en: "This platform is a real-time translated video meeting service built with Next.js and NestJS.",
  },
  {
    time: "10:32",
    speaker: "김민재",
    ko: "WebSocket을 사용해서 참가자 상태, 채팅, 자막, 번역 결과를 즉시 동기화합니다.",
    en: "WebSocket synchronizes participant state, chat, captions, and translation results instantly.",
  },
  {
    time: "10:33",
    speaker: "김민재",
    ko: "중앙 자막은 발표 흐름을 돕고, 오른쪽 패널은 놓친 내용을 다시 확인하는 기록 역할을 합니다.",
    en: "The center caption supports the presentation flow, while the right panel keeps a reviewable transcript.",
  },
  {
    time: "10:34",
    speaker: "이수진",
    ko: "회의가 끝난 뒤에는 누적된 자막 기록을 요약 기능과 연결할 수 있습니다.",
    en: "After the meeting, the accumulated caption history can be connected to summarization.",
  },
];

const languages = [
  { code: "KO", text: liveCaption.ko, className: "border-cyan-300/30 text-white" },
  { code: "EN", text: liveCaption.en, className: "border-amber-300/25 text-amber-100" },
  { code: "JA", text: liveCaption.ja, className: "border-emerald-300/25 text-emerald-100" },
  { code: "ZH", text: liveCaption.zh, className: "border-rose-300/25 text-rose-100" },
];

function ParticipantTile({
  name,
  active = false,
  muted = false,
}: {
  name: string;
  active?: boolean;
  muted?: boolean;
}) {
  return (
    <div className={`relative h-full min-w-44 overflow-hidden rounded-lg border bg-zinc-950 ${active ? "border-emerald-300/55 shadow-[0_0_24px_rgba(52,211,153,0.22)]" : "border-white/10"}`}>
      <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_center,#293142,#0c111c_70%)]">
        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/15 bg-white/10 text-lg font-semibold text-white">
          {name[0]}
        </div>
      </div>
      <div className="absolute bottom-2 left-2 rounded-md bg-black/55 px-2 py-1 text-xs font-medium text-white backdrop-blur">
        {name} {muted ? "· 음소거" : "· 발화 중"}
      </div>
    </div>
  );
}

function MeetingStage() {
  return (
    <section className="relative h-[620px] overflow-hidden bg-[#101725]">
      <div className="absolute inset-0 opacity-[0.18] [background-image:linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:44px_44px]" />
      <div className="relative flex h-full flex-col p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/25 px-3 py-1.5 text-sm font-medium text-white/75">
            <Video className="h-4 w-4" />
            AI Meet 발표 회의
          </div>
          <div className="flex items-center gap-2 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1.5 text-sm font-semibold text-emerald-100">
            <Radio className="h-4 w-4" />
            발표자 모드
          </div>
        </div>

        <div className="mt-4 flex min-h-0 flex-1 flex-col gap-3">
          <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-white/10 bg-black shadow-2xl">
            <div className="flex h-full min-h-[410px] items-center justify-center bg-[radial-gradient(circle_at_center,#384255,#0b0f19_68%)]">
              <div className="flex h-40 w-40 items-center justify-center rounded-full border border-white/15 bg-white/10 text-5xl font-semibold text-white shadow-2xl">
                김
              </div>
            </div>

            <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white shadow-lg">
              <Mic className="h-3.5 w-3.5" />
              말하는 중
            </div>

            <div className="absolute bottom-5 left-5 rounded-lg bg-black/55 px-3 py-2 text-sm font-semibold text-white backdrop-blur">
              김민재 · 발표자
            </div>

            <div className="pointer-events-none absolute inset-x-0 bottom-14 flex justify-center px-8">
              <div className="w-full max-w-3xl rounded-lg border border-white/15 bg-black/85 px-6 py-4 text-center shadow-2xl backdrop-blur-md">
                <div className="mb-2 flex items-center justify-center gap-2 text-xs text-white/50">
                  <Captions className="h-3.5 w-3.5" />
                  <span className="font-semibold text-white/75">{liveCaption.speaker}</span>
                  <span className="h-1 w-1 rounded-full bg-white/25" />
                  <span>실시간 번역 자막</span>
                  <span className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-2 py-0.5 font-mono text-emerald-100">420ms</span>
                </div>
                <p className="text-2xl font-semibold leading-snug text-white">{liveCaption.ko}</p>
                <p className="mx-auto mt-2 max-w-2xl text-sm leading-snug text-amber-100/80">{liveCaption.en}</p>
              </div>
            </div>
          </div>

          <div className="flex h-28 gap-3 overflow-hidden">
            <ParticipantTile name="이수진" muted />
            <ParticipantTile name="박준호" muted />
            <ParticipantTile name="김민재" active />
          </div>
        </div>
      </div>
    </section>
  );
}

function TranscriptPanel() {
  return (
    <aside className="flex h-[620px] flex-col border-l border-white/10 bg-[#0d1320] text-white">
      <div className="border-b border-white/10 px-5 py-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold">실시간 번역 기록</div>
            <div className="mt-1 text-xs text-white/45">놓친 발화를 스크롤로 다시 확인</div>
          </div>
          <PanelRight className="h-4 w-4 text-white/45" />
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {transcriptItems.map((item) => (
          <div key={`${item.time}-${item.speaker}`} className="rounded-lg border border-white/10 bg-white/[0.045] p-3">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-semibold text-cyan-100">{item.speaker}</span>
              <span className="font-mono text-white/40">{item.time}</span>
            </div>
            <p className="text-sm font-medium leading-snug text-white">{item.ko}</p>
            <p className="mt-1.5 text-xs leading-snug text-amber-100/75">{item.en}</p>
          </div>
        ))}
      </div>

      <div className="border-t border-white/10 px-5 py-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-white/65">
          <Languages className="h-3.5 w-3.5" />
          4개 언어 상세 보기
        </div>
        <div className="space-y-2">
          {languages.map((row) => (
            <div key={row.code} className={`rounded-lg border bg-black/20 px-3 py-2 ${row.className}`}>
              <div className="mb-1 text-[10px] font-bold text-white/45">{row.code}</div>
              <p className="text-xs leading-snug">{row.text}</p>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

export default function SubtitlePreviewPage() {
  return (
    <main className="min-h-screen bg-[#080b10] px-6 py-8 text-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="flex items-end justify-between border-b border-white/10 pb-5">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1.5 text-xs font-semibold text-cyan-100">
              <Users className="h-3.5 w-3.5" />
              최종 예상 결과물
            </div>
            <h1 className="text-3xl font-semibold tracking-normal">실시간 번역 화상회의 플랫폼</h1>
            <p className="mt-2 text-sm text-white/55">
              발표자 중심 화면, 실시간 번역 자막, 누적 번역 기록을 하나의 회의 UI로 통합한 화면입니다.
            </p>
          </div>
          <div className="hidden rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-right text-sm text-white/60 md:block">
            Next.js · NestJS · Monorepo · WebSocket
          </div>
        </header>

        <section className="overflow-hidden rounded-lg border border-white/10 bg-[#0b101a] shadow-2xl">
          <div className="grid items-start lg:grid-cols-[1fr_380px]">
            <MeetingStage />
            <TranscriptPanel />
          </div>
        </section>
      </div>
    </main>
  );
}
