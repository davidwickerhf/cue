import type { MethodName } from "../../electron/control/contract";
import { keyLabel } from "./platform";

/** Runs a method as the user and surfaces failures as toasts instead of throwing. */
export async function run<T = unknown>(
	method: MethodName,
	params?: unknown,
): Promise<T | undefined> {
	try {
		return await window.cue.call<T>(method, params);
	} catch (error) {
		notify(
			(error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""),
			"danger",
		);
		return undefined;
	}
}

type Tone = "default" | "success" | "danger";
type Listener = (message: string, tone: Tone) => void;
const listeners = new Set<Listener>();

export function notify(message: string, tone: Tone = "default") {
	for (const listener of listeners) listener(keyLabel(message), tone);
}

export function onNotify(listener: Listener) {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
