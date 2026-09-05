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

new g_spawnDelay, g_protectTime, g_refill, g_groundTime, g_only, g_mapGuns;

// preferred primary per player: index into g_guns, -1 = team default
new g_choice[33];

// one /guns hint per connection, on first spawn
new bool:g_hinted[33];

// Keys are the bare word - every chat line is normalised through split_cmd
// before it reaches here, so "/ak", "!ak", ".ak", "ak" and "guns ak" all
// arrive as "ak". The leading slash is added back for display only.
new const g_guns[][] = {
	"ak",     "weapon_ak47",
	"m4",     "weapon_m4a1",
	"aug",    "weapon_aug",
	"sg552",  "weapon_sg552",
	"galil",  "weapon_galil",
	"famas",  "weapon_famas",
	"awp",    "weapon_awp",
	"scout",  "weapon_scout",
	"mp5",    "weapon_mp5navy",
	"p90",    "weapon_p90",
	"mac10",  "weapon_mac10",
	"tmp",    "weapon_tmp",
	"ump",    "weapon_ump45",
	"shotty", "weapon_xm1014",
	"m3",     "weapon_m3",
	"para",   "weapon_m249",
	"deagle", ""  // pistol only
};

// Second names for the same guns, so the /guns list stays short while the
// words players actually reach for still land. Sourced from the logs where
// possible (m4a4, m4a1, sniper, rifle, bullpup, aug, uzi all typed and all
// dead) and from the common 1.6 nicknames otherwise. Resolved to a canonical
// key before anything else looks at the verb.
new const g_aliases[][] = {
	"ak47",    "ak",
	"kalash",  "ak",
	"cv47",    "ak",
	"m4a1",    "m4",
	"m4a4",    "m4",
	"colt",    "m4",
	"bullpup", "aug",
	"krieg",   "sg552",
	"sg",      "sg552",
	"sniper",  "awp",
	"magnum",  "awp",
	"awm",     "awp",
	"clarion", "famas",
	"mp5navy", "mp5",
	"smg",     "mp5",
	"c90",     "p90",
	"uzi",     "mac10",
	"ump45",   "ump",
	"xm",      "shotty",
	"xm1014",  "shotty",
	"pump",    "m3",
	"m249",    "para",
	"de",      "deagle",
	// too vague to pick for them - show the list instead
	"rifle",   "guns",
	"gun",     "guns"
};

public plugin_init()
{
	register_plugin("Frag Fridays DM", "0.1.0", "frag-friday");

	g_spawnDelay  = register_cvar("dm_spawn_delay", "0.75");
	g_protectTime = register_cvar("dm_protect_time", "1.5");
	g_refill      = register_cvar("dm_refill", "1");
	g_groundTime  = register_cvar("dm_ground_time", "3.0");
	// one-weapon maps (cs_deagle5): a game_player_equip hands out
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

// client_disconnect, not client_disconnected: the newer forward needs AMXX's
// SV_DropClient detour, which we disable in gamedata (it crashes this engine -
// see addons/amxmodx/data/gamedata/common.games/custom/). The legacy forward
// fires from ClientDisconnect and is unaffected. It misses clients that abort
// mid-connect; those never had tasks queued.
public client_disconnect(id)
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
	do_respawn(taskid - TASK_RESPAWN);
}

