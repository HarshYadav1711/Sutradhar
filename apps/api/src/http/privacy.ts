/**
 * Privacy helpers for operator API responses.
 * Mask WhatsApp identifiers in list views; keep full values only where operationally needed.
 */

export function maskWhatsAppNumber(value: string | null | undefined): string | null {
  if (!value || value.trim() === '') {
    return null;
  }
  const digits = value.replace(/\D/g, '');
  if (digits.length < 4) {
    return '••••';
  }
  return `••••${digits.slice(-4)}`;
}

export function toOperatorCustomerSummary(
  customer: { id: string; whatsappNumber: string | null; name: string | null },
  options: { maskWhatsApp: boolean },
): { id: string; whatsappNumber: string | null; name: string | null } {
  return {
    id: customer.id,
    name: customer.name,
    whatsappNumber: options.maskWhatsApp
      ? maskWhatsAppNumber(customer.whatsappNumber)
      : customer.whatsappNumber,
  };
}
