import { FAQ } from "@/content/faq";
import { AUTHOR, DEMOS, DESCRIPTION, DOWNLOAD, REPO, SITE_URL } from "@/lib/site";
import { APP_VERSION } from "@/lib/version";

const author = { "@type": "Person", name: AUTHOR.name, url: AUTHOR.url, sameAs: [AUTHOR.github] };

export const softwareApplication = {
	"@context": "https://schema.org",
	"@type": "SoftwareApplication",
	"@id": `${SITE_URL}/#software`,
	name: "Cue",
	description: DESCRIPTION,
	url: SITE_URL,
	applicationCategory: "MultimediaApplication",
	applicationSubCategory: "Video editor",
	operatingSystem: "macOS, Windows, Linux",
	softwareVersion: APP_VERSION,
	downloadUrl: DOWNLOAD,
	installUrl: DOWNLOAD,
	releaseNotes: `${SITE_URL}/changelog`,
	license: "https://opensource.org/licenses/MIT",
	isAccessibleForFree: true,
	image: `${SITE_URL}/icon.png`,
	screenshot: DEMOS.map((d) => `${SITE_URL}/videos/${d}.jpg`),
	offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
	author,
	sameAs: [REPO],
};

export const faqPage = {
	"@context": "https://schema.org",
	"@type": "FAQPage",
	mainEntity: FAQ.map((f) => ({
		"@type": "Question",
		name: f.q,
		acceptedAnswer: { "@type": "Answer", text: f.a },
	})),
};
