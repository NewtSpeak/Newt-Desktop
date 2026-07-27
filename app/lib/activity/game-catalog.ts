// 内置游戏目录（与服务端 activityapi/catalog 对齐）：可执行文件名 + 展示名 + 封面 URL。
// 封面优先 Steam header CDN。

export type GameCatalogEntry = {
  id: string
  name: string
  aliases?: string[]
  executables?: string[]
  steam_app_id?: string
  cover_url?: string
}

function steamHeader(appId: string): string {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/header.jpg`
}

function withSteamCover(entry: GameCatalogEntry): GameCatalogEntry {
  if (entry.cover_url) return entry
  if (entry.steam_app_id) {
    return { ...entry, cover_url: steamHeader(entry.steam_app_id) }
  }
  return entry
}

/** 本地内置目录（无网络时仍可用） */
export const BUILTIN_GAME_CATALOG: GameCatalogEntry[] = (
  [
    {
      id: "genshin",
      name: "原神",
      aliases: ["Genshin Impact", "Genshin"],
      executables: ["yuanshen.exe", "genshinimpact.exe", "genshinimpact", "yuanshen"],
      steam_app_id: "1443500",
    },
    {
      id: "starrail",
      name: "崩坏：星穹铁道",
      aliases: ["Honkai: Star Rail", "Star Rail"],
      executables: ["starrail.exe", "starrail"],
      steam_app_id: "2195250",
    },
    {
      id: "zzz",
      name: "绝区零",
      aliases: ["Zenless Zone Zero", "ZZZ"],
      executables: ["zenlesszonezero.exe", "zenlesszonezero"],
      steam_app_id: "3159330",
    },
    {
      id: "cs2",
      name: "Counter-Strike 2",
      aliases: ["CS2", "CS:GO", "反恐精英"],
      executables: ["cs2.exe", "cs2"],
      steam_app_id: "730",
    },
    {
      id: "dota2",
      name: "Dota 2",
      aliases: ["刀塔"],
      executables: ["dota2.exe", "dota2"],
      steam_app_id: "570",
    },
    {
      id: "eldenring",
      name: "ELDEN RING",
      aliases: ["艾尔登法环", "Elden Ring"],
      executables: ["eldenring.exe", "eldenring"],
      steam_app_id: "1245620",
    },
    {
      id: "witcher3",
      name: "The Witcher 3",
      aliases: ["巫师3", "Witcher 3"],
      executables: ["witcher3.exe", "witcher3"],
      steam_app_id: "292030",
    },
    {
      id: "cyberpunk",
      name: "Cyberpunk 2077",
      aliases: ["赛博朋克2077", "赛博朋克"],
      executables: ["cyberpunk2077.exe", "cyberpunk2077"],
      steam_app_id: "1091500",
    },
    {
      id: "gta5",
      name: "Grand Theft Auto V",
      aliases: ["GTA V", "GTA5", "侠盗猎车手5"],
      executables: ["gta5.exe", "gtav.exe", "playgtav.exe", "gta5"],
      steam_app_id: "271590",
    },
    {
      id: "rdr2",
      name: "Red Dead Redemption 2",
      aliases: ["RDR2", "荒野大镖客2"],
      executables: ["rdr2.exe", "rdr2"],
      steam_app_id: "1174180",
    },
    {
      id: "apex",
      name: "Apex Legends",
      aliases: ["Apex", "艾佩克斯"],
      executables: ["r5apex.exe", "apex legends.exe", "r5apex"],
      steam_app_id: "1172470",
    },
    {
      id: "pubg",
      name: "PUBG: BATTLEGROUNDS",
      aliases: ["绝地求生", "PUBG"],
      executables: ["tslgame.exe", "pubg.exe", "tslgame"],
      steam_app_id: "578080",
    },
    {
      id: "amongus",
      name: "Among Us",
      aliases: ["在我们之中"],
      executables: ["among us.exe", "amongus.exe", "among us"],
      steam_app_id: "945360",
    },
    {
      id: "hades",
      name: "Hades",
      aliases: ["哈迪斯"],
      executables: ["hades.exe", "hades"],
      steam_app_id: "1145360",
    },
    {
      id: "hades2",
      name: "Hades II",
      aliases: ["Hades 2", "哈迪斯2"],
      executables: ["hades2.exe", "hades ii.exe", "hades2"],
      steam_app_id: "1145350",
    },
    {
      id: "terraria",
      name: "Terraria",
      aliases: ["泰拉瑞亚"],
      executables: ["terraria.exe", "terraria"],
      steam_app_id: "105600",
    },
    {
      id: "stardew",
      name: "Stardew Valley",
      aliases: ["星露谷物语"],
      executables: ["stardew valley.exe", "stardewvalley", "stardew valley"],
      steam_app_id: "413150",
    },
    {
      id: "valorant",
      name: "VALORANT",
      aliases: ["无畏契约", "Valorant"],
      executables: ["valorant.exe", "valorant-win64-shipping.exe", "valorant"],
    },
    {
      id: "lol",
      name: "英雄联盟",
      aliases: ["League of Legends", "LoL"],
      executables: ["league of legends.exe", "leagueclient.exe", "leagueclient"],
    },
    {
      id: "minecraft",
      name: "Minecraft",
      aliases: ["我的世界"],
      executables: ["minecraft.exe", "javaw.exe", "minecraft"],
    },
    {
      id: "osu",
      name: "osu!",
      aliases: ["osu"],
      executables: ["osu!.exe", "osu.exe", "osu!"],
    },
    {
      id: "wuthering",
      name: "鸣潮",
      aliases: ["Wuthering Waves"],
      executables: ["client-win64-shipping.exe", "wuthering waves.exe", "wutheringwaves"],
    },
    {
      id: "hollowknight",
      name: "Hollow Knight",
      aliases: ["空洞骑士"],
      executables: ["hollow knight.exe", "hollowknight.exe", "hollow_knight"],
      steam_app_id: "367520",
    },
    {
      id: "celeste",
      name: "Celeste",
      aliases: ["蔚蓝"],
      executables: ["celeste.exe", "celeste"],
      steam_app_id: "504230",
    },
    {
      id: "hades_silksong",
      name: "Hollow Knight: Silksong",
      aliases: ["丝之歌", "Silksong"],
      executables: ["hollow knight silksong.exe", "silksong.exe"],
      steam_app_id: "1030300",
    },
    {
      id: "palworld",
      name: "Palworld",
      aliases: ["幻兽帕鲁"],
      executables: ["palworld-win64-shipping.exe", "palworld.exe", "palworld"],
      steam_app_id: "1623730",
    },
    {
      id: "helldivers2",
      name: "HELLDIVERS 2",
      aliases: ["绝地潜兵2", "Helldivers 2"],
      executables: ["helldivers2.exe", "helldivers 2.exe"],
      steam_app_id: "553850",
    },
    {
      id: "bg3",
      name: "Baldur's Gate 3",
      aliases: ["博德之门3", "BG3"],
      executables: ["bg3.exe", "bg3_dx11.exe", "baldur's gate 3.exe"],
      steam_app_id: "1086940",
    },
    {
      id: "lethal",
      name: "Lethal Company",
      aliases: ["致命公司"],
      executables: ["lethal company.exe", "lethalcompany.exe"],
      steam_app_id: "1966720",
    },
    {
      id: "phasmophobia",
      name: "Phasmophobia",
      aliases: ["恐鬼症"],
      executables: ["phasmophobia.exe"],
      steam_app_id: "739630",
    },
    {
      id: "destiny2",
      name: "Destiny 2",
      aliases: ["命运2"],
      executables: ["destiny2.exe"],
      steam_app_id: "1085660",
    },
    {
      id: "warframe",
      name: "Warframe",
      aliases: ["星际战甲"],
      executables: ["warframe.x64.exe", "warframe.exe"],
      steam_app_id: "230410",
    },
    {
      id: "rocketleague",
      name: "Rocket League",
      aliases: ["火箭联盟"],
      executables: ["rocketleague.exe"],
      steam_app_id: "252950",
    },
    {
      id: "naraka",
      name: "永劫无间",
      aliases: ["Naraka: Bladepoint"],
      executables: ["naraka bladepoint.exe", "narakabladepoint.exe"],
      steam_app_id: "1203220",
    },
    {
      id: "deltaforce",
      name: "三角洲行动",
      aliases: ["Delta Force"],
      executables: ["deltaforceclient-win64-shipping.exe", "delta force.exe"],
    },
    {
      id: "blackmyth",
      name: "黑神话：悟空",
      aliases: ["Black Myth: Wukong", "黑神话"],
      executables: ["b1-win64-shipping.exe", "blackmythwukong.exe"],
      steam_app_id: "2358720",
    },
    {
      id: "ff14",
      name: "最终幻想XIV",
      aliases: ["FF14", "FFXIV", "Final Fantasy XIV"],
      executables: ["ffxiv_dx11.exe", "ffxiv.exe"],
      steam_app_id: "39210",
    },
    {
      id: "wow",
      name: "World of Warcraft",
      aliases: ["魔兽世界", "WoW"],
      executables: ["wow.exe", "wowclassic.exe"],
    },
  ] as GameCatalogEntry[]
).map(withSteamCover)

function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[\s:!\-·_]+/g, "")
}

/** 按展示名 / 别名模糊匹配目录项 */
export function matchGameInCatalog(
  query: string,
  catalog: GameCatalogEntry[] = BUILTIN_GAME_CATALOG,
): GameCatalogEntry | null {
  const q = normalizeKey(query)
  if (!q) return null
  for (const g of catalog) {
    if (normalizeKey(g.name) === q) return g
    for (const a of g.aliases ?? []) {
      if (normalizeKey(a) === q) return g
    }
  }
  for (const g of catalog) {
    const nk = normalizeKey(g.name)
    if (q.includes(nk) || nk.includes(q)) return g
    for (const a of g.aliases ?? []) {
      const ak = normalizeKey(a)
      if (q.includes(ak) || ak.includes(q)) return g
    }
  }
  return null
}

/** 系统/开发工具黑名单：勿当游戏匹配（焦点捕获时直接忽略） */
const EXEC_BLACKLIST = new Set([
  "finder",
  "dock",
  "windowserver",
  "chrome",
  "google chrome",
  "chrome.exe",
  "msedge.exe",
  "firefox",
  "firefox.exe",
  "safari",
  "arc",
  "brave browser",
  "code",
  "code.exe",
  "cursor",
  "cursor.exe",
  "terminal",
  "iterm2",
  "warp",
  "zsh",
  "bash",
  "node",
  "node.exe",
  "owl-desktop",
  "owl desktop",
  "app",
  "electron",
  "wechat",
  "wechat.exe",
  "weixin",
  "qq",
  "qq.exe",
  "discord",
  "discord.exe",
  "slack",
  "slack.exe",
  "telegram",
  "telegram.exe",
  "steam",
  "steam.exe",
  "steamwebhelper.exe",
  "steam helper",
  "explorer.exe",
  "systemsettings",
  "system settings",
  "spotlight",
  "notion",
  "figma",
  "spotify",
  "spotify.exe",
  "music",
  "photos",
  "preview",
  "notes",
  "mail",
  "messages",
  "calendar",
  "settings",
  "control panel",
  "searchhost.exe",
  "shellexperiencehost.exe",
  "applicationframehost.exe",
  "textinputhost.exe",
  "lockapp.exe",
  "startmenuexperiencehost.exe",
])

/** 是否应忽略该可执行名（非游戏） */
export function isIgnoredExecutable(execName: string): boolean {
  const key = execName.toLowerCase().trim()
  if (!key) return true
  const bare = key.replace(/\.app$/, "").replace(/\.exe$/, "")
  return EXEC_BLACKLIST.has(key) || EXEC_BLACKLIST.has(bare)
}

/** 按可执行文件名匹配（精确优先，再后缀包含） */
export function matchGameByExecutable(
  execName: string,
  catalog: GameCatalogEntry[] = BUILTIN_GAME_CATALOG,
): GameCatalogEntry | null {
  const key = execName.toLowerCase().trim()
  if (!key || isIgnoredExecutable(key)) return null
  const bare = key.replace(/\.app$/, "").replace(/\.exe$/, "")

  // 1) 精确
  for (const g of catalog) {
    for (const ex of g.executables ?? []) {
      const e = ex.toLowerCase()
      if (e === key || e === bare || e.replace(/\.exe$/, "") === bare) return g
    }
  }
  // 2) 可执行名包含目录项（避免过短匹配）
  for (const g of catalog) {
    for (const ex of g.executables ?? []) {
      const e = ex.toLowerCase()
      if (e.length < 4) continue
      if (key.includes(e) || bare.includes(e.replace(/\.exe$/, ""))) return g
    }
  }
  return null
}
