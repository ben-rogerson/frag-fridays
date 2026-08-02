// Frag Friday DM - minimal module-free deathmatch.
//
// CSDM's binary module signature-scans the original CS game DLL and fails
// silently against this stack's reimplemented DLL (see docs/decisions.md), so
// this plugin recreates the useful subset with plain Ham/fakemeta calls -
// every API used here is proven on this stack by gungame.sma.
//
// What it does: instant respawn after death, armour + rifle + deagle on
// spawn, brief spawn protection, backpack ammo refill on kill, strips the C4
// so bomb rounds cannot end the round under respawn.
//
// Gun choice is CHAT COMMANDS, not a menu - AMXX menus are unverified in the
// browser client (backlog item 5). Say /guns for the list; choice applies
// from the next spawn.

#include <amxmodx>
#include <amxmisc>
#include <fakemeta>
#include <cstrike>
#include <hamsandwich>
#include <fun>

#if !defined SF_NORESPAWN
	#define SF_NORESPAWN (1 << 30)
#endif

#define TASK_RESPAWN 42000
#define TASK_PROTECT 43000

new g_spawnDelay, g_protectTime, g_refill;

// preferred primary per player: index into g_guns, -1 = team default
new g_choice[33];

new const g_guns[][] = {
	"/ak",     "weapon_ak47",
	"/m4",     "weapon_m4a1",
	"/awp",    "weapon_awp",
	"/mp5",    "weapon_mp5navy",
	"/p90",    "weapon_p90",
	"/scout",  "weapon_scout",
	"/shotty", "weapon_xm1014",
	"/famas",  "weapon_famas",
	"/deagle", ""  // pistol only
};

public plugin_init()
{
	register_plugin("Frag Friday DM", "0.1.0", "frag-friday");

	g_spawnDelay  = register_cvar("dm_spawn_delay", "0.75");
	g_protectTime = register_cvar("dm_protect_time", "1.5");
	g_refill      = register_cvar("dm_refill", "1");

	register_event("DeathMsg", "event_death", "a");
	RegisterHam(Ham_Spawn, "player", "ham_player_spawn", 1);

	register_clcmd("say", "cmd_say");
	register_clcmd("say_team", "cmd_say");

	// DM round shape: no freeze, long rounds (they end on the round timer,
	// since respawn means teams are never eliminated)
	server_cmd("mp_freezetime 0");
	server_cmd("mp_roundtime 9");
	server_cmd("mp_buytime 0.25");
}

public client_putinserver(id)
{
	g_choice[id] = -1;
}

public client_disconnected(id)
{
	remove_task(TASK_RESPAWN + id);
	remove_task(TASK_PROTECT + id);
}

// --- death -> queue respawn, refill killer ---------------------------------

public event_death()
{
	new killer = read_data(1);
	new victim = read_data(2);

	if (is_user_connected(victim))
	{
		remove_task(TASK_RESPAWN + victim);
		set_task(get_pcvar_float(g_spawnDelay), "task_respawn", TASK_RESPAWN + victim);
	}

	if (get_pcvar_num(g_refill) && killer != victim
		&& is_user_alive(killer))
	{
		new clip, ammo, wId = get_user_weapon(killer, clip, ammo);
		if (wId && wId != CSW_KNIFE && wId != CSW_C4)
			cs_set_user_bpammo(killer, wId, 200);
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

// --- spawn -> equip + protect ----------------------------------------------

public ham_player_spawn(id)
{
	if (!is_user_alive(id))
		return;

	new CsTeams:team = cs_get_user_team(id);
	if (team != CS_TEAM_T && team != CS_TEAM_CT)
		return;

	// bomb rounds must not end the round out from under respawning players
	ham_strip_weapon(id, "weapon_c4");

	// replace the spawn pistol with a deagle
	ham_strip_weapon(id, "weapon_glock18");
	ham_strip_weapon(id, "weapon_usp");
	ham_give_weapon(id, "weapon_deagle");
	cs_set_user_bpammo(id, CSW_DEAGLE, 70);

	new primary[24];
	get_primary(id, team, primary, charsmax(primary));
	if (primary[0])
	{
		ham_give_weapon(id, primary);
		new wId = get_weaponid(primary);
		if (wId) cs_set_user_bpammo(id, wId, 200);
	}

	cs_set_user_armor(id, 100, CS_ARMOR_VESTHELM);

	new Float:protect = get_pcvar_float(g_protectTime);
	if (protect > 0.0)
	{
		set_user_godmode(id, 1);
		set_user_rendering(id, kRenderFxGlowShell, 100, 200, 100, kRenderTransColor, 16);
		remove_task(TASK_PROTECT + id);
		set_task(protect, "task_unprotect", TASK_PROTECT + id);
	}
}

public task_unprotect(taskid)
{
	new id = taskid - TASK_PROTECT;
	if (!is_user_connected(id))
		return;
	set_user_godmode(id, 0);
	set_user_rendering(id);
}

get_primary(id, CsTeams:team, out[], len)
{
	new c = g_choice[id];
	if (c == -1)
	{
		copy(out, len, team == CS_TEAM_T ? "weapon_ak47" : "weapon_m4a1");
		return;
	}
	copy(out, len, g_guns[c * 2 + 1]);
}

// --- chat commands ----------------------------------------------------------

public cmd_say(id)
{
	new said[32];
	read_args(said, charsmax(said));
	remove_quotes(said);
	trim(said);

	if (equali(said, "/guns") || equali(said, "guns"))
	{
		new list[128], pos;
		for (new i = 0; i < sizeof(g_guns) / 2; i++)
			pos += formatex(list[pos], charsmax(list) - pos, "%s ", g_guns[i * 2]);
		client_print(id, print_chat, "[DM] Pick a gun for your next spawn: %s", list);
		return PLUGIN_CONTINUE;
	}

	for (new i = 0; i < sizeof(g_guns) / 2; i++)
	{
		if (equali(said, g_guns[i * 2]))
		{
			g_choice[id] = i;
			client_print(id, print_chat, "[DM] %s from your next spawn.",
				g_guns[i * 2 + 1][0] ? g_guns[i * 2 + 1] : "deagle only");
			return PLUGIN_CONTINUE;
		}
	}
	return PLUGIN_CONTINUE;
}

// --- stocks lifted verbatim from gungame.sma (proven on this stack) ---------

// gives a player a weapon efficiently
stock ham_give_weapon(id, const weapon[])
{
	if (!equal(weapon, "weapon_", 7)) return 0;

	new wEnt = engfunc(EngFunc_CreateNamedEntity, engfunc(EngFunc_AllocString, weapon));
	if (!pev_valid(wEnt)) return 0;

	set_pev(wEnt, pev_spawnflags, SF_NORESPAWN);
	dllfunc(DLLFunc_Spawn, wEnt);

	if (!ExecuteHamB(Ham_AddPlayerItem, id, wEnt))
	{
		if (pev_valid(wEnt)) set_pev(wEnt, pev_flags, pev(wEnt, pev_flags) | FL_KILLME);
		return 0;
	}

	ExecuteHamB(Ham_Item_AttachToPlayer, wEnt, id)
	return 1;
}

// takes a weapon from a player efficiently
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
	else if (wId == CSW_SMOKEGRENADE || wId == CSW_FLASHBANG || wId == CSW_HEGRENADE)
		cs_set_user_bpammo(id, wId, 0);

	return 1;
}
