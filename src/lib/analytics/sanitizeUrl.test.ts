import { describe, expect, it } from "vitest";
import { redactSharePath, sanitizeUrlForAnalytics } from "./sanitizeUrl";

describe("sanitizeUrlForAnalytics", () => {
	it("drops the implicit-flow token fragment", () => {
		const out = sanitizeUrlForAnalytics(
			"https://rankdelta.ai/reset-password#access_token=eyJ.a.b&refresh_token=abc&type=recovery",
		);
		expect(out).toBe("https://rankdelta.ai/reset-password");
	});
	it("drops PKCE code and other auth params but keeps benign ones", () => {
		const out = sanitizeUrlForAnalytics("https://rankdelta.ai/auth/callback?code=xyz&state=s&utm_source=x");
		expect(out).toBe("https://rankdelta.ai/auth/callback?utm_source=x");
	});
	it("never throws on garbage", () => {
		expect(sanitizeUrlForAnalytics("not a url#access_token=1")).not.toContain("access_token");
	});
	it("never sends a shared report token (/r/<token>) to analytics", () => {
		const token = 'ab'.repeat(24) // a 48-hex share token, built so no secret scanner mistakes it for a key;
		expect(sanitizeUrlForAnalytics(`https://rankdelta.ai/r/${token}`)).toBe("https://rankdelta.ai/r/:token");
		expect(sanitizeUrlForAnalytics(`https://rankdelta.ai/r/${token}?print=1&utm_source=mail`)).toBe(
			"https://rankdelta.ai/r/:token?print=1&utm_source=mail",
		);
		expect(redactSharePath(`/r/${token}`)).toBe("/r/:token");
		// Readable teaser slugs and other paths stay as they are.
		expect(sanitizeUrlForAnalytics("https://rankdelta.ai/r/acme-coffee")).toBe("https://rankdelta.ai/r/acme-coffee");
		expect(sanitizeUrlForAnalytics("https://rankdelta.ai/reports")).toBe("https://rankdelta.ai/reports");
	});
});
