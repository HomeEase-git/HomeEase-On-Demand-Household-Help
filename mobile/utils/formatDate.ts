import dayjs from 'dayjs';

export function formatDate(date: string, format = 'MMM D, YYYY'): string {
  return dayjs(date).format(format);
}
