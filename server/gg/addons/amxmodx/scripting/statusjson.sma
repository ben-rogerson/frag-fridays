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
// The file is truncated in place (compose mounts it by inode, so no
// write-then-rename), which means a read landing mid-write gets half a
// document. The client keeps its last good snapshot and skips the tick; that
// is the whole handling this needs.

#include <amxmodx>
// cs_get_user_deaths - deaths live on CBasePlayer, not in entvars
#include <cstrike>

new g_roundtime;
new Float:g_roundEnd;

public plugin_init()
{
	register_plugin("Frag Fridays Status JSON", "0.2.0", "frag-friday");

	g_roundtime = get_cvar_pointer("mp_roundtime");
	register_logevent("logev_round_start", 2, "1=Round_Start");

	set_task(1.0, "task_write", 0, "", 0, "b");
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

		fprintf(fp, "%s{^"name^":^"%s^",^"frags^":%d,^"deaths^":%d,^"team^":%d,^"ping^":%d,^"bot^":%s}",
			i ? "," : "", esc, get_user_frags(id), cs_get_user_deaths(id),
			get_user_team(id), ping, is_user_bot(id) ? "true" : "false");
	}

	fprintf(fp, "]}");
	fclose(fp);
}

// quotes/backslashes escaped, control chars dropped - enough for player names
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
