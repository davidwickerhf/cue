"use client";

import { useEffect, useRef } from "react";

/** A muted, looping demo that only plays (and loads) while it is on screen. */
export function AutoVideo({ name, label, priority = false }: { name: string; label: string; priority?: boolean }) {
	const ref = useRef<HTMLVideoElement>(null);
	useEffect(() => {
		const video = ref.current;
		if (!video) return;
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
			poster={`/videos/${name}.jpg`}
			aria-label={label}
			muted
			loop
			playsInline
			preload={priority ? "auto" : "none"}
			className="block aspect-[1920/1080] w-full"
		/>
	);
}
