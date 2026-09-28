/**
 * Minimal type declarations for the `turndown` package.
 *
 * The published package ships no types and `@types/turndown` is not installed.
 * This declaration covers only the surface area used in the codebase
 * (constructor options, `addRule`, and `turndown`).
 */
declare module 'turndown' {
	interface Options {
		headingStyle?: 'setext' | 'atx';
		hr?: string;
		bulletListMarker?: '-' | '+' | '*';
		codeBlockStyle?: 'indented' | 'fenced';
		fence?: '```' | '~~~';
		emDelimiter?: '_' | '*';
		strongDelimiter?: '__' | '**';
		linkStyle?: 'inlined' | 'referenced';
		linkReferenceStyle?: 'full' | 'collapsed' | 'shortcut';
	}

	interface Node {
		nodeName: string;
		[key: string]: unknown;
	}

	interface Rule {
		filter: string | string[] | ((node: Node, options: Options) => boolean);
		replacement: (content: string, node: Node, options: Options) => string;
	}

	class TurndownService {
		constructor(options?: Options);
		turndown(html: string | Node): string;
		addRule(key: string, rule: Rule): this;
		keep(filter: Rule['filter']): this;
		remove(filter: Rule['filter']): this;
		use(plugin: ((service: TurndownService) => void) | Array<(service: TurndownService) => void>): this;
	}

	export default TurndownService;
}
