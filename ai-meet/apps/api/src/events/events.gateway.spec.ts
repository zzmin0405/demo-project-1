import { EventsGateway } from './events.gateway';

describe('EventsGateway broadcast gating', () => {
  const createClient = (canBroadcast: boolean) => {
    const emit = jest.fn();
    const client = {
      id: 'socket-1',
      rooms: new Set(['socket-1', 'room-1']),
      handshake: { auth: { token: 'user-1' } },
      user: { sub: 'user-1' },
      emit,
      to: jest.fn(() => ({ emit })),
    };

    const gateway = new EventsGateway({} as any);
    (gateway as any).roomToUsers.set(
      'room-1',
      new Map([
        [
          'socket-1',
          {
            userId: 'user-1',
            username: 'User 1',
            hasVideo: canBroadcast,
            isMuted: !canBroadcast,
            canBroadcast,
          },
        ],
      ]),
    );

    return { gateway, client: client as any, emit };
  };

  it('relays presenter media chunks', () => {
    const { gateway, client, emit } = createClient(true);

    gateway.handleMediaChunk(client, {
      chunk: Buffer.from('media'),
      mimeType: 'video/webm; codecs=vp8,opus',
      timestamp: 123,
    });

    expect(client.to).toHaveBeenCalledWith('room-1');
    expect(emit).toHaveBeenCalledWith('media-chunk', expect.objectContaining({
      socketId: 'socket-1',
      userId: 'user-1',
      mimeType: 'video/webm; codecs=vp8,opus',
      timestamp: 123,
    }));
  });

  it('drops receive-only attendee media chunks', () => {
    const { gateway, client, emit } = createClient(false);

    gateway.handleMediaChunk(client, {
      chunk: Buffer.from('media'),
      mimeType: 'video/webm; codecs=vp8,opus',
      timestamp: 123,
    });

    expect(client.to).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('falls back to browser STT when Deepgram is not configured', () => {
    const originalKey = process.env.DEEPGRAM_API_KEY;
    delete process.env.DEEPGRAM_API_KEY;
    const { gateway, client, emit } = createClient(true);

    gateway.handleSubtitleSttStart(client, {
      roomId: 'room-1',
      sourceLang: 'ko-KR',
    });

    expect(emit).toHaveBeenCalledWith('stt-provider-state', {
      provider: 'browser',
      enabled: false,
      reason: 'missing-deepgram-key',
    });
    if (originalKey === undefined) {
      delete process.env.DEEPGRAM_API_KEY;
    } else {
      process.env.DEEPGRAM_API_KEY = originalKey;
    }
  });

  it('tracks requested subtitle languages per room', () => {
    const { gateway, client } = createClient(true);

    gateway.handleSubtitleLanguageChanged(client, {
      roomId: 'room-1',
      lang: 'ko',
    });

    expect((gateway as any).getRequestedSubtitleLanguages('room-1')).toEqual(['ko']);
  });
});
