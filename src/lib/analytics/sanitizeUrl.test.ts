import { describe, expect, it } from "vitest";
import { sanitizeUrlForAnalytics } from "./sanitizeUrl";

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
});
