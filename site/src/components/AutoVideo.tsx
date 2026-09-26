"use client";

import { useEffect, useRef } from "react";
import { preload } from "react-dom";

/**
 * A muted, looping demo that only loads and plays while it is on screen. Until then it
 * shows its poster, which is preloaded for the video above the fold (`priority`).
 */
export function AutoVideo({ name, label, priority = false }: { name: string; label: string; priority?: boolean }) {
	const ref = useRef<HTMLVideoElement>(null);
	const poster = `/videos/${name}.jpg`;
	if (priority) preload(poster, { as: "image", fetchPriority: "high" });
	useEffect(() => {
		const video = ref.current;
		if (!video) return;
		// Visitors who prefer less motion get the poster; the video plays on click.
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			video.controls = true;
			return;
		}
		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry.isIntersecting) void video.play().catch(() => {});
				else video.pause();
			},
			{ threshold: 0.35 },
		);
		observer.observe(video);
		return () => observer.disconnect();
	}, []);
	return (
		<video
			ref={ref}
			src={`/videos/${name}.mp4`}
			poster={poster}
			aria-label={label}
			width={1920}
			height={1080}
			muted
			loop
			playsInline
			preload={priority ? "metadata" : "none"}
			className="block aspect-[1920/1080] h-auto w-full"
		/>
	);
}
