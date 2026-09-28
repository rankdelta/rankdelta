/**
 * Rich Text Editor Component
 * 
 * Modern WYSIWYG editor with TipTap.
 * - Clean, user-friendly visual mode as default
 * - Floating toolbar on selection (Notion/Medium style)
 * - Markdown mode for advanced users
 * - Beautiful typography and formatting
 */

import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import Typography from '@tiptap/extension-typography';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import { useState, useEffect, useCallback, type ReactElement, useRef } from 'react';
import { marked } from 'marked';
import TurndownService from 'turndown';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { hrefOf, isSafeHref } from '../../lib/seoUrls';

interface RichTextEditorProps {
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	className?: string;
	minHeight?: string;
}

// Modern toolbar button component
interface ToolbarButtonProps {
	onClick: () => void;
	isActive?: boolean;
	disabled?: boolean;
	children: React.ReactNode;
	label: string;
	shortcut?: string;
}

const ToolbarButton = ({ onClick, isActive, disabled, children, label, shortcut }: ToolbarButtonProps): ReactElement => (
	<button
		className={`
			relative group flex items-center justify-center w-9 h-9 rounded-lg 
			transition-all duration-200 ease-out
			${isActive 
				? 'bg-gradient-to-br from-cosmic-cyan/20 to-cosmic-purple/20 text-cosmic-cyan shadow-sm' 
				: 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'
			}
			${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}
		`}
		disabled={disabled}
		onClick={onClick}
		type="button"
	>
		{children}
		{/* Tooltip */}
		<div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 bg-gray-900 text-white text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap z-50 pointer-events-none">
			<span>{label}</span>
			{shortcut && <span className="ml-1.5 text-gray-400 font-mono text-[10px]">{shortcut}</span>}
			<div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-gray-900" />
		</div>
	</button>
);

// Toolbar section divider
const ToolbarDivider = (): ReactElement => (
	<div className="w-px h-6 bg-gray-200 mx-1.5" />
);

// Toolbar section wrapper
const ToolbarSection = ({ children }: { children: React.ReactNode }): ReactElement => (
	<div className="flex items-center gap-0.5">{children}</div>
);

// Main toolbar component
interface EditorToolbarProps {
	editor: Editor | null;
	onAddLink: () => void;
	onAddImage: () => void;
}

