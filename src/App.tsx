import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { RouterProvider } from "@tanstack/react-router";
import i18next from "i18next";
import { useEffect } from "react";
import type { FunctionComponent } from "./common/types";
import type { TanstackRouter } from "./main";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { GlobalToastHost, showGlobalToast } from "./components/ui/GlobalToast";
import { initAnalytics, trackPageview } from "./lib/analytics";

const queryClient = new QueryClient({
	// Every failed mutation gets a generic toast (opt out per-mutation with `meta: { silent: true }`).
	// Raw error text only in DEV — production users never see internals.
	mutationCache: new MutationCache({
		onError: (error, _vars, _ctx, mutation) => {
			if (mutation.options.meta?.["silent"]) return;
			const generic = i18next.t("common.mutationError", "Something went wrong. Please try again.");
			const message = import.meta.env.DEV && error instanceof Error && error.message
				? `${generic} (${error.message})`
				: generic;
			showGlobalToast(message, "error");
		},
	}),
	defaultOptions: {
		queries: {
			retry: 1,
			refetchOnWindowFocus: false,
		},
	},
});

type AppProps = { router: TanstackRouter };

const App = ({ router }: AppProps): FunctionComponent => {
	useEffect(() => {
		initAnalytics();
		trackPageview(window.location.href); // initial load
		const unsub = router.subscribe("onResolved", () => trackPageview(window.location.href));
		return unsub;
	}, [router]);

	return (
		<ErrorBoundary>
			<QueryClientProvider client={queryClient}>
				<RouterProvider router={router} />
				<GlobalToastHost />
				{import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} position="bottom" />}
			</QueryClientProvider>
		</ErrorBoundary>
	);
};

export default App;
