"use client";

import Lenis from "lenis";
import { useEffect } from "react";

/** Momentum scrolling like the Recordly site; off when the visitor prefers less motion. */
export function SmoothScroll() {
	useEffect(() => {
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		const lenis = new Lenis({ duration: 1.15, smoothWheel: true, anchors: true });
		let frame = 0;
		const raf = (time: number) => {
			lenis.raf(time);
			frame = requestAnimationFrame(raf);
		};
		frame = requestAnimationFrame(raf);
		return () => {
			cancelAnimationFrame(frame);
			lenis.destroy();
		};
	}, []);
	return null;
}
