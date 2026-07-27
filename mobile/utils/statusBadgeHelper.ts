import type { StatusType } from '../components/ui/StatusBadge';
import { colors } from '../constants';

export function getStatusColor(status: StatusType): string {
  switch (status) {
    case 'Pending':
    case 'Pending KYC':
      return colors.warning;
    case 'Accepted':
      return colors.active;
    case 'Active':
      return colors.brand.DEFAULT;
    case 'Completed':
    case 'Credited':
    case 'Verified':
      return colors.success;
    case 'Cancelled':
      return colors.error;
    default:
      return colors.text.muted;
  }
}
