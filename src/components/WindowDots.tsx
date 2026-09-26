/** Offscreen recordings have no window chrome; draw the traffic lights so demos look like the real window. */
export function WindowDots() {
	if (!new URLSearchParams(location.search).has("record")) return null;
	return (
		<div
			className="pointer-events-none absolute top-1/2 left-[18px] flex -translate-y-1/2 gap-2"
			aria-hidden
		>
			<span className="size-3 rounded-full bg-[#ff5f57]" />
			<span className="size-3 rounded-full bg-[#febc2e]" />
			<span className="size-3 rounded-full bg-[#28c840]" />
		</div>
	);
}