const EditorToolbar = ({ editor, onAddLink, onAddImage }: EditorToolbarProps): ReactElement | null => {
	const { t } = useTranslation();
	if (!editor) return null;

	return (
		<div className="flex flex-wrap items-center gap-1 px-4 py-3 border-b border-gray-100 bg-gradient-to-b from-white to-gray-50/50">
			{/* Text formatting */}
			<ToolbarSection>
				<ToolbarButton
					isActive={editor.isActive('bold')}
					label={t('editor.bold')}
					onClick={() => editor.chain().focus().toggleBold().run()}
					shortcut="⌘B"
				>
					<svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
						<path d="M6 4h8a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6V4zm0 8h9a4 4 0 0 1 4 4 4 4 0 0 1-4 4H6v-8z" stroke="currentColor" strokeWidth="2" fill="none"/>
					</svg>
				</ToolbarButton>
				<ToolbarButton
					isActive={editor.isActive('italic')}
					label={t('editor.italic')}
					onClick={() => editor.chain().focus().toggleItalic().run()}
					shortcut="⌘I"
				>
					<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
						<line x1="19" y1="4" x2="10" y2="4"/>
						<line x1="14" y1="20" x2="5" y2="20"/>
						<line x1="15" y1="4" x2="9" y2="20"/>
					</svg>
				</ToolbarButton>
				<ToolbarButton
					isActive={editor.isActive('underline')}
					label={t('editor.underline')}
					onClick={() => editor.chain().focus().toggleUnderline().run()}
					shortcut="⌘U"
				>
					<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
						<path d="M6 3v7a6 6 0 0 0 12 0V3"/>
						<line x1="4" y1="21" x2="20" y2="21"/>
					</svg>
				</ToolbarButton>
				<ToolbarButton
					isActive={editor.isActive('strike')}
					label={t('editor.strike')}
					onClick={() => editor.chain().focus().toggleStrike().run()}
				>
					<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
						<line x1="5" y1="12" x2="19" y2="12"/>
						<path d="M16 6C16 6 14.5 4 12 4C9.5 4 7 5.5 7 8C7 10.5 9 11 12 12C15 13 17 13.5 17 16C17 18.5 14.5 20 12 20C9.5 20 8 18 8 18"/>
					</svg>
				</ToolbarButton>
			</ToolbarSection>

			<ToolbarDivider />

			{/* Headings */}
			<ToolbarSection>
				<ToolbarButton
					isActive={editor.isActive('heading', { level: 1 })}
					label={t('editor.heading1')}
					onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
				>
					<span className="font-bold text-sm">H1</span>
				</ToolbarButton>
				<ToolbarButton
					isActive={editor.isActive('heading', { level: 2 })}
					label={t('editor.heading2')}
					onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
				>
					<span className="font-bold text-sm">H2</span>
				</ToolbarButton>
				<ToolbarButton
					isActive={editor.isActive('heading', { level: 3 })}
					label={t('editor.heading3')}
					onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
				>
					<span className="font-bold text-sm">H3</span>
				</ToolbarButton>
			</ToolbarSection>

			<ToolbarDivider />

			{/* Text alignment */}
			<ToolbarSection>
				<ToolbarButton
					isActive={editor.isActive({ textAlign: 'left' })}
					label={t('editor.alignLeft')}
					onClick={() => editor.chain().focus().setTextAlign('left').run()}
				>
					<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
						<line x1="3" y1="6" x2="21" y2="6"/>
						<line x1="3" y1="12" x2="15" y2="12"/>
						<line x1="3" y1="18" x2="18" y2="18"/>
					</svg>
				</ToolbarButton>
				<ToolbarButton
					isActive={editor.isActive({ textAlign: 'center' })}
					label={t('editor.alignCenter')}
					onClick={() => editor.chain().focus().setTextAlign('center').run()}
				>
					<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
						<line x1="3" y1="6" x2="21" y2="6"/>
						<line x1="6" y1="12" x2="18" y2="12"/>
						<line x1="5" y1="18" x2="19" y2="18"/>
					</svg>
				</ToolbarButton>
				<ToolbarButton
					isActive={editor.isActive({ textAlign: 'right' })}
					label={t('editor.alignRight')}
					onClick={() => editor.chain().focus().setTextAlign('right').run()}
				>
					<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
						<line x1="3" y1="6" x2="21" y2="6"/>
						<line x1="9" y1="12" x2="21" y2="12"/>
						<line x1="6" y1="18" x2="21" y2="18"/>
					</svg>
				</ToolbarButton>
			</ToolbarSection>

			<ToolbarDivider />

			{/* Lists */}
			<ToolbarSection>
				<ToolbarButton
					isActive={editor.isActive('bulletList')}
					label={t('editor.bulletList')}
					onClick={() => editor.chain().focus().toggleBulletList().run()}
				>
					<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
						<circle cx="4" cy="6" r="1.5" fill="currentColor"/>
						<circle cx="4" cy="12" r="1.5" fill="currentColor"/>
						<circle cx="4" cy="18" r="1.5" fill="currentColor"/>
						<line x1="9" y1="6" x2="21" y2="6"/>
						<line x1="9" y1="12" x2="21" y2="12"/>
						<line x1="9" y1="18" x2="21" y2="18"/>
					</svg>
				</ToolbarButton>
				<ToolbarButton
					isActive={editor.isActive('orderedList')}
					label={t('editor.orderedList')}
					onClick={() => editor.chain().focus().toggleOrderedList().run()}
				>
					<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
						<text x="2" y="8" fontSize="8" fill="currentColor" stroke="none">1</text>
						<text x="2" y="14" fontSize="8" fill="currentColor" stroke="none">2</text>
						<text x="2" y="20" fontSize="8" fill="currentColor" stroke="none">3</text>
						<line x1="9" y1="6" x2="21" y2="6"/>
						<line x1="9" y1="12" x2="21" y2="12"/>
						<line x1="9" y1="18" x2="21" y2="18"/>
					</svg>
				</ToolbarButton>
			</ToolbarSection>

			<ToolbarDivider />

			{/* Block elements */}
			<ToolbarSection>
				<ToolbarButton
					isActive={editor.isActive('blockquote')}
					label={t('editor.blockquote')}
					onClick={() => editor.chain().focus().toggleBlockquote().run()}
				>
					<svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
						<path d="M4.583 17.321C3.553 16.227 3 15 3 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 01-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179zm10 0C13.553 16.227 13 15 13 13.011c0-3.5 2.457-6.637 6.03-8.188l.893 1.378c-3.335 1.804-3.987 4.145-4.247 5.621.537-.278 1.24-.375 1.929-.311 1.804.167 3.226 1.648 3.226 3.489a3.5 3.5 0 01-3.5 3.5c-1.073 0-2.099-.49-2.748-1.179z"/>
					</svg>
				</ToolbarButton>
				<ToolbarButton
					isActive={editor.isActive('codeBlock')}
					label={t('editor.codeBlock')}
					onClick={() => editor.chain().focus().toggleCodeBlock().run()}
				>
					<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
						<polyline points="16,18 22,12 16,6"/>
						<polyline points="8,6 2,12 8,18"/>
					</svg>
				</ToolbarButton>
				<ToolbarButton
					label={t('editor.horizontalRule')}
					onClick={() => editor.chain().focus().setHorizontalRule().run()}
				>
					<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
						<line x1="3" y1="12" x2="21" y2="12"/>
					</svg>
				</ToolbarButton>
			</ToolbarSection>

			<ToolbarDivider />

			{/* Links and images */}
			<ToolbarSection>
				<ToolbarButton
					isActive={editor.isActive('link')}
					label={t('editor.insertLink')}
					onClick={onAddLink}
					shortcut="⌘K"
				>
					<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
						<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
						<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
					</svg>
				</ToolbarButton>
				<ToolbarButton
					label={t('editor.insertImage')}
					onClick={onAddImage}
				>
					<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
						<rect x="3" y="3" width="18" height="18" rx="2"/>
						<circle cx="8.5" cy="8.5" r="1.5"/>
						<polyline points="21,15 16,10 5,21"/>
					</svg>
				</ToolbarButton>
			</ToolbarSection>

			<div className="flex-1" />

			{/* Undo/Redo */}
			<ToolbarSection>
				<ToolbarButton
					disabled={!editor.can().undo()}
					label={t('editor.undo')}
					onClick={() => editor.chain().focus().undo().run()}
					shortcut="⌘Z"
				>
					<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
						<path d="M3 10h10a5 5 0 0 1 5 5v2"/>
						<polyline points="3,10 8,5"/>
						<polyline points="3,10 8,15"/>
					</svg>
				</ToolbarButton>
				<ToolbarButton
					disabled={!editor.can().redo()}
					label={t('editor.redo')}
					onClick={() => editor.chain().focus().redo().run()}
					shortcut="⇧⌘Z"
				>
					<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
						<path d="M21 10H11a5 5 0 0 0-5 5v2"/>
						<polyline points="21,10 16,5"/>
						<polyline points="21,10 16,15"/>
					</svg>
				</ToolbarButton>
			</ToolbarSection>
		</div>
	);
};

