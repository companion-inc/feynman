// Types
export interface ActivityEntry {
	id: string;
	type: "api" | "fetch";
	startTime: number;
	endTime?: number;

	// For API calls
	query?: string;

	// For URL fetches
	url?: string;

	// Result - status is number (HTTP code) or null (pending/network error)
	status: number | null;
	error?: string;
}

export interface RateLimitInfo {
	used: number;
	max: number;
	oldestTimestamp: number | null;
	windowMs: number;
}

export class ActivityMonitor {
	private entries: ActivityEntry[] = [];
	private readonly maxEntries = 10;
	private listeners = new Set<() => void>();
	private rateLimitInfo: RateLimitInfo = { used: 0, max: 10, oldestTimestamp: null, windowMs: 60000 };
	private nextId = 1;

	logStart(partial: Omit<ActivityEntry, "id" | "startTime" | "status">): string {
		const id = `act-${this.nextId++}`;
		const entry: ActivityEntry = {
			...partial,
			id,
			startTime: Date.now(),
			status: null,
		};
		this.entries.push(entry);
		if (this.entries.length > this.maxEntries) {
			this.entries.shift();
		}
		this.notify();
		return id;
	}

	logComplete(id: string, status: number): void {
		const entry = this.entries.find((e) => e.id === id);
		if (entry) {
			entry.endTime = Date.now();
			entry.status = status;
			this.notify();
		}
	}

	logError(id: string, error: string): void {
		const entry = this.entries.find((e) => e.id === id);
		if (entry) {
			entry.endTime = Date.now();
			entry.error = error;
			this.notify();
		}
	}

	getEntries(): readonly ActivityEntry[] {
		return this.entries;
	}

	getRateLimitInfo(): RateLimitInfo {
		return this.rateLimitInfo;
	}

	updateRateLimit(info: RateLimitInfo): void {
		this.rateLimitInfo = info;
		this.notify();
	}

	onUpdate(callback: () => void): () => void {
		this.listeners.add(callback);
		return () => this.listeners.delete(callback);
	}

	clear(): void {
		this.entries = [];
		this.rateLimitInfo = { used: 0, max: 10, oldestTimestamp: null, windowMs: 60000 };
		this.notify();
	}

	private notify(): void {
		for (const cb of this.listeners) {
			try {
				cb();
			} catch {
			}
		}
	}
}

export const activityMonitor = new ActivityMonitor();
