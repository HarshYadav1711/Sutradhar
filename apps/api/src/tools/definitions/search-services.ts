import { z } from 'zod';

import type { AgentTool } from '../types.js';

const inputSchema = z.object({
  query: z.string().trim().min(1).max(200).optional(),
});

export type SearchServicesInput = z.infer<typeof inputSchema>;

export const searchServicesTool: AgentTool<typeof inputSchema, unknown> = {
  name: 'search_services',
  description: 'Search active configured services and return real catalogue entries with prices.',
  inputSchema,
  async execute(input, context) {
    const services = await context.db.service.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
    });

    const query = input.query?.toLowerCase();
    const matched = query
      ? services.filter((service) => {
          const haystack = `${service.name} ${service.slug} ${service.description}`.toLowerCase();
          return haystack.includes(query);
        })
      : services;

    return {
      services: matched.map((service) => ({
        id: service.id,
        name: service.name,
        slug: service.slug,
        description: service.description,
        basePriceMinor: service.basePriceMinor,
        estimatedDurationMinutes: service.estimatedDurationMinutes,
        currency: context.currency ?? 'INR',
      })),
      count: matched.length,
    };
  },
};
