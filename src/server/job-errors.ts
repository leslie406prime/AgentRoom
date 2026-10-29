// Messages of this error type are safe to show to channel members. When releaseUsage is true the provider
// never consumed tokens, so the quota reservation is released instead of retained.
export class PublicJobError extends Error { constructor(message: string, public releaseUsage = false) { super(message); } }
