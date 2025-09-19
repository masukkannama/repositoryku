const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:106.0) Gecko/20100101 Firefox/106.0";

const Empty = new Response(null, { status: 404 });

export interface MediaItem {
  id: string;
  title: string;
  thumb: string;
}

export interface MediaItemWithURL extends MediaItem {
  m3u8Url: string;
}

async function handler(req: Request) {
  const url = new URL(req.url);
  const path = url.pathname.split("/").filter(Boolean);

  if (req.method !== "GET") return Empty;

  // 🔹 Endpoint /json/all/123-456-789
  if (path[0] === "json" && path[1] === "all" && path[2] && !path[2].startsWith("range")) {
    const ids = path[2].split("-");
    const results = await Promise.all(ids.map(fetchFullById));

    return jsonResponse(results);
  }

  // 🔹 Endpoint /json/all/range/123-130
  if (path[0] === "json" && path[1] === "all" && path[2] === "range" && path[3]) {
    const [start, end] = path[3].split("-").map(Number);
    const ids: string[] = [];
    for (let i = start; i <= end; i++) ids.push(i.toString());

    const results = await Promise.all(ids.map(fetchFullById));

    return jsonResponse(results);
  }

  // 🔹 Endpoint /json/list/day?page=1
  if (path[0] === "json" && path[1] === "list") {
    const type = path[2] || "day"; // day/week/month/search/category
    const param = path.slice(3).join("/") || "";
    const page = parseInt(url.searchParams.get("page") || "1");

    const base = makeListURL(type, param);
    const results = await getList(base, page);

    return jsonResponse(results);
  }

  return Empty;
}

/**
 * Helper Response JSON
 */
function jsonResponse(data: any) {
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "content-type": "application/json" },
  });
}

/**
 * Buat URL listing
 */
function makeListURL(type: string, param: string) {
  if (type === "day" || type === "week" || type === "month") {
    const u = new URL("/en/popular", "https://supjav.com");
    u.searchParams.set("sort", type);
    return u;
  } else if (type === "search") {
    const u = new URL("/en/", "https://supjav.com");
    u.searchParams.set("s", param);
    return u;
  } else if (type === "category") {
    return new URL(`/en/category/${param}`, "https://supjav.com");
  }
  return new URL("/en/", "https://supjav.com");
}

/**
 * Ambil data lengkap (title, thumb, m3u8) berdasarkan id
 */
async function fetchFullById(id: string): Promise<MediaItemWithURL> {
  const req = await fetch(`https://supjav.com/${id}.html`, {
    headers: { "user-agent": UA, referer: "https://supjav.com/" },
  });
  const html = await req.text();

  const titleMatch = html.match(/<title>(.*?)<\/title>/i);
  const thumbMatch = html.match(/data-original="(.*?)"/i);

  const title = titleMatch ? titleMatch[1].replace(" - SupJAV", "") : "";
  const thumb = thumbMatch ? thumbMatch[1].split("!")[0] : "";

  const m3u8Url = await getM3U8FromHtml(html);

  return { id, title, thumb, m3u8Url: m3u8Url ?? "" };
}

/**
 * Ambil link m3u8 dari halaman detail
 */
async function getM3U8FromHtml(html: string): Promise<string | null> {
  const linkList = html.match(/data-link\=".*?">.*?</mg);
  if (!linkList) return null;

  const serverMap = makeServerList(linkList);
  if (!serverMap.TV) return null;

  const tvid = serverMap.TV.split("").reverse().join("");
  const res = await fetch(`https://lk1.supremejav.com/supjav.php?c=${tvid}`, {
    headers: { "referer": "https://supjav.com/", "user-agent": UA },
  });

  const data = await res.text();
  const urlMatch = data.match(/urlPlay.*?(https.*?\.m3u8)/m);
  return urlMatch ? urlMatch[1] : null;
}

/**
 * Buat map server dari data-link
 */
function makeServerList(arr: RegExpMatchArray) {
  const result: Record<string, string> = {};
  for (const item of arr) {
    const i = item.indexOf(">");
    const key = item.slice(i + 1, -1);
    const val = item.slice(11, i - 1);
    result[key] = val;
  }
  return result;
}

/**
 * Ambil list media dari halaman listing
 */
async function getList(base: URL, page = 1): Promise<MediaItemWithURL[]> {
  if (page > 1) {
    if (!base.pathname.endsWith("/")) base.pathname += "/";
    base.pathname += `page/${page}`;
  }

  const html = await (await fetch(base, { headers: { "user-agent": UA } })).text();

  const matches = html.match(/https:\/\/supjav\.com\/.*?\d+\.html.*?title=\".*?\".*?data-original=\".*?\"/gm);
  if (!matches) return [];

  const mediaList = matches.map((item) => {
    const id = item.match(/supjav\.com\/.*?(\d+)\.html/)![1];
    const title = item.match(/title=\"(.*?)\"/)![1];
    const thumb = item.match(/data-original=\"(.*?)\"/)![1].split("!")[0];
    return { id, title, thumb };
  });

  // ambil m3u8 untuk 5 item pertama saja (biar cepat)
  const results: MediaItemWithURL[] = [];
  for (const item of mediaList.slice(0, 5)) {
    const m3u8Url = await getM3U8ById(item.id);
    results.push({ ...item, m3u8Url: m3u8Url ?? "" });
  }
  return results;
}

/**
 * Ambil m3u8 langsung berdasarkan id
 */
async function getM3U8ById(id: string): Promise<string | null> {
  const req1 = await fetch(`https://supjav.com/${id}.html`, {
    headers: { "referer": "https://supjav.com/", "user-agent": UA },
  });
  const data1 = await req1.text();
  return await getM3U8FromHtml(data1);
}

export default { fetch: handler };
