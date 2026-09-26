// electron-builder afterPack: the app has its copy, so the host's ffmpeg goes
// back for `npm run dev` and the tests (see ffmpeg.cjs).
const { useFfmpeg } = require("./ffmpeg.cjs");

exports.default = async function afterPack() {
	useFfmpeg(process.platform, process.arch);
};