// Link input modal
interface LinkInputProps {
	isOpen: boolean;
	onClose: () => void;
	onSubmit: (url: string) => void;
	initialUrl?: string;
}

const LinkInput = ({ isOpen, onClose, onSubmit, initialUrl = '' }: LinkInputProps): ReactElement | null => {
	const { t } = useTranslation();
	const [url, setUrl] = useState(initialUrl);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (isOpen) {
			setUrl(initialUrl);
			setTimeout(() => inputRef.current?.focus(), 100);
		}
	}, [isOpen, initialUrl]);

	if (!isOpen) return null;

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (url.trim()) {
			onSubmit(url.startsWith('http') ? url : `https://${url}`);
		} else {
			onSubmit('');
		}
		onClose();
	};

	return (
		<AnimatePresence>
			<motion.div
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				exit={{ opacity: 0 }}
				className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
				onClick={onClose}
			>
				<motion.div
					initial={{ opacity: 0, scale: 0.95, y: 20 }}
					animate={{ opacity: 1, scale: 1, y: 0 }}
					exit={{ opacity: 0, scale: 0.95, y: 20 }}
					className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md mx-4"
					onClick={(e) => e.stopPropagation()}
				>
					<h3 className="text-lg font-semibold text-gray-900 mb-4">{t('editor.linkModalTitle')}</h3>
					<form onSubmit={handleSubmit}>
						<input
							ref={inputRef}
							type="text"
							value={url}
							onChange={(e) => setUrl(e.target.value)}
							placeholder={t('editor.linkPlaceholder')}
							className="w-full px-4 py-3 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cosmic-cyan/50 focus:border-cosmic-cyan transition-all"
						/>
						<div className="flex gap-3 mt-4">
							<button
								type="button"
								onClick={() => {
									onSubmit('');
									onClose();
								}}
								className="flex-1 px-4 py-2.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-xl transition-colors font-medium"
							>
								{t('editor.removeLink')}
							</button>
							<button
								type="submit"
								className="flex-1 px-4 py-2.5 bg-cosmic-cyan text-white rounded-xl hover:bg-cosmic-cyan-dark transition-colors font-medium shadow-lg shadow-cosmic-cyan/20"
							>
								{t('editor.apply')}
							</button>
						</div>
					</form>
				</motion.div>
			</motion.div>
		</AnimatePresence>
	);
};

