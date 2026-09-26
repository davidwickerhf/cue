// ffmpeg-static downloads one ffmpeg, for the platform and CPU that ran
// `npm install`. Packaging for another target (the Intel Mac build on an Apple
// Silicon Mac, or Linux from a Mac) would ship the wrong binary, so before each
// pack this puts the target's ffmpeg in place (downloading it once through
// ffmpeg-static's own installer and caching it in node_modules/.cache), and
// after the pack it puts the host's back for development and tests.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const pkgDir = path.dirname(require.resolve("ffmpeg-static/package.json"));
const cacheDir = path.join(pkgDir, "..", ".cache", "cue-ffmpeg");
const NAMES = ["ffmpeg", "ffmpeg.exe"];

/** electron-builder's Arch enum. */
const ARCH = { 0: "ia32", 1: "x64", 2: "arm", 3: "arm64", 4: "universal" };

/** Platform and CPU of an executable, from its header. */
function detect(file) {
	const fd = fs.openSync(file, "r");
	const b = Buffer.alloc(4096);
	fs.readSync(fd, b, 0, b.length, 0);
	fs.closeSync(fd);
	if (b.readUInt32LE(0) === 0xfeedfacf) {
		const cpu = b.readUInt32LE(4);
		return {
			platform: "darwin",
			arch: cpu === 0x0100000c ? "arm64" : cpu === 0x01000007 ? "x64" : "?",
		};
	}
	if (b.readUInt32BE(0) === 0xcafebabe) return { platform: "darwin", arch: "universal" };
	if (b.readUInt32BE(0) === 0x7f454c46) {
		const m = b.readUInt16LE(0x12);
		return { platform: "linux", arch: { 62: "x64", 183: "arm64", 3: "ia32", 40: "arm" }[m] ?? "?" };
	}
	if (b.toString("latin1", 0, 2) === "MZ") {
		const pe = b.readUInt32LE(0x3c);
		const m = pe + 6 <= b.length ? b.readUInt16LE(pe + 4) : 0;
		return { platform: "win32", arch: { 34404: "x64", 332: "ia32", 43620: "arm64" }[m] ?? "?" };
	}
	return null;
}

/** Makes node_modules/ffmpeg-static hold exactly the ffmpeg for `platform`/`arch`. */
function useFfmpeg(platform, arch) {
	const name = platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
	const target = path.join(pkgDir, name);
	// Another platform's README and LICENSE (left by an earlier download) don't belong in this app.
	for (const n of NAMES.filter((n) => n !== name))
		for (const suffix of [".README", ".LICENSE"])
			fs.rmSync(path.join(pkgDir, n + suffix), { force: true });
	if (fs.existsSync(target)) {
		const found = detect(target);
		const others = NAMES.filter((n) => n !== name && fs.existsSync(path.join(pkgDir, n)));
		if (found?.platform === platform && found.arch === arch && others.length === 0) return;
	}
	// Set aside whatever is there, by what it is.
	for (const n of NAMES) {
		const file = path.join(pkgDir, n);
		if (!fs.existsSync(file)) continue;
		const found = detect(file);
		if (found && found.arch !== "?") {
			const dir = path.join(cacheDir, `${found.platform}-${found.arch}`);
			fs.mkdirSync(dir, { recursive: true });
			fs.copyFileSync(file, path.join(dir, n));
		}
		fs.rmSync(file);
	}
	const cached = path.join(cacheDir, `${platform}-${arch}`, name);
	if (fs.existsSync(cached)) {
		fs.copyFileSync(cached, target);
		fs.chmodSync(target, 0o755);
	} else {
		console.log(`  • downloading ffmpeg for ${platform}-${arch} (ffmpeg-static)`);
		execFileSync(process.execPath, [path.join(pkgDir, "install.js")], {
			cwd: pkgDir,
			stdio: "inherit",
			env: { ...process.env, npm_config_platform: platform, npm_config_arch: arch, CI: "1" },
		});
		fs.mkdirSync(path.dirname(cached), { recursive: true });
		fs.copyFileSync(target, cached);
	}
	const placed = detect(target);
	if (placed?.platform !== platform || placed.arch !== arch)
		throw new Error(
			`ffmpeg for ${platform}-${arch} could not be put in place (found ${JSON.stringify(placed)}).`,
		);
	console.log(`  • ffmpeg for ${platform}-${arch} in place`);
}

module.exports = { useFfmpeg, detect, ARCH };
