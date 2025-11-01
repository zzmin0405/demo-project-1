import MeetingClient from './meeting-client';

export default async function MeetingPage({ params }: { params: { roomId: string } }) {
  const resolvedParams = await params; // Await the params object
  return <MeetingClient roomId={resolvedParams.roomId} />;
}