// Image input modal
interface ImageInputProps {
	isOpen: boolean;
	onClose: () => void;
	onSubmit: (url: string) => void;
}

const ImageInput = ({ isOpen, onClose, onSubmit }: ImageInputProps): ReactElement | null => {
	const { t } = useTranslation();
	const [url, setUrl] = useState('');
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (isOpen) {
			setUrl('');
			setTimeout(() => inputRef.current?.focus(), 100);
		}
	}, [isOpen]);

	if (!isOpen) return null;

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (url.trim()) {
			onSubmit(url);
		}
		onClose();
	};

	return (
		<AnimatePresence>
			<motion.div
				initial={{ opacity: 0 }}
				animate={{ opacity: 1 }}
				exit={{ opacity: 0 }}
				className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
				onClick={onClose}
			>
				<motion.div
					initial={{ opacity: 0, scale: 0.95, y: 20 }}
					animate={{ opacity: 1, scale: 1, y: 0 }}
					exit={{ opacity: 0, scale: 0.95, y: 20 }}
					className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md mx-4"
					onClick={(e) => e.stopPropagation()}
				>
					<h3 className="text-lg font-semibold text-gray-900 mb-4">{t('editor.imageModalTitle')}</h3>
					<form onSubmit={handleSubmit}>
						<input
							ref={inputRef}
							type="text"
							value={url}
							onChange={(e) => setUrl(e.target.value)}
							placeholder={t('editor.imagePlaceholder')}
							className="w-full px-4 py-3 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-cosmic-cyan/50 focus:border-cosmic-cyan transition-all"
						/>
						<p className="text-xs text-gray-500 mt-2">{t('editor.imageHint')}</p>
						<div className="flex gap-3 mt-4">
							<button
								type="button"
								onClick={onClose}
								className="flex-1 px-4 py-2.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-xl transition-colors font-medium"
							>
								{t('common.cancel')}
							</button>
							<button
								type="submit"
								disabled={!url.trim()}
								className="flex-1 px-4 py-2.5 bg-cosmic-cyan text-white rounded-xl hover:bg-cosmic-cyan-dark transition-colors font-medium shadow-lg shadow-cosmic-cyan/20 disabled:opacity-50 disabled:cursor-not-allowed"
							>
								{t('editor.insert')}
							</button>
						</div>
					</form>
				</motion.div>
			</motion.div>
		</AnimatePresence>
	);
};

// Turndown service for HTML to Markdown conversion
const turndownService = new TurndownService({
	headingStyle: 'atx',
	codeBlockStyle: 'fenced',
	bulletListMarker: '-',
});

turndownService.addRule('strikethrough', {
	filter: ['del', 's', 'strike'],
	replacement: (content) => `~~${content}~~`,
});

