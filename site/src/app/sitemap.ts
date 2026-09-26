import type { MetadataRoute } from "next";
import { CHANGELOG } from "@/content/changelog";
import { DOCS } from "@/content/docs";
import { DEMOS, SITE_URL, USE_CASES } from "@/lib/site";

const LAST_RELEASE = CHANGELOG.find((r) => r.date)?.date;

export default function sitemap(): MetadataRoute.Sitemap {
	return [
		{
			url: SITE_URL,
			lastModified: LAST_RELEASE,
			changeFrequency: "weekly",
			priority: 1,
			images: DEMOS.map((d) => `${SITE_URL}/videos/${d}.jpg`),
		},
		...USE_CASES.map((u) => ({
			url: `${SITE_URL}${u.href}`,
			lastModified: LAST_RELEASE,
			changeFrequency: "monthly" as const,
			priority: 0.8,
		})),
		{ url: `${SITE_URL}/changelog`, lastModified: LAST_RELEASE, changeFrequency: "weekly", priority: 0.6 },
		{ url: `${SITE_URL}/styles`, lastModified: LAST_RELEASE, changeFrequency: "monthly", priority: 0.8 },
		{ url: `${SITE_URL}/assets`, lastModified: LAST_RELEASE, changeFrequency: "monthly", priority: 0.7 },
		...DOCS.map((d) => ({
			url: `${SITE_URL}${d.href}`,
			lastModified: LAST_RELEASE,
			changeFrequency: "monthly" as const,
			priority: d.href === "/docs" ? 0.7 : 0.6,
		})),
	];
}
