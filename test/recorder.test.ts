import { afterEach, expect, it, vi } from "vitest";
import type { LineView, ProjectSnapshot } from "../electron/core/types";

vi.mock("../src/lib/playback", () => ({
	playback: {
		currentMs: 0,
		pause: vi.fn(),
		seek: vi.fn(),
		playOpenEnded: vi.fn(),
		onTick: vi.fn(() => () => {}),
		setFilter: vi.fn(),
	},
}));

import { playback } from "../src/lib/playback";
import { recorder } from "../src/lib/recorder";
import { editor } from "../src/lib/state";

afterEach(() => {
	recorder.cancel();
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it("restores the audible preview after saving a voiceover take", async () => {
	vi.useFakeTimers();
	const saveRecording = vi.fn(async () => ({}));
	vi.stubGlobal("window", { cue: { reportRecorder: vi.fn(), saveRecording } });
	class FakeMediaRecorder {
		static isTypeSupported() {
			return true;
		}
		state = "inactive";
		mimeType = "audio/webm";
		onstart: (() => void) | null = null;
		onstop: (() => void) | null = null;
		ondataavailable: (() => void) | null = null;
		start() {
			this.state = "recording";
			this.onstart?.();
		}
		stop() {
			this.state = "inactive";
			this.onstop?.();
		}
	}
	vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
	vi.spyOn(recorder, "ensureMic").mockResolvedValue({} as MediaStream);
	editor.set({ previewMode: "all" });
	const project = {
		data: { settings: { prerollMs: 1500, postrollMs: 1200, monitor: "mute", autoStop: true } },
	} as ProjectSnapshot;
	const line = { id: "L01", startMs: 2000, maxMs: 4000 } as LineView;
	const start = recorder.record(project, line);
	await vi.advanceTimersByTimeAsync(3000);
	await start;
	expect(playback.playOpenEnded).toHaveBeenCalledWith(500, "muted");
	await recorder.stop();
	expect(saveRecording).toHaveBeenCalledOnce();
	expect(playback.setFilter).toHaveBeenCalledWith("all");
});
