// supjav_fixed_worker.ts
// Lengkap: mulai dari konstanta UA sampai export default.
// Perbaikan utama:
// - Untuk endpoint /json/all/... setiap ID hanya di-fetch sekali (tidak double-fetch).
// - Sequential processing dengan delay (default 300ms) untuk stabilitas.
// - Default count=10, maxCount=20 (batas aman).
// - Endpoint /json/list/... tidak diubah secara fungsional (tetap bekerja seperti semula).

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:106.0) Gecko/20100101 Firefox/106.0";

const Empty = new Response(null, { status: 404 });
const GroupMap = {
  category: "category/",
  maker: "category/maker/",
  cast: "category/cast/",
  tag: "tag/",
};

type MediaItem = {
  id: string;
  title: string;
  thumb: string;
};

type MediaItemWithURL = MediaItem & {
  m3u8Url: string | null;
};

// ======================== Handler utama ========================
async function handler(req: Request) {
  const uri = new URL(req.url);
  let lang = uri.searchParams.get("lang") || "en";
  let page = parseInt(uri.searchParams.get("page") || "1");
  let count = parseInt(uri.searchParams.get("count") || "10");

  // safety defaults
  if (!["zh", "en", "ja"].includes(lang)) lang = "en";
  if (isNaN(page) || page < 1) page = 1;
  const MAX_COUNT = 20;
  if (isNaN(count) || count < 1) count = 10;
  count = Math.min(count, MAX_COUNT);

  if (req.method !== "GET") return Empty;

  const parts = uri.pathname.split("/").filter(Boolean);

  // -------- /json/list/...  (day, week, month, search, category, maker, cast, tag) --------
  if (parts[0] === "json" && parts[1] === "list") {
    const type = parts[2] || "day";
    const param = parts.slice(3).join("/");

    let base: URL | null = null;

    if (["day", "week", "month"].includes(type)) {
      base = new URL(`/${lang}/popular`, "https://supjav.com");
      base.searchParams.set("sort", type);
    } else if (type === "search") {
      base = new URL(`/${lang}/`, "https://supjav.com");
      base.searchParams.set("s", param);
    } else if (type in GroupMap) {
      let p = "/";
      if (lang !== "en") p += lang + "/";
      base = new URL(p + (GroupMap as any)[type] + param, "https://supjav.com");
    } else {
      return Empty;
    }

    const items = await getList(base, page, count);
    return new Response(JSON.stringify({ page, count: items.length, items }, null, 2), {
      headers: { "content-type": "application/json" },
    });
  }

  // -------- /json/all/...  manual list or range --------
  if (parts[0] === "json" && parts[1] === "all") {
    // manual list: /json/all/123-124-125
    if (parts[2] && !parts[2].startsWith("range")) {
      const ids = parts[2].split("-").map((s) => s.trim()).filter(Boolean).slice(0, count);
      const items = await fetchIdsSequential(ids, { delayMs: 300 }); // delay 300ms between IDs
      return new Response(JSON.stringify({ page: 1, count: items.length, items }, null, 2), {
        headers: { "content-type": "application/json" },
      });
    }

    // range: /json/all/range/100-110
    if (parts[2] === "range" && parts[3]) {
      const [startRaw, endRaw] = parts[3].split("-").map((s) => s.trim());
      const start = parseInt(startRaw, 10);
      const end = parseInt(endRaw, 10);
      if (isNaN(start) || isNaN(end) || end < start) {
        return new Response("Invalid range", { status: 400 });
      }
      const ids: string[] = [];
      for (let i = start; i <= end; i++) ids.push(String(i));
      const idsLimited = ids.slice(0, count);
      const items = await fetchIdsSequential(idsLimited, { delayMs: 300 });
      return new Response(JSON.stringify({ page: 1, count: items.length, items }, null, 2), {
        headers: { "content-type": "application/json" },
      });
    }
  }

  return Empty;
}

