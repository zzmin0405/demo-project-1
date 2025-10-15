import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function MeetingPage() {
  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      <header className="bg-card text-center p-4 text-xl font-bold border-b">
        AI-Meet
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Main Content - Video Grid */}
        <main className="flex-1 p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 overflow-y-auto">
          {/* Placeholder for video streams */}
          {[...Array(5)].map((_, i) => (
            <div key={i} className="bg-muted aspect-video rounded-lg flex items-center justify-center">
              <span className="text-muted-foreground">Participant {i + 1}</span>
            </div>
          ))}
          <div key="local" className="bg-primary text-primary-foreground aspect-video rounded-lg flex items-center justify-center border-2 border-ring">
            <span>You</span>
          </div>
        </main>

        {/* Sidebar - Chat/Participants */}
        <aside className="w-80 bg-card p-4 flex flex-col border-l">
          <h2 className="text-lg font-semibold mb-4">Chat</h2>
          <div className="flex-1 bg-muted rounded-lg p-2 mb-4 overflow-y-auto">
            {/* Placeholder for chat messages */}
            <p className="text-sm text-muted-foreground mb-2">[2:30 PM] Alice: Hello everyone!</p>
            <p className="text-sm text-muted-foreground mb-2">[2:31 PM] Bob: Hey Alice, how are you?</p>
          </div>
          <div className="flex">
            <Input
              type="text"
              placeholder="Type a message..."
              className="flex-1"
            />
            <Button>Send</Button>
          </div>
        </aside>

        {/* Controls Sidebar */}
        <div className="w-40 bg-background p-4 flex flex-col items-center justify-center space-y-4 border-l">
            <Button variant="secondary" className="w-full">Mute</Button>
            <Button variant="secondary" className="w-full">Stop Video</Button>
            <Button variant="secondary" className="w-full">Share Screen</Button>
            <Button variant="destructive" className="w-full">End Call</Button>
        </div>
      </div>
    </div>
  );
}
