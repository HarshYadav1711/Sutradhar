export type BookingDetailField = 'service' | 'date' | 'timePreference' | 'address' | 'quantity';

export type BookingDetailsSnapshot = {
  serviceId?: string | null;
  requestedDate?: string | null;
  timePreference?: string | null;
  address?: string | null;
  quantity?: number | null;
};

/**
 * Returns which booking fields are still missing for a prepare_booking attempt.
 */
export function getMissingBookingFields(details: BookingDetailsSnapshot): BookingDetailField[] {
  const missing: BookingDetailField[] = [];

  if (!details.serviceId || details.serviceId.trim() === '') {
    missing.push('service');
  }
  if (!details.requestedDate || details.requestedDate.trim() === '') {
    missing.push('date');
  }
  if (!details.timePreference || details.timePreference.trim() === '') {
    missing.push('timePreference');
  }
  if (!details.address || details.address.trim().length < 3) {
    missing.push('address');
  }
  if (details.quantity === null || details.quantity === undefined || details.quantity < 1) {
    missing.push('quantity');
  }

  return missing;
}

export function promptForMissingBookingField(
  field: BookingDetailField,
  languageStyle: 'en' | 'hinglish' = 'en',
): string {
  if (languageStyle === 'hinglish') {
    switch (field) {
      case 'service':
        return 'Kaunsi service chahiye? Jaise AC servicing ya washing machine repair.';
      case 'date':
        return 'Kis date ke liye chahiye? Please YYYY-MM-DD ya kal/parso jaisa clear din batayein.';
      case 'timePreference':
        return 'Subah, dopahar, ya shaam — kaunsa time prefer karenge?';
      case 'address':
        return 'Service address batayein, jaise Sector 62, Noida.';
      case 'quantity':
        return 'Kitne units ke liye booking karni hai?';
    }
  }

  switch (field) {
    case 'service':
      return 'Which service do you need? For example, AC servicing or washing machine repair.';
    case 'date':
      return 'Which date works for you? Please share a clear day (we store it as YYYY-MM-DD).';
    case 'timePreference':
      return 'Do you prefer morning, afternoon, or evening?';
    case 'address':
      return 'What is the service address?';
    case 'quantity':
      return 'How many units should we book for?';
  }
}

export function firstMissingBookingPrompt(
  details: BookingDetailsSnapshot,
  languageStyle: 'en' | 'hinglish' = 'en',
): string | null {
  const missing = getMissingBookingFields(details);
  if (missing.length === 0) {
    return null;
  }
  return promptForMissingBookingField(missing[0]!, languageStyle);
}
