import { createRouter } from "@tanstack/react-router";
import React from "react";
import i18next from "i18next";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import { routeTree } from "./routeTree.gen.ts";
import "./styles/tailwind.css";
import "./styles/report-print.css";
import "./styles/report-screen.css";
import "./common/i18n";

/** Dark, branded crash fallback — a runtime error must never leave the user on a blank white page. */
function RouteErrorFallback({ error }: { error: Error }) {
	React.useEffect(() => {
		console.error("RouteErrorFallback caught an error:", error);
	}, [error]);
	// Raw error text only in DEV: production users get a generic, translated message (no internals leak).
	const message = import.meta.env.DEV
		? error?.message
		: i18next.t("errorBoundary.genericMessage", "An unexpected error occurred. Please reload the page.");
	return (
		<div
			style={{
				display: "flex",
				justifyContent: "center",
				alignItems: "center",
				minHeight: "100vh",
				backgroundColor: "#0a0a0f",
				color: "#fff",
				fontFamily: "system-ui, -apple-system, sans-serif",
				padding: "24px",
			}}
		>
			<div style={{ textAlign: "center", maxWidth: 440 }}>
				<div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
				<h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>{i18next.t("errorBoundary.title", "Something went wrong")}</h1>
				<p style={{ fontSize: 14, opacity: 0.6, marginBottom: 6 }}>
					{i18next.t("errorBoundary.safeNote", "Your work is safe: generated articles are saved in your history.")}
				</p>
				<p style={{ fontSize: 12, opacity: 0.35, marginBottom: 20, wordBreak: "break-word" }}>{message}</p>
				<button
					onClick={() => window.location.reload()}
					style={{
						padding: "10px 24px",
						borderRadius: 9999,
						border: "none",
						background: "#fff",
						color: "#000",
						fontWeight: 600,
						fontSize: 14,
						cursor: "pointer",
					}}
				>
					{i18next.t("errorBoundary.reload", "Reload page")}
				</button>
			</div>
		</div>
	);
}

const router = createRouter({ routeTree, defaultErrorComponent: RouteErrorFallback });

export type TanstackRouter = typeof router;

declare module "@tanstack/react-router" {
	interface Register {
		// This infers the type of our router and registers it across your entire project
		router: TanstackRouter;
	}
}

// Prerender injects a crawler shell into #root; always mount so /docs/mcp and other SPA routes render.
const rootElement = document.querySelector("#root") as Element;
const root = ReactDOM.createRoot(rootElement);
root.render(
	<React.StrictMode>
		<React.Suspense fallback={
			<div style={{
				display: 'flex',
				justifyContent: 'center',
				alignItems: 'center',
				height: '100vh',
				width: '100vw',
				backgroundColor: '#0a0e27',
				color: '#ffffff',
				fontFamily: 'system-ui, -apple-system, sans-serif'
			}}>
				<div style={{ textAlign: 'center' }}>
					<div style={{ fontSize: '24px', marginBottom: '16px' }}>Loading Rankdelta...</div>
					<div style={{ fontSize: '14px', opacity: 0.7 }}>Please wait</div>
				</div>
			</div>
		}>
			<App router={router} />
		</React.Suspense>
	</React.StrictMode>
);
