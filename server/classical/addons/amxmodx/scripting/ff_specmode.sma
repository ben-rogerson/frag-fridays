// Frag Fridays spectator camera. Two things, both about what a dead player
// looks at: they land in their killer's own first-person view instead of the
// free-fly camera, and the two map-overview modes are gone from the cycle
// because on most of our maps they are a black screen.
//
// ---------------------------------------------------------------------------
// PART ONE: first person is the camera you get when you die.
//
// WHAT THE DLL DOES ON ITS OWN. Measured 2026-09-05 in a throwaway classical
// container with a probe plugin logging every iuser1 transition:
//
//   t+0.00s  DeathMsg, and in the same frame iuser1 0 -> 2 (CHASE_FREE),
//            iuser2 already pointing at a live player
//   t+4.5s   iuser1 2 -> 3 (ROAMING), iuser2 cleared
//
// So the camera you actually settle in is the free-fly one, five seconds after
// you die, and the chase cam is only the death-cam moment on the way there.
// The 4.5s step is StartObserver running Observer_SetMode(m_iObserverLastMode),
// and m_iObserverLastMode starts at ROAMING - which also means the dll DOES
// remember a mode you picked yourself and reuses it on your next death.
//
// WHAT WE DO. From the death until the player touches the camera cycle, the
// mode is rewritten to IN_EYE and the target to the killer - so you are behind
// their eyes from the frame you die, watching what they do next. It has to be
// every frame, not once: the dll's own 4.5s switch to ROAMING lands well after
// the death frame and would take the camera straight back.
//
// THE KILLER IS NOT THE DLL'S PICK. Left alone, the dll aims you at
// Observer_FindNextPlayer's first candidate - measured on the rig, that is the
// same low player index for everybody, whoever actually killed them. The
// killer comes from the DeathMsg itself. When there is no killer to watch (a
// suicide, the world, a killer who dies or leaves while you are on them) we
// fall back to the dll's target if it is alive, then to anyone alive, and once
// the killer is gone we do not snap back to them if they respawn.
//
// AND THEN WE STOP. The first jump press (or a spectator-menu "specmode")
// while dead hands the camera back for good - that death and every one after
// it, because the dll's remembered mode is then the player's own choice and
// forcing first person over it every death would be the more annoying bug.
// Bots are skipped: nobody is looking through them.
//
// ---------------------------------------------------------------------------
// PART TWO: the map-overview modes.
//
// THE BUG. Spectating, the jump key cycles the camera. CS's own cycle (in the
// game dll's Observer_HandleButtons) is:
//
//   CHASE_LOCKED -> CHASE_FREE -> IN_EYE -> ROAMING -> MAP_FREE -> MAP_CHASE
//   -> back to CHASE_FREE
//
// The last two are the top-down radar views ("Free Map Overview" / "Chase Map
// Overview"). They draw cstrike/overviews/<map>.bmp as the backdrop. If the
// client has no overview file for the map, cs16-client falls back to its bare
// green grid on black - and 16 of the 30 maps across our rotations have no
// overview file at all. Verified live 2026-09-05 with a real browser client on
// the fy mod: fy_desert (has an overview) renders the map image with the red
// and blue player icons; fy_iceworld (has none) renders black + grid. So a
// spectator on fy_iceworld hits two dead camera modes on the way round.
//
// The maps with nothing to draw: awp_city, awp_dust, awp_sunburn, css_bycastor,
// css_cache, css_deagle, css_dust2_go, css_mirage_go, aim_map, cs_deagle5,
// cs_prospeedball, fy_iceworld, fy_pool_day, fy_houses, fy_snow, scoutzknivez.
// That is all of awp, five of six css maps and four of six fy maps. Only the
// stock CS maps ship overviews; the community maps we added did not, except
// de_rats / fy_desert / fy_nuketown / de_bank_csgo, which brought their own.
//
// WHY A PLUGIN AND NOT A CVAR. There isn't one, for either half. The mode list
// is hardcoded in the game dll's button handler, the starting mode is
// hardcoded in StartObserver, and the client's spectator menu forwards
// "specmode N" to the server, so every route ends at the same place: the
// server writing pev->iuser1. Nothing in between is configurable.
//
// WHY PER-FRAME AND NOT A COMMAND HOOK. Blocking the "specmode" client command
// would only cover the menu. The jump cycle never sends a command - the server
// reads the button itself - so the only thing that catches both is watching the
// value. Hooking PlayerPreThink POST puts us immediately after
// Observer_HandleButtons ran, in the same frame it changed the mode, so the
// state never reaches the client and there is no flash of black.
//
// WHERE IT LANDS THEM. CHASE_FREE, which is where CS's own cycle goes after
// MAP_CHASE - so jump from Free Look now simply wraps to chase and the ring is
// CHASE_LOCKED -> CHASE_FREE -> IN_EYE -> ROAMING -> (wrap). Chase needs a
// target: if iuser2 is not a live player we pick one, and if the server has
// nobody alive to watch we leave them in ROAMING, which is the only mode that
// works with an empty server anyway. That is also the fallback the death
// camera drops to once the killer is gone.
//
// THE CENTRE MESSAGE. The game dll announces every mode change itself, as a
// TextMsg carrying the token "#Spec_Mode<n>" which the client localises ("Free
// Overview", "Chase Free", ...). That send happens inside the same PreThink,
// before we get to correct the mode, so without this the screen says "Free
// Overview" while you are looking at a chase cam. Every token we are about to
// overrule is rewritten to the mode we actually put the player in.
//
// THE TRADE. This also removes the overview on the maps where it DOES work
// (all of aim / classical / cpl, and most of dm and gg). That is deliberate -
// the alternative was generating the 16 missing overview images. If those ever
// get made, delete that half rather than making it map-aware: a server-side
// file check would be wrong, because containers mount only cs/cstrike/maps and
// the custom overviews are client-only assets that ride valve.zip.
//
// Live kill switches: pnpm run rc "ff_specmode_block 0" (overview modes back),
// pnpm run rc "ff_specmode_eye 0" (death camera back to the dll's own).

