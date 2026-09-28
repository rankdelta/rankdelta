import { createFileRoute, redirect } from '@tanstack/react-router';
import { ProjectDetail } from '../pages/ProjectDetail';
import { isLegacyAgentUiAvailable } from '../config/productMode';

export const Route = createFileRoute('/projects/$projectId/')({
	beforeLoad: ({ params }) => {
		if (!isLegacyAgentUiAvailable()) {
			throw redirect({
				href: `/visibility/${params.projectId}/`,
			});
		}
	},
	component: ProjectDetail,
});

