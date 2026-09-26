import { Button, Switch, Tooltip } from "@heroui/react";
import { CaretRight } from "@phosphor-icons/react";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { cn } from "../../lib/utils";
import { isCollapsed, layout, sections, toggleSection } from "../../lib/workspace";

/** Sections inside this fold by title (the inspector); elsewhere they stay open. */
export const FoldingSections = createContext(false);

export function IconButton({
	label,
	shortcut,
	onPress,
	children,
	active,
	disabled,
	variant = "ghost",
	size = "sm",
	className,
}: {
	label: string;
	shortcut?: string;
	onPress?: () => void;
	children: ReactNode;
	active?: boolean;
	disabled?: boolean;
	variant?: "ghost" | "secondary" | "primary" | "tertiary" | "danger-soft" | "outline";
	size?: "sm" | "md";
	className?: string;
}) {
	return (
		<Tooltip delay={400} closeDelay={0}>
			<Button
				aria-label={label}
				isIconOnly
				size={size}
				variant={active ? "secondary" : variant}
				isDisabled={disabled}
				onPress={onPress}
				className={cn(active && "text-accent", className)}
			>
				{children}
			</Button>
			<Tooltip.Content className="text-xs">
				{label}
				{shortcut && <span className="ml-2 text-muted">{shortcut}</span>}
			</Tooltip.Content>
		</Tooltip>
	);
}

