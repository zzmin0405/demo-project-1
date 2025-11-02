import MeetingClient from './meeting-client';

export default function MeetingPage({ params }: { params: { roomId: string } }) {
  return <MeetingClient roomId={params.roomId} />;
}
