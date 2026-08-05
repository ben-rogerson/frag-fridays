// Frag Fridays DM - minimal module-free deathmatch.
//
// CSDM's binary module signature-scans the original CS game DLL and fails
// silently against this stack's reimplemented DLL (see docs/decisions.md), so
// this plugin recreates the useful subset with plain Ham/fakemeta calls -
// every API used here is proven on this stack by gungame.sma.
//
// What it does: instant respawn after death, armour + rifle + deagle on
// spawn, brief spawn protection, backpack ammo refill on kill, strips the C4
// so bomb rounds cannot end the round under respawn. Maps with their own
// floor guns (dm_map_guns) or a single signature gun (dm_only) override the
// spawn kit - see the cvar comments below.
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
// offset must clear TASK_PROTECT + max entity index (weaponbox tasks are
// keyed by entity, not player)
#define TASK_WBOX    50000

new g_spawnDelay, g_protectTime, g_refill, g_groundTime, g_only, g_mapGuns, g_botKnives;

// preferred primary per player: index into g_guns, -1 = team default
new g_choice[33];

// one /guns hint per connection, on first spawn
new bool:g_hinted[33];

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
	register_plugin("Frag Fridays DM", "0.1.0", "frag-friday");

	g_spawnDelay  = register_cvar("dm_spawn_delay", "0.75");
	g_protectTime = register_cvar("dm_protect_time", "1.5");
	g_refill      = register_cvar("dm_refill", "1");
	g_groundTime  = register_cvar("dm_ground_time", "3.0");
	// one-weapon maps (cs_deagle5, awp_india): a game_player_equip hands out
	// the map's gun and info_map_parameters says "buying 3" - but this
	// stack's DLL ignores that, so bots (yb_botbuy 1) and humans can still
	// buy. Set dm_only to the weapon shortname ("deagle", "awp") per map via
	// configs/maps/<map>.cfg: the DM kit is replaced by that gun and
	// everything else is stripped the moment it is deployed. The amxx.cfg
	// baseline resets it to "" every map start so it can't leak.
	g_only        = register_cvar("dm_only", "");
	// floor-gun maps (aim_map): the BSP ships its own armoury_entity rifles,
	// so skip the primary handout - players spawn with the deagle and grab
	// rifles off the floor. Armoury entities only restock on round restart
	// and DM never restarts rounds on no-objective maps, so dropped primaries
	// are kept (exempt from weaponbox cleanup) - the map's guns circulate
	// through kill/drop/pickup instead. Set per map via configs/maps/<map>.cfg;
	// the amxx.cfg baseline resets it to 0 every map start so it can't leak.
	g_mapGuns     = register_cvar("dm_map_guns", "0");
	// aim prac: bots fight with knives only. yb_jasonmode stops YaPB buying,
	// but this plugin hands out the spawn kit itself - so skip the kit and
	// armour for bots, and strip anything a bot still ends up holding (floor
	// pickups). Humans are untouched.
	g_botKnives   = register_cvar("dm_bot_knives", "0");

	register_event("DeathMsg", "event_death", "a");
	RegisterHam(Ham_Spawn, "player", "ham_player_spawn", 1);

	// dm_only enforcement - CurWeapon fires on every deploy (bought, picked
	// up, bot or human), so nothing outside the allowed set survives.
	register_event("CurWeapon", "event_curweapon", "be", "1=1");

	// dropped-gun cleanup: constant respawns litter the map with weaponbox
	// ents and the accumulation lags clients. Engine-level forward, no Ham
	// on non-player classes (unverified on this stack's reimplemented DLL).
	register_forward(FM_SetModel, "fw_set_model");

	register_clcmd("say", "cmd_say");
	register_clcmd("say_team", "cmd_say");

	// DM round shape: no freeze, long rounds. With respawn, teams are never
	// eliminated; only objective maps (hostages/bomb sites) end the round on
	// the timer - no-objective maps run one round for the whole map. Short
	// timelimit so a 30-minute session sees at least two maps and the
	// end-of-map vote.
	server_cmd("mp_freezetime 0");
	server_cmd("mp_roundtime 5");
	server_cmd("mp_buytime 0.25");
	server_cmd("mp_timelimit 10");
}

