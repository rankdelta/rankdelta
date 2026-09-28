/**
 * Sidebar Component
 * 
 * Navigation sidebar inspired by RankPill design
 * Clean, modern sidebar with navigation and user info
 */

import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from '@tanstack/react-router';
import { useAuth } from '../../hooks/useAuth';
import { useContentProposals } from '../../hooks/useContentProposals';
import { useTranslation } from 'react-i18next';
import { isLegacyAgentUiAvailable } from '../../config/productMode';
import { LanguageSwitcher } from '../ui/LanguageSwitcher';
import { motion, AnimatePresence } from 'framer-motion';

interface NavItem {
	id: string;
	label: string;
	icon: string;
	path: string;
	search?: Record<string, string>;
	badge?: number | string;
}

export const Sidebar = () => {
	const navigate = useNavigate();
	const location = useLocation();
	const { user, signOut } = useAuth();
	const { t } = useTranslation();
	const showLegacyAgent = isLegacyAgentUiAvailable();
	const { data: proposals } = useContentProposals(undefined, { enabled: showLegacyAgent });
	const pendingProposalsCount = proposals?.filter((p) => p.status === 'pending').length || 0;
	const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
	const [isMobile, setIsMobile] = useState(false);

	// Detect mobile screen size
	useEffect(() => {
		const checkMobile = () => {
			setIsMobile(window.innerWidth < 768);
		};
		checkMobile();
		window.addEventListener('resize', checkMobile);
		return () => window.removeEventListener('resize', checkMobile);
	}, []);

	// Close mobile menu when route changes
	useEffect(() => {
		setIsMobileMenuOpen(false);
	}, [location.pathname]);

	const legacyNavItems: NavItem[] = [
		{ id: 'calendar', label: t('navigation.calendar'), icon: '📅', path: '/dashboard' },
		{
			id: 'proposals',
			label: t('navigation.proposals'),
			icon: '✨',
			path: '/proposals',
			badge: pendingProposalsCount > 0 ? pendingProposalsCount : undefined,
		},
		{ id: 'projects', label: t('navigation.projects'), icon: '📁', path: '/projects' },
		{ id: 'content-updates', label: t('navigation.contentUpdates'), icon: '🔄', path: '/content-updates' },
		{ id: 'analytics', label: t('navigation.analytics'), icon: '📊', path: '/rankings/' },
		{ id: 'reports', label: t('navigation.reports'), icon: '📈', path: '/reports' },
		{
			id: 'connect-ai',
			label: t('navigation.connectAI'),
			icon: '🔌',
			path: '/settings',
			search: { tab: 'mcp' },
		},
		{ id: 'settings', label: t('navigation.settings'), icon: '⚙️', path: '/settings' },
	];

	/** Visibility-first: tracker hub, workspaces, GEO analytics, settings */
	const visibilityNavItems: NavItem[] = [
		{ id: 'visibility', label: t('navigation.visibility'), icon: '📡', path: '/visibility/' },
		{ id: 'projects', label: t('navigation.stores'), icon: '📁', path: '/projects' },
		{ id: 'analytics', label: t('navigation.analytics'), icon: '📊', path: '/rankings/' },
		{ id: 'reports', label: t('navigation.reports'), icon: '📈', path: '/reports/portal' },
		{ id: 'agent', label: 'Agente AI', icon: '🤖', path: '/agent/' },
		{
			id: 'connect-ai',
			label: t('navigation.connectAI'),
			icon: '🔌',
			path: '/settings',
			search: { tab: 'mcp' },
		},
		{ id: 'settings', label: t('navigation.settings'), icon: '⚙️', path: '/settings' },
	];

	const navItems = showLegacyAgent ? legacyNavItems : visibilityNavItems;
	const productTagline = showLegacyAgent ? t('navigation.taglineContent') : t('navigation.taglineVisibility');

	const isActive = (item: NavItem) => {
		if (item.id === 'connect-ai') {
			const tab = new URLSearchParams(location.searchStr).get('tab');
			return location.pathname === '/settings' && tab === 'mcp';
		}
		if (item.id === 'settings') {
			const tab = new URLSearchParams(location.searchStr).get('tab');
			return location.pathname === '/settings' && tab !== 'mcp';
		}
		return location.pathname === item.path || location.pathname.startsWith(item.path + '/');
	};

	const sidebarContent = (
		<>
			{/* Logo */}
			<div className="p-5 border-b border-gray-100">
				<div className="flex items-center gap-3">
					<div className="w-10 h-10 bg-gradient-to-br from-teal-500 to-cyan-500 rounded-xl flex items-center justify-center shadow-md shadow-teal-500/20">
						<span className="text-xl">🚀</span>
					</div>
					<div>
						<h1 className="text-lg font-bold text-gray-900">Rankdelta.ai</h1>
						<p className="text-xs text-gray-500 font-medium">{productTagline}</p>
					</div>
				</div>
			</div>

			{/* Navigation */}
			<nav className="flex-1 p-3 space-y-1 overflow-y-auto">
				{navItems.map((item) => (
					<motion.button
						key={item.id}
						whileHover={{ x: 2 }}
						whileTap={{ scale: 0.98 }}
						onClick={() =>
							navigate({
								to: item.path as any,
								...(item.search ? { search: item.search as any } : {}),
							})
						}
						className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all relative ${
							isActive(item)
								? 'bg-teal-50 text-teal-700 font-semibold'
								: 'text-gray-600 hover:text-gray-900 hover:bg-gray-50 font-medium'
						}`}
					>
						<span className="text-base">{item.icon}</span>
						<span className="text-sm">{item.label}</span>
						{item.badge && (
							<span className="ml-auto px-2 py-0.5 bg-gradient-to-r from-violet-500 to-purple-500 text-white text-xs rounded-full font-semibold min-w-[20px] text-center shadow-sm">
								{item.badge}
							</span>
						)}
						{isActive(item) && (
							<motion.div
								layoutId="activeNav"
								className="absolute left-0 top-1 bottom-1 w-1 bg-gradient-to-b from-teal-500 to-cyan-500 rounded-r-full"
								transition={{ type: 'spring', stiffness: 300, damping: 30 }}
							/>
						)}
					</motion.button>
				))}
			</nav>

			{/* Credits / Status */}
			<div className="p-4 border-t border-gray-100 space-y-3">
				{/* Language Switcher */}
				<LanguageSwitcher />
				
				{/* Credits */}
				<div className="bg-gradient-to-br from-slate-50 to-gray-100 rounded-xl p-3.5 border border-gray-200">
					<div className="flex items-center justify-between mb-2">
						<span className="text-xs font-medium text-gray-600">{t('credits.title')}</span>
						<span className="text-xs font-bold text-emerald-600">{t('credits.unlimited')}</span>
					</div>
					<div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
						<div className="h-full bg-gradient-to-r from-teal-500 to-emerald-500 w-full rounded-full" />
					</div>
				</div>

				{/* User Info */}
				<div className="flex items-center gap-3 p-3 bg-white rounded-xl border border-gray-200 hover:border-gray-300 transition-colors">
					<div className="w-9 h-9 bg-gradient-to-br from-violet-500 to-purple-500 rounded-full flex items-center justify-center text-sm font-bold text-white shadow-sm">
						{user?.email?.[0]?.toUpperCase() || 'U'}
					</div>
					<div className="flex-1 min-w-0">
						<p className="text-sm font-semibold text-gray-900 truncate">
							{user?.email?.split('@')[0] || 'User'}
						</p>
						<p className="text-xs text-gray-500 truncate">{user?.email}</p>
					</div>
					<button
						onClick={() => signOut()}
						className="text-gray-400 hover:text-gray-600 transition-colors p-1.5 hover:bg-gray-100 rounded-lg"
						title={t('user.logout')}
					>
						<svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
						</svg>
					</button>
				</div>
			</div>
		</>
	);

	// Mobile version with hamburger menu
	if (isMobile) {
		return (
			<>
				{/* Mobile Header */}
				<header className="md:hidden fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200">
					<div className="flex items-center justify-between p-4">
						<div className="flex items-center gap-3">
							<div className="w-10 h-10 bg-gradient-to-br from-teal-500 to-cyan-500 rounded-xl flex items-center justify-center shadow-md shadow-teal-500/20">
								<span className="text-xl">🚀</span>
							</div>
							<div>
								<h1 className="text-lg font-bold text-gray-900">Rankdelta.ai</h1>
								<p className="text-[10px] text-gray-500 font-medium leading-tight">{productTagline}</p>
							</div>
						</div>
						<button
							onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
							className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
							aria-label={t('appNav.menu')}
						>
							<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								{isMobileMenuOpen ? (
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
								) : (
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
								)}
							</svg>
						</button>
					</div>
				</header>

				{/* Mobile Sidebar Overlay */}
				<AnimatePresence>
					{isMobileMenuOpen && (
						<>
							<motion.div
								initial={{ opacity: 0 }}
								animate={{ opacity: 1 }}
								exit={{ opacity: 0 }}
								onClick={() => setIsMobileMenuOpen(false)}
								className="fixed inset-0 bg-black/50 z-40 md:hidden"
							/>
							<motion.aside
								initial={{ x: '-100%' }}
								animate={{ x: 0 }}
								exit={{ x: '-100%' }}
								transition={{ type: 'spring', damping: 30, stiffness: 300 }}
								className="fixed left-0 top-0 bottom-0 w-64 bg-white border-r border-gray-200 flex flex-col z-50 md:hidden"
							>
								{sidebarContent}
							</motion.aside>
						</>
					)}
				</AnimatePresence>

				{/* Spacer for mobile header */}
				<div className="h-16 md:hidden" />
			</>
		);
	}

	// Desktop version
	return (
		<aside className="hidden md:flex w-64 bg-white border-r border-gray-200 flex-col h-screen sticky top-0">
			{sidebarContent}
		</aside>
	);
};

