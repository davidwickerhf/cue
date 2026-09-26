import path from "node:path";

export function resolveInProject(projectDir: string, file: string): string {
	return path.isAbsolute(file) ? file : path.join(projectDir, file);
}

export function relativeToProject(projectDir: string, file: string): string {
	const rel = path.relative(projectDir, file);
	return rel.startsWith("..") || path.isAbsolute(rel) ? file : rel;
}