#include <amxmodx>
#include <fakemeta>

// engine observer modes (hlsdk const.h) - not in any amxmodx include
#define OBS_NONE         0
#define OBS_CHASE_LOCKED 1
#define OBS_CHASE_FREE   2
#define OBS_ROAMING      3
#define OBS_IN_EYE       4
#define OBS_MAP_FREE     5
#define OBS_MAP_CHASE    6

new g_pBlock;
new g_pEye;
new g_maxPlayers;

// this death's camera is ours to aim, until they take it back
new bool:g_eyePending[33];
// ...which they do by cycling it themselves, once, and then it is theirs
new bool:g_eyeChosen[33];
// their buttons on the previous frame, to catch the jump PRESS and not the hold
new g_eyeButtons[33];
// who killed them, while that player is still worth looking through
new g_eyeKiller[33];

public plugin_init()
{
	register_plugin("Frag Fridays Spectator Modes", "0.2.0", "frag-friday");

	g_pBlock = register_cvar("ff_specmode_block", "1");
	g_pEye = register_cvar("ff_specmode_eye", "1");
	g_maxPlayers = get_maxplayers();

	// POST: run after the game dll's Observer_HandleButtons has already moved
	// the mode on this frame, so we correct it before the client is told
	register_forward(FM_PlayerPreThink, "fw_prethink_post", 1);

	// ...and relabel the announce the game dll already sent for that mode
	register_message(get_user_msgid("TextMsg"), "msg_textmsg");

	// the moment the camera becomes a question
	register_event("DeathMsg", "ev_death", "a");

	// the spectator menu's route to a mode - the other way a player chooses
	register_clcmd("specmode", "cmd_specmode");
}

public client_putinserver(id)
{
	g_eyePending[id] = false;
	g_eyeChosen[id] = false;
	g_eyeButtons[id] = 0;
	g_eyeKiller[id] = 0;
}

public ev_death()
{
	new victim = read_data(2);
	if (victim < 1 || victim > g_maxPlayers || is_user_bot(victim))
		return;

	// arg 1 is the killer; it is the victim again for a suicide and 0 for the
	// world, and eye_target() sorts both out
	new killer = read_data(1);
	g_eyeKiller[victim] = (killer != victim) ? killer : 0;

	g_eyePending[victim] = !g_eyeChosen[victim];
	// baseline for the press edge, so a jump held through the death itself
	// does not read as a choice
	g_eyeButtons[victim] = pev(victim, pev_button);
}

