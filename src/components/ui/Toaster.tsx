import { CheckCircle, WarningCircle, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { onNotify } from "../../lib/api";
import { cn } from "../../lib/utils";

interface Toast {
	id: number;
	message: string;
	tone: "default" | "success" | "danger";
}

export function Toaster() {
	const [toasts, setToasts] = useState<Toast[]>([]);
	useEffect(() => {
		let id = 0;
		return onNotify((message, tone) => {
			const toast = { id: ++id, message, tone };
			setToasts((list) => [...list.slice(-3), toast]);
			setTimeout(() => setToasts((list) => list.filter((t) => t.id !== toast.id)), tone === "danger" ? 7000 : 3500);
		});
	}, []);
	return (
		<div className="pointer-events-none fixed right-5 bottom-5 z-[200] flex w-[360px] flex-col gap-2">
			{toasts.map((toast) => (
				<div
					key={toast.id}
					className={cn(
						"pointer-events-auto flex items-start gap-2.5 rounded-xl border border-border bg-overlay px-3.5 py-3 text-[13px] shadow-lg",
						"animate-in fade-in slide-in-from-bottom-2",
					)}
				>
					{toast.tone === "danger" ? <WarningCircle weight="fill" className="mt-0.5 size-4 shrink-0 text-danger" /> : <CheckCircle weight="fill" className="mt-0.5 size-4 shrink-0 text-success" />}
					<p className="flex-1 leading-snug select-text">{toast.message}</p>
					<button type="button" onClick={() => setToasts((list) => list.filter((t) => t.id !== toast.id))} className="text-muted hover:text-foreground">
						<X className="size-3.5" />
					</button>
				</div>
			))}
		</div>
	);
}
