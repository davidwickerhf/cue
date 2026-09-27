import type { MetadataRoute } from "next";
import { CHANGELOG } from "@/content/changelog";
import { DOCS } from "@/content/docs";
import { EXAMPLES } from "@/content/examples";
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
		{ url: `${SITE_URL}/download`, lastModified: LAST_RELEASE, changeFrequency: "weekly", priority: 0.9 },
		{ url: `${SITE_URL}/changelog`, lastModified: LAST_RELEASE, changeFrequency: "weekly", priority: 0.6 },
		{ url: `${SITE_URL}/styles`, lastModified: LAST_RELEASE, changeFrequency: "monthly", priority: 0.8 },
		{ url: `${SITE_URL}/assets`, lastModified: LAST_RELEASE, changeFrequency: "monthly", priority: 0.7 },
		{ url: `${SITE_URL}/examples`, lastModified: LAST_RELEASE, changeFrequency: "monthly", priority: 0.8 },
		...EXAMPLES.map((e) => ({
			url: `${SITE_URL}/examples/${e.slug}`,
			lastModified: LAST_RELEASE,
			changeFrequency: "monthly" as const,
			priority: 0.8,
			images: [`${SITE_URL}${e.poster}`],
			videos: [
				{
					title: e.title,
					description: e.summary,
					thumbnail_loc: `${SITE_URL}${e.poster}`,
					content_loc: `${SITE_URL}${e.video}`,
				},
			],
		})),
		...DOCS.map((d) => ({
			url: `${SITE_URL}${d.href}`,
			lastModified: LAST_RELEASE,
			changeFrequency: "monthly" as const,
			priority: d.href === "/docs" ? 0.7 : 0.6,
		})),
	];
}
