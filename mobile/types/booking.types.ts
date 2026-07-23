export type BookingStatus = 'Pending' | 'Active' | 'Completed' | 'Cancelled';

export type Booking = {
  id: string;
  service: string;
  worker: string;
  workerId?: string;
  date: string;
  time?: string;
  status: BookingStatus;
  amount: number;
  payment?: {
    methodType?: string;
    accountIdentifier?: string;
    status?: string;
    totalAmount?: number;
  };
  address?: string;
};
