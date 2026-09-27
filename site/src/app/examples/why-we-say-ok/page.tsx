import { ExamplePage } from "@/components/ExamplePage";
import { example } from "@/content/examples";
import { pageMetadata } from "@/lib/metadata";

const e = example("why-we-say-ok");

export const metadata = pageMetadata({
	title: `${e.title}: a Vox-style explainer made in Cue`,
	description: e.summary,
	path: `/examples/${e.slug}`,
});

export default function WhyWeSayOkPage() {
	return <ExamplePage example={e} />;
}
