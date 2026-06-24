import * as cheerio from "cheerio"
import type { NewsItem } from "@shared/types"

/**
 * 解析相对路径为绝对 URL
 */
function resolveUrl(href: string, sectionUrl: string): string {
  if (href.startsWith("http")) return href

  const base = sectionUrl.replace(/\/$/, "")

  if (href.startsWith("../../")) {
    const parts = base.split("/")
    const parent = parts.slice(0, -2).join("/")
    return `${parent}/${href.replace(/^\.\.\/\.\.\//, "")}`
  }
  if (href.startsWith("../")) {
    const parts = base.split("/")
    const parent = parts.slice(0, -1).join("/")
    return `${parent}/${href.replace(/^\.\.\//, "")}`
  }
  const clean = href.replace(/^\.\//, "")
  return `${base}/${clean}`
}

interface SiteParser {
  name: string
  url: string
}

async function scrapeSection(site: SiteParser): Promise<NewsItem[]> {
  const items: NewsItem[] = []

  let html: string
  try {
    html = await myFetch(site.url)
  } catch {
    return items
  }

  const $ = cheerio.load(html)
  const hasGlList = $("div.gl_list").length > 0

  if (hasGlList) {
    // 结构 B：gl_list + bf-pass（仙游）
    $("div.gl_list li").each((_, el) => {
      const $el = $(el)
      const $a = $el.find("a[title]")
      const title = $a.attr("title")
      const href = $a.attr("href")
      const dateText = $el.find(".bf-pass").text().trim()
      const dateMatch = dateText.match(/(\d{4}-\d{2}-\d{2})/)

      if (title && href && dateMatch) {
        items.push({
          id: href,
          title: title.trim(),
          url: resolveUrl(href, site.url),
          pubDate: new Date(`${dateMatch[1]}T00:00:00+08:00`).valueOf(),
          extra: { info: site.name },
        })
      }
    })
  } else {
    // 结构 A：li > a[title] + span 日期（上杭）
    $("li").each((_, el) => {
      const $el = $(el)
      const $a = $el.find("a[title]")
      const title = $a.attr("title")
      const href = $a.attr("href")
      const dateText = $el.find("span").text().trim()
      const dateMatch = dateText.match(/(\d{4}-\d{2}-\d{2})/)

      if (title && href && dateMatch) {
        items.push({
          id: href,
          title: title.trim(),
          url: resolveUrl(href, site.url),
          pubDate: new Date(`${dateMatch[1]}T00:00:00+08:00`).valueOf(),
          extra: { info: site.name },
        })
      }
    })
  }

  return items
}

// ===== 2 个政府要闻来源 =====
const GOVNEWS_SITES: SiteParser[] = [
  { name: "仙游·最新信息", url: "http://www.xianyou.gov.cn/xxgk/gzdt/zxxx/" },
  { name: "上杭·要闻", url: "https://www.shanghang.gov.cn/xwzx/bdyw/" },
]

export default defineSource(async () => {
  const allNews: NewsItem[] = []

  const results = await Promise.allSettled(
    GOVNEWS_SITES.map(site => scrapeSection(site)),
  )

  for (const result of results) {
    if (result.status === "fulfilled") {
      allNews.push(...result.value)
    }
  }

  return allNews.sort((a, b) => ((b.pubDate ?? 0) as number) - ((a.pubDate ?? 0) as number))
})
