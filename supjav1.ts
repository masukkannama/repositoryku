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

export function extractMediaList(body: string): MediaItem[] | null {
  const list = body.match(
    /https:\/\/supjav\.com\/.*?\d+\.html.*?title=\".*?\".*?data-original=\".*?\"/gm,
  );
  if (!list) return null;
  return list.map((item) => {
    const id = item.match(/supjav\.com\/.*?(\d+)\.html/)![1];
    const title = item.match(/title=\"(.*?)\"/)![1];
    const thumb = item.match(/data-original=\"(.*?)\"/)![1].split("!")[0];
    return { id, title, thumb };
  });
}

async function fetchBody(url: string | URL) {
  const req = await fetch(url, { headers: { "user-agent": UA } });
  const body = await req.text();
  return body;
}

async function getM3U8ById(id: string) {
  const req1 = await fetch(`https://supjav.com/${id}.html`, {
    headers: {
      "referer": "https://supjav.com/",
      "user-agent": UA,
    },
  });
  const data1 = await req1.text();
  const linkList = data1.match(/data-link\=".*?">.*?</mg);
  if (!linkList) return null;
  const serverMap = makeServerList(linkList);

  const tvid = serverMap.TV.split("").reverse().join("");
  const data2 = await (await fetch(
    `https://lk1.supremejav.com/supjav.php?c=${tvid}`,
    {
      headers: {
        "referer": "https://supjav.com/",
        "user-agent": UA,
      },
    },
  )).text();

  const url = data2.match(/urlPlay.*?(https.*?\.m3u8)/m);
  if (url === null) return null;
  return url[1];
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
  const list = await Promise.all(arr);
  const mediaList = list.map(extractMediaList).filter((i) => !!i).flat() as MediaItem[];

  const updatedList: MediaItemWithURL[] = [];
  for (const item of mediaList) {
    const m3u8Url = await getM3U8ById(item.id);
    if (m3u8Url) {
      updatedList.push({
        ...item,
        m3u8Url: m3u8Url,
      });
    }
  }

  return updatedList;
}

function makePlayList(list: MediaItemWithURL[]): string {
  let str = "#EXTM3U\n";
  for (const item of list) {
    str += '#EXTINF:-1 tvg-logo="' + item.thumb + '",' + item.title + "\n";
    str += item.m3u8Url + "\n";
  }
  return str;
}

async function handler(req: Request) {
  const uri = new URL(req.url);
  let lang = uri.searchParams.get("lang") || "en";
  console.log(new Date().toISOString(), uri.pathname);

  if (req.method !== "GET") return Empty;
  if (lang !== "zh" && lang !== "en" && lang !== "ja") {
    lang = "en";
  }
  
  // Endpoint untuk mendapatkan daftar URL asli
  if (uri.pathname.match(/^\/list-m3u8\/(day|week|month|search|category|maker|cast|tag)/)) {
    let list: MediaItemWithURL[] | null = null;
    let base: URL;

    const pathParts = uri.pathname.split('/');
    const type = pathParts[2];

    if (type === 'day' || type === 'week' || type === 'month') {
      base = new URL(`/${lang}/popular`, "https://supjav.com");
      base.searchParams.set("sort", type);
      list = await getList(base);
    } else if (type === 'search') {
      const param = pathParts.slice(3).join('/');
      base = new URL(`/${lang}/`, "https://supjav.com");
      base.searchParams.set("s", param);
      list = await getList(base);
    } else { // Category, maker, cast, tag
      const key = type;
      const param = pathParts.slice(3).join('/');
      const pages = parseInt(uri.searchParams.get("pages") || "1");
      
      let p = "/";
      if (lang !== "en") p += lang + "/";
      base = new URL(p + GroupMap[key as keyof typeof GroupMap] + param, "https://supjav.com");
      list = await getList(base, pages);
    }

    if (!list) return Empty;

    const m3u8Links = list.map(item => item.m3u8Url).join('\n');
    return new Response(m3u8Links, {
      headers: { 'content-type': 'text/plain' }
    });
  }

  // Jika Anda ingin kembali ke versi redirect, Anda bisa mengganti blok kode di atas
  // dengan kode handler dari percakapan sebelumnya.
  // Kode di bawah ini adalah kode handler dari versi yang menampilkan URL asli.
  // Ini adalah kode lengkap dari pendekatan yang Anda inginkan.

  if (uri.pathname.match(/^\/popular\/(day|week|month)$/)) {
    const type = uri.pathname.split("/").pop();
    if (!type) return Empty;
    let p = "/";
    if (lang !== "en") p += lang + "/";
    const base = new URL(p + "popular", "https://supjav.com");
    base.searchParams.set("sort", type);
    const list = await getList(base);
    if (!list) return Empty;
    return new Response(makePlayList(list));
  }

  if (uri.pathname.startsWith("/search/")) {
    const param = uri.pathname.slice(8);
    let p = "/";
    if (lang !== "en") p += lang + "/";
    const base = new URL(p, "https://supjav.com");
    base.searchParams.set("s", param);
    const list = await getList(base);
    if (!list) return Empty;
    return new Response(makePlayList(list));
  }

  for (const [key, path] of Object.entries(GroupMap)) {
    if (!uri.pathname.startsWith(`/${key}/`)) continue;

    let p = "/";
    if (lang !== "en") p += lang + "/";
    const param = uri.pathname.slice(key.length + 2);
    const base = new URL(p + path + param, "https://supjav.com");
    const pages = parseInt(uri.searchParams.get("pages") || "3");
    const list = await getList(base, pages);
    if (!list) return Empty;
    return new Response(makePlayList(list));
  }
  
  return Empty;
}

export default { fetch: handler };
