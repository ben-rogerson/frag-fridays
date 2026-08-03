// Frag Fridays status JSON - live server snapshot for the web loading screen.
//
// Writes ../public/status.json every 5s. The game server and the Go web
// server share the container and /xashds is the working dir, so the AMXX
// relative path "cstrike/../public/" lands in the statically-served dir -
// same origin as the loading page, no CORS, no extra mounts. The target
// file is pre-created writable in the Dockerfile (the dir stays root-owned).
//
// Round time left is tracked from the Round_Start logevent because no cvar
// exposes it; -1 means "no round timer seen yet this map" and the frontend
// hides it.

#include <amxmodx>

new g_roundtime;
new Float:g_roundEnd;

public plugin_init()
{
	register_plugin("Frag Fridays Status JSON", "0.1.0", "frag-friday");

	g_roundtime = get_cvar_pointer("mp_roundtime");
	register_logevent("logev_round_start", 2, "1=Round_Start");

	set_task(5.0, "task_write", 0, "", 0, "b");
}

public plugin_cfg()
{
	// fresh file at map start rather than a 5s-stale one from the last map
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
		roundLeft = max(0, floatround(g_roundEnd - get_gametime()));

	fprintf(fp, "{^"map^":^"%s^",^"maxplayers^":%d,^"humans^":%d,^"bots^":%d,^"mapTimeLeft^":%d,^"roundTimeLeft^":%d,^"players^":[",
		mapname, get_maxplayers(), humans, bots, get_timeleft(), roundLeft);

	for (new i = 0; i < num; i++)
	{
		new id = players[i];
		new name[32], esc[64];
		get_user_name(id, name, charsmax(name));
		json_escape(name, esc, charsmax(esc));

		fprintf(fp, "%s{^"name^":^"%s^",^"frags^":%d,^"bot^":%s}",
			i ? "," : "", esc, get_user_frags(id), is_user_bot(id) ? "true" : "false");
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
