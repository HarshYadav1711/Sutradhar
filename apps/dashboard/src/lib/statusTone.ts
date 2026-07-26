export type StatusTone = 'default' | 'ok' | 'warn' | 'danger' | 'accent';

export function conversationStatusTone(status: string): StatusTone {
  switch (status) {
    case 'BOOKED':
      return 'ok';
    case 'AWAITING_BOOKING_CONFIRMATION':
    case 'AWAITING_RESCHEDULE_CONFIRMATION':
    case 'COLLECTING_BOOKING_DETAILS':
      return 'warn';
    case 'HANDED_OFF':
      return 'danger';
    case 'CLOSED':
      return 'default';
    default:
      return 'accent';
  }
}

export function handoffStatusTone(status: string): StatusTone {
  switch (status) {
    case 'OPEN':
      return 'danger';
    case 'IN_PROGRESS':
      return 'warn';
    case 'RESOLVED':
      return 'ok';
    default:
      return 'default';
  }
}

export function toolStatusTone(status: string): StatusTone {
  switch (status) {
    case 'SUCCESS':
      return 'ok';
    case 'VALIDATION_ERROR':
      return 'warn';
    case 'ERROR':
      return 'danger';
    default:
      return 'default';
  }
}
