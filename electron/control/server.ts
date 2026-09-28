import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import type { Controller } from "../controller";
import { usage } from "../core/usage";
import { contract, type MethodName } from "./contract";

export interface ControlInfo {
	port: number;
	token: string;
	pid: number;
	version: string;
}

/**
 * Loopback-only JSON API used by the MCP bridge. The port and a random token
 * are written to `control.json` (mode 600) in the app's data folder; requests
 * without the token are rejected.
 */
export async function startControlServer(
	controller: Controller,
	dataDir: string,
	version: string,
	enabled: () => boolean = () => true,
) {
	const token = randomBytes(24).toString("hex");
	/**
	 * Calls that outlast one request (exports, voiceovers, transcripts…) keep running
	 * here; the agent gets a call id and picks the result up with wait_for. Finished
	 * results are kept for ten minutes.
	 */
	const calls = new Map<
		string,
		{
			method: MethodName;
			startedAt: number;
			done: Promise<void>;
			outcome?: { result: unknown } | { error: string };
		}
	>();
	let callSeq = 0;
	const errorText = (error: unknown) => {
		const err = error as Error & { issues?: unknown };
		return err.issues ? `Invalid input: ${JSON.stringify(err.issues)}` : err.message;
	};
	/** Waits up to `waitMs` for a call; its reply, or a note that it is still running. */
	const settle = async (id: string, waitMs: number) => {
		const call = calls.get(id);
		if (!call)
			return { error: `No call "${id}" (results are kept for ten minutes after they finish).` };
		await Promise.race([call.done, new Promise((r) => setTimeout(r, waitMs))]);
		if (call.outcome) {
			calls.delete(id);
			return "error" in call.outcome
				? { error: call.outcome.error }
				: { result: call.outcome.result ?? null };
		}
		const job = controller.runningJob();
		return {
			result: {
				status: "running",
				callId: id,
				method: call.method,
				elapsedMs: Date.now() - call.startedAt,
				...(job ? { job: job.label, progress: job.progress } : {}),
				next: `Still working. Call wait_for {callId: "${id}"} to wait for the result (do not start it again).`,
			},
		};
	};
	const server = http.createServer(async (req, res) => {
		const reply = (status: number, body: unknown) => {
			res.writeHead(status, { "content-type": "application/json" });
			res.end(JSON.stringify(body));
		};
		if (req.headers.authorization !== `Bearer ${token}`)
			return reply(401, { error: "Unauthorised" });
		// Health answers even with agent access off, so the bridge sees Cue is running
		// (and reports the setting) instead of trying to launch it again.
		if (req.method === "GET" && req.url === "/health")
			return reply(200, { ok: true, version, enabled: enabled() });
		if (!enabled())
			return reply(403, { error: "Agent access is turned off in Cue → Settings → Agent." });
		if (req.method !== "POST" || req.url !== "/rpc") return reply(404, { error: "Not found" });
		let body = "";
		for await (const chunk of req) {
			body += chunk;
			if (body.length > 5_000_000) return reply(413, { error: "Request too large" });
		}
		try {
			const { method, params, waitMs } = JSON.parse(body) as {
				method: string;
				params?: unknown;
				waitMs?: number;
			};
			if (!(method in contract)) return reply(400, { error: `Unknown method ${method}` });
			controller.noteAgentRequest();
			usage.countTool(method);
			// Replies come within this time, so no client times out on a long call.
			const budget = Math.max(1000, Math.min(waitMs ?? 45000, 50000));
			if (method === "wait_for") {
				const { callId, waitMs: wait } = (params ?? {}) as { callId?: string; waitMs?: number };
				return reply(200, await settle(String(callId), Math.min(wait ?? budget, budget)));
			}
			// A misspelt parameter is an error, not silently dropped.
			const known = Object.keys(contract[method as MethodName].input);
			const unknown = Object.keys((params ?? {}) as object).filter((k) => !known.includes(k));
			if (unknown.length)
				return reply(200, {
					error: `Unknown parameter${unknown.length > 1 ? "s" : ""} ${unknown.map((k) => `"${k}"`).join(", ")} for ${method}. Its parameters are: ${known.join(", ") || "none"}.`,
				});
			const id = `call${++callSeq}`;
			const entry = {
				method: method as MethodName,
				startedAt: Date.now(),
				done: Promise.resolve(),
				outcome: undefined as { result: unknown } | { error: string } | undefined,
			};
			entry.done = controller
				.call(method as MethodName, params, "agent")
				.then(
					(result) => {
						entry.outcome = { result };
					},
					(error) => {
						entry.outcome = { error: errorText(error) };
					},
				)
				.then(() => {
					setTimeout(() => calls.delete(id), 600000);
				});
			calls.set(id, entry);
			reply(200, await settle(id, budget));
		} catch (error) {
			reply(200, { error: errorText(error) });
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const port = (server.address() as { port: number }).port;
	const info: ControlInfo = { port, token, pid: process.pid, version };
	const file = path.join(dataDir, "control.json");
	await fs.mkdir(dataDir, { recursive: true });
	await fs.writeFile(file, JSON.stringify(info), { mode: 0o600 });
	controller.agent = { ...controller.agent, controlPort: port };
	return {
		info,
		async close() {
			server.close();
			await fs.rm(file, { force: true });
		},
	};
}
