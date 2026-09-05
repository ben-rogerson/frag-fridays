// Frag Fridays rejoin cleanup - give a crashed player their own name and their
// own seat back instead of "Name (1)" beside a ghost.
//
// THE BUG. sv_timeout is 600 on purpose (browsers freeze the WASM game loop in
// a background tab, and a short timeout kicked alt-tabbed players - see
// docs/decisions.md). So when a tab crashes or the machine is force-quit, the
// engine keeps that client, its slot AND its name for up to ten minutes. The
// player comes back, the engine finds the name taken, and hands them
// "Reversons (1)". That splits them in two in the kill logs, which is what the
// standings and the Friday recap are built from - half their frags each, and
// an MVP they actually won can go to someone else.
//
// WHAT COUNTS AS "THE SAME PLAYER" HERE. Nothing but the name, and that is not
// laziness - it is everything this stack gives us. Measured in a throwaway
// container on 2026-09-05 with a real browser client:
//
//   authid   ID_7dea362b3fac8e00956a4952a3d4f47 - the same constant for every
//            browser client ever seen (it is the hash of an absent steamid; it
//            is all over data/logs/). Useless.
//   ip       "0.87.11.9:1000", "1.94.234.160:1000", "5.235.128.164:1000" - the
//            Go/WebRTC layer fabricates an address per CONNECTION, always port
//            1000, and the same person gets a different one every time they
//            join. Not the player's real address, not stable, useless.
//
// So: name only. Which means the plugin must be careful never to knock out a
// DIFFERENT person who happens to use the same alias - see below.
//
// WHAT DISTINGUISHES A GHOST FROM A LIVE PLAYER. The ghost is the one that is
// not sending. FM_CmdStart fires once per usercmd received from a client, so
// it is a direct "this client's packets are still arriving" signal. Measured
// on the same rig: a live client ticks ~60/s; the instant its renderer was
// crashed the count froze and stayed frozen for the whole seven minutes the
// engine held the slot. get_user_ping/loss do NOT work for this - the ghost's
// ping stayed pinned at its last value (27ms) and loss stayed 0 the entire
// time. get_players() DOES still list the ghost (conn=1), so enumeration is
// fine.
//
// THE POLICY. On a client joining, look for another client with the same base
// name. Drop it only if it has been silent for ff_rejoin_quiet seconds. A live
// player under the same alias is sending every frame, so they are never
// touched. The residual case this cannot separate is a DIFFERENT person under
// the same alias who is alt-tabbed at that moment (also silent) - they would be
// dropped back to the lobby with a Reconnect button. Aliases here are people's
// actual names, so that trade is worth it; ff_rejoin_drop 0 turns the whole
// thing off live via the cmdpipe if it ever isn't.
//
// THE NAME COMES BACK BY RENAMING, NOT BY WINNING THE RACE. The engine
// uniquifies before AMXX sees anything: at client_connect the incoming name is
// ALREADY "Reversons (1)" (verified on the rig). So there is no hook early
// enough to prevent the suffix - the plugin drops the ghost first and then puts
// the base name back.
//
// WHY THE DROP IS SAFE HERE, AND ONLY HERE. AMX Mod X detours the engine's
// SV_DropClient and reads Xash's sv_client_t as GoldSrc's client_t; that
// crashed the whole server eight times before 2026-08-28 (see
// docs/troubleshooting.md). Every mod that ships this plugin also ships
// addons/amxmodx/data/gamedata/common.games/custom/fragfridays-sv-dropclient.txt,
// which makes the detour fail to install, so a kick runs the engine's own drop
// with no AMXX prehook in the way. Boot-tested 2026-09-05: kicking a ghost
// dropped it in the same frame, container RestartCount 0, no "Crash: signal".
// DO NOT ship this plugin anywhere that gamedata override is missing.

#include <amxmodx>
#include <fakemeta>

#define MAX_SLOTS 33
// task ids are offset so they can never collide with another plugin's
#define TASK_SWEEP 7100
#define TASK_RENAME 7200

new g_pDrop;
new g_pQuiet;

// get_gametime() of the last usercmd received from each slot; 0.0 = none yet
new Float:g_lastCmd[MAX_SLOTS];
// the name to put back once the ghost is gone
new g_wantName[MAX_SLOTS][32];

public plugin_init()
{
	register_plugin("Frag Fridays Rejoin", "0.1.0", "frag-friday");

	// live kill switch: pnpm run rc "ff_rejoin_drop 0" stops it dropping
	// anything, with the logging left on
	g_pDrop = register_cvar("ff_rejoin_drop", "1");
	// how long a same-named client must have been silent before it counts as
	// a ghost. 10s is far longer than any hitch a client that is still there
	// can produce (they send ~60 cmds a second) and far shorter than the 600s
	// the engine would otherwise hold the slot for.
	g_pQuiet = register_cvar("ff_rejoin_quiet", "10.0");

	register_forward(FM_CmdStart, "fw_cmdstart");
}

// one call per usercmd received from a client - the "still sending" signal
public fw_cmdstart(id)
{
	g_lastCmd[id] = get_gametime();
	return FMRES_IGNORED;
}

