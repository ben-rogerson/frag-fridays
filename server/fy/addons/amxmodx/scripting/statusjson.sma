// Frag Fridays status JSON - live server snapshot for the web loading screen
// and, since the client draws its own tab screen, for the scoreboard too.
//
// Writes ../public/status.json every second. The game server and the Go web
// server share the container and /xashds is the working dir, so the AMXX
// relative path "cstrike/../public/" lands in the statically-served dir -
// same origin as the loading page, no CORS, no extra mounts. The target
// file is pre-created writable in the Dockerfile (the dir stays root-owned).
//
// Round time left is tracked from the Round_Start logevent because no cvar
// exposes it; -1 means "no live round timer" (none seen yet this map, or the
// last one expired with no new round - see task_write) and the frontend
// hides it.
//
// The per-player block carries deaths, team and ping as well as frags because
// this file IS the scoreboard now: the browser client draws its own tab screen
// over the canvas and unbinds the engine's (see launch.ts), so it has no other
// way to know what the server thinks the score is. Same reason the cadence is
// 1s and not the 5s the loading screen was happy with - a scoreboard trailing
// the kill feed by five seconds reads as broken.
//
// It also carries who is holding the C4 and who has a defuse kit (0.4.0).
// Both are round-deciding facts this client shows NOWHERE else: the engine's
// scoreboard is unbound, and the C4 and kit icons are drawn on the owner's own
// HUD only - so a CT could never tell whether anyone on their side could cut
// the wires, and a T could never tell who to escort. Written for every mode
// rather than only the Classic family: in a mode with no bomb both are simply
// always false, which is cheaper than teaching this plugin which mod it is
// running under.
//
// The file is truncated in place (compose mounts it by inode, so no
// write-then-rename), which means a read landing mid-write gets half a
// document. The client keeps its last good snapshot and skips the tick; that
// is the whole handling this needs.
//
// CHAT rides the same file, for the tab screen's chat panel, and the reason it
// comes from the server rather than the client is that the client has nothing
// to give. Measured live 2026-09-05 against the classical mod with a real
// browser client: three spectator `say`s, an `amx_psay` and two `amx_say`s all
// reached the server (they are in the mod's own log) and not one of them
// appeared in the client - not in the HUD, not on the engine's stdout, with
// hud_saytext 1 and hud_saytext_time 5. Death notices DO print to stdout, so
// this is specific to SayText. So there is no client-side stream to intercept
// and the panel would have nothing to draw; going through the server also
// means structured fields instead of regexing localised HUD prose.
//
// Captured with clcmd hooks on say/say_team, which fire once per message with
// the sender known, rather than register_message(SayText), which fires once
// per RECIPIENT (N copies of every line to dedupe) and carries localisation
// tokens instead of plain text. The trade is that admin `amx_say` and plugin
// announcements are not client says and so do not appear. That is the right
// side of the trade for a panel whose job is "what did people say".

#include <amxmodx>
// cs_get_user_deaths - deaths live on CBasePlayer, not in entvars;
// cs_get_user_defuse - the defuse kit is a flag on the player, not an item
#include <cstrike>

new g_roundtime;
new Float:g_roundEnd;

// Rolling window of what has been said. It is the whole history the panel
// gets: no client-side accumulation, so a player who tabs in mid-session sees
// the same last-20 as everyone else, and nothing has to survive a reload.
// Twenty lines is about a screen of the panel and ~2KB on top of a file that
// is rewritten every second anyway.
#define CHAT_MAX 20
#define CHAT_TEXT 128

new g_chatName[CHAT_MAX][32];
new g_chatText[CHAT_MAX][CHAT_TEXT];
new g_chatTeam[CHAT_MAX];
new bool:g_chatDead[CHAT_MAX];
new bool:g_chatTeamOnly[CHAT_MAX];
new g_chatId[CHAT_MAX];
// next slot to write, how many slots hold a message, and the id counter
new g_chatHead;
new g_chatCount;
new g_chatSeq;

public plugin_init()
{
	register_plugin("Frag Fridays Status JSON", "0.4.0", "frag-friday");

	g_roundtime = get_cvar_pointer("mp_roundtime");
	register_logevent("logev_round_start", 2, "1=Round_Start");

	// both return PLUGIN_CONTINUE - this only watches, the server still
	// broadcasts every one of these exactly as it did before
	register_clcmd("say", "cmd_say");
	register_clcmd("say_team", "cmd_say_team");

	set_task(1.0, "task_write", 0, "", 0, "b");
}

public cmd_say(id)
{
	return chat_add(id, false);
}

public cmd_say_team(id)
{
	return chat_add(id, true);
}

chat_add(id, bool:teamOnly)
{
	new text[CHAT_TEXT];
	read_args(text, charsmax(text));
	remove_quotes(text);
	trim(text);

	if (!text[0])
		return PLUGIN_CONTINUE;

	// Chat COMMANDS are not chat. "/guns" and friends are handled by another
	// plugin which answers and then swallows the line, so it never reaches
	// anyone else's screen - putting it in the panel would show a
	// conversation that did not happen. Both prefixes, because players use
	// both and the mods answer to both.
	if (text[0] == '/' || text[0] == '!')
		return PLUGIN_CONTINUE;

	new slot = g_chatHead;
	g_chatHead = (g_chatHead + 1) % CHAT_MAX;
	if (g_chatCount < CHAT_MAX)
		g_chatCount++;

	get_user_name(id, g_chatName[slot], charsmax(g_chatName[]));
	copy(g_chatText[slot], charsmax(g_chatText[]), text);
	g_chatTeam[slot] = get_user_team(id);
	// 1.6 prefixes dead players' chat, because a dead player talking to the
	// living would be a different thing entirely; the panel says so too
	g_chatDead[slot] = !is_user_alive(id);
	g_chatTeamOnly[slot] = teamOnly;
	g_chatId[slot] = ++g_chatSeq;

	return PLUGIN_CONTINUE;
}

