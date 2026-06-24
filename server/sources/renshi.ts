import * as cheerio from "cheerio"
import type { NewsItem } from "@shared/types"

/**
 * 解析相对路径为绝对 URL
 */
function resolveUrl(href: string, sectionUrl: string, levelsUp = 0): string {
  if (href.startsWith("http")) return href

  const base = sectionUrl.replace(/\/$/, "")

  // ../../xxx → 退 N 级
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
  // ./xxx 或 xxx
  const clean = href.replace(/^\.\//, "")
  return `${base}/${clean}`
}

interface SiteParser {
  name: string
  url: string
  levelsUp?: number    // 路径退几级
  encoding?: string   // gb2312 等非 utf-8 编码
}

/**
 * 通用政府网站列表页解析器
 * 支持两种主流结构：
 *   A) <li> <a title="xxx" href="xxx"> <span>日期</span> </li>
 *   B) <div class="gl_list"> <li> <span class="bf-pass">日期</span> <a href="xxx" title="xxx"> </li>
 */
async function scrapeSection(site: SiteParser): Promise<NewsItem[]> {
  const items: NewsItem[] = []

  let html: string
  try {
    if (site.encoding && site.encoding !== "utf-8") {
      // 非 UTF-8 编码，用 iconv-lite 转换
      const raw: ArrayBuffer = await myFetch(site.url, { responseType: "arrayBuffer" })
      const iconv = await import("iconv-lite")
      html = iconv.decode(Buffer.from(raw), site.encoding)
    } else {
      html = await myFetch(site.url)
    }
  } catch {
    return items
  }

  const $ = cheerio.load(html)

  // 判断结构类型：有 gl_list 用 B，否则用 A
  const hasGlList = $("div.gl_list").length > 0

  if (hasGlList) {
    // 结构 B：gl_list + bf-pass
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
          url: resolveUrl(href, site.url, site.levelsUp ?? 0),
          pubDate: new Date(`${dateMatch[1]}T00:00:00+08:00`).valueOf(),
          extra: { info: site.name },
        })
      }
    })
  } else {
    // 结构 A：通用 li > a[title] + span 日期
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
          url: resolveUrl(href, site.url, site.levelsUp ?? 0),
          pubDate: new Date(`${dateMatch[1]}T00:00:00+08:00`).valueOf(),
          extra: { info: site.name },
        })
      }
    })
  }

  return items
}

// ===== 6 个人事任免来源 =====
const RENSHI_SITES: SiteParser[] = [
  { name: "仙游·人事任免", url: "http://www.xianyou.gov.cn/xxgk/rsxx/rsrm/" },
  { name: "上杭·人事任免", url: "https://www.shanghang.gov.cn/zwgk/rsxx/rsrm/" },
  { name: "龙岩·人事任免", url: "https://www.longyan.gov.cn/gk/flgk/rsxx/rsrm/" },
  { name: "莆田·人事任免", url: "https://www.putian.gov.cn/zwgk/rsxx/rsrm/" },
  { name: "龙岩人大·选举任免", url: "http://rd.longyan.gov.cn/qwfb/xjrm/", encoding: "gb2312" },
  { name: "莆田人大·人事任免", url: "http://www.ptrd.gov.cn/rsrm/" },
]

export default defineSource(async () => {
  const allNews: NewsItem[] = []

  // 并发爬取所有站点
  const results = await Promise.allSettled(
    RENSHI_SITES.map(site => scrapeSection(site)),
  )

  for (const result of results) {
    if (result.status === "fulfilled") {
      allNews.push(...result.value)
    }
  }

  // 按日期倒序（最新的在前）
  return allNews.sort((a, b) => ((b.pubDate ?? 0) as number) - ((a.pubDate ?? 0) as number))
})
