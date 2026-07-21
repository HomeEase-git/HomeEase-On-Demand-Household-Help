import { useMemo } from 'react';
import { useBookingStore } from '../store/bookingStore';
import { isValidHHmm } from '../utils/time';

type Args = { workerId?: string | null; date?: string | null; time?: string | null; category?: string | null };

export function useBookingAvailability({ workerId, date, time, category }: Args) {
  const bookings = useBookingStore((s) => s.bookings);

  return useMemo(() => {
    const warnings: string[] = [];
    let workerOk = true;
    let dateOk = true;
    let timeOk = true;
    let blockSubmit = false;

    if (!workerId) {
      workerOk = false;
      warnings.push('No worker selected');
      blockSubmit = true;
    }

    if (!date) {
      dateOk = false;
      warnings.push('No date selected');
      blockSubmit = true;
    }

    if (!time) {
      timeOk = false;
      warnings.push('No time selected');
      blockSubmit = true;
    } else if (!isValidHHmm(time)) {
      timeOk = false;
      warnings.push('Selected time is invalid');
      blockSubmit = true;
    }

    // Basic capacity check placeholder: if workerId provided, check exact matches in bookings
    if (workerId && date && time) {
      const clash = bookings.find((b) => b.worker === workerId && b.date === date && b.time === time);
      if (clash) {
        workerOk = false;
        warnings.push('Worker already booked at this slot');
        blockSubmit = true;
      }
    }

    return { workerOk, dateOk, timeOk, warnings, blockSubmit };
  }, [workerId, date, time, category, bookings]);
}

export default useBookingAvailability;
