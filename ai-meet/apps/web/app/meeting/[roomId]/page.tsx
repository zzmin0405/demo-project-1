import MeetingClient from './meeting-client';

export const runtime = 'nodejs';

export default async function MeetingPage({
  params
}: {
  params: Promise<{ roomId: string }>
}) {
  const { roomId } = await params;
  return <MeetingClient roomId={roomId} />;
}