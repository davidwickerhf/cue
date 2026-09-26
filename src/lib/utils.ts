import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

/** 83450 → "1:23.4" (or "1:23:04" frames when fps is given). */
export function formatTime(ms: number, precise = true): string {
	const safe = Math.max(0, ms);
	const minutes = Math.floor(safe / 60000);
	const seconds = Math.floor((safe % 60000) / 1000);
	const tenths = Math.floor((safe % 1000) / 100);
	return `${minutes}:${String(seconds).padStart(2, "0")}${precise ? `.${tenths}` : ""}`;
}

export function formatSeconds(ms: number | null | undefined, digits = 1): string {
	if (ms === null || ms === undefined) return "—";
	return `${(ms / 1000).toFixed(digits)} s`;
}

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
