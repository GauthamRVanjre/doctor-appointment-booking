import type { LlmTool } from 'agora-agents';

export function bookingTools(baseUrl: string, toolToken: string): LlmTool[] {
  const text = (description: string) => ({ type: 'string', description });
  const definitions = [
    { name: 'findDoctors', description: 'Look up the configured fictional doctor for the patient concern. Use for every new concern, including emergencies. No match means no supported service.',
      properties: { concern: text('Patient concern, 1–500 characters.') }, required: ['concern'] },
    { name: 'getAvailableSlots', description: 'Read actual availability. If slots is empty, explain reason and offer the returned alternatives. Never invent slots.',
      properties: { doctor_id: text('Configured doctor ID.'), start_date: text('YYYY-MM-DD within seven local days, or empty string for the default window.'), end_date: text('YYYY-MM-DD within seven local days, or empty string for the default window.'), preferred_time: text('HH:mm in Asia/Kolkata, or empty string for any time.') }, required: ['doctor_id', 'start_date', 'end_date', 'preferred_time'] },
    { name: 'bookAppointment', description: 'Request review of an exact server-returned slot. Returns ON_SCREEN_APPROVAL_REQUIRED until the patient explicitly confirms in the UI. This tool cannot approve. Success is returned only for an already committed matching booking. Call after any change to selected details.',
      properties: { doctor_id: text('Configured doctor ID.'), slot_id: text('Exact server-returned slot ID.'), demo_alias: { type: 'string', enum: ['Demo Patient', 'Demo Guest'] } }, required: ['doctor_id', 'slot_id', 'demo_alias'] },
  ];
  return definitions.map(d => ({ type: 'function', function: { name: d.name, description: d.description,
    parameters: { type: 'object', properties: d.properties, required: d.required, additionalProperties: false },
  }, execution: { mode: 'sync' }, server: {
    method: 'POST', url: `${baseUrl}/api/booking/tools`,
    headers: { Authorization: `Bearer ${toolToken}`, 'Content-Type': 'application/json' },
    body: { tool: d.name, input: Object.fromEntries(Object.keys(d.properties).map(key => [key, `{{args.${key}}}`])) },
    timeout_ms: 10000,
  } }));
}

export function toolsBaseUrl(): string {
  const value = process.env.BOOKING_TOOLS_BASE_URL;
  if (!value) throw new Error('BOOKING_TOOLS_BASE_URL is required. Authorize and configure the tools-only HTTPS gateway first.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('BOOKING_TOOLS_BASE_URL must be an HTTPS origin.');
  return url.origin;
}
