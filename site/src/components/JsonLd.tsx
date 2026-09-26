/** Structured data for search engines and AI, as recommended by the Next.js JSON-LD guide. */
export function JsonLd({ data }: { data: object }) {
	return (
		<script
			type="application/ld+json"
			// Escape "<" so a string in the data can never close the script tag.
			dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
		/>
	);
}
