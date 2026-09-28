/**
 * Topical Map Component
 * 
 * Interactive visualization of keyword clusters using React Flow.
 */

import { useCallback, useMemo } from 'react';
import ReactFlow, {
	Node,
	Edge,
	Controls,
	Background,
	MiniMap,
	useNodesState,
	useEdgesState,
	addEdge,
	Connection,
} from 'reactflow';
import 'reactflow/dist/style.css';
import type { Cluster } from '../../services/clustering';

interface TopicalMapProps {
	clusters: Cluster[];
	onNodeClick?: (cluster: Cluster) => void;
}

export const TopicalMap = ({ clusters, onNodeClick }: TopicalMapProps) => {
	// Convert clusters to React Flow nodes and edges
	const initialNodes: Node[] = useMemo(() => {
		return clusters.map((cluster, index) => {
			const angle = (index / clusters.length) * 2 * Math.PI;
			const radius = 200;
			const x = 400 + radius * Math.cos(angle);
			const y = 400 + radius * Math.sin(angle);

			return {
				id: `cluster-${index}`,
				type: 'default',
				position: { x, y },
				data: {
					label: (
						<div className="text-center">
							<div className="font-bold text-cosmic-cyan">{cluster.name}</div>
							<div className="text-xs text-gray-400 mt-1">{cluster.keywords.length} keywords</div>
						</div>
					),
					cluster: cluster as Cluster,
				},
				style: {
					background: 'rgba(0, 217, 255, 0.1)',
					border: '2px solid #00d9ff',
					borderRadius: '8px',
					padding: '10px',
					minWidth: '150px',
					color: '#fff',
				},
			};
		});
	}, [clusters]);

	const initialEdges: Edge[] = useMemo(() => {
		const edges: Edge[] = [];
		// Create edges between related clusters (simplified)
		for (let i = 0; i < clusters.length; i++) {
			const cluster1 = clusters[i];
			if (!cluster1) continue;
			
			for (let j = i + 1; j < clusters.length; j++) {
				const cluster2 = clusters[j];
				if (!cluster2) continue;
				
				// Check if clusters share keywords
				const cluster1Keywords = cluster1.keywords.map((k) => k.toLowerCase());
				const cluster2Keywords = cluster2.keywords.map((k) => k.toLowerCase());
				const hasCommon = cluster1Keywords.some((k) => cluster2Keywords.includes(k));

				if (hasCommon) {
					edges.push({
						id: `edge-${i}-${j}`,
						source: `cluster-${i}`,
						target: `cluster-${j}`,
						type: 'smoothstep',
						style: { stroke: '#00d9ff', strokeWidth: 2 },
					});
				}
			}
		}
		return edges;
	}, [clusters]);

	const [nodes, , onNodesChange] = useNodesState(initialNodes);
	const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

	const onConnect = useCallback(
		(params: Connection) => setEdges((eds) => addEdge(params, eds)),
		[setEdges]
	);

	const onNodeClickHandler = useCallback(
		(_event: React.MouseEvent, node: Node) => {
			if (node.data && typeof node.data === 'object' && 'cluster' in node.data) {
				const cluster = (node.data as { cluster?: Cluster }).cluster;
				if (cluster) {
					onNodeClick?.(cluster);
				}
			}
		},
		[onNodeClick]
	);

	return (
		<div className="w-full h-[600px] bg-cosmic-dark rounded-lg border border-cosmic-cyan/20">
			<ReactFlow
				nodes={nodes}
				edges={edges}
				onNodesChange={onNodesChange}
				onEdgesChange={onEdgesChange}
				onConnect={onConnect}
				onNodeClick={onNodeClickHandler}
				fitView
			>
				<Background color="#1a2a4d" gap={16} />
				<Controls className="bg-cosmic-dark-soft border border-cosmic-cyan/20" />
				<MiniMap
					className="bg-cosmic-dark-soft border border-cosmic-cyan/20"
					nodeColor="#00d9ff"
					maskColor="rgba(15, 23, 41, 0.8)"
				/>
			</ReactFlow>
		</div>
	);
};

