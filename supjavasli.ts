// UA dan variabel konstan lainnya
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:106.0) Gecko/20100101 Firefox/106.0";
const Empty = new Response(null, { status: 404 });
const GroupMap = {
  category: "category/",
  maker: "category/maker/",
  cast: "category/cast/",
  tag: "tag/",
};

// Tipe data untuk media
type MediaItem = {
  id: string;
  title: string;
  thumb: string;
};

type MediaItemWithURL = MediaItem & {
  m3u8Url: string;
};

// Fungsi-fungsi pembantu
function makeServerList(arr: RegExpMatchArray) { ... }
export function extractMediaList(body: string): MediaItem[] | null { ... }
async function fetchBody(url: string | URL) { ... }
async function getM3U8Asli(id: string) { ... }

// Fungsi utama
async function getList(base: URL, pages = 3) { ... }
function makePlayList(list: MediaItemWithURL[]): string { ... }

// Handler utama
async function handler(req: Request) {
  const uri = new URL(req.url);
  let lang = uri.searchParams.get("lang") || "en";
  console.log(new Date().toISOString(), uri.pathname);

  if (req.method !== "GET") return Empty;
  if (lang !== "zh" && lang !== "en" && lang !== "ja") {
    lang = "en";
  }

  // Bagian untuk daftar populer
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

  // Bagian untuk pencarian
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

  // Bagian untuk kategori dan tag
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