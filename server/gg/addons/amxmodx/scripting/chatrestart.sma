// !restart - restart the current round from chat.
//
// Casual-server escape hatch for rounds stuck in a weird state (bots camped,
// objective wedged). Deliberately not admin-gated - sessions run without
// admins. A pending latch stops chat spam queueing several restarts.
//
// Not installed on kz: /restart there means "reset my own run", and a round
// restart would wipe every player's timer.

#include <amxmodx>

new bool:g_pending;

public plugin_init()
{
	register_plugin("Chat Restart", "0.1.0", "frag-friday");
	register_clcmd("say", "cmd_say");
	register_clcmd("say_team", "cmd_say");
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