// ======================== Helper: fetch HTML dengan header mirip browser ========================
async function fetchHTML(url: string | URL) {
  const res = await fetch(url.toString(), {
    headers: {
      "user-agent": UA,
      referer: "https://supjav.com/",
      // Accept header helps avoid some protective responses:
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  return await res.text();
}

// ======================== Extract media items from listing page ========================
export function extractMediaList(body: string): MediaItem[] | null {
  // lebih fleksibel: cari blok <a href="/123456.html" ...> ... title="..." ... data-original="..."
  const list = body.match(/\/\d+\.html[^\n\r]*/g);
  if (!list) return null;

  const out: MediaItem[] = [];
  for (const item of list) {
    // item might be like '/123456.html"... title="Some Title" ... data-original="https://...jpg"...'
    const idMatch = item.match(/\/(\d+)\.html/);
    if (!idMatch) continue;
    const id = idMatch[1];

    const titleMatch = item.match(/title\s*=\s*"([^"]+)"/) || item.match(/alt\s*=\s*"([^"]+)"/);
    const title = titleMatch ? titleMatch[1] : "";

    const thumbMatch = item.match(/data-original\s*=\s*"([^"]+)"/) || item.match(/data-src\s*=\s*"([^"]+)"/) || item.match(/src\s*=\s*"([^"]+\.jpg)"/);
    let thumb = thumbMatch ? thumbMatch[1] : "";
    if (thumb && thumb.includes("!")) thumb = thumb.split("!")[0];

    out.push({ id, title, thumb });
  }

  return out.length ? out : null;
}

// ======================== Get m3u8 and metadata from a single detail page (single fetch per id) ========================
async function fetchDetailAndM3U8(id: string): Promise<MediaItemWithURL> {
  // fetch detail HTML once
  try {
    const detailUrl = `https://supjav.com/${id}.html`;
    const html = await fetchHTML(detailUrl);

    // Title: prefer og:title, fallback <title>
    const titleMatch = html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i)
      || html.match(/<title>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : "";

    // Thumb: prefer og:image, fallback data-original / data-src / first jpg
    const thumbMatch =
      html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i) ||
      html.match(/data-original\s*=\s*"([^"]+)"/i) ||
      html.match(/data-src\s*=\s*"([^"]+)"/i) ||
      html.match(/https?:\/\/[^"']+\.jpg/i);
    let thumb = thumbMatch ? thumbMatch[1] || thumbMatch[0] : "";
    if (thumb && thumb.includes("!")) thumb = thumb.split("!")[0];

    // Find data-link entries to build serverMap; if present, fetch supremejav endpoint
    const linkList = html.match(/data-link\s*=\s*"[^"]*"\s*>[^<]+</g);
    let m3u8Url: string | null = null;
    if (linkList && linkList.length > 0) {
      const serverMap = makeServerList(linkList as RegExpMatchArray);
      // prefer 'TV' key if present else take first key
      const serverKey = serverMap.TV ? "TV" : Object.keys(serverMap)[0];
      if (serverKey) {
        const tvid = serverMap[serverKey].split("").reverse().join("");
        try {
          const res2 = await fetch(`https://lk1.supremejav.com/supjav.php?c=${tvid}`, {
            headers: { referer: "https://supjav.com/", "user-agent": UA },
          });
          const data2 = await res2.text();
          const m = data2.match(/urlPlay.*?(https?:\/\/[^'"\s]+\.m3u8)/m);
          if (m) m3u8Url = m[1];
        } catch (e) {
          // ignore; m3u8Url stays null
        }
      }
    }

    return { id, title, thumb, m3u8Url };
  } catch (e) {
    // if anything fails, return minimal shape
    return { id, title: "", thumb: "", m3u8Url: null };
  }
}

// ======================== Sequential multi-ID fetcher (single detail fetch per ID) ========================
async function fetchIdsSequential(ids: string[], opts: { delayMs?: number } = {}): Promise<MediaItemWithURL[]> {
  const delayMs = typeof opts.delayMs === "number" ? opts.delayMs : 300;
  const out: MediaItemWithURL[] = [];
  for (const id of ids) {
    const item = await fetchDetailAndM3U8(id);
    out.push(item);
    // small delay to reduce chance of being rate-limited / blocked
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return out;
}

// ======================== makeServerList (parse data-link list) ========================
function makeServerList(arr: RegExpMatchArray) {
  const result: Record<string, string> = {};
  for (const item of arr) {
    // item example: data-link="abcd">TV<
    const m = item.match(/data-link\s*=\s*"([^"]+)"\s*>\s*([^<\s]+)/i);
    if (m) {
      result[m[2]] = m[1];
    } else {
      // fallback parsing used previously
      const i = item.indexOf(">");
      if (i > -1) {
        const key = item.slice(i + 1, -1).trim();
        const val = item.slice(11, i - 1);
        if (key) result[key] = val;
      }
    }
  }
  return result;
}

// ======================== getList: listing -> parse -> for first N fetch details sequentially ========================
async function getList(base: URL, page = 1, count = 10): Promise<MediaItemWithURL[]> {
  const u = new URL(base.href);
  if (!u.pathname.endsWith("/")) u.pathname += "/";
  if (page > 1) u.pathname = u.pathname + "page/" + page;

  const body = await fetchHTML(u);
  const mediaList = extractMediaList(body) || [];

  // take first `count` items from listing, then for each get detail including m3u8 sequentially
  const slice = mediaList.slice(0, count);
  const out: MediaItemWithURL[] = [];
  for (const item of slice) {
    // fetch detail+ m3u8 for that id (single fetch inside)
    const detail = await fetchDetailAndM3U8(item.id);
    // if title/thumb are empty in detail, fallback to listing meta
    const title = detail.title || item.title || "";
    const thumb = detail.thumb || item.thumb || "";
    out.push({ id: item.id, title, thumb, m3u8Url: detail.m3u8Url });
    // small delay to be gentle
    await new Promise((r) => setTimeout(r, 200));
  }
  return out;
}

// ======================== Export ========================
export default { fetch: handler };
