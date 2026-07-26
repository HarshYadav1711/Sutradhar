import { z } from 'zod';

import { DomainNotFoundError } from '../../domain/errors.js';
import type { AgentTool } from '../types.js';

const inputSchema = z.object({}).strict();

export const getCustomerProfileTool: AgentTool<typeof inputSchema, unknown> = {
  name: 'get_customer_profile',
  description: 'Load the current customer profile for this conversation.',
  inputSchema,
  async execute(_input, context) {
    const customer = await context.db.customer.findUnique({
      where: { id: context.customerId },
    });

    if (!customer) {
      throw new DomainNotFoundError('Customer not found');
    }

    return {
      id: customer.id,
      whatsappNumber: customer.whatsappNumber,
      name: customer.name,
      preferredLanguage: customer.preferredLanguage,
      defaultAddress: customer.defaultAddress,
    };
  },
};