export const RichTextEditor = ({
	value,
	onChange,
	placeholder,
	className = '',
	minHeight = '400px',
}: RichTextEditorProps): ReactElement => {
	const { t } = useTranslation();
	const resolvedPlaceholder = placeholder ?? t('editor.placeholderDefault');
	const [isMarkdownMode, setIsMarkdownMode] = useState(false);
	const [markdownValue, setMarkdownValue] = useState(value);
	const [showLinkInput, setShowLinkInput] = useState(false);
	const [showImageInput, setShowImageInput] = useState(false);
	const [currentLinkUrl, setCurrentLinkUrl] = useState('');

	// Initialize TipTap editor
	const editor = useEditor({
		extensions: [
			StarterKit.configure({
				heading: {
					levels: [1, 2, 3, 4, 5, 6],
				},
			}),
			Link.configure({
				openOnClick: false,
				protocols: ['http', 'https', 'mailto'],
				isAllowedUri: (url, context) => isSafeHref(url) && context.defaultValidate(url),
				HTMLAttributes: {
					class: 'text-cosmic-cyan underline decoration-cosmic-cyan/30 hover:decoration-cosmic-cyan transition-colors cursor-pointer',
				},
			}),
			Image.configure({
				HTMLAttributes: {
					class: 'max-w-full h-auto rounded-xl my-6 shadow-lg',
				},
			}),
			Placeholder.configure({
				placeholder: resolvedPlaceholder,
				emptyEditorClass: 'is-editor-empty',
			}),
			Typography,
			Underline,
			TextAlign.configure({
				types: ['heading', 'paragraph'],
			}),
		],
		content: '',
		editorProps: {
			attributes: {
				class: 'prose prose-lg max-w-none focus:outline-none',
				style: `min-height: ${minHeight}`,
			},
		},
		onUpdate: ({ editor }) => {
			if (!isMarkdownMode) {
				const html = editor.getHTML();
				const markdown = turndownService.turndown(html);
				onChange(markdown);
			}
		},
	});

	// Convert Markdown to HTML and set editor content
	useEffect(() => {
		if (editor && value && !isMarkdownMode) {
			const currentMarkdown = turndownService.turndown(editor.getHTML());
			if (currentMarkdown.trim() !== value.trim()) {
				const html = marked.parse(value) as string;
				editor.commands.setContent(html);
			}
		}
	}, [value, editor, isMarkdownMode]);

	// Handle mode switch
	const handleModeSwitch = useCallback(() => {
		if (isMarkdownMode) {
			const html = marked.parse(markdownValue) as string;
			editor?.commands.setContent(html);
		} else {
			if (editor) {
				const html = editor.getHTML();
				const markdown = turndownService.turndown(html);
				setMarkdownValue(markdown);
			}
		}
		setIsMarkdownMode(!isMarkdownMode);
	}, [isMarkdownMode, markdownValue, editor]);

	// Handle Markdown text change
	const handleMarkdownChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
		const newValue = e.target.value;
		setMarkdownValue(newValue);
		onChange(newValue);
	}, [onChange]);

	// Handle link
	const handleAddLink = useCallback(() => {
		const previousUrl = editor?.getAttributes('link')['href'] as string | undefined;
		setCurrentLinkUrl(previousUrl || '');
		setShowLinkInput(true);
	}, [editor]);

	const handleLinkSubmit = useCallback((url: string) => {
		if (!editor) return;
		if (url === '') {
			editor.chain().focus().extendMarkRange('link').unsetLink().run();
			return;
		}
		const trimmed = url.trim();
		const safe = /^mailto:/i.test(trimmed) && isSafeHref(trimmed) ? trimmed : hrefOf(trimmed);
		if (!safe) return;
		editor.chain().focus().extendMarkRange('link').setLink({ href: safe }).run();
	}, [editor]);

	// Handle image
	const handleAddImage = useCallback(() => {
		setShowImageInput(true);
	}, []);

	const handleImageSubmit = useCallback((url: string) => {
		const safe = hrefOf(url);
		if (!safe || !editor) return;
		editor.chain().focus().setImage({ src: safe }).run();
	}, [editor]);

	return (
		<div className={`overflow-hidden bg-white ${className}`}>
			{/* Modern Mode toggle */}
			<div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-gray-50 to-white border-b border-gray-100">
				<div className="flex items-center gap-2">
					<span className="text-sm font-medium text-gray-500">{t('editor.modeLabel')}</span>
					<div className="flex bg-gray-100 rounded-xl p-1">
						<button
							className={`px-4 py-2 text-sm font-medium rounded-lg transition-all duration-300 ${
								!isMarkdownMode 
									? 'bg-white text-gray-900 shadow-sm' 
									: 'text-gray-500 hover:text-gray-700'
							}`}
							onClick={() => isMarkdownMode && handleModeSwitch()}
							type="button"
						>
							<span className="flex items-center gap-2">
								<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
									<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
									<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
								</svg>
								{t('editor.modeVisual')}
							</span>
						</button>
						<button
							className={`px-4 py-2 text-sm font-medium rounded-lg transition-all duration-300 ${
								isMarkdownMode 
									? 'bg-white text-gray-900 shadow-sm' 
									: 'text-gray-500 hover:text-gray-700'
							}`}
							onClick={() => !isMarkdownMode && handleModeSwitch()}
							type="button"
						>
							<span className="flex items-center gap-2">
								<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
									<polyline points="16,18 22,12 16,6"/>
									<polyline points="8,6 2,12 8,18"/>
								</svg>
								{t('editor.modeMarkdown')}
							</span>
						</button>
					</div>
				</div>
				<div className="text-xs text-gray-400 flex items-center gap-2">
					<span className={`w-2 h-2 rounded-full ${isMarkdownMode ? 'bg-gray-400' : 'bg-cosmic-green'}`} />
					{isMarkdownMode ? t('editor.statusMarkdown') : t('editor.statusWysiwyg')}
				</div>
			</div>

			{/* WYSIWYG Editor */}
			{!isMarkdownMode && (
				<>
					<EditorToolbar 
						editor={editor} 
						onAddLink={handleAddLink}
						onAddImage={handleAddImage}
					/>
					
					<div 
						className="overflow-y-auto editor-container" 
						style={{ maxHeight: '70vh' }}
					>
						<div className="px-8 py-6 max-w-4xl mx-auto">
							<EditorContent 
								editor={editor} 
								className="rich-text-editor"
							/>
						</div>
					</div>
				</>
			)}

			{/* Markdown Editor */}
			{isMarkdownMode && (
				<div className="relative">
					<textarea
						className="w-full p-8 font-mono text-sm focus:outline-none resize-none bg-gradient-to-b from-gray-900 to-gray-950 text-gray-100 leading-relaxed"
						onChange={handleMarkdownChange}
						placeholder={resolvedPlaceholder}
						style={{ minHeight }}
						value={markdownValue}
					/>
				</div>
			)}

			{/* Link input modal */}
			<LinkInput
				isOpen={showLinkInput}
				onClose={() => setShowLinkInput(false)}
				onSubmit={handleLinkSubmit}
				initialUrl={currentLinkUrl}
			/>

			{/* Image input modal */}
			<ImageInput
				isOpen={showImageInput}
				onClose={() => setShowImageInput(false)}
				onSubmit={handleImageSubmit}
			/>

			{/* Enhanced Editor styles */}
			<style>{`
				.rich-text-editor .ProseMirror {
					min-height: ${minHeight};
					outline: none;
				}
				
				/* Placeholder styling */
				.rich-text-editor .ProseMirror p.is-editor-empty:first-child::before {
					color: #9ca3af;
					content: attr(data-placeholder);
					float: left;
					height: 0;
					pointer-events: none;
					font-style: italic;
				}
				
				/* Typography - Beautiful heading hierarchy */
				.rich-text-editor .ProseMirror h1 {
					font-size: 2.25em;
					font-weight: 800;
					margin: 1.5em 0 0.75em;
					color: #111827;
					letter-spacing: -0.025em;
					line-height: 1.2;
				}
				
				.rich-text-editor .ProseMirror h2 {
					font-size: 1.75em;
					font-weight: 700;
					margin: 1.25em 0 0.6em;
					color: #1f2937;
					letter-spacing: -0.02em;
					line-height: 1.3;
				}
				
				.rich-text-editor .ProseMirror h3 {
					font-size: 1.375em;
					font-weight: 600;
					margin: 1.1em 0 0.5em;
					color: #374151;
					line-height: 1.35;
				}
				
				.rich-text-editor .ProseMirror h4 {
					font-size: 1.125em;
					font-weight: 600;
					margin: 1em 0 0.5em;
					color: #4b5563;
				}
				
				/* Paragraphs */
				.rich-text-editor .ProseMirror p {
					margin: 0.75em 0;
					line-height: 1.8;
					color: #374151;
					font-size: 1.0625rem;
				}
				
				/* Links */
				.rich-text-editor .ProseMirror a {
					color: #00d9ff;
					text-decoration: underline;
					text-decoration-color: rgba(0, 217, 255, 0.3);
					text-underline-offset: 3px;
					transition: all 0.2s ease;
				}
				
				.rich-text-editor .ProseMirror a:hover {
					color: #a855f7;
					text-decoration-color: #a855f7;
				}
				
				/* Lists - Clean and readable */
				.rich-text-editor .ProseMirror ul,
				.rich-text-editor .ProseMirror ol {
					margin: 1em 0;
					padding-left: 1.75em;
				}
				
				.rich-text-editor .ProseMirror ul {
					list-style-type: disc;
				}
				
				.rich-text-editor .ProseMirror ul ul {
					list-style-type: circle;
				}
				
				.rich-text-editor .ProseMirror ol {
					list-style-type: decimal;
				}
				
				.rich-text-editor .ProseMirror li {
					margin: 0.5em 0;
					line-height: 1.7;
					color: #374151;
				}
				
				.rich-text-editor .ProseMirror li > p {
					margin: 0;
				}
				
				/* Blockquote - Elegant styling */
				.rich-text-editor .ProseMirror blockquote {
					border-left: 4px solid #00d9ff;
					margin: 1.5em 0;
					padding: 1em 0 1em 1.5em;
					background: linear-gradient(to right, rgba(0, 217, 255, 0.05), transparent);
					border-radius: 0 12px 12px 0;
				}
				
				.rich-text-editor .ProseMirror blockquote p {
					color: #4b5563;
					font-style: italic;
					margin: 0;
				}
				
				/* Code - Inline and block */
				.rich-text-editor .ProseMirror code {
					background: #f3f4f6;
					padding: 0.2em 0.5em;
					border-radius: 6px;
					font-family: 'Fira Code', monospace;
					font-size: 0.875em;
					color: #be185d;
					border: 1px solid #e5e7eb;
				}
				
				.rich-text-editor .ProseMirror pre {
					background: linear-gradient(135deg, #1e1e2e 0%, #181825 100%);
					color: #cdd6f4;
					padding: 1.25em 1.5em;
					border-radius: 12px;
					overflow-x: auto;
					margin: 1.5em 0;
					box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
					border: 1px solid rgba(255, 255, 255, 0.05);
				}
				
				.rich-text-editor .ProseMirror pre code {
					background: none;
					padding: 0;
					color: inherit;
					border: none;
					font-size: 0.875em;
				}
				
				/* Horizontal rule */
				.rich-text-editor .ProseMirror hr {
					border: none;
					height: 1px;
					background: linear-gradient(to right, transparent, #d1d5db, transparent);
					margin: 2.5em 0;
				}
				
				/* Images */
				.rich-text-editor .ProseMirror img {
					max-width: 100%;
					height: auto;
					border-radius: 12px;
					margin: 1.5em 0;
					box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
				}
				
				.rich-text-editor .ProseMirror img.ProseMirror-selectednode {
					outline: 3px solid #00d9ff;
					outline-offset: 2px;
				}
				
				/* Strong and emphasis */
				.rich-text-editor .ProseMirror strong {
					font-weight: 700;
					color: #111827;
				}
				
				.rich-text-editor .ProseMirror em {
					font-style: italic;
				}
				
				.rich-text-editor .ProseMirror u {
					text-decoration: underline;
					text-decoration-color: currentColor;
					text-underline-offset: 3px;
				}
				
				.rich-text-editor .ProseMirror s {
					text-decoration: line-through;
					color: #9ca3af;
				}
				
				/* Selection */
				.rich-text-editor .ProseMirror ::selection {
					background: rgba(0, 217, 255, 0.2);
				}
				
				/* Focus states */
				.editor-container:focus-within {
					box-shadow: inset 0 0 0 2px rgba(0, 217, 255, 0.1);
				}
			`}</style>
		</div>
	);
};

export default RichTextEditor;
