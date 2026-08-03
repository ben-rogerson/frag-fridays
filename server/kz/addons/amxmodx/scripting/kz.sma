// Frag Fridays KZ - minimal module-free jump/climb mode.
//
// Same constraints as frag_dm.sma: script-only Ham/fakemeta, no binary
// modules, and no Ham hooks on non-player classes (unverified on this
// stack's reimplemented DLL). That rules out Ham_Use on func_button for the
// map timers, so button presses are detected engine-side instead: an IN_USE
// edge in PlayerPreThink plus an AABB proximity check against the map's
// counter buttons (both timed maps in rotation use the classic Xtreme-Jumps
// counter prefab: buttons targeting "counter_start" / "counter_off").
//
// What it does: checkpoint/teleport chat commands, a run timer driven by the
// maps' own start/stop buttons, instant respawn with auto-return to your
// checkpoint (deaths and 9-minute round restarts both land you back where
// you were), knife only, player-vs-player damage blocked, and everyone on
// CT - the rotation's kz maps ship zero T spawn points.

#include <amxmodx>
#include <fakemeta>
#include <cstrike>
#include <hamsandwich>

#define TASK_RESPAWN 42000
#define TASK_TPBACK  44000

new g_spawnDelay;

new Float:g_cp[33][3],   Float:g_cpAng[33][3],   bool:g_hasCp[33];
new Float:g_prev[33][3], Float:g_prevAng[33][3], bool:g_hasPrev[33];
new g_tpCount[33];
new Float:g_runStart[33]; new bool:g_running[33];
new Float:g_best[33];           // per-map session best, 0.0 = none
new g_oldButtons[33];
new Float:g_lastUse[33];
new bool:g_hinted[33];

public plugin_init()
{
	register_plugin("Frag Fridays KZ", "0.1.0", "frag-friday");

	g_spawnDelay = register_cvar("kz_spawn_delay", "0.75");

	register_event("DeathMsg", "event_death", "a");
	RegisterHam(Ham_Spawn, "player", "ham_player_spawn", 1);
	RegisterHam(Ham_TakeDamage, "player", "ham_take_damage", 0);
	register_forward(FM_PlayerPreThink, "fw_prethink");

	register_clcmd("say", "cmd_say");
	register_clcmd("say_team", "cmd_say");

	// KZ round shape: rounds only end on the 9-minute cap (nobody is ever
	// eliminated under respawn) and auto-tp makes the restart invisible.
	// 20-minute maps - climbs need more time than a DM map.
	server_cmd("mp_freezetime 0");
	server_cmd("mp_roundtime 9");
	server_cmd("mp_timelimit 20");

	// on-screen run clock
	set_task(1.0, "task_hud", _, _, _, "b");
}

public client_putinserver(id)
{
	g_hasCp[id] = false;
	g_hasPrev[id] = false;
	g_running[id] = false;
	g_tpCount[id] = 0;
	g_best[id] = 0.0;
	g_oldButtons[id] = 0;
	g_lastUse[id] = 0.0;
	g_hinted[id] = false;
}

public client_disconnected(id)
{
	remove_task(TASK_RESPAWN + id);
	remove_task(TASK_TPBACK + id);
}

// --- death -> instant respawn (auto-tp happens in the spawn hook) -----------

public event_death()
{
	new victim = read_data(2);
	if (is_user_connected(victim))
	{
		remove_task(TASK_RESPAWN + victim);
		set_task(get_pcvar_float(g_spawnDelay), "task_respawn", TASK_RESPAWN + victim);
	}
}

public task_respawn(taskid)
{
	new id = taskid - TASK_RESPAWN;
	if (!is_user_connected(id) || is_user_alive(id))
		return;

	new CsTeams:team = cs_get_user_team(id);
	if (team != CS_TEAM_T && team != CS_TEAM_CT)
		return;

	ExecuteHamB(Ham_CS_RoundRespawn, id);
}

// --- spawn: force CT, knife only, return to checkpoint ----------------------