public client_putinserver(id)
{
	g_choice[id] = -1;
	g_hinted[id] = false;
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

// --- one-weapon maps: strip everything else on deploy ------------------------

// CSW id of the dm_only weapon, or 0 when the map is a normal DM map
get_only_wid()
{
	new only[16], wname[24];
	get_pcvar_string(g_only, only, charsmax(only));
	if (!only[0])
		return 0;
	formatex(wname, charsmax(wname), "weapon_%s", only);
	return get_weaponid(wname);
}

public event_curweapon(id)
{
	new wId = read_data(2);

	// knife-horde bots must never end up holding a gun
	if (wId != CSW_KNIFE && get_pcvar_num(g_botKnives) && is_user_bot(id))
	{
		new wname[24];
		get_weaponname(wId, wname, charsmax(wname));
		ham_strip_weapon(id, wname);
		return;
	}

	new onlyId = get_only_wid();
	if (!onlyId)
		return;
	if (wId == onlyId || ((1 << wId) & ((1 << CSW_KNIFE)
		| (1 << CSW_HEGRENADE) | (1 << CSW_FLASHBANG) | (1 << CSW_SMOKEGRENADE))))
		return;

	new wname[24];
	get_weaponname(wId, wname, charsmax(wname));
	ham_strip_weapon(id, wname);
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

	// knife-horde bot: spawn pistols are stripped above, so the knife is all
	// that's left - no kit, no armour. Spawn protection still applies.
	new bool:knifeBot = (get_pcvar_num(g_botKnives) && is_user_bot(id)) ? true : false;

	new onlyId = knifeBot ? 0 : get_only_wid();
	if (onlyId)
	{
		// one-weapon map: give the map's gun straight away - its own
		// game_player_equip only fires ~1s after spawn
		new wname[24];
		get_weaponname(onlyId, wname, charsmax(wname));
		ham_give_weapon(id, wname);
		cs_set_user_bpammo(id, onlyId, 200);
	}
	else if (!knifeBot)
	{
		ham_give_weapon(id, "weapon_deagle");
		cs_set_user_bpammo(id, CSW_DEAGLE, 70);

		if (!get_pcvar_num(g_mapGuns))
		{
			new primary[24];
			get_primary(id, team, primary, charsmax(primary));
			if (primary[0])
			{
				ham_give_weapon(id, primary);
				new wId = get_weaponid(primary);
				if (wId) cs_set_user_bpammo(id, wId, 200);
			}
		}
	}

	if (!knifeBot)
		cs_set_user_armor(id, 100, CS_ARMOR_VESTHELM);

	// no /guns hint on one-weapon maps - the choice would not apply
	if (!g_hinted[id] && !is_user_bot(id) && !onlyId)
	{
		g_hinted[id] = true;
		if (get_pcvar_num(g_mapGuns))
			client_print(id, print_chat, "[DM] Rifles are lying around the map - grab one off the floor.");
		else
			client_print(id, print_chat, "[DM] Say /guns to pick your gun - it applies from your next spawn.");
	}

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

// --- dropped weapon cleanup -------------------------------------------------

// on floor-gun maps only these get cleaned up - dropped primaries must stay
// in circulation (see dm_map_guns above)
new const g_junkModels[][] = {
	"w_deagle", "w_usp", "w_glock18", "w_p228", "w_elite", "w_fiveseven",
	"w_hegrenade", "w_flashbang", "w_smokegrenade"
};

// every drop routes through SetModel on a fresh weaponbox ent
public fw_set_model(ent, const model[])
{
	static classname[12];
	if (!pev_valid(ent))
		return FMRES_IGNORED;

	pev(ent, pev_classname, classname, charsmax(classname));
	if (!equal(classname, "weaponbox"))
		return FMRES_IGNORED;

	if (get_pcvar_num(g_mapGuns))
	{
		new bool:junk = false;
		for (new i = 0; i < sizeof(g_junkModels); i++)
		{
			if (containi(model, g_junkModels[i]) != -1)
			{
				junk = true;
				break;
			}
		}
		if (!junk)
			return FMRES_IGNORED;
	}

	new Float:life = get_pcvar_float(g_groundTime);
	if (life > 0.0)
	{
		// SetModel can fire more than once for the same box
		remove_task(TASK_WBOX + ent);
		set_task(life, "task_remove_wbox", TASK_WBOX + ent);
	}
	return FMRES_IGNORED;
}

public task_remove_wbox(taskid)
{
	new ent = taskid - TASK_WBOX;
	// entity slots get reused - only remove if it is still a weaponbox
	// (picked-up boxes are freed by the game; a reused slot at worst loses
	// a newer dropped gun a little early)
	if (!pev_valid(ent))
		return;

	static classname[12];
	pev(ent, pev_classname, classname, charsmax(classname));
	if (!equal(classname, "weaponbox"))
		return;

	engfunc(EngFunc_RemoveEntity, ent);
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
			if (get_pcvar_num(g_mapGuns))
				client_print(id, print_chat, "[DM] This map runs its own floor guns - your pick applies on other maps.");
			else
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
