const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Safari/537.36";

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

async function handler(req: Request) {
  const uri = new URL(req.url);
  let lang = uri.searchParams.get("lang") || "en";
  let page = parseInt(uri.searchParams.get("page") || "1");
  let count = parseInt(uri.searchParams.get("count") || "10");

  if (req.method !== "GET") return Empty;
  if (lang !== "zh" && lang !== "en" && lang !== "ja") lang = "en";

  const parts = uri.pathname.split("/").filter(Boolean);

  // ==================== /json/list/... ====================
  if (parts[0] === "json" && parts[1] === "list") {
    const type = parts[2];
    const param = parts.slice(3).join("/");

    let list: MediaItemWithURL[] | null = null;
    let base: URL;

    if (type === "day" || type === "week" || type === "month") {
      base = new URL(`/${lang}/popular`, "https://supjav.com");
      base.searchParams.set("sort", type);
      list = await getList(base, page, count);
    } else if (type === "search") {
      base = new URL(`/${lang}/`, "https://supjav.com");
      base.searchParams.set("s", param);
      list = await getList(base, page, count);
    } else {
      const key = type;
      let p = "/";
      if (lang !== "en") p += lang + "/";
      base = new URL(
        p + GroupMap[key as keyof typeof GroupMap] + param,
        "https://supjav.com"
      );
      list = await getList(base, page, count);
    }

    if (!list) return Empty;

    return new Response(
      JSON.stringify({ page, count, items: list }, null, 2),
      {
        headers: { "content-type": "application/json" },
      }
    );
  }

  // ==================== /json/all/... ====================
  if (parts[0] === "json" && parts[1] === "all") {
    // manual id list
    if (parts[2] && !parts[2].startsWith("range")) {
      const ids = parts[2].split("-").slice(0, count);
      const items = await fetchIdsSequential(ids);
      return new Response(JSON.stringify(items, null, 2), {
        headers: { "content-type": "application/json" },
      });
    }

    // range id
    if (parts[2] === "range" && parts[3]) {
      const [start, end] = parts[3].split("-").map((x) => parseInt(x, 10));
      let ids: string[] = [];
      for (let i = start; i <= end; i++) ids.push(String(i));
      ids = ids.slice(0, count);
      const items = await fetchIdsSequential(ids);
      return new Response(JSON.stringify(items, null, 2), {
        headers: { "content-type": "application/json" },
      });
    }
  }

  return Empty;
}

// ============= Fungsi pendukung =============

async function fetchBody(url: string | URL) {
  const req = await fetch(url, { headers: { "user-agent": UA } });
  return await req.text();
}

export function extractMediaList(body: string): MediaItem[] | null {
  const list = body.match(
    /https:\/\/supjav\.com\/.*?\d+\.html.*?title=\".*?\".*?data-original=\".*?\"/gm
  );
  if (!list) return null;
  return list.map((item) => {
    const id = item.match(/supjav\.com\/.*?(\d+)\.html/)![1];
    const title = item.match(/title=\"(.*?)\"/)![1];
    const thumb = item.match(/data-original=\"(.*?)\"/)![1].split("!")[0];
    return { id, title, thumb };
  });
}

async function getM3U8ById(id: string): Promise<string | null> {
  const req1 = await fetch(`https://supjav.com/${id}.html`, {
    headers: { referer: "https://supjav.com/", "user-agent": UA },
  });
  const data1 = await req1.text();
  const linkList = data1.match(/data-link\=".*?">.*?</gm);
  if (!linkList) return null;
  const serverMap = makeServerList(linkList);

  if (!serverMap.TV) return null;
  const tvid = serverMap.TV.split("").reverse().join("");
  const data2 = await (
    await fetch(`https://lk1.supremejav.com/supjav.php?c=${tvid}`, {
      headers: { referer: "https://supjav.com/", "user-agent": UA },
    })
  ).text();

  const url = data2.match(/urlPlay.*?(https.*?\.m3u8)/m);
  if (url === null) return null;
  return url[1];
}

async function getList(
  base: URL,
  page = 1,
  count = 10
): Promise<MediaItemWithURL[]> {
  const u = new URL(base.href);
  if (!u.pathname.endsWith("/")) u.pathname += "/";
  if (page > 1) u.pathname = u.pathname + "page/" + page;

  const body = await fetchBody(u);
  const mediaList = extractMediaList(body) || [];

  const slice = mediaList.slice(0, count);
  const updatedList: MediaItemWithURL[] = [];
  for (const item of slice) {
    const m3u8Url = await getM3U8ById(item.id);
    updatedList.push({ ...item, m3u8Url });
  }
  return updatedList;
}

async function fetchIdsSequential(ids: string[]): Promise<MediaItemWithURL[]> {
  const items: MediaItemWithURL[] = [];
  for (const id of ids) {
    try {
      const m3u8Url = await getM3U8ById(id);
      const res = await fetch(`https://supjav.com/${id}.html`, {
        headers: { "user-agent": UA },
      });
      const html = await res.text();
      const titleMatch = html.match(/<title>(.*?)<\/title>/);
      const title = titleMatch ? titleMatch[1].replace(" - SupJAV.com", "") : "";
      const thumbMatch = html.match(/data-original="(.*?)"/);
      const thumb = thumbMatch ? thumbMatch[1].split("!")[0] : "";

      items.push({ id, title, thumb, m3u8Url });
      await new Promise((r) => setTimeout(r, 150)); // delay kecil
    } catch (e) {
      items.push({ id, title: "", thumb: "", m3u8Url: null });
    }
  }
  return items;
}

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