// Respawn one dead player where they stand in the rotation. Shared by the
// post-death task and the /respawn chat command; returns false when the
// player is not in a state that can be respawned (alive, spectating,
// unassigned, gone).
bool:do_respawn(id)
{
	if (!is_user_connected(id) || is_user_alive(id))
		return false;

	new CsTeams:team = cs_get_user_team(id);
	if (team != CS_TEAM_T && team != CS_TEAM_CT)
		return false;

	ExecuteHamB(Ham_CS_RoundRespawn, id);
	return true;
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
	new onlyId = get_only_wid();
	if (!onlyId)
		return;

	new wId = read_data(2);
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

	new onlyId = get_only_wid();
	if (onlyId)
	{
		// one-weapon map: give the map's gun straight away - its own
		// game_player_equip only fires ~1s after spawn
		new wname[24];
		get_weaponname(onlyId, wname, charsmax(wname));
		ham_give_weapon(id, wname);
		cs_set_user_bpammo(id, onlyId, 200);
	}
	else
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

print_gun_line(id, const line[], bool:continuation)
{
	if (continuation)
		client_print(id, print_chat, "[DM] %s", line);
	else
		client_print(id, print_chat, "[DM] Pick a gun for your next spawn: %s", line);
}

// Split a chat line into a normalised verb and optional argument.
//
// Players type the same command a dozen ways, and the SHAPE rather than the
// word is what usually kills it. Measured 2026-09-05 over the full log
// history: of 254 command-shaped lines ever said here, 76 did nothing, and
// the largest group was a word this plugin knows wearing a prefix it did not
// ("ak", "!awp", ".m4") or split across two ("guns ak", "more guns"). The
// inconsistency was also ours - chatrestart.sma took !restart while this
// file took only /-prefixed words.
//
// Accepts /x, !x, .x and bare x, case-insensitively, plus "guns <name>" for
// the pick and "more guns"/"all guns" for the list.
split_cmd(const said[], verb[], vlen, arg[], alen)
{
	new buf[48];
	copy(buf, charsmax(buf), said);
	trim(buf);
	strtolower(buf);

	new start = (buf[0] == '/' || buf[0] == '!' || buf[0] == '.') ? 1 : 0;

	// cut at the first space, leaving the remainder addressable
	new sp = contain(buf[start], " ");
	if (sp != -1)
		buf[start + sp] = EOS;

	copy(verb, vlen, buf[start]);

	if (sp != -1)
	{
		copy(arg, alen, buf[start + sp + 1]);
		trim(arg);
	}
	else
		arg[0] = EOS;

	if (equal(arg, "guns") && (equal(verb, "more") || equal(verb, "all")))
	{
		copy(verb, vlen, "guns");
		arg[0] = EOS;
	}
	else if (equal(verb, "guns") && arg[0])
	{
		copy(verb, vlen, arg);
		arg[0] = EOS;
	}
}

public cmd_say(id)
{
	new said[48];
	read_args(said, charsmax(said));
	remove_quotes(said);
	trim(said);

	new verb[24], arg[24];
	split_cmd(said, verb, charsmax(verb), arg, charsmax(arg));
	if (!verb[0])
		return PLUGIN_CONTINUE;

	for (new i = 0; i < sizeof(g_aliases) / 2; i++)
	{
		if (equal(verb, g_aliases[i * 2]))
		{
			copy(verb, charsmax(verb), g_aliases[i * 2 + 1]);
			break;
		}
	}

	// Pistol picks are not a thing yet, and the reason is structural rather
	// than an oversight: ham_player_spawn hardcodes the deagle as everyone's
	// sidearm, and /deagle is overloaded to mean "pistol only, no rifle" via
	// an empty primary - so "which pistol" and "no rifle" are the same slot.
	// Seven requests sit in the logs (glock, fn, five seven, g18, pistols,
	// sidearm) and all seven died silently. Answering is cheap; a dead end
	// that tells you it is a dead end teaches the menu's real shape.
	if (equal(verb, "pistols") || equal(verb, "sidearm") || equal(verb, "glock")
		|| equal(verb, "usp") || equal(verb, "p228") || equal(verb, "elite")
		|| equal(verb, "fiveseven") || equal(verb, "fn") || equal(verb, "g18"))
	{
		client_print(id, print_chat, "[DM] Pistol picks aren't in yet - everyone spawns with the deagle. Say /deagle for the deagle and no rifle.");
		return PLUGIN_CONTINUE;
	}

	// /respawn - put a dead player back in the game NOW.
	//
	// Without this the only verb a dead player has ever had is /restart, which
	// is chatrestart.sma's SERVER-WIDE round restart: one player who wants to
	// spawn drags everyone through sv_restartround. Measured 2026-09-05 over
	// the full log history, one player accounted for 57 of the server's 90
	// round restarts, 45 of them within a minute of joining. Death already
	// queues task_respawn, so this only ever matters to someone dead for
	// another reason - joined mid-round, or waiting out a long objective map.
	if (equal(verb, "respawn") || equal(verb, "spawn"))
	{
		if (!do_respawn(id))
			client_print(id, print_chat, "[DM] /respawn only works while you are dead and on a team - press F1 or F2 to pick a side.");
		return PLUGIN_CONTINUE;
	}

	if (equal(verb, "guns"))
	{
		// the list outgrew one chat line, so wrap it rather than truncate -
		// still generated from the table so it cannot drift out of date
		new line[96], pos;
		new bool:wrapped = false;
		for (new i = 0; i < sizeof(g_guns) / 2; i++)
		{
			if (pos && pos + strlen(g_guns[i * 2]) + 2 >= charsmax(line))
			{
				print_gun_line(id, line, wrapped);
				wrapped = true;
				pos = 0;
				line[0] = EOS;
			}
			pos += formatex(line[pos], charsmax(line) - pos, "/%s ", g_guns[i * 2]);
		}
		if (pos)
			print_gun_line(id, line, wrapped);
		return PLUGIN_CONTINUE;
	}

	for (new i = 0; i < sizeof(g_guns) / 2; i++)
	{
		if (equal(verb, g_guns[i * 2]))
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
