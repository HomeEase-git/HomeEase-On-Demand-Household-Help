import { renderHook, act } from '@testing-library/react-native';

jest.mock('../../services/api', () => ({
  reportMessage: jest.fn(),
  blockUser: jest.fn(),
  unblockUser: jest.fn(),
}));
const mockAlert = { showAlert: jest.fn(), confirm: jest.fn(), success: jest.fn(), info: jest.fn(), error: jest.fn() };
jest.mock('../../contexts/AlertModalContext', () => ({ useAlertModal: () => mockAlert }));

import * as api from '../../services/api';
import { useChatSafety } from '../useChatSafety';

const press = (text: string) => {
  const { buttons } = mockAlert.showAlert.mock.calls.at(-1)[0];
  return buttons.find((b: { text: string }) => b.text === text).onPress();
};

beforeEach(() => jest.clearAllMocks());

it('reports a message with the picked reason', async () => {
  (api.reportMessage as jest.Mock).mockResolvedValue({});
  const { result } = await renderHook(() => useChatSafety('u1', 'Maria'));
  await act(async () => { result.current.reportMessage('m1'); });
  await act(async () => { await press('Harassment'); });
  expect(api.reportMessage).toHaveBeenCalledWith('m1', 'Harassment');
  expect(mockAlert.success).toHaveBeenCalled();
});

it('says so when the message was already reported', async () => {
  (api.reportMessage as jest.Mock).mockRejectedValue({ isAxiosError: true, response: { status: 409 } });
  const { result } = await renderHook(() => useChatSafety('u1', 'Maria'));
  await act(async () => { result.current.reportMessage('m1'); });
  await act(async () => { await press('Spam'); });
  expect(mockAlert.info).toHaveBeenCalledWith('Already reported', expect.any(String));
});

it('blocks after confirming, then offers unblock', async () => {
  (api.blockUser as jest.Mock).mockResolvedValue({});
  const { result } = await renderHook(() => useChatSafety('u1', 'Maria'));
  await act(async () => { result.current.openMenu(); });
  await act(async () => { await mockAlert.confirm.mock.calls.at(-1)[2].onConfirm(); });
  expect(api.blockUser).toHaveBeenCalledWith('u1');
  expect(result.current.blockedByMe).toBe(true);

  (api.unblockUser as jest.Mock).mockResolvedValue({});
  await act(async () => { result.current.openMenu(); });
  await act(async () => { await mockAlert.confirm.mock.calls.at(-1)[2].onConfirm(); });
  expect(api.unblockUser).toHaveBeenCalledWith('u1');
  expect(result.current.blockedByMe).toBe(false);
});
