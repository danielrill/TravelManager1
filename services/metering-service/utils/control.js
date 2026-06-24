// Control state for the usage consumer (surfaced at GET /api/control).
export const control = {
  usage: { processed: 0, duplicates: 0, errors: 0, lastMessageAt: null, subscriberUp: false },
}