public cmd_specmode(id)
{
	if (g_eyePending[id])
	{
		g_eyePending[id] = false;
		g_eyeChosen[id] = true;
	}

	return PLUGIN_CONTINUE;
}

public msg_textmsg(msgid, dest, id)
{
	if (id < 1 || id > g_maxPlayers)
		return PLUGIN_CONTINUE;

	// arg 1 is the print destination byte; arg 2 is the token or literal
	if (get_msg_args() < 2 || get_msg_argtype(2) != ARG_STRING)
		return PLUGIN_CONTINUE;

	new token[16];
	get_msg_arg_string(2, token, charsmax(token));

	if (!equal(token, "#Spec_Mode", 10))
		return PLUGIN_CONTINUE;

	// every mode the dll announces during a steered death is a mode we are
	// about to replace, so the label follows the camera rather than the dll
	if (g_eyePending[id] && get_pcvar_num(g_pEye) && eye_target(id))
	{
		set_msg_arg_string(2, "#Spec_Mode4");
		return PLUGIN_CONTINUE;
	}

	if (!get_pcvar_num(g_pBlock))
		return PLUGIN_CONTINUE;

	if (!equal(token, "#Spec_Mode5") && !equal(token, "#Spec_Mode6"))
		return PLUGIN_CONTINUE;

	// same decision fw_prethink_post is about to make, so the label matches
	// the camera the player actually ends up in
	if (chase_target(id))
		set_msg_arg_string(2, "#Spec_Mode2");
	else
		set_msg_arg_string(2, "#Spec_Mode3");

	return PLUGIN_CONTINUE;
}

public fw_prethink_post(id)
{
	// 0 for anyone playing normally, so this is the whole cost for them
	new mode = pev(id, pev_iuser1);
	if (mode == OBS_NONE)
	{
		if (g_eyePending[id])
			g_eyePending[id] = false;	// respawned

		return FMRES_IGNORED;
	}

	if (g_eyePending[id] && get_pcvar_num(g_pEye))
	{
		new buttons = pev(id, pev_button);
		new pressed = buttons & ~g_eyeButtons[id];
		g_eyeButtons[id] = buttons;

		if (pressed & IN_JUMP)
		{
			// they cycled it themselves: hands off, now and every death after
			g_eyePending[id] = false;
			g_eyeChosen[id] = true;
		}
		else
		{
			new target = eye_target(id);
			if (target)
			{
				// the target matters as much as the mode: the dll moves you
				// off a target that dies, so this is also what keeps you on
				// the killer for as long as they are alive
				set_pev(id, pev_iuser2, target);
				set_pev(id, pev_iuser1, OBS_IN_EYE);
				return FMRES_IGNORED;
			}

			// nobody alive to look through - let the dll's mode stand, and
			// try again next frame
		}
	}

	if (!get_pcvar_num(g_pBlock))
		return FMRES_IGNORED;

	if (mode != OBS_MAP_FREE && mode != OBS_MAP_CHASE)
		return FMRES_IGNORED;

	new target = chase_target(id);
	if (target)
	{
		set_pev(id, pev_iuser2, target);
		set_pev(id, pev_iuser1, OBS_CHASE_FREE);
	}
	else
	{
		// nobody alive to chase - CS would have forced this itself
		set_pev(id, pev_iuser1, OBS_ROAMING);
	}

	return FMRES_IGNORED;
}

// who a player we just killed off should be looking through: their killer
// while that is a live player, else the same rule as the chase cam. The killer
// is forgotten once they are not watchable, so a respawn does not yank the
// camera back to them.
eye_target(id)
{
	new killer = g_eyeKiller[id];
	if (killer > 0 && killer <= g_maxPlayers && is_user_connected(killer) && is_user_alive(killer))
		return killer;

	g_eyeKiller[id] = 0;
	return chase_target(id);
}

// who this spectator would watch: whoever they were already on, else anyone
// alive, else 0 for "the server has nothing to watch"
chase_target(id)
{
	new target = pev(id, pev_iuser2);
	if (target > 0 && target <= g_maxPlayers && is_user_connected(target) && is_user_alive(target))
		return target;

	new players[32], num;
	get_players(players, num, "a");	// alive only
	return num ? players[0] : 0;
}
