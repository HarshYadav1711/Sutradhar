export type NormalizedWhatsAppTextMessage = {
  kind: 'text_message';
  externalKey: string;
  externalMessageId: string;
  waId: string;
  profileName: string | null;
  text: string;
  timestamp: string | null;
  phoneNumberId: string | null;
  metadata: Record<string, unknown>;
};

export type NormalizedWhatsAppUnsupportedMessage = {
  kind: 'unsupported_message';
  externalKey: string;
  externalMessageId: string;
  waId: string;
  profileName: string | null;
  messageType: string;
  timestamp: string | null;
  phoneNumberId: string | null;
  metadata: Record<string, unknown>;
};

export type NormalizedWhatsAppStatusEvent = {
  kind: 'status_event';
  externalKey: string;
  statusId: string;
  status: string;
  recipientId: string | null;
  timestamp: string | null;
  metadata: Record<string, unknown>;
};

export type NormalizedWhatsAppIgnored = {
  kind: 'ignored';
  externalKey: string;
  reason: string;
  metadata: Record<string, unknown>;
};

export type NormalizedWhatsAppEvent =
  | NormalizedWhatsAppTextMessage
  | NormalizedWhatsAppUnsupportedMessage
  | NormalizedWhatsAppStatusEvent
  | NormalizedWhatsAppIgnored;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * Normalises Meta WhatsApp Cloud API webhook payloads into typed events.
 * Unknown shapes are ignored without throwing.
 */
export function normalizeWhatsAppWebhookPayload(payload: unknown): NormalizedWhatsAppEvent[] {
  const root = asRecord(payload);
  if (!root) {
    return [
      {
        kind: 'ignored',
        externalKey: `ignored:invalid-root:${Date.now()}`,
        reason: 'payload_not_object',
        metadata: {},
      },
    ];
  }

  if (root.object !== 'whatsapp_business_account') {
    return [
      {
        kind: 'ignored',
        externalKey: `ignored:object:${String(root.object ?? 'missing')}`,
        reason: 'unexpected_object',
        metadata: { object: root.object ?? null },
      },
    ];
  }

  const events: NormalizedWhatsAppEvent[] = [];

  for (const entry of asArray(root.entry)) {
    const entryRecord = asRecord(entry);
    if (!entryRecord) {
      continue;
    }

    for (const change of asArray(entryRecord.changes)) {
      const changeRecord = asRecord(change);
      if (!changeRecord) {
        continue;
      }

      const value = asRecord(changeRecord.value);
      if (!value) {
        continue;
      }

      const metadata = asRecord(value.metadata) ?? {};
      const phoneNumberId = asString(metadata.phone_number_id);
      const contacts = asArray(value.contacts);
      const profileNameByWaId = new Map<string, string>();
      for (const contact of contacts) {
        const contactRecord = asRecord(contact);
        if (!contactRecord) {
          continue;
        }
        const waId = asString(contactRecord.wa_id);
        const profile = asRecord(contactRecord.profile);
        const name = profile ? asString(profile.name) : null;
        if (waId && name) {
          profileNameByWaId.set(waId, name);
        }
      }

      for (const message of asArray(value.messages)) {
        const messageRecord = asRecord(message);
        if (!messageRecord) {
          continue;
        }

        const externalMessageId = asString(messageRecord.id);
        const waId = asString(messageRecord.from);
        const messageType = asString(messageRecord.type) ?? 'unknown';
        const timestamp = asString(messageRecord.timestamp);

        if (!externalMessageId || !waId) {
          events.push({
            kind: 'ignored',
            externalKey: `ignored:message-missing-ids:${Date.now()}:${events.length}`,
            reason: 'message_missing_ids',
            metadata: { messageType },
          });
          continue;
        }

        const safeMetadata = {
          phoneNumberId,
          messageType,
          timestamp,
        };

        if (messageType === 'text') {
          const textRecord = asRecord(messageRecord.text);
          const text = textRecord ? asString(textRecord.body) : null;
          if (!text) {
            events.push({
              kind: 'unsupported_message',
              externalKey: `msg:${externalMessageId}`,
              externalMessageId,
              waId,
              profileName: profileNameByWaId.get(waId) ?? null,
              messageType: 'text_empty',
              timestamp,
              phoneNumberId,
              metadata: safeMetadata,
            });
            continue;
          }

          events.push({
            kind: 'text_message',
            externalKey: `msg:${externalMessageId}`,
            externalMessageId,
            waId,
            profileName: profileNameByWaId.get(waId) ?? null,
            text,
            timestamp,
            phoneNumberId,
            metadata: safeMetadata,
          });
          continue;
        }

        events.push({
          kind: 'unsupported_message',
          externalKey: `msg:${externalMessageId}`,
          externalMessageId,
          waId,
          profileName: profileNameByWaId.get(waId) ?? null,
          messageType,
          timestamp,
          phoneNumberId,
          metadata: safeMetadata,
        });
      }

      for (const status of asArray(value.statuses)) {
        const statusRecord = asRecord(status);
        if (!statusRecord) {
          continue;
        }

        const statusId = asString(statusRecord.id);
        const statusValue = asString(statusRecord.status) ?? 'unknown';
        if (!statusId) {
          events.push({
            kind: 'ignored',
            externalKey: `ignored:status-missing-id:${Date.now()}:${events.length}`,
            reason: 'status_missing_id',
            metadata: { status: statusValue },
          });
          continue;
        }

        events.push({
          kind: 'status_event',
          externalKey: `status:${statusId}:${statusValue}`,
          statusId,
          status: statusValue,
          recipientId: asString(statusRecord.recipient_id),
          timestamp: asString(statusRecord.timestamp),
          metadata: {
            conversation: statusRecord.conversation ?? null,
            pricing: statusRecord.pricing ?? null,
          },
        });
      }
    }
  }

  if (events.length === 0) {
    events.push({
      kind: 'ignored',
      externalKey: `ignored:empty:${Date.now()}`,
      reason: 'no_supported_events',
      metadata: {},
    });
  }

  return events;
}
