import { describe, expect, it } from "vitest";
import {
	layerAt,
	layerAtPoint,
	layerBox,
	listLayers,
	reorderLayer,
	updateLayer,
} from "../electron/core/motionLayers";
import { compileMotion } from "../electron/core/motionSpec";

const spec = {
	width: 1920,
	height: 1080,
	durationMs: 3000,
	layers: [
		{
			type: "rect",
			name: "Background",
			x: 960,
			y: 540,
			width: 1920,
			height: 1080,
			fill: "#111111",
		},
		{
			type: "group",
			name: "Tag",
			layers: [
				{ type: "rect", name: "Box", x: 300, y: 200, width: 200, height: 100, fill: "#e4362b" },
				{
					type: "text",
					text: "OK",
					x: 300,
					y: 200,
					size: 80,
					align: "center",
					font: "sans",
					weight: 800,
				},
			],
		},
	],
};

describe("motion layers for the Motion page", () => {
	it("lists layers top first, with groups before their children", () => {
		const rows = listLayers(spec);
		expect(rows.map((r) => [r.name, r.depth, r.path.join(".")])).toEqual([
			["Tag", 0, "1"],
			["OK", 1, "1.1"],
			["Box", 1, "1.0"],
			["Background", 0, "0"],
		]);
	});

	it("changes one layer and leaves the rest of the spec as it was", () => {
		const next = updateLayer(spec, [1, 0], { fill: "#0000ff", x: 320, name: undefined });
		expect(layerAt(next, [1, 0])).toEqual({
			type: "rect",
			x: 320,
			y: 200,
			width: 200,
			height: 100,
			fill: "#0000ff",
		});
		expect((next.layers as unknown[])[0]).toBe(spec.layers[0]);
		expect(layerAt(spec, [1, 0])?.fill).toBe("#e4362b");
		// Still a valid spec.
		expect(() => compileMotion(next)).not.toThrow();
	});

	it("reorders a layer within its own list", () => {
		const { spec: next, path } = reorderLayer(spec, [1, 0], 1);
		expect(path).toEqual([1, 1]);
		expect((layerAt(next, [1, 1]) as { name: string }).name).toBe("Box");
		expect(reorderLayer(spec, [1, 1], 1).path).toEqual([1, 1]);
	});

	it("boxes shapes and text, and picks the topmost layer at a point", () => {
		expect(layerBox(spec, layerAt(spec, [1, 0]) ?? {})).toEqual({
			left: 200,
			top: 150,
			right: 400,
			bottom: 250,
		});
		const text = layerBox(spec, layerAt(spec, [1, 1]) ?? {});
		expect(text && text.right - text.left).toBeGreaterThan(80);
		expect(layerAtPoint(spec, 300, 200)?.name).toBe("OK");
		expect(layerAtPoint(spec, 210, 160)?.name).toBe("Box");
		expect(layerAtPoint(spec, 1500, 900)?.name).toBe("Background");
	});
});

describe("moving and finding layers", () => {
	it("moves shapes by x and y, lines by their points and groups with everything in them", async () => {
		const { moveLayer, findLayer } = await import("../electron/core/motionLayers");
		const withLine = {
			...spec,
			layers: [
				...spec.layers,
				{
					type: "line",
					name: "Leader",
					points: [
						[0, 0],
						[100, 50],
					],
					stroke: "#ffffff",
				},
			],
		};
		expect(layerAt(moveLayer(withLine, [2], 10, 20), [2])?.points).toEqual([
			[10, 20],
			[110, 70],
		]);
		const group = moveLayer(withLine, [1], 5, -5);
		expect(layerAt(group, [1, 0])).toMatchObject({ x: 305, y: 195 });
		expect(layerAt(group, [1, 1])).toMatchObject({ x: 305, y: 195 });
		expect(layerBox(withLine, layerAt(withLine, [2]) ?? {})).not.toBeNull();
		expect(findLayer(withLine, "Leader")?.path).toEqual([2]);
		expect(findLayer(withLine, "box")?.path).toEqual([1, 0]);
		expect(findLayer(withLine, "1.1")?.name).toBe("OK");
	});
});

describe("editing a graphic's layers over MCP (no window needed)", () => {
	it("changes, moves and removes layers of a template graphic, which becomes its own design", async () => {
		const fs = await import("node:fs/promises");
		const os = await import("node:os");
		const path = await import("node:path");
		const { ProjectStore } = await import("../electron/core/store");
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-layers-"));
		const store = new ProjectStore({
			mediaUrl: (f) => f,
			recentFile: path.join(dir, "recent.json"),
			autoProxies: () => false,
		});
		await store.create({ path: dir, name: "Layers" });
		const { asset } = await store.createMotionGraphic(
			{
				template: "annotate-label",
				params: { text: "OW", targetX: 0.5, targetY: 0.5, labelX: 0.6, labelY: 0.3 },
			},
			"agent",
		);
		const before = store.motionGraphicSource(asset.id);
		expect(before.layers.map((l) => l.name)).toEqual(expect.arrayContaining(["Label", "Leader"]));
		const edited = await store.editMotionLayer(
			asset.id,
			{ layer: "Label", patch: { text: "Oll Wright", color: "#e4362b" } },
			"agent",
		);
		expect(edited.layer).toBe("Label");
		const source = store.current.assets.find((a) => a.id === asset.id)?.motionSource;
		expect(source?.template).toBeUndefined();
		const label = listLayers(source?.spec ?? {}).find((r) => r.name === "Label")?.layer;
		expect(label).toMatchObject({ text: "Oll Wright", color: "#e4362b" });
		expect(
			store.current.assets.find((a) => a.id === asset.id)?.motion?.texts.map((t) => t.text),
		).toContain("Oll Wright");
		// Move the leader line, then remove it; each is one step.
		const leaderBefore = listLayers(source?.spec ?? {}).find((r) => r.name === "Leader")?.layer
			.points as number[][];
		await store.editMotionLayer(asset.id, { layer: "Leader", move: { dx: 10, dy: 0 } }, "agent");
		const moved = listLayers(
			store.motionGraphicSource(asset.id).spec as Record<string, unknown>,
		).find((r) => r.name === "Leader")?.layer.points as number[][];
		expect(moved[0][0]).toBeCloseTo(leaderBefore[0][0] + 10, 1);
		await store.editMotionLayer(asset.id, { layer: "Leader", remove: true }, "agent");
		expect(store.motionGraphicSource(asset.id).layers.map((l) => l.name)).not.toContain("Leader");
		await expect(store.editMotionLayer(asset.id, { layer: "Nope" }, "agent")).rejects.toThrow(
			/No layer "Nope"/,
		);
	});
});