public ham_player_spawn(id)
{
	if (!is_user_alive(id))
		return;

	new CsTeams:team = cs_get_user_team(id);
	if (team == CS_TEAM_T)
	{
		// the kz maps have no T spawn points at all
		cs_set_user_team(id, CS_TEAM_CT);
		ExecuteHamB(Ham_CS_RoundRespawn, id);
		return;
	}
	if (team != CS_TEAM_CT)
		return;

	ham_strip_weapon(id, "weapon_c4");
	ham_strip_weapon(id, "weapon_glock18");
	ham_strip_weapon(id, "weapon_usp");

	if (!g_hinted[id] && !is_user_bot(id))
	{
		g_hinted[id] = true;
		client_print(id, print_chat, "[KZ] /cp saves a checkpoint, /tp returns to it, /stuck goes one back, /start resets. The map's buttons run the timer.");
	}

	// deaths and round restarts both come through here - put the player back
	// at their checkpoint so neither costs any progress
	if (g_hasCp[id])
	{
		remove_task(TASK_TPBACK + id);
		set_task(0.3, "task_tpback", TASK_TPBACK + id);
	}
}

public task_tpback(taskid)
{
	new id = taskid - TASK_TPBACK;
	if (is_user_alive(id) && g_hasCp[id])
		do_teleport(id);
}

// --- no player-vs-player damage (world and falls still hurt) ----------------

public ham_take_damage(victim, inflictor, attacker, Float:damage, bits)
{
	if (attacker >= 1 && attacker <= 32 && attacker != victim)
		return HAM_SUPERCEDE;
	return HAM_IGNORED;
}

// --- map timer: IN_USE edge + proximity to a counter button -----------------

public fw_prethink(id)
{
	if (!is_user_alive(id))
		return FMRES_IGNORED;

	new btn = pev(id, pev_button);
	new old = g_oldButtons[id];
	g_oldButtons[id] = btn;

	if (!(btn & IN_USE) || (old & IN_USE))
		return FMRES_IGNORED;

	new Float:now = get_gametime();
	if (now - g_lastUse[id] < 0.5)
		return FMRES_IGNORED;
	g_lastUse[id] = now;

	check_counter_button(id);
	return FMRES_IGNORED;
}

check_counter_button(id)
{
	static target[32];
	new ent = 0;
	while ((ent = engfunc(EngFunc_FindEntityByString, ent, "classname", "func_button")))
	{
		pev(ent, pev_target, target, charsmax(target));

		new type = 0;
		if (equal(target, "counter_start") || equal(target, "clockstart"))
			type = 1;
		else if (equal(target, "counter_off") || equal(target, "counter_end")
			|| equal(target, "counter_stop") || equal(target, "clockstop"))
			type = 2;
		if (!type || !in_reach(id, ent))
			continue;

		if (type == 1) timer_start(id);
		else timer_stop(id);
		return;
	}
}

bool:in_reach(id, ent)
{
	new Float:o[3], Float:mins[3], Float:maxs[3];
	pev(id, pev_origin, o);
	pev(ent, pev_absmin, mins);
	pev(ent, pev_absmax, maxs);

	// distance from eye-ish origin to the closest point of the button's AABB
	new Float:d2 = 0.0;
	for (new i = 0; i < 3; i++)
	{
		new Float:c = floatclamp(o[i], mins[i], maxs[i]) - o[i];
		d2 += c * c;
	}
	return d2 <= 96.0 * 96.0;
}

timer_start(id)
{
	g_running[id] = true;
	g_runStart[id] = get_gametime();
	g_tpCount[id] = 0;
	client_print(id, print_chat, "[KZ] Timer started - go!");
}

