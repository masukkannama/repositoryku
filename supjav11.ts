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
  m3u8Url: string;
};

async function handler(req: Request) {
  const uri = new URL(req.url);
  let lang = uri.searchParams.get("lang") || "en";
  console.log(new Date().toISOString(), uri.pathname);

  if (req.method !== "GET") return Empty;
  if (!["zh", "en", "ja"].includes(lang)) lang = "en";

  // JSON endpoint
  if (uri.pathname.match(/^\/json\/(day|week|month|search|category|maker|cast|tag)/)) {
    let list: MediaItemWithURL[] | null = null;
    let base: URL;

    const pathParts = uri.pathname.split("/");
    const type = pathParts[2];
    const param = pathParts.slice(3).join("/");

    if (type === "day" || type === "week" || type === "month") {
      base = new URL(`/${lang}/popular`, "https://supjav.com");
      base.searchParams.set("sort", type);
      list = await getList(base);
    } else if (type === "search") {
      base = new URL(`/${lang}/`, "https://supjav.com");
      base.searchParams.set("s", param);
      list = await getList(base);
    } else {
      const pages = parseInt(uri.searchParams.get("pages") || "1");
      let p = "/";
      if (lang !== "en") p += lang + "/";
      base = new URL(p + GroupMap[type as keyof typeof GroupMap] + param, "https://supjav.com");
      list = await getList(base, pages);
    }

    if (!list) return Empty;

    return new Response(JSON.stringify(list, null, 2), {
      headers: { "content-type": "application/json" },
    });
  }

  return Empty;
}

// Ambil link m3u8 dari halaman detail
async function getM3U8ById(id: string) {
  const res = await fetch(`https://supjav.com/${id}.html`, {
    headers: { referer: "https://supjav.com/", "user-agent": UA },
  });
  const html = await res.text();

  const linkList = html.match(/data-link=".*?">.*?</g);
  if (!linkList) return null;
  const serverMap = makeServerList(linkList);

  // ambil server pertama yang ada
  const firstKey = Object.keys(serverMap)[0];
  if (!firstKey) return null;

  const tvid = serverMap[firstKey].split("").reverse().join("");
  const data2 = await (
    await fetch(`https://lk1.supremejav.com/supjav.php?c=${tvid}`, {
      headers: { referer: "https://supjav.com/", "user-agent": UA },
    })
  ).text();

  const match = data2.match(/urlPlay.*?(https.*?\.m3u8)/);
  return match ? match[1] : null;
}

// Ekstrak daftar item (id, title, thumb) dari halaman
export function extractMediaList(body: string): MediaItem[] | null {
  const list = body.match(/https:\/\/supjav\.com\/\d+\.html[^>]+/g);
  if (!list) return null;

  return list.map((item) => {
    const id = item.match(/supjav\.com\/(\d+)\.html/)?.[1] || "";
    const title = item.match(/title="([^"]+)"/)?.[1] || "";
    const thumb = item.match(/data-original="([^"]+)"/)?.[1].split("!")[0] || "";
    return { id, title, thumb };
  });
}

async function fetchBody(url: string | URL) {
  const res = await fetch(url, { headers: { "user-agent": UA } });
  return await res.text();
}

async function getList(base: URL, pages = 3) {
  console.log("BASE:", base.href);
  const arr = [fetchBody(base)];
  for (let i = 2; i <= pages; i++) {
    const u = new URL(base.href);
    if (!u.pathname.endsWith("/")) u.pathname += "/";
    u.pathname = u.pathname + "page/" + i;
    arr.push(fetchBody(u));
  }

  const pagesHtml = await Promise.all(arr);
  const mediaList = pagesHtml.map(extractMediaList).filter(Boolean).flat() as MediaItem[];

  // parallel ambil m3u8 biar cepat
  const results = await Promise.all(
    mediaList.map(async (item) => {
      const m3u8Url = await getM3U8ById(item.id);
      return m3u8Url ? { ...item, m3u8Url } : null;
    })
  );

  return results.filter(Boolean) as MediaItemWithURL[];
}

function makeServerList(arr: RegExpMatchArray) {
  const result: Record<string, string> = {};
  for (const item of arr) {
    const m = item.match(/data-link="([^"]+)">([^<]+)/);
    if (m) result[m[2]] = m[1];
  }
  return result;
}

export default { fetch: handler };
