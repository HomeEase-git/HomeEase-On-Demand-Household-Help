import dayjs from 'dayjs';

export function formatTime(date: string): string {
  return dayjs(date).format('h:mm A');
}
