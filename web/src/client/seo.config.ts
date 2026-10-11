/**
 * Single source of truth for the site's <title>, meta description, and
 * Open Graph defaults. Per-page overrides go through `<Seo />` or the `seo`
 * prop on `<Page />`.
 */

export interface SeoConfig {
  siteName: string;
  description: string;
  formatTitle: (title?: string) => string;
}

const siteName = 'VibeGuard';

const description =
  'A self-tightening agent harness on MongoDB Atlas: failed evals write guardrail rules, a human approves or reverts, the next run loads them.';

export const seoConfig: SeoConfig = {
  siteName,
  description,
  formatTitle: (title) => (title ? `${title} · ${siteName}` : siteName),
};
