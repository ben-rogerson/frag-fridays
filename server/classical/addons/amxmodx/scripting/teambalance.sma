// Frag Fridays team balance - on-demand team evening and side swapping via
// the cmdpipe.
//
// The F1/F2 join binds send humans to whichever key they pressed, and
// yb_kick_after_player_connect frees a bot slot without caring which team
// the leaving bot was on, so a session drifts lopsided (6v3). Stock
// mp_autoteambalance is deliberately off (see the Dockerfile note), so this
// registers ff_rebalance: a server command (pnpm run rebalance, or the
// rebalance_teams MCP tool) that evens the T/CT headcount immediately.
//
// ff_swapteams is the other half: every player changes sides at once, which
// is what a session wants after a one-sided map rather than an even one.
// The war room's Teams panel drives both.
//
// Policy: while the sides differ by 2+, move one player from the larger
// team - bots first, then the human with the fewest frags (least invested
// in the current map). Moves are server-side, so the client's
// one-team-change-per-round limit never applies. A moved player is slain
// with frags kept; both gg and dm run instant respawn, so they pop straight
// back up on their new side.
//
// Why raw pdata and not cs_set_user_team: the cstrike module's team WRITE
// crashes this stack (segfault in CPlayer::ResetModel -> PostponeModelUpdate
// against the reimplemented CS DLL - observed in a throwaway boot test
// 2026-08-05, same failure class that killed CSDM). Module READS are proven
// (frag_dm ships cs_get_user_team), so this plugin writes m_iTeam with
// fakemeta at the very offset cs_get_user_team reads, and verifies every
// write through cs_get_user_team before touching the next player. On any
// mismatch it aborts loudly rather than corrupt pdata.

#include <amxmodx>
#include <cstrike>
#include <fakemeta>
#include <fun>

// m_iTeam / m_iModelName private offsets, identical to the cstrike module's
// (fakemeta's default +5 linuxdiff applies, matching the module)
#define OFFSET_TEAM 114
#define OFFSET_MODEL 126
// CsInternalModel: spawn derives the player model from m_iModelName, so give
// movers a stock class on the new side
#define MODEL_T_TERROR 2
#define MODEL_CT_URBAN 1

public plugin_init()
{
	register_plugin("Frag Fridays Team Balance", "0.3.0", "frag-friday");
	register_srvcmd("ff_rebalance", "cmd_rebalance");
	register_srvcmd("ff_swapteams", "cmd_swapteams");
}

count_teams(&tCount, &ctCount)
{
	new players[32], num;
	get_players(players, num);
	tCount = 0;
	ctCount = 0;
	for (new i = 0; i < num; i++)
	{
		switch (cs_get_user_team(players[i]))
		{
			case CS_TEAM_T: tCount++;
			case CS_TEAM_CT: ctCount++;
		}
	}
}

// bots are free to move; among humans take the fewest frags
pick_from(CsTeams:team)
{
	new players[32], num;
	get_players(players, num);
	new pick = 0, pickFrags = 999999;
	for (new i = 0; i < num; i++)
	{
		new id = players[i];
		if (cs_get_user_team(id) != team)
			continue;
		if (is_user_bot(id))
			return id;
		new frags = get_user_frags(id);
		if (frags < pickFrags)
		{
			pickFrags = frags;
			pick = id;
		}
	}
	return pick;
}

// raw m_iTeam write, sanity-checked through the cstrike module's read on
// both sides. Returns false (and aborts the caller's loop) on any mismatch.
bool:transfer(id, CsTeams:to)
{
	if (get_pdata_int(id, OFFSET_TEAM) != _:cs_get_user_team(id))
	{
		server_print("[rebalance] ABORT: pdata offset %d disagrees with cs_get_user_team - offsets moved, not writing", OFFSET_TEAM);
		return false;
	}

	set_pdata_int(id, OFFSET_TEAM, _:to);
	set_pdata_int(id, OFFSET_MODEL, to == CS_TEAM_T ? MODEL_T_TERROR : MODEL_CT_URBAN);

	if (cs_get_user_team(id) != to)
	{
		server_print("[rebalance] ABORT: team write did not stick for #%d", id);
		return false;
	}

	// scoreboard + radar
	message_begin(MSG_ALL, get_user_msgid("TeamInfo"));
	write_byte(id);
	write_string(to == CS_TEAM_T ? "TERRORIST" : "CT");
	message_end();

	// respawn lands them on the new side (flag 1: frags kept)
	if (is_user_alive(id))
		user_kill(id, 1);
	return true;
}

public cmd_rebalance()
{
	new t, ct;
	count_teams(t, ct);

	new moved = 0;
	while ((t > ct ? t - ct : ct - t) >= 2)
	{
		new bool:fromT = t > ct;
		new id = pick_from(fromT ? CS_TEAM_T : CS_TEAM_CT);
		if (!id)
			break;
		if (!transfer(id, fromT ? CS_TEAM_CT : CS_TEAM_T))
			break;

		if (fromT) { t--; ct++; } else { ct--; t++; }
		moved++;
	}

	if (moved)
	{
		set_hudmessage(0, 255, 0, -1.0, 0.35, 0, 0.0, 6.0, 0.5, 0.15);
		show_hudmessage(0, "Teams rebalanced: moved %d player%s (now %d v %d)",
			moved, moved == 1 ? "" : "s", t, ct);
	}
	server_print("[rebalance] %s - T %d v CT %d (moved %d)",
		moved ? "done" : "teams already even", t, ct, moved);
	return PLUGIN_HANDLED;
}

// Flip every side at once. The player list is snapshotted before the first
// write because transfer() slays the mover, and a slain player is still on
// the list - what must not happen is reading a team back after it changed
// and swapping the same player twice.
public cmd_swapteams()
{
	new players[32], num;
	get_players(players, num);

	new CsTeams:was[32];
	for (new i = 0; i < num; i++)
		was[i] = cs_get_user_team(players[i]);

	new moved = 0;
	for (new i = 0; i < num; i++)
	{
		if (was[i] != CS_TEAM_T && was[i] != CS_TEAM_CT)
			continue; // spectators and the unassigned stay put
		if (!transfer(players[i], was[i] == CS_TEAM_T ? CS_TEAM_CT : CS_TEAM_T))
			break; // transfer() said the offsets moved - stop before corrupting more
		moved++;
	}

	new t, ct;
	count_teams(t, ct);

	if (moved)
	{
		set_hudmessage(0, 255, 0, -1.0, 0.35, 0, 0.0, 6.0, 0.5, 0.15);
		show_hudmessage(0, "Teams swapped: %d player%s changed sides (now %d v %d)",
			moved, moved == 1 ? "" : "s", t, ct);
	}
	server_print("[swapteams] %s - T %d v CT %d (swapped %d)",
		moved ? "done" : "nobody to swap", t, ct, moved);
	return PLUGIN_HANDLED;
}