timer_stop(id)
{
	if (!g_running[id])
		return;
	g_running[id] = false;

	new Float:t = get_gametime() - g_runStart[id];
	new stamp[16], name[32], mapname[32];
	fmt_time(t, stamp, charsmax(stamp));
	get_user_name(id, name, charsmax(name));
	get_mapname(mapname, charsmax(mapname));

	new bool:pb = (g_best[id] == 0.0 || t < g_best[id]);
	if (pb) g_best[id] = t;

	client_print(0, print_chat, "[KZ] %s finished %s in %s with %d teleport%s%s",
		name, mapname, stamp, g_tpCount[id], g_tpCount[id] == 1 ? "" : "s",
		pb ? " - personal best!" : "");
	// one line per finish in the HL log (mp_logfile) - recap material
	log_message("^"%s^" kz_finish (map ^"%s^") (time ^"%s^") (teleports ^"%d^")",
		name, mapname, stamp, g_tpCount[id]);
}

public task_hud()
{
	static players[32], num;
	get_players(players, num, "ach"); // alive humans
	for (new i = 0; i < num; i++)
	{
		new id = players[i];
		if (!g_running[id])
			continue;
		new stamp[16];
		fmt_time(get_gametime() - g_runStart[id], stamp, charsmax(stamp));
		set_hudmessage(200, 220, 255, -1.0, 0.80, 0, 0.0, 1.1, 0.0, 0.0, -1);
		show_hudmessage(id, "%s | %d tp", stamp, g_tpCount[id]);
	}
}

fmt_time(Float:t, out[], len)
{
	new ds = floatround(t * 10.0, floatround_floor);
	formatex(out, len, "%d:%02d.%d", ds / 600, (ds % 600) / 10, ds % 10);
}

vec_copy(const Float:src[3], Float:dst[3])
{
	dst[0] = src[0]; dst[1] = src[1]; dst[2] = src[2];
}

// --- chat commands ----------------------------------------------------------

public cmd_say(id)
{
	new said[32];
	read_args(said, charsmax(said));
	remove_quotes(said);
	trim(said);

	if (equali(said, "/cp") || equali(said, "cp") || equali(said, "/check"))
	{
		cmd_checkpoint(id);
		return PLUGIN_CONTINUE;
	}
	if (equali(said, "/tp") || equali(said, "tp") || equali(said, "/gc"))
	{
		cmd_teleport(id);
		return PLUGIN_CONTINUE;
	}
	if (equali(said, "/stuck") || equali(said, "/prev"))
	{
		cmd_stuck(id);
		return PLUGIN_CONTINUE;
	}
	if (equali(said, "/start") || equali(said, "/restart") || equali(said, "/reset"))
	{
		cmd_start(id);
		return PLUGIN_CONTINUE;
	}
	if (equali(said, "/time"))
	{
		if (g_running[id])
		{
			new stamp[16];
			fmt_time(get_gametime() - g_runStart[id], stamp, charsmax(stamp));
			client_print(id, print_chat, "[KZ] Current run: %s, %d teleports.", stamp, g_tpCount[id]);
		}
		else
			client_print(id, print_chat, "[KZ] No run going - press the map's start button.");
		return PLUGIN_CONTINUE;
	}
	if (equali(said, "/top"))
	{
		cmd_top(id);
		return PLUGIN_CONTINUE;
	}
	if (equali(said, "/kz") || equali(said, "/help"))
	{
		client_print(id, print_chat, "[KZ] /cp checkpoint - /tp back - /stuck previous cp - /start over - /time - /top");
		return PLUGIN_CONTINUE;
	}
	return PLUGIN_CONTINUE;
}

cmd_checkpoint(id)
{
	if (!is_user_alive(id))
	{
		client_print(id, print_chat, "[KZ] You need to be alive to set a checkpoint.");
		return;
	}
	// mid-air checkpoints defeat the whole map; ladders (MOVETYPE_FLY) are fine
	if (!(pev(id, pev_flags) & FL_ONGROUND) && pev(id, pev_movetype) != MOVETYPE_FLY)
	{
		client_print(id, print_chat, "[KZ] Checkpoints only stick on the ground (or a ladder).");
		return;
	}

	if (g_hasCp[id])
	{
		vec_copy(g_cp[id], g_prev[id]);
		vec_copy(g_cpAng[id], g_prevAng[id]);
		g_hasPrev[id] = true;
	}
	pev(id, pev_origin, g_cp[id]);
	pev(id, pev_v_angle, g_cpAng[id]);
	g_hasCp[id] = true;
	client_print(id, print_chat, "[KZ] Checkpoint saved - /tp to return.");
}

