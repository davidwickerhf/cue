import { afterEach, expect, it, vi } from "vitest";
import { generateImage } from "../electron/core/ai";
import { emptyProject } from "../electron/core/project";

afterEach(() => vi.unstubAllGlobals());

it("defaults new projects to GPT Image 2.5 Flare", () => {
	expect(emptyProject("New").ai.imageModel).toBe("gpt-image-2.5-flare");
});

it("sends the selected GPT Image model using Cue's existing OpenAI credential", async () => {
	const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
		expect(init.headers).toEqual({
			authorization: "Bearer stored-key",
			"content-type": "application/json",
		});
		expect(JSON.parse(init.body as string)).toMatchObject({
			model: "gpt-image-2.5-sunburst",
			size: "1024x1024",
		});
		return new Response(
			JSON.stringify({ data: [{ b64_json: Buffer.from("png").toString("base64") }] }),
			{ status: 200 },
		);
	});
	vi.stubGlobal("fetch", fetcher);
	expect(
		await generateImage(
			{ apiKey: "stored-key" },
			{ prompt: "A city map", model: "gpt-image-2.5-sunburst", size: "1024x1024" },
		),
	).toEqual(Buffer.from("png"));
	expect(fetcher).toHaveBeenCalledOnce();
});
