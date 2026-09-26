import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import electron from "vite-plugin-electron/simple";

const nodeExternals = ["ffmpeg-static", "electron"];

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
	test: { include: ["test/**/*.test.ts"], environment: "node", setupFiles: ["test/setup.ts"] },
}));