public plugin_cfg()
{
	// fresh file at map start rather than a 1s-stale one from the last map
	task_write();
}

public logev_round_start()
{
	g_roundEnd = get_gametime() + get_pcvar_float(g_roundtime) * 60.0;
}

public task_write()
{
	new fp = fopen("../public/status.json", "wt");
	if (!fp)
		return;

	new mapname[32];
	get_mapname(mapname, charsmax(mapname));

	new players[32], num;
	get_players(players, num);

	new humans, bots;
	for (new i = 0; i < num; i++)
	{
		if (is_user_bot(players[i])) bots++;
		else humans++;
	}

	new roundLeft = -1;
	if (g_roundEnd > 0.0)
	{
		roundLeft = max(0, floatround(g_roundEnd - get_gametime()));

		// No-objective maps (fy_*, scoutzknivez) never end the round when
		// the timer expires, so under DM respawn the clock would sit at
		// 0:00 for the rest of the map. The longest legitimate overrun is
		// a planted C4 plus the round-end delay (~1 min), so a clock 90s
		// past expiry is dead - hide it until Round_Start re-arms it.
		if (roundLeft == 0 && get_gametime() - g_roundEnd > 90.0)
		{
			g_roundEnd = 0.0;
			roundLeft = -1;
		}
	}

	fprintf(fp, "{^"map^":^"%s^",^"maxplayers^":%d,^"humans^":%d,^"bots^":%d,^"mapTimeLeft^":%d,^"roundTimeLeft^":%d,^"players^":[",
		mapname, get_maxplayers(), humans, bots, get_timeleft(), roundLeft);

	for (new i = 0; i < num; i++)
	{
		new id = players[i];
		new name[32], esc[64];
		get_user_name(id, name, charsmax(name));
		json_escape(name, esc, charsmax(esc));

		// team: 1 = T, 2 = CT, 3 = spectator, 0 = still picking. The web
		// scoreboard splits on it under Classic; every other mode reads one
		// combined list ordered by kills, so it ignores the field there.
		// Bots report a ping of 0 - the client prints BOT in that column
		// instead, the way 1.6's own scoreboard does.
		new ping, loss;
		get_user_ping(id, ping, loss);

		// Both questions are about who is ALIVE and holding the thing right
		// now. A dead player's bomb is on the ground and their kit died with
		// them, and a board still crediting a corpse with the C4 is worse than
		// one that says nothing: it sends a CT to guard a body.
		new bool:alive = is_user_alive(id) != 0;

		fprintf(fp, "%s{^"name^":^"%s^",^"frags^":%d,^"deaths^":%d,^"team^":%d,^"ping^":%d,^"bot^":%s,^"bomb^":%s,^"kit^":%s}",
			i ? "," : "", esc, get_user_frags(id), cs_get_user_deaths(id),
			get_user_team(id), ping, is_user_bot(id) ? "true" : "false",
			(alive && has_c4(id)) ? "true" : "false",
			(alive && cs_get_user_defuse(id)) ? "true" : "false");
	}

	// oldest first, so the panel can render the array top to bottom and the
	// newest line is the one nearest the input you would type into
	fprintf(fp, "],^"chat^":[");

	for (new i = 0; i < g_chatCount; i++)
	{
		new slot = (g_chatHead - g_chatCount + i + CHAT_MAX) % CHAT_MAX;
		new escName[64], escText[CHAT_TEXT * 2 + 1];
		json_escape(g_chatName[slot], escName, charsmax(escName));
		json_escape(g_chatText[slot], escText, charsmax(escText));

		fprintf(fp, "%s{^"id^":%d,^"name^":^"%s^",^"text^":^"%s^",^"team^":%d,^"dead^":%s,^"teamOnly^":%s}",
			i ? "," : "", g_chatId[slot], escName, escText, g_chatTeam[slot],
			g_chatDead[slot] ? "true" : "false", g_chatTeamOnly[slot] ? "true" : "false");
	}

	fprintf(fp, "]}");
	fclose(fp);
}

// Whether this player is carrying the C4.
//
// Read off the weapon list because there is no "has the bomb" native: to the
// engine C4 is a weapon like any other, and get_user_weapons is core rather
// than a module native, so asking this way costs no new dependency. A dropped
// bomb belongs to nobody and so shows against nobody, which is the honest
// answer to the question the scoreboard is actually asking - "who is carrying
// it", which is not the same question as "where is it".
bool:has_c4(id)
{
	new weapons[32], num;
	get_user_weapons(id, weapons, num);

	for (new i = 0; i < num; i++)
		if (weapons[i] == CSW_C4)
			return true;

	return false;
}

// quotes/backslashes escaped, control chars dropped - enough for player names
// and for chat text, which is the same problem with a longer buffer: both are
// arbitrary bytes a player chose, and both land inside a JSON string. Give
// `dst` room for twice `src` - every character can double.
stock json_escape(const src[], dst[], len)
{
	new j = 0;
	for (new i = 0; src[i] && j < len - 2; i++)
	{
		if (src[i] == '^"' || src[i] == '\')
		{
			dst[j++] = '\';
			dst[j++] = src[i];
		}
		else if (src[i] >= 32)
			dst[j++] = src[i];
	}
	dst[j] = 0;
}
