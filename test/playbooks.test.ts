import { describe, expect, it } from "vitest";
import { contract } from "../electron/control/contract";
import { PLAYBOOKS, playbook } from "../electron/control/playbooks";
import { MOTION_TEMPLATES } from "../electron/core/motionTemplates";

describe("playbooks", () => {
	it("have unique ids, a summary and a body", () => {
		expect(new Set(PLAYBOOKS.map((p) => p.id)).size).toBe(PLAYBOOKS.length);
		for (const p of PLAYBOOKS) {
			expect(p.summary.length).toBeGreaterThan(20);
			expect(p.body.length).toBeGreaterThan(300);
		}
		expect(playbook("vox-explainer").name).toMatch(/Vox/);
		expect(() => playbook("nope")).toThrow(/No playbook/);
	});

	it("only name tools that exist", () => {
		for (const p of PLAYBOOKS) {
			const named = [...p.body.matchAll(/\b[a-z]+(?:_[a-z]+)+\b/g)].map((m) => m[0]);
			for (const tool of named)
				expect(Object.keys(contract), `${p.id} names ${tool}`).toContain(tool);
		}
	});

	it("only name templates that exist", () => {
		const ids = new Set(MOTION_TEMPLATES.map((t) => t.id));
		for (const p of PLAYBOOKS) {
			const named = [
				...p.body.matchAll(
					/\b(?:annotate|transition)-[a-z]+\b|\b[a-z]+-(?:tag|title|chart|third|map|bar|words)\b/g,
				),
			].map((m) => m[0]);
			for (const t of named) {
				if (t === "title-safe" || (t === "lower-third" && ids.has("lower-third"))) continue;
				expect(ids.has(t), `${p.id} names template ${t}`).toBe(true);
			}
		}
	});
});
