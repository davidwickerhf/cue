import path from "node:path";

export function resolveInProject(projectDir: string, file: string): string {
	return path.isAbsolute(file) ? file : path.join(projectDir, file);
}

export function relativeToProject(projectDir: string, file: string): string {
	const rel = path.relative(projectDir, file);
	return rel.startsWith("..") || path.isAbsolute(rel) ? file : rel;
}

/** A short unique part for file names: the time plus a few random letters, so files made in the same millisecond (jobs run in parallel) never share a name. */
export function stamp(): string {
	return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
