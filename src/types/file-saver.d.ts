/**
 * Minimal type declarations for the `file-saver` package.
 *
 * The published package ships no types and `@types/file-saver` is not installed.
 * This declaration covers only the surface area used in the codebase
 * (`saveAs`), mirroring src/types/turndown.d.ts.
 */
declare module 'file-saver' {
	export function saveAs(
		data: Blob | string,
		filename?: string,
		options?: { autoBom?: boolean }
	): void;
	const fileSaver: { saveAs: typeof saveAs };
	export default fileSaver;
}