public client_connect(id)
{
	// slots are reused, so the previous occupant's timestamp would make a
	// brand new client look like it had been quiet for minutes
	g_lastCmd[id] = 0.0;
	g_wantName[id][0] = 0;
	return PLUGIN_CONTINUE;
}

public client_putinserver(id)
{
	// Treat joining as activity. This matters on a MAP CHANGE: the plugin
	// reloads with a zeroed table while everyone stays connected, and without
	// this stamp two live players who genuinely share an alias would both look
	// silent on the next map and one would be dropped. Stamped here they each
	// get a fresh grace period, and only a client that then stops sending ages
	// past ff_rejoin_quiet.
	g_lastCmd[id] = get_gametime();

	if (is_user_bot(id))
		return;

	// deliberately NOT inline: kicking runs the engine's drop synchronously
	// (verified - client_disconnect fires before server_exec returns), and
	// doing that from inside the connect path would re-enter the engine
	// mid-connect. A tick later the new client owns its slot outright.
	set_task(0.5, "task_sweep", id + TASK_SWEEP);
}

public client_disconnect(id)
{
	// client_disconnect, not client_disconnected: the newer forward is
	// disabled by the SV_DropClient gamedata override (same reason as
	// frag_dm.sma)
	g_lastCmd[id] = 0.0;
	g_wantName[id][0] = 0;
	remove_task(id + TASK_SWEEP);
	remove_task(id + TASK_RENAME);
}

public task_sweep(taskid)
{
	new id = taskid - TASK_SWEEP;
	if (!is_user_connected(id))
		return;

	new name[32], base[32];
	get_user_name(id, name, charsmax(name));
	strip_dupe_suffix(name, base, charsmax(base));

	new Float:quietFor = get_pcvar_float(g_pQuiet);
	new Float:now = get_gametime();
	new maxp = get_maxplayers();
	new dropped = 0;

	for (new j = 1; j <= maxp; j++)
	{
		if (j == id || is_user_bot(j))
			continue;
		// is_user_connecting catches a client still mid-handshake, which
		// holds a slot and a name just like a joined one
		if (!is_user_connected(j) && !is_user_connecting(j))
			continue;

		new other[32], otherBase[32];
		get_user_name(j, other, charsmax(other));
		strip_dupe_suffix(other, otherBase, charsmax(otherBase));
		if (!equal(otherBase, base))
			continue;

		// Never kick a client that is still sending. A zero stamp means the
		// client never even reached client_putinserver - a handshake that
		// stalled - so fall back to how long it has been sitting there.
		new Float:silent = g_lastCmd[j] > 0.0 ? now - g_lastCmd[j] : float(get_user_time(j));
		if (silent < quietFor)
		{
			log_amx("ff_rejoin: ^"%s^" (uid %d) matches ^"%s^" but is still sending (%.1fs) - left alone",
				other, get_user_userid(j), name, silent);
			continue;
		}

		if (!get_pcvar_num(g_pDrop))
		{
			log_amx("ff_rejoin: would drop ghost ^"%s^" (uid %d, silent %.0fs) for ^"%s^" - ff_rejoin_drop is 0",
				other, get_user_userid(j), silent, name);
			continue;
		}

		log_amx("ff_rejoin: dropping ghost ^"%s^" (uid %d, silent %.0fs) - ^"%s^" is rejoining",
			other, get_user_userid(j), silent, name);
		server_cmd("kick #%d ^"reconnected - your old session was still on the server^"", get_user_userid(j));
		dropped++;
	}

	if (!dropped)
		return;

	server_exec();

	// the ghost owned the base name; now that it is gone, take it back
	if (!equal(name, base))
	{
		copy(g_wantName[id], charsmax(g_wantName[]), base);
		set_task(0.5, "task_rename", id + TASK_RENAME);
	}
}

public task_rename(taskid)
{
	new id = taskid - TASK_RENAME;
	if (!is_user_connected(id) || !g_wantName[id][0])
		return;

	new now[32];
	get_user_name(id, now, charsmax(now));
	if (equal(now, g_wantName[id]))
		return;

	log_amx("ff_rejoin: renaming ^"%s^" back to ^"%s^"", now, g_wantName[id]);
	set_user_info(id, "name", g_wantName[id]);
}

// "Reversons (1)" -> "Reversons". The engine appends " (N)" on a name
// collision and counts up, so one strip is enough, but a name that already
// ended in a suffix would come through as "X (1) (1)" - loop a couple of
// times rather than assume.
stock strip_dupe_suffix(const src[], dst[], len)
{
	copy(dst, len, src);

	for (new pass = 0; pass < 2; pass++)
	{
		new n = strlen(dst);
		if (n < 4 || dst[n - 1] != ')')
			return;

		new i = n - 2;
		new digits = 0;
		while (i > 0 && dst[i] >= '0' && dst[i] <= '9')
		{
			digits++;
			i--;
		}
		// need "<space>(<digits>)" and something before it
		if (!digits || dst[i] != '(' || i < 2 || dst[i - 1] != ' ')
			return;

		dst[i - 1] = 0;
	}
}
