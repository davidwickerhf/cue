import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import electron from "vite-plugin-electron/simple";

const nodeExternals = ["ffmpeg-static", "electron", "electron-updater"];

export default defineConfig(({ mode }) => ({
	plugins: [
		react(),
		tailwindcss(),
		...(mode === "ui"
			? []
			: [
					electron({
						main: {
							entry: "electron/main.ts",
							vite: {
								// The PostHog project token for opt-in usage reporting (electron/core/usage.ts).
								// Only release builds set it (.github/workflows/release.yml); otherwise empty,
								// which turns reporting off entirely.
								define: {
									"process.env.CUE_POSTHOG_KEY": JSON.stringify(process.env.CUE_POSTHOG_KEY ?? ""),
								},
								build: {
									outDir: "dist-electron",
									lib: {
										entry: "electron/main.ts",
										formats: ["cjs"],
										fileName: () => "main.cjs",
									},
									rollupOptions: { external: nodeExternals },
									rolldownOptions: { external: nodeExternals },
								},
							},
						},
						preload: {
							input: path.join(__dirname, "electron/preload.ts"),
							vite: {
								build: {
									outDir: "dist-electron",
									rollupOptions: { output: { format: "cjs", entryFileNames: "preload.cjs" } },
								},
							},
						},
					}),
				]),
	],
	resolve: { alias: { "@": path.resolve(__dirname, "src") } },
	base: "./",
	build: { target: "esnext", outDir: "dist" },
	test: { include: ["test/**/*.test.ts", "test/**/*.test.tsx"], environment: "node", setupFiles: ["test/setup.ts"], maxWorkers: 2 },
}));
