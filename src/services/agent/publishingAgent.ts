/**
 * Publishing Agent — Stage 5 of the pipeline.
 *
 * Takes the written article and:
 *   1. Searches Pexels for relevant images (1 featured + 2-3 in-article)
 *   2. Inserts the in-article images as EXTERNAL image blocks (Pexels URLs) at natural
 *      positions in the content — nothing is uploaded from the browser
 *   3. Publishes the post through the `wp-publish` edge function, which uploads the
 *      featured image server-side, ensures the category and sets the Rank Math meta
 *   4. Returns the published post URL
 *
 * The WordPress application password is column-locked for browser clients (migration 027):
 * no WP credentials ever exist in the browser, hence no client-side media upload.
 * Pexels API is free up to 200 req/hour — well within our limits.
 */

import type { ArticleContent, PublishResult, PexelsImage } from './types'
import { publishViaEdge } from '../wordpress'
import { proxyStockImage } from '../edgeProxy'
import { defaultBlogCategoryName, pexelsCaptionLabels } from '../../lib/contentLanguages'

async function searchPexels(query: string, count: number): Promise<PexelsImage[]> {
  const photos = await proxyStockImage({ provider: 'pexels', query, count })
  return photos.map((p, i) => ({
    id: i,
    url: p.url,
    photographer: p.photographer,
    photographerUrl: p.photographerUrl,
    altText: p.alt || query,
  }))
}

/**
 * Gutenberg image block. With `wpMediaId` it references a media-library item; without it the
 * block is an external image (`src` = the Pexels URL, no `id` / `wp-image-*` class). The
 * figcaption photographer credit is a Pexels license requirement — keep it in both forms.
 */
function buildImageBlock(image: PexelsImage, language: string, wpMediaId?: number): string {
  const caption = pexelsCaptionLabels(language)
  const attrs = wpMediaId
    ? `{"id":${wpMediaId},"sizeSlug":"large","linkDestination":"none"}`
    : `{"sizeSlug":"large","linkDestination":"none"}`
  const imgClass = wpMediaId ? ` class="wp-image-${wpMediaId}"` : ''
  return `
<!-- wp:image ${attrs} -->
<figure class="wp-block-image size-large"><img loading="lazy" decoding="async" src="${image.url}" alt="${image.altText}"${imgClass}/><figcaption class="wp-element-caption">${caption.by} ${image.photographer} ${caption.on} <a href="https://pexels.com" rel="nofollow noopener">Pexels</a></figcaption></figure>
<!-- /wp:image -->`
}

function insertImagesIntoContent(
  content: string,
  images: PexelsImage[],
  language: string
): { content: string; placed: number } {
  if (images.length === 0) return { content, placed: 0 }

  // Find H2 positions to insert images after them
  const h2Positions: number[] = []
  let searchFrom = 0
  while (true) {
    const idx = content.indexOf('<!-- wp:heading {"level":2}', searchFrom)
    if (idx === -1) break
    // Find the closing of this heading block
    const closeIdx = content.indexOf('<!-- /wp:heading -->', idx)
    if (closeIdx === -1) break
    h2Positions.push(closeIdx + '<!-- /wp:heading -->'.length)
    searchFrom = closeIdx + 1
  }

  if (h2Positions.length === 0) return { content, placed: 0 }

  // Insert images after the 2nd, 4th, 6th H2 (skip 1st which is intro)
  const insertionPoints = h2Positions.filter((_, i) => i === 1 || i === 3 || i === 5)

  let result = content
  let offset = 0
  let placed = 0

  images.slice(0, insertionPoints.length).forEach((img, i) => {
    if (!img.url) return
    const pos = (insertionPoints[i] ?? 0) + offset
    const block = '\n' + buildImageBlock(img, language, img.wpMediaId) + '\n'
    result = result.slice(0, pos) + block + result.slice(pos)
    offset += block.length
    placed += 1
  })

  return { content: result, placed }
}

export async function runPublishingAgent(
  projectId: string,
  article: ArticleContent,
  opts?: { status?: 'publish' | 'draft'; categoryName?: string }
): Promise<PublishResult> {
  console.log(`[Publishing] Starting publish for: "${article.title}"`)

  // 1. Search images (no upload — the browser holds no WP credentials)
  const images: PexelsImage[] = []

  for (let i = 0; i < article.imageSearchTerms.length && i < 4; i++) {
    const term = article.imageSearchTerms[i] ?? ''
    if (!term) continue

    try {
      const found = await searchPexels(term, 3)
      const photo = found[i % found.length] // vary to avoid same photo
      if (!photo) continue

      const altText = `${article.imageSearchTerms[0]} — ${photo.altText}`.slice(0, 125)
      images.push({ ...photo, altText })

      console.log(`[Publishing] Found image ${i + 1}: ${photo.url}`)
    } catch (e) {
      console.warn(`[Publishing] Image search ${i + 1} failed:`, e)
    }
  }

  // 2. Insert in-article images as external image blocks (featured = index 0 is uploaded
  //    server-side by wp-publish from its URL)
  const { content: contentWithImages, placed: imagesPlaced } = insertImagesIntoContent(
    article.gutenbergContent,
    images.slice(1),
    article.language
  )

  // 3. Publish through the edge function (featured image, category, Rank Math handled there)
  console.log('[Publishing] Publishing post to WordPress...')
  const featuredImageUrl = images[0]?.url ?? article.featuredImageUrl
  const published = await publishViaEdge(
    projectId,
    {
      title: article.title,
      slug: article.slug,
      contentHtml: contentWithImages,
      excerpt: article.metaDescription,
      featuredImageUrl,
      categoryName: opts?.categoryName ?? defaultBlogCategoryName(article.language),
      rankMath: {
        title: article.metaTitle,
        description: article.metaDescription,
        focusKeyword: article.focusKeyword,
      },
    },
    opts?.status ?? 'publish'
  )

  console.log(`[Publishing] Published! ID: ${published.postId}, URL: ${published.postUrl}`)

  return {
    wpPostId: published.postId,
    wpPostUrl: published.postUrl,
    publishedAt: new Date().toISOString(),
    featuredImageUrl: featuredImageUrl ?? '',
    imagesUploaded: imagesPlaced + (published.featuredMediaId ? 1 : 0),
  }
}
