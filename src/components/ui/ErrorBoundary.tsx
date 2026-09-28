import { WarningCircle } from "@phosphor-icons/react";
import { Component, type ReactNode } from "react";

/**
 * Keeps a drawing error in one part of the window from blanking all of it: that
 * part shows what went wrong and a way back, and the rest keeps working. The
 * project lives in the main process, so nothing is lost either way.
 */
export class ErrorBoundary extends Component<
	{ name: string; children: ReactNode; whole?: boolean },
	{ error: Error | null }
> {
	state = { error: null as Error | null };

	static getDerivedStateFromError(error: Error) {
		return { error };
	}

	componentDidCatch(error: Error, info: { componentStack?: string | null }) {
		console.error(
			`[${this.props.name}] ${error.stack ?? error.message}${info.componentStack ?? ""}`,
		);
	}

	render() {
		const { error } = this.state;
		if (!error) return this.props.children;
		const retry = () => this.setState({ error: null });
		if (this.props.whole)
			return (
				<div className="flex h-full flex-col items-center justify-center gap-4 bg-background p-8 text-center text-foreground">
					<WarningCircle className="size-8 text-danger" />
					<div className="flex max-w-md flex-col gap-1.5">
						<p className="text-[14px] font-medium">Cue couldn't draw the window.</p>
						<p className="text-[12px] text-muted">
							Your project is safe: it is kept outside the window and saved as you work.
						</p>
						<p className="mt-1 rounded-md bg-default px-2.5 py-1.5 font-mono text-[11px] break-words text-muted select-text">
							{error.message}
						</p>
					</div>
					<div className="flex gap-2">
						<button
							type="button"
							onClick={retry}
							className="h-8 rounded-md bg-default px-3 text-[12px] hover:bg-default/70"
						>
							Try again
						</button>
						<button
							type="button"
							onClick={() => location.reload()}
							className="h-8 rounded-md bg-accent px-3 text-[12px] text-accent-foreground"
						>
							Reload the window
						</button>
					</div>
				</div>
			);
		return (
			<div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
				<WarningCircle className="size-5 text-danger" />
				<p className="text-[12px]">The {this.props.name} hit a problem.</p>
				<p className="max-w-xs font-mono text-[10px] break-words text-muted select-text">
					{error.message}
				</p>
				<button
					type="button"
					onClick={retry}
					className="h-7 rounded-md bg-default px-2.5 text-[12px] hover:bg-default/70"
				>
					Try again
				</button>
			</div>
		);
	}
}
