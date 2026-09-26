import type { Metadata } from "next";
import { OG_IMAGE, SITE_URL } from "@/lib/site";

/**
 * Metadata for a sub-page. Open Graph and Twitter objects replace the root layout's
 * (metadata merges shallowly), so the shared fields are repeated here.
 */
export function pageMetadata({ title, description, path }: { title: string; description: string; path: string }): Metadata {
	const url = `${SITE_URL}${path}`;
	return {
		title,
		description,
		alternates: { canonical: path },
		openGraph: { title: `${title} · Cue`, description, url, siteName: "Cue", type: "website", locale: "en_US", images: [OG_IMAGE] },
		twitter: { card: "summary_large_image", title: `${title} · Cue`, description, images: [OG_IMAGE] },
	};
}
