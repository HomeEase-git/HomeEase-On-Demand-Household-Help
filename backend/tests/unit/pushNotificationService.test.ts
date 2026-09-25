const mockFindUnique = jest.fn();
const mockUpdate = jest.fn();

jest.mock('@config/database', () => ({
  __esModule: true,
  default: { user: { findUnique: mockFindUnique, update: mockUpdate } },
}));

import { sendPushToUser } from '../../src/services/pushNotificationService';

const fetchMock = jest.fn();

function sentBody(): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[0];
  return JSON.parse(init.body as string);
}

describe('sendPushToUser Android channel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindUnique.mockResolvedValue({ pushToken: 'ExponentPushToken[abc123]' });
    fetchMock.mockResolvedValue({ json: async () => ({ data: { status: 'ok', id: 't1' } }) });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it.each([
    ['BOOKING_REQUEST', 'new-job'],
    ['MESSAGE_RECEIVED', 'messages'],
    ['BOOKING_ACCEPTED', 'bookings'],
  ])('sends %s on the %s channel', async (type, channelId) => {
    await sendPushToUser({ userId: 'u1', title: 't', body: 'b', data: { notificationId: 'n1', type } });
    expect(sentBody()).toMatchObject({ channelId, sound: 'default', data: { type } });
  });

  it('leaves other types on the default channel', async () => {
    await sendPushToUser({ userId: 'u1', title: 't', body: 'b', data: { type: 'PAYOUT_SENT' } });
    expect(sentBody()).not.toHaveProperty('channelId');
  });

  it('handles a push with no data', async () => {
    await sendPushToUser({ userId: 'u1', title: 't', body: 'b' });
    expect(sentBody()).not.toHaveProperty('channelId');
  });
});
