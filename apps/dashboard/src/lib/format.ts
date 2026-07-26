type CustomerSummary = {
  id: string;
  whatsappNumber: string | null;
  name: string | null;
};

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const DATE_TIME = new Intl.DateTimeFormat('en-IN', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Kolkata',
});

export function formatInrFromMinor(minor: number): string {
  return INR.format(minor / 100);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return DATE_TIME.format(date);
}

export function maskCustomerLabel(customer: CustomerSummary): string {
  if (customer.name && customer.name.trim() !== '') {
    return customer.name.trim();
  }
  return maskPhone(customer.whatsappNumber);
}

export function maskPhone(value: string | null | undefined): string {
  if (!value || value.trim() === '') {
    return 'Unknown customer';
  }
  const digits = value.replace(/\D/g, '');
  if (digits.length < 4) {
    return '••••';
  }
  return `••••${digits.slice(-4)}`;
}

export function humanizeStatus(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function humanizeEventType(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
