// Fills an EMPTY throwaway instance with the film's demo world: fictional people with example.com
// addresses, a server called Friday Crew, a conversation, friendships and a direct message.
// Never point it at an instance with real accounts: the first registration becomes the instance owner.
//   STELLARR_FILM_WEB=http://127.0.0.1:3100 node seed.mjs
import { launch, sleep } from "./cdp.mjs";
import { BASE, installApi, api } from "./api.mjs";

const PASS = "demo-pass-2026";
const PEOPLE = [
  { u: "theo", n: "Theo" },
  { u: "priya", n: "Priya" },
  { u: "jonas", n: "Jonas" },
  { u: "kenji", n: "Kenji" },
  { u: "ola", n: "Ola" },
];

const b = await launch();
const pages = {};
const ids = {};
const page = async () => {
  const p = await b.newPage();
  await p.goto(`${BASE}/login`, { wait: 1000 });
  await installApi(p);
  return p;
};
try {
  // the first account founds the instance: a server with #general and a voice channel
  const maya = await page();
  ids.maya = (await api(maya, "POST", "/api/auth/register", { username: "maya", displayName: "Maya", email: "maya@example.com", password: PASS })).id;
  pages.maya = maya;
  const boot = await api(maya, "GET", "/api/bootstrap");
  const S = boot.server.id;
  const general = boot.channels.find((c) => c.kind === "text").id;
  const voice = boot.channels.find((c) => c.kind === "voice").id;

  await api(maya, "PATCH", "/api/admin/server", { name: "Friday Crew", description: "Games, builds and late nights." }, S);
  await api(maya, "PATCH", `/api/admin/channels/${voice}`, { name: "lounge" }, S);
  await api(maya, "PATCH", `/api/admin/channels/${general}`, { topic: "Plans for tonight live here" }, S);
  // channel names are lower case, letters, digits and hyphens
  const mk = (name, kind) => api(maya, "POST", "/api/admin/channels", { name, kind }, S);
  const clips = await mk("clips", "text");
  await mk("builds", "text");
  const homelab = await mk("homelab", "text");
  await mk("co-op-night", "voice");
  await mk("quiet-room", "voice");

  // everyone else joins through one invite
  const inv = await api(maya, "POST", "/api/admin/invites", { channelId: general }, S);
  const code = inv.url.split("/").pop();
  for (const p of PEOPLE) {
    const pg = await page();
    ids[p.u] = (await api(pg, "POST", "/api/auth/register", { username: p.u, displayName: p.n, email: `${p.u}@example.com`, password: PASS, inviteCode: code })).id;
    pages[p.u] = pg;
  }

  // Maya is friends with everyone
  for (const p of PEOPLE) {
    await api(maya, "POST", "/api/social/requests", { username: p.u });
    const st = await api(pages[p.u], "GET", "/api/social");
    const req = (st.requests || []).find((r) => r.direction === "incoming");
    if (req) await api(pages[p.u], "POST", `/api/social/requests/${req.id}/accept`);
  }

  // the conversation in #general (the film reveals these one by one)
  const post = async (u, content, extra = {}) => {
    const m = await api(pages[u], "POST", `/api/channels/${general}/messages`, { content, attachmentIds: [], ...extra }, S);
    await sleep(700);
    return m;
  };
  const react = (u, id, e) => api(pages[u], "PUT", `/api/messages/${id}/reactions/${encodeURIComponent(e)}`, undefined, S);
  const q = await post("priya", "Anyone up for co-op tonight?");
  await post("theo", "In. Give me 20 minutes, still cooking 🍝");
  const patch = await post("jonas", "Same. I patched the server mod, the desync should be gone", { replyToMessageId: q.id });
  await post("jonas", "```js\nconst crew = [\"maya\", \"theo\", \"priya\", \"jonas\"];\ncrew.forEach((name) => lobby.invite(name));\n```");
  const plan = await post("maya", "Opening Lounge at 8. Bring snacks");
  await post("kenji", "Running late, but I'm in 🙌");
  await post("ola", "Wchodzę o 20:30, zostawcie mi miejsce!");
  await react("theo", patch.id, "🔥");
  await react("priya", patch.id, "🔥");
  for (const u of ["theo", "priya", "kenji"]) await react(u, plan.id, "🍿");
  await react("jonas", plan.id, "🙌");

  // unread messages elsewhere, so the channel list has some life
  await api(pages.kenji, "POST", `/api/channels/${clips.id}/messages`, { content: "That last round was unreal", attachmentIds: [] }, S);
  await api(pages.jonas, "POST", `/api/channels/${homelab.id}/messages`, { content: "Moved the instance to the NAS, one container, zero drama", attachmentIds: [] }, S);

  // a direct message
  const conv = await api(maya, "POST", "/api/social/conversations", { userId: ids.theo });
  await api(pages.theo, "POST", `/api/social/conversations/${conv.id}/messages`, { content: "Can you send me the invite for Ola?" });
  await api(maya, "POST", `/api/social/conversations/${conv.id}/messages`, { content: "Sent it a minute ago" });

  // two more servers for the server rail
  await api(maya, "POST", "/api/servers", { name: "Homelab", description: "Servers at home" });
  await api(maya, "POST", "/api/servers", { name: "Book club", description: "One book a month" });
  console.log("seeded", Object.keys(ids).length, "people on", BASE);
} finally {
  await b.close();
}
