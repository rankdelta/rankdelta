const STORAGE_KEY = 'astroseo_last_visibility_store_id';

export function setLastVisibilityStoreId(projectId: string): void {
	try {
		localStorage.setItem(STORAGE_KEY, projectId);
	} catch {
		/* ignore quota / private mode */
	}
}

export function getLastVisibilityStoreId(): string | null {
	try {
		return localStorage.getItem(STORAGE_KEY);
	} catch {
		return null;
	}
}
