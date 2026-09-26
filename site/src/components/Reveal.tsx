"use client";

import { type CSSProperties, type ElementType, type ReactNode, useEffect, useRef, useState } from "react";

/** Becomes true once the element scrolls into view (and stays true). */
function useInView<T extends Element>(margin = "0px 0px -12% 0px") {
	const ref = useRef<T>(null);
	const [seen, setSeen] = useState(false);
	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
			const frame = requestAnimationFrame(() => setSeen(true));
			return () => cancelAnimationFrame(frame);
		}
		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry.isIntersecting) {
					setSeen(true);
					observer.disconnect();
				}
			},
			{ rootMargin: margin },
		);
		observer.observe(el);
		return () => observer.disconnect();
	}, [margin]);
	return [ref, seen] as const;
}

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/**
 * Fades in from below with a blur, the way Framer sites reveal content.
 * `delay` staggers siblings; `y` is how far it rises.
 */
export function Reveal({
	children,
	delay = 0,
	y = 24,
	blur = 10,
	scale = 1,
	duration = 900,
	as: Tag = "div",
	className,
	style,
	id,
}: {
	children: ReactNode;
	delay?: number;
	y?: number;
	blur?: number;
	scale?: number;
	duration?: number;
	as?: ElementType;
	className?: string;
	style?: CSSProperties;
	id?: string;
}) {
	const [ref, seen] = useInView<HTMLElement>();
	return (
		<Tag
			ref={ref}
			id={id}
			className={className}
			style={{
				...style,
				opacity: seen ? 1 : 0,
				transform: seen ? "none" : `translateY(${y}px) scale(${scale})`,
				filter: seen ? "none" : `blur(${blur}px)`,
				transition: `opacity ${duration}ms ${EASE} ${delay}ms, transform ${duration}ms ${EASE} ${delay}ms, filter ${duration}ms ${EASE} ${delay}ms`,
				willChange: seen ? undefined : "opacity, transform, filter",
			}}
		>
			{children}
		</Tag>
	);
}

/** A heading whose words come into focus one after another. */
export function Words({
	text,
	muted,
	as: Tag = "h2",
	className,
	delay = 0,
	step = 55,
}: {
	text: string;
	/** A second, dimmer phrase after the text (e.g. "We've got answers."). */
	muted?: string;
	as?: ElementType;
	className?: string;
	delay?: number;
	step?: number;
}) {
	const [ref, seen] = useInView<HTMLElement>();
	const words = [...text.split(" ").map((w) => ({ w, dim: false })), ...(muted ? muted.split(" ").map((w) => ({ w, dim: true })) : [])];
	return (
		<Tag ref={ref} className={className} aria-label={muted ? `${text} ${muted}` : text}>
			{words.map(({ w, dim }, i) => (
				<span
					// biome-ignore lint/suspicious/noArrayIndexKey: words of a fixed sentence
					key={i}
					aria-hidden
					className={dim ? "text-muted" : undefined}
					style={{
						display: "inline-block",
						whiteSpace: "pre",
						opacity: seen ? 1 : 0,
						transform: seen ? "none" : "translateY(20px)",
						filter: seen ? "none" : "blur(10px)",
						transition: `opacity 800ms ${EASE} ${delay + i * step}ms, transform 800ms ${EASE} ${delay + i * step}ms, filter 800ms ${EASE} ${delay + i * step}ms`,
					}}
				>
					{w}
					{i < words.length - 1 ? " " : ""}
				</span>
			))}
		</Tag>
	);
}
