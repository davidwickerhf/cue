import type { ChromaKey, Mask } from "../../electron/core/types";

/**
 * Preview versions of the export's compositing: mask images (same formula
 * as the exporter's geq mask) and a WebGL chroma keyer (same maths as
 * ffmpeg's chromakey), so what you see is what you export.
 */

const maskCache = new Map<string, string>();

/** A data URL whose alpha is the mask, drawn at a size with the picture's aspect ratio. */
export function maskUrl(mask: Mask, aspect: number): string {
	const key = JSON.stringify([mask, Math.round(aspect * 100)]);
	const cached = maskCache.get(key);
	if (cached) return cached;
	const w = aspect >= 1 ? 480 : Math.round(480 * aspect);
	const h = aspect >= 1 ? Math.round(480 / aspect) : 480;
	const canvas = document.createElement("canvas");
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext("2d");
	if (!ctx) return "";
	const img = ctx.createImageData(w, h);
	const cx = mask.x * w;
	const cy = mask.y * h;
	const rx = Math.max(1, (mask.width / 2) * w);
	const ry = Math.max(1, (mask.height / 2) * h);
	const fe = Math.max(0.002, mask.feather);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const dx = (x - cx) / rx;
			const dy = (y - cy) / ry;
			const d =
				mask.shape === "ellipse" ? Math.hypot(dx, dy) : Math.max(Math.abs(dx), Math.abs(dy));
			let v = Math.min(1, Math.max(0, (1 - d) / fe));
			if (mask.invert) v = 1 - v;
			const i = (y * w + x) * 4;
			img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
			img.data[i + 3] = Math.round(v * 255);
		}
	}
	ctx.putImageData(img, 0, 0);
	const url = canvas.toDataURL("image/png");
	if (maskCache.size > 64) maskCache.clear();
	maskCache.set(key, url);
	return url;
}

const VERTEX = `attribute vec2 p; varying vec2 uv; void main(){ uv = vec2((p.x+1.0)/2.0, (1.0-p.y)/2.0); gl_Position = vec4(p,0.0,1.0); }`;
const FRAGMENT = `precision mediump float;
varying vec2 uv; uniform sampler2D tex; uniform vec2 keyUV; uniform float similarity; uniform float blend;
vec2 chroma(vec3 c){ return vec2(-0.169*c.r - 0.331*c.g + 0.5*c.b + 0.5, 0.5*c.r - 0.419*c.g - 0.081*c.b + 0.5); }
void main(){
	vec4 c = texture2D(tex, uv);
	vec2 d = chroma(c.rgb) - keyUV;
	float diff = sqrt((d.x*d.x + d.y*d.y) / 2.0);
	float a = blend > 0.0001 ? clamp((diff - similarity) / blend, 0.0, 1.0) : (diff > similarity ? 1.0 : 0.0);
	gl_FragColor = vec4(c.rgb * a, a);
}`;

export interface Keyer {
	canvas: HTMLCanvasElement;
	draw(source: HTMLVideoElement | HTMLImageElement, key: ChromaKey): void;
	/** Frees the WebGL context. */
	dispose(): void;
}

/** A canvas that shows a video frame with one colour keyed out. */
export function createKeyer(): Keyer | null {
	const canvas = document.createElement("canvas");
	canvas.className = "absolute inset-0 size-full";
	const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true });
	if (!gl) return null;
	const shader = (type: number, source: string) => {
		const s = gl.createShader(type) as WebGLShader;
		gl.shaderSource(s, source);
		gl.compileShader(s);
		return s;
	};
	const program = gl.createProgram() as WebGLProgram;
	gl.attachShader(program, shader(gl.VERTEX_SHADER, VERTEX));
	gl.attachShader(program, shader(gl.FRAGMENT_SHADER, FRAGMENT));
	gl.linkProgram(program);
	gl.useProgram(program);
	const buffer = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
	const loc = gl.getAttribLocation(program, "p");
	gl.enableVertexAttribArray(loc);
	gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
	const texture = gl.createTexture();
	gl.bindTexture(gl.TEXTURE_2D, texture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	const uKey = gl.getUniformLocation(program, "keyUV");
	const uSim = gl.getUniformLocation(program, "similarity");
	const uBlend = gl.getUniformLocation(program, "blend");
	return {
		canvas,
		draw(source, key) {
			const isVideo = source instanceof HTMLVideoElement;
			const w = isVideo ? source.videoWidth : source.naturalWidth;
			const h = isVideo ? source.videoHeight : source.naturalHeight;
			if ((isVideo ? source.readyState < 2 : !source.complete) || !w) return;
			if (canvas.width !== w || canvas.height !== h) {
				canvas.width = w;
				canvas.height = h;
				gl.viewport(0, 0, canvas.width, canvas.height);
			}
			const n = Number.parseInt(key.color.slice(1), 16);
			const [r, g, b] = [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
			gl.uniform2f(
				uKey,
				-0.169 * r - 0.331 * g + 0.5 * b + 0.5,
				0.5 * r - 0.419 * g - 0.081 * b + 0.5,
			);
			gl.uniform1f(uSim, key.similarity);
			gl.uniform1f(uBlend, key.blend);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
			gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
		},
		dispose() {
			gl.getExtension("WEBGL_lose_context")?.loseContext();
			canvas.remove();
		},
	};
}
