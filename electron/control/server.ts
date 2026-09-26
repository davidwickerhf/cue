import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import type { Controller } from "../controller";
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
			const { method, params } = JSON.parse(body) as { method: string; params?: unknown };
			if (!(method in contract)) return reply(400, { error: `Unknown method ${method}` });
			controller.noteAgentRequest();
			const result = await controller.call(method as MethodName, params, "agent");
			reply(200, { result: result ?? null });
		} catch (error) {
			const err = error as Error & { issues?: unknown };
			reply(200, {
				error: err.issues ? `Invalid input: ${JSON.stringify(err.issues)}` : err.message,
			});
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
