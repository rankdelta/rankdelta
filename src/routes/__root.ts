import { createRootRoute, Outlet } from "@tanstack/react-router";
import { NotFoundPage } from "../pages/NotFoundPage";

export const Route = createRootRoute({
	component: Outlet,
	notFoundComponent: NotFoundPage,
});
