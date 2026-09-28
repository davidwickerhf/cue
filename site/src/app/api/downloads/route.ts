import { classifyDownload, type Platform } from "@/lib/analytics";

/**
 * GitHub release download counts per platform, as JSON: GET /api/downloads.
 * Built at most once an hour (ISR), so it stays within GitHub's unauthenticated rate limit.
 * Set GITHUB_TOKEN in the environment to raise that limit (optional).
 *
 * `installs` counts the installer files (dmg, exe, AppImage, deb) and `zips` the Mac zips, which
 * are mostly downloaded by the updater. Caveat: on Windows and for the AppImage the updater
 * downloads the installer file itself, so those "installs" include updates.
 */
export const revalidate = 3600;

const REPO_API = "https://api.github.com/repos/davidwickerhf/cue/releases";

type Counts = Record<Platform, number> & { total: number };
const empty = (): Counts => ({ "mac-arm": 0, "mac-intel": 0, windows: 0, "linux-appimage": 0, "linux-deb": 0, total: 0 });

interface GitHubRelease {
  tag_name: string;
  draft: boolean;
  published_at: string | null;
  assets: { name: string; download_count: number }[];
}

async function releases(): Promise<GitHubRelease[]> {
  const headers: Record<string, string> = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const all: GitHubRelease[] = [];
  for (let page = 1; page <= 5; page++) {
    const res = await fetch(`${REPO_API}?per_page=100&page=${page}`, { headers, next: { revalidate: 3600 } });
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const batch = (await res.json()) as GitHubRelease[];
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all.filter((r) => !r.draft && /^v\d/.test(r.tag_name));
}

export async function GET() {
  try {
    const list = await releases();
    const totals = { installs: empty(), zips: empty() };
    const perRelease = list.map((r) => {
      const installs = empty();
      const zips = empty();
      for (const asset of r.assets) {
        const kind = classifyDownload(`/releases/latest/download/${asset.name}`);
        if (!kind) continue;
        const bucket = kind.format === "zip" ? zips : installs;
        const total = kind.format === "zip" ? totals.zips : totals.installs;
        bucket[kind.platform] += asset.download_count;
        bucket.total += asset.download_count;
        total[kind.platform] += asset.download_count;
        total.total += asset.download_count;
      }
      return { version: r.tag_name.replace(/^v/, ""), publishedAt: r.published_at, installs, zips };
    });
    return Response.json({
      generatedAt: new Date().toISOString(),
      note: "installs: dmg/exe/AppImage/deb downloads; zips: Mac zips (mostly the updater). Windows and AppImage updates also download the installer file.",
      totals,
      releases: perRelease,
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 502 });
  }
}
