import { describe, expect, it } from "vitest";
import { plainFfmpegCause } from "../electron/core/media";

describe("ffmpeg failures in plain words", () => {
	it("names the usual causes and leaves the rest alone", () => {
		expect(plainFfmpegCause("av_interleaved_write_frame(): No space left on device")).toMatch(
			/disk is full/,
		);
		expect(plainFfmpegCause("/x.mp4: No such file or directory")).toMatch(/missing/);
		expect(plainFfmpegCause("moov atom not found")).toMatch(/damaged/);
		expect(plainFfmpegCause("Error while filtering: Invalid argument")).toBeNull();
	});
});