export function Section({
	title,
	action,
	children,
	className,
}: {
	title?: string;
	action?: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	// Titled inspector sections fold; which start open depends on the workspace.
	const folding = useContext(FoldingSections) && !!title;
	sections.use((s) => s.collapsed[title ?? ""]);
	layout.use((s) => s.sections);
	const collapsed = folding && isCollapsed(title as string);
	return (
		<section
			className={cn(
				"flex flex-col gap-2.5 border-b border-separator px-4 py-3.5 last:border-b-0",
				collapsed && "py-2",
				className,
			)}
		>
			{(title || action) && (
				<div className="flex min-h-6 items-center justify-between gap-2">
					{title && !folding && <h3 className="text-[11px] font-medium text-muted">{title}</h3>}
					{title && folding && (
						<button
							type="button"
							onClick={() => toggleSection(title as string)}
							aria-expanded={!collapsed}
							className="-ml-1 flex items-center gap-1 rounded px-1 text-[11px] font-medium text-muted hover:text-foreground"
						>
							<CaretRight
								className={cn("size-2.5 transition-transform", !collapsed && "rotate-90")}
								weight="bold"
							/>
							{title}
						</button>
					)}
					{!collapsed && action}
				</div>
			)}
			{!collapsed && children}
		</section>
	);
}

export function Field({
	label,
	hint,
	children,
	inline,
}: {
	label: string;
	hint?: string;
	children: ReactNode;
	inline?: boolean;
}) {
	return (
		<label
			className={cn("flex gap-1 text-[12px]", inline ? "items-center justify-between" : "flex-col")}
		>
			<span className="text-muted">{label}</span>
			{children}
			{hint && <span className="text-[11px] leading-snug text-muted">{hint}</span>}
		</label>
	);
}

const inputClass =
	"h-7 w-full rounded-md border border-border bg-field px-2 text-[12px] text-foreground outline-none transition-colors focus:border-accent disabled:opacity-50";

export function TextInput({
	value,
	onCommit,
	placeholder,
	multiline,
	rows = 3,
	className,
	type = "text",
}: {
	value: string;
	onCommit: (value: string) => void;
	placeholder?: string;
	multiline?: boolean;
	rows?: number;
	className?: string;
	type?: string;
}) {
	const [draft, setDraft] = useState(value);
	useEffect(() => setDraft(value), [value]);
	const commit = () => {
		if (draft !== value) onCommit(draft);
	};
	if (multiline)
		return (
			<textarea
				value={draft}
				rows={rows}
				placeholder={placeholder}
				onChange={(e) => setDraft(e.target.value)}
				onBlur={commit}
				onKeyDown={(e) => {
					if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit();
					e.stopPropagation();
				}}
				className={cn(inputClass, "h-auto resize-none py-2 leading-relaxed", className)}
			/>
		);
	return (
		<input
			type={type}
			value={draft}
			placeholder={placeholder}
			onChange={(e) => setDraft(e.target.value)}
			onBlur={commit}
			onKeyDown={(e) => {
				if (e.key === "Enter") (e.target as HTMLInputElement).blur();
				e.stopPropagation();
			}}
			className={cn(inputClass, className)}
		/>
	);
}

export function NumberInput({
	value,
	onCommit,
	step = 1,
	min,
	max,
	suffix,
	scale = 1,
	digits = 0,
	className,
}: {
	value: number;
	onCommit: (value: number) => void;
	step?: number;
	min?: number;
	max?: number;
	suffix?: string;
	/** Display value = stored value / scale (e.g. ms shown as seconds with scale 1000). */
	scale?: number;
	digits?: number;
	className?: string;
}) {
	const shown = (value / scale).toFixed(digits);
	const [draft, setDraft] = useState(shown);
	useEffect(() => setDraft(shown), [shown]);
	const commit = () => {
		const parsed = Number.parseFloat(draft);
		if (Number.isNaN(parsed)) return setDraft(shown);
		let next = parsed * scale;
		if (min !== undefined) next = Math.max(min, next);
		if (max !== undefined) next = Math.min(max, next);
		if (Math.abs(next - value) > 1e-6) onCommit(next);
		else setDraft(shown);
	};
	return (
		<div className={cn("relative", className)}>
			<input
				value={draft}
				inputMode="decimal"
				onChange={(e) => setDraft(e.target.value)}
				onBlur={commit}
				onKeyDown={(e) => {
					e.stopPropagation();
					if (e.key === "Enter") (e.target as HTMLInputElement).blur();
					if (e.key === "ArrowUp" || e.key === "ArrowDown") {
						e.preventDefault();
						const delta = (e.key === "ArrowUp" ? step : -step) * (e.shiftKey ? 10 : 1);
						const next = Math.min(
							max ?? Number.POSITIVE_INFINITY,
							Math.max(min ?? Number.NEGATIVE_INFINITY, value + delta * scale),
						);
						onCommit(next);
					}
				}}
				className={cn(inputClass, "tabular-nums", suffix && "pr-8")}
			/>
			{suffix && (
				<span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[11px] text-muted">
					{suffix}
				</span>
			)}
		</div>
	);
}

export function Range({
	value,
	onChange,
	onCommit,
	min = 0,
	max = 1,
	step = 0.01,
	format,
}: {
	value: number;
	onChange?: (value: number) => void;
	onCommit: (value: number) => void;
	min?: number;
	max?: number;
	step?: number;
	format?: (value: number) => string;
}) {
	const [draft, setDraft] = useState(value);
	useEffect(() => setDraft(value), [value]);
	const pct = ((draft - min) / (max - min)) * 100;
	return (
		<div className="flex items-center gap-2.5">
			<input
				type="range"
				min={min}
				max={max}
				step={step}
				value={draft}
				onChange={(e) => {
					const next = Number(e.target.value);
					setDraft(next);
					onChange?.(next);
				}}
				onPointerUp={() => onCommit(draft)}
				onKeyUp={() => onCommit(draft)}
				className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full accent-[var(--accent)]"
				style={{
					background: `linear-gradient(to right, var(--accent) ${pct}%, color-mix(in srgb, var(--foreground) 12%, transparent) ${pct}%)`,
				}}
			/>
			<span className="w-11 text-right text-[11px] text-muted tabular-nums">
				{format ? format(draft) : draft.toFixed(2)}
			</span>
		</div>
	);
}

export function Toggle({
	checked,
	onChange,
	label,
}: {
	checked: boolean;
	onChange: (checked: boolean) => void;
	label: string;
}) {
	return (
		<Switch isSelected={checked} onChange={onChange} size="sm" className="w-full">
			<Switch.Content className="flex w-full items-center justify-between gap-3 text-[13px]">
				<span className="text-foreground/85">{label}</span>
				<Switch.Control>
					<Switch.Thumb />
				</Switch.Control>
			</Switch.Content>
		</Switch>
	);
}

export function Segmented<T extends string>({
	value,
	options,
	onChange,
	size = "sm",
}: {
	value: T;
	options: { value: T; label: ReactNode; title?: string }[];
	onChange: (value: T) => void;
	size?: "sm" | "xs";
}) {
	return (
		<div className="inline-flex rounded-md bg-field p-0.5 ring-1 ring-border" role="radiogroup">
			{options.map((option) => (
				<button
					key={option.value}
					type="button"
					role="radio"
					title={option.title}
					aria-checked={option.value === value}
					onClick={() => onChange(option.value)}
					className={cn(
						"rounded-[4px] px-2 font-medium transition-colors",
						size === "xs" ? "h-6 text-[11px]" : "h-7 text-[12px]",
						option.value === value
							? "bg-default text-foreground"
							: "text-muted hover:text-foreground",
					)}
				>
					{option.label}
				</button>
			))}
		</div>
	);
}

export function ColorInput({
	value,
	onCommit,
	allowNone,
}: {
	value: string | null;
	onCommit: (value: string | null) => void;
	allowNone?: boolean;
}) {
	const hex = toHex(value);
	return (
		<div className="flex items-center gap-2">
			<input
				type="color"
				value={hex}
				onChange={(e) => onCommit(e.target.value)}
				className="h-8 w-10 cursor-pointer rounded-md border border-border bg-transparent p-0.5"
			/>
			<TextInput
				value={value ?? ""}
				placeholder={allowNone ? "None" : ""}
				onCommit={(v) => onCommit(v.trim() ? v.trim() : allowNone ? null : hex)}
				className="flex-1"
			/>
		</div>
	);
}

function toHex(color: string | null): string {
	if (!color) return "#000000";
	if (/^#[0-9a-f]{6}$/i.test(color)) return color;
	const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
	if (m)
		return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, "0")).join("")}`;
	return "#000000";
}

export function Empty({
	icon,
	title,
	children,
}: {
	icon: ReactNode;
	title: string;
	children?: ReactNode;
}) {
	return (
		<div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
			<div className="text-muted">{icon}</div>
			<p className="text-[13px] font-medium">{title}</p>
			{children && <div className="text-[12px] leading-relaxed text-muted">{children}</div>}
		</div>
	);
}
