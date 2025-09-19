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

  // endpoint /json/all/123-456-789
  if (path[0] === "json" && path[1] === "all" && path[2] && !path[2].startsWith("range")) {
    const ids = path[2].split("-");
    const results = await Promise.all(ids.map(fetchFullById));

    return new Response(JSON.stringify(results, null, 2), {
      headers: { "content-type": "application/json" },
    });
  }

  // endpoint /json/all/range/123-130
  if (path[0] === "json" && path[1] === "all" && path[2] === "range" && path[3]) {
    const [start, end] = path[3].split("-").map(Number);
    const ids: string[] = [];
    for (let i = start; i <= end; i++) ids.push(i.toString());

    const results = await Promise.all(ids.map(fetchFullById));

    return new Response(JSON.stringify(results, null, 2), {
      headers: { "content-type": "application/json" },
    });
  }

  return Empty;
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

export default { fetch: handler };
