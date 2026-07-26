import { checkAvailabilityTool } from './definitions/check-availability.js';
import { createHandoffTool } from './definitions/create-handoff.js';
import { getCustomerProfileTool } from './definitions/get-customer-profile.js';
import { prepareBookingTool } from './definitions/prepare-booking.js';
import { prepareRescheduleTool } from './definitions/prepare-reschedule.js';
import { saveCustomerDetailsTool } from './definitions/save-customer-details.js';
import { searchServicesTool } from './definitions/search-services.js';
import { ToolRegistry } from './registry.js';

export function createAgentToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(searchServicesTool);
  registry.register(checkAvailabilityTool);
  registry.register(getCustomerProfileTool);
  registry.register(saveCustomerDetailsTool);
  registry.register(prepareBookingTool);
  registry.register(prepareRescheduleTool);
  registry.register(createHandoffTool);
  return registry;
}

export const AGENT_TOOL_NAMES = [
  'search_services',
  'check_availability',
  'get_customer_profile',
  'save_customer_details',
  'prepare_booking',
  'prepare_reschedule',
  'create_handoff',
] as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

export { ToolRegistry } from './registry.js';
export type { ToolExecutionContext, ToolResult, AgentTool } from './types.js';
