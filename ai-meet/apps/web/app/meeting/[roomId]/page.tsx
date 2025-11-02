import MeetingClient from './meeting-client';

export const runtime = 'nodejs';

export default function MeetingPage({ params }: { params: { roomId: string } }) {
  return <MeetingClient roomId={params.roomId} />;
}
