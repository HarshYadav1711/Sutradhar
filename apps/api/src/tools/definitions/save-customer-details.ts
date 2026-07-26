import { z } from 'zod';

import { DomainNotFoundError } from '../../domain/errors.js';
import type { AgentTool } from '../types.js';

const inputSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    preferredLanguage: z.string().trim().min(2).max(32).optional(),
    defaultAddress: z.string().trim().min(3).max(300).optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.preferredLanguage !== undefined ||
      value.defaultAddress !== undefined,
    { message: 'At least one customer field is required' },
  );

export const saveCustomerDetailsTool: AgentTool<typeof inputSchema, unknown> = {
  name: 'save_customer_details',
  description: 'Update validated customer profile fields without clearing known values with empty data.',
  inputSchema,
  async execute(input, context) {
    const existing = await context.db.customer.findUnique({
      where: { id: context.customerId },
    });

    if (!existing) {
      throw new DomainNotFoundError('Customer not found');
    }

    const data: {
      name?: string;
      preferredLanguage?: string;
      defaultAddress?: string;
    } = {};

    if (input.name !== undefined && input.name.trim() !== '') {
      data.name = input.name.trim();
    }
    if (input.preferredLanguage !== undefined && input.preferredLanguage.trim() !== '') {
      data.preferredLanguage = input.preferredLanguage.trim();
    }
    if (input.defaultAddress !== undefined && input.defaultAddress.trim() !== '') {
      data.defaultAddress = input.defaultAddress.trim();
    }

    const updated = await context.db.customer.update({
      where: { id: existing.id },
      data,
    });

    return {
      id: updated.id,
      whatsappNumber: updated.whatsappNumber,
      name: updated.name,
      preferredLanguage: updated.preferredLanguage,
      defaultAddress: updated.defaultAddress,
      updatedFields: Object.keys(data),
    };
  },
};
