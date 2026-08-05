// !restart - restart the current round from chat.
//
// Casual-server escape hatch for rounds stuck in a weird state (bots camped,
// objective wedged, players wedged in spectate by the browser stack).
// Deliberately not admin-gated - sessions run without admins. A pending
// latch stops chat spam queueing several restarts.
//
// Stuck players don't know the way out, so a 10s ticker nags anyone who has
// sat dead or spectating through two consecutive ticks. The two-tick grace
// keeps normal between-round deaths (instant respawn makes any real death
// shorter than one tick) from triggering it. Spectators and unassigned
// players are nagged too, not skipped: the engine's one-team-change-per-round
// limit rejects F1/F2 ("Only 1 team change is allowed"), so a round restart
// is their only way back in.
//
// Not installed on kz: /restart there means "reset my own run", and a round
// restart would wipe every player's timer.

#include <amxmodx>

new bool:g_pending;
new g_deadTicks[33];

public plugin_init()
{
	register_plugin("Chat Restart", "0.3.0", "frag-friday");
	register_clcmd("say", "cmd_say");
	register_clcmd("say_team", "cmd_say");
	set_task(10.0, "task_nag_spectators", _, _, _, "b");
}

public cmd_say(id)
{
	new said[16];
	read_args(said, charsmax(said));
	remove_quotes(said);
	trim(said);

	if (!equali(said, "!restart") && !equali(said, "/restart"))
		return PLUGIN_CONTINUE;

	if (g_pending)
		return PLUGIN_CONTINUE;
	g_pending = true;

	new name[32];
	get_user_name(id, name, charsmax(name));
	client_print(0, print_chat, "[SERVER] %s called a round restart - 3 seconds...", name);
	set_task(3.0, "task_restart");
	return PLUGIN_CONTINUE;
}

public task_restart()
{
	g_pending = false;
	server_cmd("sv_restartround 1");
}

public task_nag_spectators()
{
	for (new id = 1; id <= get_maxplayers(); id++)
	{
		if (!is_user_connected(id) || is_user_bot(id) || is_user_hltv(id)
			|| is_user_alive(id))
		{
			g_deadTicks[id] = 0;
			continue;
		}

		if (++g_deadTicks[id] >= 2)
			client_print(id, print_chat, "[SERVER] stuck as a spectator? press Y and type !restart to restart the round");
	}
}