cmd_teleport(id)
{
	if (!g_hasCp[id])
	{
		client_print(id, print_chat, "[KZ] No checkpoint yet - say /cp to save one.");
		return;
	}
	if (!is_user_alive(id))
	{
		client_print(id, print_chat, "[KZ] Respawning - you'll land back on your checkpoint.");
		return;
	}
	do_teleport(id);
}

do_teleport(id)
{
	engfunc(EngFunc_SetOrigin, id, g_cp[id]);
	new Float:zero[3];
	set_pev(id, pev_velocity, zero);
	set_pev(id, pev_angles, g_cpAng[id]);
	set_pev(id, pev_fixangle, 1);
	if (g_running[id])
		g_tpCount[id]++;
}

cmd_stuck(id)
{
	if (!g_hasPrev[id])
	{
		client_print(id, print_chat, "[KZ] No older checkpoint to fall back to.");
		return;
	}
	// swap current and previous, then teleport
	new Float:o[3], Float:a[3];
	vec_copy(g_cp[id], o); vec_copy(g_cpAng[id], a);
	vec_copy(g_prev[id], g_cp[id]); vec_copy(g_prevAng[id], g_cpAng[id]);
	vec_copy(o, g_prev[id]); vec_copy(a, g_prevAng[id]);
	client_print(id, print_chat, "[KZ] Back one checkpoint.");
	if (is_user_alive(id))
		do_teleport(id);
}

cmd_start(id)
{
	g_hasCp[id] = false;
	g_hasPrev[id] = false;
	g_running[id] = false;
	g_tpCount[id] = 0;
	if (is_user_alive(id))
		ExecuteHamB(Ham_CS_RoundRespawn, id);
	client_print(id, print_chat, "[KZ] Fresh start - checkpoints cleared.");
}

cmd_top(id)
{
	// session bests of everyone currently on the server, best first
	new players[32], num, order[32];
	get_players(players, num, "ch");
	new shown = 0;
	for (new i = 0; i < num; i++)
		if (g_best[players[i]] > 0.0)
			order[shown++] = players[i];

	if (!shown)
	{
		client_print(id, print_chat, "[KZ] No finishes on this map yet.");
		return;
	}
	// tiny n - selection sort is plenty
	for (new i = 0; i < shown - 1; i++)
		for (new j = i + 1; j < shown; j++)
			if (g_best[order[j]] < g_best[order[i]])
			{
				new tmp = order[i]; order[i] = order[j]; order[j] = tmp;
			}

	for (new i = 0; i < min(shown, 5); i++)
	{
		new stamp[16], name[32];
		fmt_time(g_best[order[i]], stamp, charsmax(stamp));
		get_user_name(order[i], name, charsmax(name));
		client_print(id, print_chat, "[KZ] %d. %s - %s", i + 1, name, stamp);
	}
}

// --- stock lifted verbatim from frag_dm.sma (proven on this stack) ----------

stock ham_strip_weapon(id, const weapon[])
{
	if (!equal(weapon, "weapon_", 7)) return 0;

	new wId = get_weaponid(weapon);
	if (!wId) return 0;

	new wEnt;
	while ((wEnt = engfunc(EngFunc_FindEntityByString, wEnt, "classname", weapon)) && pev(wEnt, pev_owner) != id) {}
	if (!wEnt) return 0;

	if (get_user_weapon(id) == wId) ExecuteHamB(Ham_Weapon_RetireWeapon, wEnt);

	if (!ExecuteHamB(Ham_RemovePlayerItem, id, wEnt)) return 0;
	ExecuteHamB(Ham_Item_Kill, wEnt);

	set_pev(id, pev_weapons, pev(id, pev_weapons) & ~(1 << wId));

	if (wId == CSW_C4)
	{
		cs_set_user_plant(id, 0, 0);
		cs_set_user_bpammo(id, CSW_C4, 0);
	}

	return 1;
}
